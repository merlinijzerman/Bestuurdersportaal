// ============================================================================
//  #413 T4-B — De Copilot Retrieval-client.
// ----------------------------------------------------------------------------
//  Wat deze module WEL doet: één `POST` naar het vastgepinde endpoint, met een
//  server-side opgebouwde body, binnen een hard requestbudget en onder de
//  beurtdeadline, en een STRIKT geparseerd antwoord.
//
//  Wat deze module NIET doet, en bewust niet mag doen:
//    • rechten bepalen — een hit is een kandidaatsignaal, geen bewijs (T4-C);
//    • een URL vertrouwen, downloaden, extraheren of citeren;
//    • een token ophalen. De tokenbron wordt GEÏNJECTEERD. In #413 bestaat er
//      geen productie-implementatie die een token met `Files.Read.All` én
//      `Sites.Read.All` kan leveren (besluit D-2), dus is deze client in
//      productie onbereikbaar — hij faalt gesloten op readiness lang vóór hier;
//    • iets loggen. Geen URL, geen body, geen header, geen extract.
//
//  RETRY. Het budget telt FEITELIJKE netwerkpogingen. Bij budget 1 vertrekt er
//  precies één request en is een 429 dus een eindresultaat. Alleen 429 en 5xx
//  mogen een volgende poging krijgen; na 401/402/403, een vormfout, een
//  annulering of een verlopen deadline volgt er niets meer.
//
//  GEEN `Retry-After`. Die header komt van de provider en kan minuten groot
//  zijn; hem volgen zou de beurtdeadline laten opeten door een waarde die wij
//  niet kiezen. De backoff is daarom van onszelf, kort, en altijd onderbreekbaar.
// ============================================================================
import {
  COPILOT_DATA_SOURCE,
  COPILOT_MAX_REQUESTBUDGET,
  COPILOT_MAX_VRAAGTEKENS,
  COPILOT_RETRIEVAL_ENDPOINT,
  begrensResultaten,
} from "./endpoint";
import { bouwFilterExpression, bouwQueryString } from "./filter";
import { CopilotFout, foutVoorHttpStatus, normaliseerCopilotFout } from "./fouten";
import { slaapMetSignaal } from "../retrieval/afbreken";

/** Harde bovengrens op ONTVANGEN BYTES; daarboven stopt het lezen. */
export const COPILOT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Backoff tussen pogingen, in volgorde. Kort, en altijd onderbreekbaar. */
const BACKOFF_MS = [400, 1_200] as const;

/**
 * De adapterprivate vorm van één kandidaat. `webUrl` is hier NIETS MEER DAN EEN
 * STRING uit een externe bron: hij is niet gevalideerd, niet vertrouwd en mag
 * de adaptergrens niet passeren. T4-C toetst hem tegen de herlezen root en het
 * bronregister, en pas een verse DriveItem-lezing maakt er een bron van.
 */
export interface CopilotKandidaat {
  webUrl: string;
  extracts: string[];
}

export interface CopilotUitkomst {
  kandidaten: CopilotKandidaat[];
  /** Alleen vorm en aantallen; nooit een veldwaarde uit de providerrespons. */
  responsTelling: CopilotResponsTelling;
  /** Feitelijke netwerkpogingen, backoff-herhalingen meegerekend. */
  netwerkpogingen: number;
  latencyMs: number;
}

export interface CopilotResponsTelling {
  retrievalHitsVeld: "ontbreekt" | "null" | "array";
  ruweHits: number;
  hitsZonderLocator: number;
}

export interface CopilotTokenbron {
  /** Levert een delegated token. Werpt als er geen geldig token te krijgen is. */
  (): Promise<{ accessToken: string }>;
}

export interface CopilotOpdracht {
  /** De vraag van de gebruiker; wordt genormaliseerd en begrensd. */
  vraag: string;
  /** Root-URL uit de OPNIEUW GELEZEN bronregistratie, nooit uit een request. */
  rootWebUrl: string;
  /** `site_hostnaam` uit diezelfde registratie; moet de root bevestigen. */
  siteHostnaam: string;
  /** Gewenst aantal kandidaten; wordt op de Microsoft-grens geklemd. */
  maxKandidaten: number;
  tokenbron: CopilotTokenbron;
  signal: AbortSignal;
  /** Feitelijke netwerkpogingen die deze call mag doen. Default 1. */
  requestBudget?: number;
  /** Uitsluitend voor tests; productie gebruikt de globale `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Strikte parsing: alles wat niet exact de verwachte vorm heeft, valt af. */
function leesKandidaten(payload: unknown, max: number): Pick<CopilotUitkomst, "kandidaten" | "responsTelling"> {
  if (typeof payload !== "object" || payload === null) {
    throw new CopilotFout("copilot_responsvorm", "configuratiefout");
  }
  const hits = (payload as { retrievalHits?: unknown }).retrievalHits;
  // Een ontbrekend veld is een LEGE UITSLAG — een geldige kwaliteitsuitkomst.
  // Een veld dat er wél is maar geen array: dat is een vorm die wij niet kennen,
  // en dan stoppen we in plaats van te gokken wat ermee bedoeld was.
  if (hits === undefined || hits === null) {
    return {
      kandidaten: [],
      responsTelling: { retrievalHitsVeld: hits === null ? "null" : "ontbreekt", ruweHits: 0, hitsZonderLocator: 0 },
    };
  }
  if (!Array.isArray(hits)) throw new CopilotFout("copilot_responsvorm", "configuratiefout");

  const kandidaten: CopilotKandidaat[] = [];
  // Tel ook hits ná het kandidaatplafond. Zo is zichtbaar of nul kandidaten
  // werkelijk nul providerhits betekent, zonder één inhoudsveld te vervoeren.
  const hitsZonderLocator = hits.reduce((aantal: number, hit: unknown) => {
    const webUrl = typeof hit === "object" && hit !== null
      ? (hit as { webUrl?: unknown }).webUrl
      : undefined;
    return aantal + (typeof webUrl !== "string" || webUrl.length === 0 ? 1 : 0);
  }, 0);
  for (const hit of hits) {
    if (kandidaten.length >= max) break;
    if (typeof hit !== "object" || hit === null) {
      throw new CopilotFout("copilot_responsvorm", "configuratiefout");
    }
    const webUrl = (hit as { webUrl?: unknown }).webUrl;
    // Zonder locator is er niets te verifiëren; zo'n hit is geen kandidaat.
    // Dit is géén vormfout: Microsoft mag hits zonder webUrl teruggeven.
    if (typeof webUrl !== "string" || webUrl.length === 0) continue;

    const ruweExtracts = (hit as { extracts?: unknown }).extracts;
    if (ruweExtracts !== undefined && ruweExtracts !== null && !Array.isArray(ruweExtracts)) {
      throw new CopilotFout("copilot_responsvorm", "configuratiefout");
    }
    const extracts: string[] = [];
    for (const extract of Array.isArray(ruweExtracts) ? ruweExtracts : []) {
      const tekst = typeof extract === "object" && extract !== null
        ? (extract as { text?: unknown }).text
        : undefined;
      if (typeof tekst === "string" && tekst.trim().length > 0) extracts.push(tekst);
    }
    kandidaten.push({ webUrl, extracts });
  }
  return {
    kandidaten,
    responsTelling: { retrievalHitsVeld: "array", ruweHits: hits.length, hitsZonderLocator },
  };
}

/**
 * Leest het antwoord met een grens op ONTVANGEN BYTES, incrementeel.
 *
 * Twee dingen gingen hier eerder mis, en ze versterkten elkaar. `response.text()`
 * buffert de héle body voordat er iets te meten valt — bij een chunked antwoord
 * zonder `content-length` is de grens dan pas bereikt als het geheugen al
 * gevuld is. En `tekst.length` telt UTF-16-code-units, geen bytes: een
 * UTF-8-antwoord van 2.700.105 bytes aan driebytetekens telt 900.105 "tekens"
 * en kwam zo onder elke grens door.
 *
 * Nu wordt er per chunk geteld op `byteLength` en wordt de reader geannuleerd
 * zodra de grens wordt overschreden — de rest van de body komt dan niet meer
 * binnen. De `content-length`-controle blijft ervóór staan: die weigert een te
 * groot antwoord zonder er ook maar één byte van te lezen.
 */
async function leesBegrensdeTekst(response: Response): Promise<string> {
  const lengte = Number(response.headers.get("content-length"));
  if (Number.isFinite(lengte) && lengte > COPILOT_MAX_RESPONSE_BYTES) {
    throw new CopilotFout("copilot_responsvorm", "configuratiefout");
  }

  const body = response.body;
  if (!body) {
    // Geen stream (een body-loos antwoord): dan is er niets meer te begrenzen,
    // maar meet wél in bytes in plaats van in tekens.
    const tekst = await response.text();
    if (new TextEncoder().encode(tekst).byteLength > COPILOT_MAX_RESPONSE_BYTES) {
      throw new CopilotFout("copilot_responsvorm", "configuratiefout");
    }
    return tekst;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let bytes = 0;
  let tekst = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > COPILOT_MAX_RESPONSE_BYTES) {
        // Annuleren, niet doorlezen: de rest van de body hoeft niet meer te
        // worden ontvangen en al helemaal niet gedecodeerd.
        await reader.cancel().catch(() => {});
        throw new CopilotFout("copilot_responsvorm", "configuratiefout");
      }
      // `stream: true` houdt een multibyte teken heel dat over twee chunks valt.
      tekst += decoder.decode(value, { stream: true });
    }
    return tekst + decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Een reader die al geannuleerd is, laat zich niet vrijgeven; dat is geen
      // fout en mag de eigenlijke uitkomst niet overschrijven.
    }
  }
}

/**
 * Eén retrievalcall. Bouwt de body server-side, toetst de vorm vóór het
 * netwerk, en geeft uitsluitend ONGEVERIFIEERDE kandidaten terug.
 */
export async function roepCopilotRetrievalAan(opdracht: CopilotOpdracht): Promise<CopilotUitkomst> {
  const budget = opdracht.requestBudget ?? 1;
  if (!Number.isInteger(budget) || budget < 1 || budget > COPILOT_MAX_REQUESTBUDGET) {
    throw new CopilotFout("copilot_budget", "configuratiefout");
  }

  // VORM EERST, NETWERK DAARNA. Een ongeldig filter of een lege vraag mag nooit
  // als ongescopete, geslaagde call vertrekken.
  const filter = bouwFilterExpression(opdracht.rootWebUrl, opdracht.siteHostnaam);
  if (!filter.ok) throw new CopilotFout("copilot_configuratie", "configuratiefout");
  const vraag = bouwQueryString(opdracht.vraag, COPILOT_MAX_VRAAGTEKENS);
  if (!vraag.ok) throw new CopilotFout("copilot_configuratie", "configuratiefout");

  const maximumNumberOfResults = begrensResultaten(opdracht.maxKandidaten);
  const body = JSON.stringify({
    queryString: vraag.queryString,
    dataSource: COPILOT_DATA_SOURCE,
    filterExpression: filter.filterExpression,
    maximumNumberOfResults,
  });

  const doeFetch = opdracht.fetchImpl ?? fetch;
  const start = Date.now();
  let netwerkpogingen = 0;
  let laatste: CopilotFout | null = null;

  for (let poging = 0; poging < budget; poging++) {
    // Vóór ELKE poging: is de beurt nog gaande? Een afgebroken beurt mag geen
    // quotum meer kosten.
    if (opdracht.signal.aborted) throw normaliseerCopilotFout(opdracht.signal.reason);

    // Het token wordt per poging opgehaald: bij een herhaling na 5xx kan het
    // inmiddels vernieuwd zijn, en een verlopen token opnieuw versturen levert
    // gegarandeerd een 401 op.
    const { accessToken } = await opdracht.tokenbron().catch((fout: unknown) => {
      throw normaliseerCopilotFout(fout);
    });

    netwerkpogingen++;
    let response: Response;
    try {
      response = await doeFetch(COPILOT_RETRIEVAL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal: opdracht.signal,
        // Geen enkele omleiding volgen: dat zou de endpointpin zinloos maken en
        // het token naar een andere host kunnen sturen.
        redirect: "manual",
      });
    } catch (fout) {
      laatste = normaliseerCopilotFout(fout);
      if (!laatste.herhaalbaar || poging === budget - 1) throw laatste;
      await slaapMetSignaal(BACKOFF_MS[Math.min(poging, BACKOFF_MS.length - 1)], opdracht.signal);
      continue;
    }

    if (!response.ok) {
      laatste = foutVoorHttpStatus(response.status);
      if (!laatste.herhaalbaar || poging === budget - 1) throw laatste;
      await slaapMetSignaal(BACKOFF_MS[Math.min(poging, BACKOFF_MS.length - 1)], opdracht.signal);
      continue;
    }

    const tekst = await leesBegrensdeTekst(response);
    let payload: unknown;
    try {
      payload = JSON.parse(tekst);
    } catch {
      // Een onleesbaar antwoord is een vormfout en wordt NIET herhaald: dezelfde
      // vraag levert hetzelfde onleesbare antwoord, en het kost quotum.
      throw new CopilotFout("copilot_responsvorm", "configuratiefout");
    }
    return {
      ...leesKandidaten(payload, maximumNumberOfResults),
      netwerkpogingen,
      latencyMs: Date.now() - start,
    };
  }

  // Alleen bereikbaar als het budget op is na uitsluitend herhaalbare fouten.
  throw laatste ?? new CopilotFout("copilot_budget", "configuratiefout");
}
