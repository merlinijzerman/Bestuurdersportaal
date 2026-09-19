// ============================================================================
//  #407 — Microsoft 365 Copilot Retrieval API als vierde MEETARM.
// ----------------------------------------------------------------------------
//  Deze module hoort bij het geïsoleerde spikeharnas van #353/#403. Zij is niet
//  aan chat, zoeken, vergelijken, de AI-gateway of de Preview-smokebrug
//  gekoppeld; de boundarygate `npm run test:spike-boundary` bewaakt dat.
//
//  Het uitgangspunt van het hele bestand: een Copilot-extract is GEEN bewijs.
//  Het is een onbetrouwbaar kandidaatsignaal totdat bron, actor, root, rechten
//  en actuele versie zelfstandig zijn bewezen, en totdat het extract uniek is
//  teruggevonden in de tekst die wij zélf uit het actuele bestand hebben
//  gehaald. Elke andere uitkomst valt fail-closed af.
// ============================================================================
import type { TekstSegment } from "../../../core/lib/document-extractie";
import {
  GraphClient,
  MAX_CONCURRENCY,
  MAX_PASSAGE_TEKENS,
  bronVingerafdruk,
  escapeKql,
  graphPadIsGelijkOfOnder,
  graphPadVanRoot,
  isFataleKandidaatFout,
  itemAfwijscategorie,
  itemUrl,
  leesGeldigeBron,
  maakKandidaat,
  nieuweAfwijzingen,
  nieuweMeting,
  parallelBegrensd,
  standaardWacht,
  veiligeSharePointUrl,
  wijsKandidaatAf,
  alsSpikeError,
  type GraphDriveItem,
  type PassageStrategie,
  type SpikeDependencies,
  type ZoekHit,
} from "./prototype";
import type {
  SpikeAfwijzingen,
  SpikeBronresultaat,
  SpikeBronSnapshot,
  SpikeCopilotUitkomst,
  SpikeDocumentMapping,
  SpikeError as SpikeErrorType,
  SpikeVraag,
} from "./types";
import { SpikeError } from "./types";

// ---------------------------------------------------------------------------
//  Vaste API- en productgrenzen uit #407. Geen beta-endpoint, geen tweede
//  databron, geen impliciete fallback.
// ---------------------------------------------------------------------------
export const COPILOT_RETRIEVAL_URL = "https://graph.microsoft.com/v1.0/copilot/retrieval";
export const COPILOT_DATA_SOURCE = "sharePoint" as const;
/** Microsoft-grens; de spike blijft er met een eigen budget ver onder. */
export const COPILOT_MAX_RESULTATEN = 25;
export const COPILOT_MAX_VRAAGTEKENS = 1_500;
/**
 * Strengere lokale spikegrens bovenop de Microsoft-grens van 200/uur/gebruiker.
 * Dit is het MAXIMUM dat een aanroeper mag vragen; de standaard is 1. Het budget
 * telt feitelijke netwerkpogingen, backoff-herhalingen meegerekend.
 */
export const COPILOT_LOKAAL_REQUESTBUDGET = 3;

/** Minimale tekenlengte waaronder een extract nooit als lokalisatiebewijs telt. */
export const COPILOT_MIN_EXTRACT_TEKENS = 24;

export interface CopilotRetrievalOpdracht {
  correlationId: string;
  vraag: SpikeVraag;
  signal?: AbortSignal;
  timeoutMs?: number;
  concurrency?: number;
  /** Lokale spikegrens; wordt geclampt op `COPILOT_LOKAAL_REQUESTBUDGET`. */
  requestBudget?: number;
}

/** Vorm van `POST /v1.0/copilot/retrieval` voor zover de spike hem gebruikt. */
type CopilotRetrievalAntwoord = {
  retrievalHits?: Array<{
    webUrl?: string;
    extracts?: Array<{ text?: string }>;
  }>;
};

// ---------------------------------------------------------------------------
//  Server-side filterconstructie en vormvalidatie
// ---------------------------------------------------------------------------

/**
 * Microsoft documenteert dat een syntactisch ongeldige KQL-filter ONGESCOPED kan
 * uitvoeren. Daarom wordt de exacte uitgaande filtervorm hier getoetst; faalt
 * die toets, dan vertrekt er geen netwerkcall. Browserinvoer bereikt deze
 * functie nooit — de root komt uit de opnieuw gelezen, serververtrouwde bron.
 */
/**
 * Toetsen op de GEDECODEERDE betekenis, niet alleen op de vorm. `new URL()`
 * percent-encodeert een aanhalingsteken in een pad stilzwijgend tot `%22`; een
 * filter die er daardoor schoon uitziet, kan aan de Microsoft-kant alsnog als
 * quote worden gelezen en de scope openbreken. Daarom mag het gedecodeerde pad
 * uitsluitend uit deze onschuldige tekens bestaan — géén quote, backslash,
 * wildcard, `%`, `#`, `?` of stuurteken. Een dubbel gecodeerd pad bevat na één
 * decodeerslag nog een `%` en valt hier dus ook af.
 */
const VEILIG_GEDECODEERD_PAD = /^(?:\/[A-Za-z0-9\-._~()& ]+)*$/;
/** Vorm van de uitgaande, opnieuw gecodeerde filter. */
const FILTER_VORM = /^path:"https:\/\/[a-z0-9-]+\.sharepoint\.com(?:\/(?:[A-Za-z0-9\-._~()&]|%[0-9A-F]{2})+)*"$/;

export function bouwCopilotFilterExpression(rootWebUrl: string): string {
  const veilig = veiligeSharePointUrl(rootWebUrl, new URL(rootWebUrl).hostname);
  if (!veilig) throw new SpikeError("configuratiefout", "copilot_filter_ongeldig");
  const parsed = new URL(veilig);
  // Query en fragment horen niet in een padscope en worden nooit doorgegeven.
  if (parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
    throw new SpikeError("configuratiefout", "copilot_filter_ongeldig");
  }

  let gedecodeerd: string;
  try {
    gedecodeerd = decodeURIComponent(parsed.pathname).normalize("NFC").replace(/\/+$/, "");
  } catch (cause) {
    throw new SpikeError("configuratiefout", "copilot_filter_ongeldig", { cause });
  }
  if (!gedecodeerd || !VEILIG_GEDECODEERD_PAD.test(gedecodeerd)) {
    throw new SpikeError("configuratiefout", "copilot_filter_ongeldig");
  }
  // escapeKql mag hier niets meer te doen hebben; is dat wel zo, dan zat er iets
  // in het pad dat wij niet als scope willen versturen.
  if (escapeKql(gedecodeerd) !== gedecodeerd) {
    throw new SpikeError("configuratiefout", "copilot_filter_ongeldig");
  }

  // Opnieuw coderen vanuit de gecontroleerde, gedecodeerde vorm; nooit de
  // binnengekomen codering overnemen.
  const pad = gedecodeerd.split("/").map((deel) => encodeURIComponent(deel)).join("/");
  const filter = `path:"${parsed.origin}${pad}"`;
  if (!FILTER_VORM.test(filter)) throw new SpikeError("configuratiefout", "copilot_filter_ongeldig");
  return filter;
}

/** Eén begrensde zin. Geen KQL, geen operators, geen stuurtekens. */
export function bouwCopilotQueryString(vraag: SpikeVraag): string {
  const ruw = (vraag.copilotVraag ?? vraag.vraag).normalize("NFKC");
  const schoon = ruw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!schoon || schoon.length > COPILOT_MAX_VRAAGTEKENS) {
    throw new SpikeError("configuratiefout", "copilot_vraag_ongeldig");
  }
  return schoon;
}

// ---------------------------------------------------------------------------
//  Locator: webUrl is uitsluitend een sleutel, nooit autoriteit
// ---------------------------------------------------------------------------

/**
 * Prefilter vóór élke vervolgcall: de hit-URL moet op dezelfde host staan als de
 * geconfigureerde site én binnen het pad van de opnieuw gelezen root vallen.
 * Alles daarbuiten valt af onder `root` zonder dat er een Graph-call op volgt.
 */
export function hitUrlBinnenRoot(webUrl: string | undefined, rootWebUrl: string, siteHostnaam: string): string | null {
  const veilig = veiligeSharePointUrl(webUrl, siteHostnaam);
  if (!veilig) return null;
  let hit: URL;
  let root: URL;
  try {
    hit = new URL(veilig);
    root = new URL(rootWebUrl);
  } catch {
    return null;
  }
  if (hit.origin !== root.origin) return null;
  const hitPad = decodeURIComponent(hit.pathname).normalize("NFC").replace(/\/+$/, "");
  const rootPad = decodeURIComponent(root.pathname).normalize("NFC").replace(/\/+$/, "");
  if (!rootPad || !graphPadIsGelijkOfOnder(hitPad, rootPad)) return null;
  return veilig;
}

/**
 * Canonieke vergelijkingsvorm voor een SharePoint-webUrl. Host in kleine letters,
 * pad gedecodeerd en genormaliseerd, query en fragment weg. Twee URL's die hierna
 * gelijk zijn, wijzen aantoonbaar naar hetzelfde bibliotheekpad.
 */
export function canoniekeWebUrl(url: string | undefined, siteHostnaam: string): string | null {
  const veilig = veiligeSharePointUrl(url, siteHostnaam);
  if (!veilig) return null;
  let parsed: URL;
  try {
    parsed = new URL(veilig);
  } catch {
    return null;
  }
  let pad: string;
  try {
    pad = decodeURIComponent(parsed.pathname).normalize("NFC").replace(/\/+$/, "");
  } catch {
    return null;
  }
  if (!pad || /[\u0000-\u001f\u007f]/.test(pad)) return null;
  return `${parsed.origin.toLowerCase()}${pad}`;
}

/**
 * Bouwt de `webUrl → itemId`-map volledig READ-ONLY vanaf de al geregistreerde
 * DriveItems.
 *
 * Waarom niet `/shares/{token}/driveItem`: Microsoft noemt daarvoor minimaal
 * delegated `Files.ReadWrite`. Deze spike mag geen schrijfrecht nodig hebben, dus
 * die route is bewust verwijderd. In plaats daarvan lezen we de items die al in
 * het private fixture-register staan op hun vertrouwde item-id — een gewone
 * `GET /drives/{drive}/items/{item}` die met `Files.Read.All`/`Sites.Read.All`
 * volstaat — en nemen we van elk item de actuele, door Graph zelf geleverde
 * `webUrl` als sleutel.
 *
 * De richting is daarmee omgedraaid en strenger: wij bepalen welke URL's bestaan,
 * en een Copilot-hit mag daar alleen exact op matchen. Een URL die wij niet zelf
 * hebben opgehaald, bestaat voor deze arm niet.
 *
 * Gevolg dat we bewust accepteren: Word- en PowerPoint-weergave-URL's (`/:w:/…`,
 * `/:p:/…`) matchen niet op het bibliotheekpad en vallen dus fail-closed af onder
 * `mapping`. Dat is een bekende beperking, geen stille afwijzing — de teller laat
 * het zien en het spike-rapport benoemt het.
 */
export async function bouwLocatorRegister(
  client: GraphClient,
  bron: SpikeBronSnapshot,
  rootGraphPad: string,
): Promise<Map<string, SpikeDocumentMapping>> {
  const register = new Map<string, SpikeDocumentMapping>();
  const dubbel = new Set<string>();
  for (const mapping of bron.documenten) {
    let item: GraphDriveItem;
    try {
      item = await client.json<GraphDriveItem>(itemUrl(bron, mapping.itemId));
    } catch (fout) {
      if (isFataleKandidaatFout(fout)) throw fout;
      // Een onleesbaar of verdwenen item levert simpelweg geen sleutel op.
      continue;
    }
    // De webUrl is pas een bruikbare sleutel als het item aantoonbaar aan de
    // gebonden drive, het verwachte id en de root hangt.
    if (item.id !== mapping.itemId || item.parentReference?.driveId !== bron.driveId || !item.file) continue;
    if (itemAfwijscategorie(item, bron, mapping, rootGraphPad) !== null) continue;
    const sleutel = canoniekeWebUrl(item.webUrl, bron.siteHostnaam);
    if (!sleutel) continue;
    // Twee registraties op dezelfde URL zijn ambigu; dan mag geen van beide
    // via een locator worden geraakt.
    if (register.has(sleutel)) {
      dubbel.add(sleutel);
      continue;
    }
    register.set(sleutel, mapping);
  }
  for (const sleutel of dubbel) register.delete(sleutel);
  return register;
}

// ---------------------------------------------------------------------------
//  Extractlokalisatie
// ---------------------------------------------------------------------------

/**
 * Normaliseert zoals het echte bestand genormaliseerd wordt: Unicode-vorm,
 * witruimte, typografische aanhalingstekens en streepjes. Zonder dit zou een
 * Copilot-extract dat inhoudelijk identiek is, op opmaak stuklopen.
 */
export function normaliseerVoorLokalisatie(tekst: string): string {
  return tekst
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("nl");
}

export interface Lokalisatie {
  passage: string;
  pagina: number | null;
  paragraaf: string | null;
}

/**
 * Zoekt het genormaliseerde extract in de zelf uitgelezen segmenten en eist dat
 * het daar **precies één keer** voorkomt. Meerdere treffers zijn ambigu: dan kan
 * niet worden aangewezen welke passage geciteerd wordt, en dus valt de kandidaat
 * af. De geretourneerde passage komt altijd uit de eigen extractie, nooit uit de
 * Microsoft-tekst.
 */
export function lokaliseerExtract(segmenten: TekstSegment[], extract: string): Lokalisatie | null {
  const naald = normaliseerVoorLokalisatie(extract);
  if (naald.length < COPILOT_MIN_EXTRACT_TEKENS) return null;

  const treffers: Lokalisatie[] = [];
  for (const segment of segmenten) {
    const delen = segment.pagina === null
      ? segment.tekst.split(/\n\s*\n+/).map((tekst, index) => ({ tekst, paragraaf: `Alinea ${index + 1}` }))
      : [{ tekst: segment.tekst, paragraaf: segment.paragraaf }];
    for (const deel of delen) {
      const hooi = normaliseerVoorLokalisatie(deel.tekst);
      let vanaf = 0;
      for (;;) {
        const index = hooi.indexOf(naald, vanaf);
        if (index < 0) break;
        // Meer dan één treffer maakt het citaat ambigu; stop meteen.
        if (treffers.length >= 1) return null;
        const schoon = deel.tekst.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
        const begin = Math.max(0, Math.round(index * (schoon.length / Math.max(1, hooi.length))) - 300);
        treffers.push({
          passage: schoon.slice(begin, begin + MAX_PASSAGE_TEKENS),
          pagina: segment.pagina,
          paragraaf: deel.paragraaf,
        });
        vanaf = index + naald.length;
      }
    }
  }
  return treffers.length === 1 ? treffers[0] : null;
}

/**
 * Passagestrategie voor de Copilot-arm. Faalt de lokalisatie, dan telt dat als
 * `lokalisatie` — niet als `extractie` — zodat het kwaliteitsrapport onderscheid
 * kan maken tussen "wij konden de tekst niet lezen" en "Microsoft bood iets aan
 * dat niet in de actuele inhoud staat".
 */
export function copilotPassageStrategie(extractsPerFixture: Map<string, string[]>): PassageStrategie {
  return {
    faalcategorie: "lokalisatie",
    kies: (segmenten: TekstSegment[], _vraag: SpikeVraag, mapping: SpikeDocumentMapping) => {
      for (const extract of extractsPerFixture.get(mapping.fixtureCode) ?? []) {
        const gevonden = lokaliseerExtract(segmenten, extract);
        if (gevonden) return gevonden;
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
//  De retrievalcall zelf
// ---------------------------------------------------------------------------

export interface CopilotZoekUitkomst {
  hits: ZoekHit[];
  /** Per fixturecode de aangeboden extracts, uitsluitend voor lokalisatie. */
  extractsPerFixture: Map<string, string[]>;
  aangebodenExtracts: number;
}

/**
 * Statusbewuste vertaling, uitsluitend voor deze arm.
 *
 * 401 en 403 zijn NIET tot één oorzaak te herleiden: het kan een ontbrekende
 * Copilot-licentie zijn, maar net zo goed ontbrekend of ingetrokken consent voor
 * `Files.Read.All` + `Sites.Read.All`. Beide krijgen daarom de neutrale code
 * `copilot_toegang_geweigerd`; welke van de twee het is, stelt een mens vast.
 * Alleen 402 (Payment Required) is een eenduidig licentie-/billingsignaal.
 */
function copilotFoutVertaler(response: Response): SpikeErrorType | undefined {
  if (response.status === 402) return new SpikeError("toestemming_geweigerd", "copilot_licentie_of_billing");
  if (response.status === 401 || response.status === 403) {
    return new SpikeError("toestemming_geweigerd", "copilot_toegang_geweigerd");
  }
  return undefined;
}

function normaliseerCopilotFout(fout: unknown): SpikeErrorType {
  if (fout instanceof SpikeError) return fout;
  return new SpikeError("providerfout", "copilot_response", { cause: fout });
}

/**
 * Exact één `POST /v1.0/copilot/retrieval` per meting, tenzij een expliciet hoger
 * lokaal budget is gezet. Het budget begrenst het aantal FEITELIJKE pogingen,
 * backoff-herhalingen meegerekend: bij budget 1 vertrekt er precies één request
 * en is een 429 dus een stopresultaat. Geen paginering, geen tweede databron,
 * geen fallback naar een andere route.
 */
export async function zoekViaCopilotRetrieval(
  client: GraphClient,
  bron: SpikeBronSnapshot,
  vraag: SpikeVraag,
  rootWebUrl: string,
  maxKandidaten: number,
  /**
   * Levert het read-only locatorregister. Bewust lui: pas wanneer er een hit
   * bínnen de root is, is het register nodig. Een 401/402/403/429 of timeout
   * kost daardoor geen enkele extra item-read. De inhoud van het register hangt
   * nooit van een hit af — alleen het moment waarop het wordt opgebouwd.
   */
  leesLocatorRegister: () => Promise<Map<string, SpikeDocumentMapping>>,
  afwijzingen: SpikeAfwijzingen,
  budget: number,
): Promise<CopilotZoekUitkomst> {
  if (budget < 1 || budget > COPILOT_LOKAAL_REQUESTBUDGET) {
    throw new SpikeError("configuratiefout", "copilot_budget_overschreden");
  }
  // Vorm eerst, netwerk daarna. Een ongeldige filter of vraag mag nooit als
  // ongescopede succesvolle call vertrekken.
  const filterExpression = bouwCopilotFilterExpression(rootWebUrl);
  const queryString = bouwCopilotQueryString(vraag);
  const maximumNumberOfResults = Math.min(Math.max(1, maxKandidaten), COPILOT_MAX_RESULTATEN);

  let antwoord: CopilotRetrievalAntwoord;
  try {
    antwoord = await client.json<CopilotRetrievalAntwoord>(
      COPILOT_RETRIEVAL_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queryString,
          dataSource: COPILOT_DATA_SOURCE,
          filterExpression,
          maximumNumberOfResults,
        }),
      },
      // Harde koppeling tussen het lokale budget en het werkelijke aantal
      // netwerkpogingen. Zonder dit keek de retrylus alleen naar MAX_RETRIES en
      // kon een "budget 1" alsnog drie POST's laten vertrekken.
      { maxPogingen: budget, foutVertaler: copilotFoutVertaler },
    );
  } catch (fout) {
    throw normaliseerCopilotFout(fout);
  }

  const hits: ZoekHit[] = [];
  const extractsPerFixture = new Map<string, string[]>();
  const gezien = new Set<string>();
  let aangebodenExtracts = 0;
  let locatorRegister: Map<string, SpikeDocumentMapping> | null = null;

  for (const hit of antwoord.retrievalHits ?? []) {
    if (hits.length >= maximumNumberOfResults) break;
    // Stap 1 — locator binnen de herlezen root? Zo niet: geen enkele vervolgstap.
    const locator = hitUrlBinnenRoot(hit.webUrl, rootWebUrl, bron.siteHostnaam);
    if (!locator) {
      wijsKandidaatAf(afwijzingen, "root");
      continue;
    }
    // Stap 2 — exacte match tegen het read-only opgebouwde locatorregister. Aan
    // deze stap komt geen netwerkcall te pas: de sleutels komen uit DriveItems
    // die we op hun vertrouwde item-id al hebben gelezen. Een URL die wij niet
    // zelf hebben opgehaald — waaronder Office-weergave-URL's `/:w:/…` en
    // `/:p:/…` — bestaat voor deze arm niet en valt hier fail-closed af.
    locatorRegister ??= await leesLocatorRegister();
    const sleutel = canoniekeWebUrl(locator, bron.siteHostnaam);
    const mapping = sleutel ? locatorRegister.get(sleutel) : undefined;
    if (!mapping) {
      wijsKandidaatAf(afwijzingen, "mapping");
      continue;
    }
    const itemId = mapping.itemId;
    if (gezien.has(itemId)) continue;
    gezien.add(itemId);

    const extracts = (hit.extracts ?? [])
      .map((extract) => (typeof extract.text === "string" ? extract.text : ""))
      .filter((tekst) => tekst.trim().length > 0)
      .slice(0, 8);
    aangebodenExtracts += extracts.length;
    extractsPerFixture.set(mapping.fixtureCode, [
      ...(extractsPerFixture.get(mapping.fixtureCode) ?? []),
      ...extracts,
    ]);
    hits.push({ itemId, positie: hits.length + 1, score: null });
  }

  return { hits, extractsPerFixture, aangebodenExtracts };
}

// ---------------------------------------------------------------------------
//  Hoofdingang van de meetarm
// ---------------------------------------------------------------------------

/**
 * Voert één Copilot Retrieval-meting uit. Elke fout levert nul kandidaten; er is
 * geen providerfallback, geen modelcontext en geen persistente opslag van
 * inhoud, extracts of embeddings.
 */
export async function voerCopilotRetrievalSpikeUit(
  deps: SpikeDependencies,
  opdracht: CopilotRetrievalOpdracht,
): Promise<SpikeCopilotUitkomst> {
  const klok = deps.klok ?? (() => performance.now());
  const start = klok();
  const meting = nieuweMeting();
  const afwijzingen = nieuweAfwijzingen();
  let client: GraphClient | undefined;
  let fataleKandidaatFout: SpikeErrorType | null = null;
  let aangebodenExtracts = 0;
  let gelokaliseerdeExtracts = 0;

  try {
    const bron = await leesGeldigeBron(deps);
    const token = await deps.delegatedToken();
    if (!token.accessToken || token.tenantId !== bron.tenantId || token.actorObjectId !== bron.microsoftActorObjectId) {
      throw new SpikeError("buiten_scope", "actor_of_tenant_mismatch");
    }

    const timeoutMs = opdracht.timeoutMs ?? 20_000;
    const deadline = AbortSignal.timeout(timeoutMs);
    const fataleAfbreking = new AbortController();
    const signal = AbortSignal.any([
      ...(opdracht.signal ? [opdracht.signal] : []),
      deadline,
      fataleAfbreking.signal,
    ]);
    const graphClient = new GraphClient(
      token.accessToken,
      deps.fetchImpl ?? ((input, init) => fetch(input, init)),
      signal,
      timeoutMs,
      deps.wacht ?? standaardWacht,
    );
    client = graphClient;

    // Root altijd zelf herlezen; de scope komt nooit uit een eerdere run.
    const root = await graphClient.json<GraphDriveItem>(itemUrl(bron, bron.rootItemId));
    const rootWebUrl = veiligeSharePointUrl(root.webUrl, bron.siteHostnaam);
    const rootGraphPad = graphPadVanRoot(root);
    if (!root.id || !root.folder || root.id !== bron.rootItemId || root.parentReference?.driveId !== bron.driveId || !rootWebUrl || !rootGraphPad) {
      throw new SpikeError("buiten_scope", "document_buiten_bron");
    }

    // Locatorregister: volledig read-only opgebouwd uit de al geregistreerde
    // DriveItems, op hun vertrouwde item-id. Eenmalig en lui — pas bij de eerste
    // hit binnen de root. De sleutels komen dus nooit uit de hit zelf.
    let locatorRegister: Map<string, SpikeDocumentMapping> | null = null;
    const leesLocatorRegister = async () => {
      locatorRegister ??= await bouwLocatorRegister(graphClient, bron, rootGraphPad);
      return locatorRegister;
    };
    const fixturePerItemId = (itemId: string): SpikeDocumentMapping | null => {
      const gevonden = [...(locatorRegister?.values() ?? [])].filter((mapping) => mapping.itemId === itemId);
      return gevonden.length === 1 ? gevonden[0] : null;
    };

    const zoek = await zoekViaCopilotRetrieval(
      graphClient,
      bron,
      opdracht.vraag,
      rootWebUrl,
      opdracht.vraag.maxKandidaten ?? COPILOT_MAX_RESULTATEN,
      leesLocatorRegister,
      afwijzingen,
      Math.min(Math.max(1, opdracht.requestBudget ?? 1), COPILOT_LOKAAL_REQUESTBUDGET),
    );
    aangebodenExtracts = zoek.aangebodenExtracts;
    await deps.onFase?.("na_zoeken");

    const strategie = copilotPassageStrategie(zoek.extractsPerFixture);
    const fingerprint = bronVingerafdruk(bron);
    const bekendeHits = zoek.hits
      .map((hit) => ({ hit, mapping: fixturePerItemId(hit.itemId) }))
      .filter((paar): paar is { hit: ZoekHit; mapping: SpikeDocumentMapping } => paar.mapping !== null);

    const kandidaten = await parallelBegrensd<{ hit: ZoekHit; mapping: SpikeDocumentMapping }, SpikeBronresultaat>(
      bekendeHits,
      Math.min(Math.max(1, opdracht.concurrency ?? MAX_CONCURRENCY), MAX_CONCURRENCY),
      async ({ hit, mapping }) => {
        try {
          // Vanaf hier loopt exact dezelfde, ongewijzigde keten als de drie
          // bestaande routes: actualiteit, binding, root, eigen download en
          // extractie, dubbele eTag/cTag, configherlezing en previewbewijs.
          return await maakKandidaat(
            graphClient,
            deps,
            { vraag: opdracht.vraag, correlationId: opdracht.correlationId },
            bron,
            fingerprint,
            rootGraphPad,
            mapping,
            hit,
            afwijzingen,
            strategie,
          );
        } catch (fout) {
          if (isFataleKandidaatFout(fout)) {
            fataleKandidaatFout ??= fout as SpikeErrorType;
            fataleAfbreking.abort("fatale_kandidaatfout");
            throw fout;
          }
          return wijsKandidaatAf(afwijzingen, "rechten_configuratie");
        }
      },
      signal,
    );
    kandidaten.sort((a, b) => a.rang.positie - b.rang.positie || a.ref.localeCompare(b.ref));
    // Elke toegelaten passage van deze arm is per definitie gelokaliseerd; een
    // niet-lokaliseerbaar extract heeft de keten nooit gehaald.
    gelokaliseerdeExtracts = kandidaten.length;
    Object.assign(meting, graphClient.meting);
    return {
      route: "copilot_retrieval",
      searchScope: null,
      provider: "microsoft",
      methode: "sharepoint_live",
      kandidaten,
      kandidatenVoorVerificatie: zoek.hits.length,
      latencyMs: Math.max(0, Math.round(klok() - start)),
      ...(kandidaten.length === 0 ? { fout: "geen_resultaten" as const } : {}),
      afwijzingen,
      meting,
      aangebodenExtracts,
      gelokaliseerdeExtracts,
    };
  } catch (fout) {
    if (client) Object.assign(meting, client.meting);
    let veilig = fataleKandidaatFout ?? alsSpikeError(fout);
    if (veilig.categorie === "annulering" && !opdracht.signal?.aborted) {
      veilig = new SpikeError("timeout", "graph_timeout");
    }
    return {
      route: "copilot_retrieval",
      searchScope: null,
      provider: "microsoft",
      methode: "sharepoint_live",
      kandidaten: [],
      kandidatenVoorVerificatie: 0,
      latencyMs: Math.max(0, Math.round(klok() - start)),
      fout: veilig.categorie,
      foutcode: veilig.code,
      afwijzingen,
      meting,
      aangebodenExtracts,
      gelokaliseerdeExtracts: 0,
    };
  }
}
