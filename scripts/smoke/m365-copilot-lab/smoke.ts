// ============================================================================
//  #407 labsmoke — de beslislogica, los van netwerk en terminal.
// ----------------------------------------------------------------------------
//  Alles wat bepaalt OF er gemeten mag worden en WAT een meting waard is, staat
//  hier — met geïnjecteerde afhankelijkheden, zodat elke regel hermetisch
//  getest kan worden zonder ook maar één byte naar Microsoft te sturen.
//
//  DE VOLGORDE IS DE VEILIGHEID:
//    1. registratie lezen en kruisverwijzingen toetsen   (registry.ts)
//    2. aanmelden als de geregistreerde lab-identiteit   (auth.ts)
//    3. DRIFT — tenant, actor, appregistratie, root      (hier)
//    4. de twee read-only scans                          (graph.ts)
//    5. DE POORT — nul in één van beide scans = stoppen  (hier)
//    6. expliciet akkoord van een mens                   (run.ts)
//    7. precies één Retrieval-poging                     (client.ts, #415)
//    8. rootfiltering en categorisering                  (hier)
//
//  Stap 3 en stap 5 zijn allebei FAIL-CLOSED: bij twijfel geen call. Een
//  Retrieval-call die op de verkeerde tenant, de verkeerde actor of een koude
//  index landt, levert geen fout maar iets veel vervelenders — een lege uitslag
//  die eruitziet als een kwaliteitsoordeel.
// ============================================================================
import { roepCopilotRetrievalAan, type CopilotOpdracht } from "../../../core/lib/microsoft-retrieval/client";
import { hitBinnenRoot } from "../../../core/lib/microsoft-retrieval/mapping";
import { VERGELIJK_SCENARIOS } from "../../spike/sharepoint-retrieval/vergelijking-scenarios";
import { spikeFixtureStatus } from "../../spike/sharepoint-retrieval/fixturestatus";
import type { Aanmelding } from "./auth";
import type { GraphActor, GraphBron, BestandsnaamscanUitkomst, InhoudscanUitkomst } from "./graph";
import type { Labprofiel } from "./registry";

/**
 * Het bestaande semantische scenario en de enige fixture die deze runner als
 * verwacht resultaat erkent. SEM01 komt uit de vastgestelde #407-scenarioset;
 * de afzonderlijke exacte canary heeft alleen een vaste vraag op die fixture.
 */
export const SCENARIO = VERGELIJK_SCENARIOS.SEM01;
export const VERWACHTE_FIXTURE = "PGB407-DOC-101";

/** De canaryterm van de inhoudscan. Komt in geen enkele scenariovraag voor. */
export const INHOUDSCAN_TERM = "Zandloperbaken 12";
/** Afzonderlijk indexbewijs, niet te verwarren met de semantische SEM01-meting. */
export const EXACTE_CANARY_SCENARIO = "CANARY_INDEX_101";
export type Meetmodus = "sem01" | "exacte_canary";

/** Alleen deze twee vaste vragen mogen de Retrieval API bereiken. */
export function meetinstelling(modus: Meetmodus): { scenario: string; vraag: string } {
  switch (modus) {
    case "sem01": return { scenario: SCENARIO.code, vraag: SCENARIO.copilotVraag };
    case "exacte_canary": return { scenario: EXACTE_CANARY_SCENARIO, vraag: INHOUDSCAN_TERM };
    default: throw new StopFail("onbekende_meetmodus", "geen Retrieval-call toegestaan");
  }
}
/** De naamprefix van de bestandsnaamscan; `PGB407-DOC-101*`. */
export const BESTANDSNAAM_PREFIX = "PGB407-DOC-101";

/** Precies één netwerkpoging naar de Retrieval API. Geen retry, geen backoff. */
export const RETRIEVAL_REQUESTBUDGET = 1;

/** Hoeveel kandidaten de ene call mag vragen. */
export const RETRIEVAL_MAX_KANDIDATEN = 10;

export class StopFail extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "StopFail";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
//  Stap 3 — drift
// ---------------------------------------------------------------------------

export type Driftsoort = "tenant" | "actor" | "appregistratie" | "root";

export interface Driftbevinding {
  soort: Driftsoort;
  /** Vaste, inhoudsvrije code; nooit een provider- of tokentekst. */
  code: string;
}

/** Canonieke vergelijkingsvorm voor een SharePoint-URL: host klein, pad gedecodeerd. */
export function canoniekPad(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  try {
    const pad = decodeURIComponent(parsed.pathname).normalize("NFC").replace(/\/+$/, "");
    return `${parsed.hostname.toLowerCase()}${pad}`;
  } catch {
    return null;
  }
}

function isGelijkOfOnder(pad: string, root: string): boolean {
  const a = pad.toLocaleLowerCase("nl");
  const b = root.toLocaleLowerCase("nl");
  return a === b || a.startsWith(`${b}/`);
}

/**
 * Toetst de vier drift-assen tegen de registratie.
 *
 * Elke as wordt op TWEE onafhankelijke waarnemingen getoetst waar dat kan: de
 * tenant uit het id-token én de site die Graph teruggeeft, de actor uit het
 * id-token én uit `/me`. Eén bron die klopt is geen bewijs dat er niets
 * verschoven is — juist de gevallen waarin één controle groen blijft, zijn de
 * gevaarlijke.
 */
export function toetsDrift(
  profiel: Labprofiel,
  aanmelding: Aanmelding,
  actor: GraphActor,
  bron: GraphBron,
): Driftbevinding[] {
  const bevindingen: Driftbevinding[] = [];

  if (aanmelding.claims.tid !== profiel.tenantId) {
    bevindingen.push({ soort: "tenant", code: "idtoken_tenant_wijkt_af" });
  }
  if (aanmelding.claims.aud !== profiel.clientId) {
    bevindingen.push({ soort: "appregistratie", code: "idtoken_audience_wijkt_af" });
  }
  if (aanmelding.claims.oid !== profiel.actorObjectId) {
    bevindingen.push({ soort: "actor", code: "idtoken_objectid_wijkt_af" });
  }
  if (actor.id !== profiel.actorObjectId) {
    bevindingen.push({ soort: "actor", code: "graph_objectid_wijkt_af" });
  }
  if (actor.userPrincipalName.toLowerCase() !== profiel.actorUpn.toLowerCase()) {
    bevindingen.push({ soort: "actor", code: "graph_upn_wijkt_af" });
  }
  // De aanmeldpagina kan een andere identiteit hebben opgeleverd dan de hint;
  // dan wijken id-token en /me samen af van de registratie, maar onderling niet.
  // Deze controle vangt het omgekeerde: twee bronnen die elkaar tegenspreken.
  if (
    aanmelding.claims.preferred_username
    && aanmelding.claims.preferred_username.toLowerCase() !== actor.userPrincipalName.toLowerCase()
  ) {
    bevindingen.push({ soort: "actor", code: "idtoken_en_graph_spreken_elkaar_tegen" });
  }

  const geregistreerdeSite = canoniekPad(profiel.siteUrl);
  const geregistreerdeRoot = canoniekPad(profiel.rootUrl);
  const liveSite = canoniekPad(bron.siteWebUrl);
  const liveDrive = canoniekPad(bron.driveWebUrl);
  if (!geregistreerdeSite || !geregistreerdeRoot || !liveSite || !liveDrive) {
    bevindingen.push({ soort: "root", code: "root_url_onleesbaar" });
  } else {
    if (liveSite !== geregistreerdeSite) {
      bevindingen.push({ soort: "root", code: "site_wijkt_af_van_registratie" });
    }
    // De geregistreerde root moet de bibliotheek zijn of eronder liggen. Ligt
    // hij erbuiten, dan zou de filter een bredere scope beschrijven dan de
    // bibliotheek die wij zojuist hebben gelezen.
    if (!isGelijkOfOnder(geregistreerdeRoot, liveDrive)) {
      bevindingen.push({ soort: "root", code: "root_ligt_buiten_bibliotheek" });
    }
    if (!isGelijkOfOnder(geregistreerdeRoot, geregistreerdeSite)) {
      bevindingen.push({ soort: "root", code: "root_ligt_buiten_site" });
    }
  }

  return bevindingen;
}

// ---------------------------------------------------------------------------
//  Stap 5 — de poort
// ---------------------------------------------------------------------------

export type Poortcode =
  | "geen_zoekresultaat"
  | "zoekresultaat_niet_verifieerbaar"
  | "zoekresultaat_buiten_root"
  | "bestand_niet_aanwezig"
  | "beide_nul";

export type Poortoordeel = { doorgelaten: true } | { doorgelaten: false; code: Poortcode };

/**
 * De stopregel, letterlijk. Zolang één van beide scans niets GEVERIFIEERDS
 * binnen de bronroot oplevert, vertrekt er geen Retrieval-call.
 *
 * Elke nulstand krijgt een eigen code, want ze vragen om iets volstrekt
 * verschillends. `inhoud_niet_geindexeerd` deed dat onderscheid nog niet en
 * vertelde daardoor het verkeerde verhaal: de live dry-run van 21-09 vond één
 * zoekresultaat en accepteerde er nul, en rapporteerde dat als "de index kent
 * de inhoud nog niet" — terwijl de index hem juist wél kende en de LOCATIE niet
 * vast te stellen was. Wachten op SharePoint was dus precies de verkeerde
 * vervolgstap.
 *
 * Nu:
 *   geen_zoekresultaat              → de index kent de term niet; wachten.
 *   zoekresultaat_niet_verifieerbaar→ er is een treffer, maar zijn locatie is
 *                                     niet vast te stellen; uitzoeken.
 *   zoekresultaat_buiten_root       → er is een treffer en die ligt aantoonbaar
 *                                     buiten de bron; dat is een bronprobleem.
 *
 * `niet_verifieerbaar` gaat vóór `buiten_root` wanneer beide voorkomen: een
 * onbekende locatie is het zwaardere signaal. Weten dát iets buiten de root
 * valt is een uitkomst; niet weten waar iets staat, is een gat in de meting.
 */
export function beoordeelPoort(
  inhoud: Pick<InhoudscanUitkomst, "binnenRoot" | "buitenRoot" | "nietVerifieerbaar" | "treffers">,
  naam: Pick<BestandsnaamscanUitkomst, "treffers">,
): Poortoordeel {
  const inhoudNul = inhoud.binnenRoot === 0;
  const naamNul = naam.treffers === 0;

  if (inhoudNul && naamNul && inhoud.treffers === 0) return { doorgelaten: false, code: "beide_nul" };
  // Een ontbrekend bestand is het dominante feit: dan valt er over de index
  // niets zinnigs te zeggen, want er is niets om te indexeren.
  if (naamNul) return { doorgelaten: false, code: "bestand_niet_aanwezig" };

  if (inhoudNul) {
    if (inhoud.treffers === 0) return { doorgelaten: false, code: "geen_zoekresultaat" };
    if (inhoud.nietVerifieerbaar > 0) return { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" };
    if (inhoud.buitenRoot > 0) return { doorgelaten: false, code: "zoekresultaat_buiten_root" };
    // Treffers, geen acceptaties, en geen van beide verklaringen: dan telt de
    // scan niet op en is de meting zelf verdacht. Fail-closed als het geval dat
    // om onderzoek vraagt.
    return { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" };
  }
  return { doorgelaten: true };
}

// ---------------------------------------------------------------------------
//  Stap 7 — precies één netwerkpoging
// ---------------------------------------------------------------------------

/**
 * Wikkelt een `fetch` in een grendel die na één aanroep dichtklapt.
 *
 * De client van #415 respecteert zijn requestbudget al; deze grendel staat
 * ernaast en niet in plaats daarvan. Een budget is een instelling — iets wat
 * iemand later per ongeluk op 3 kan zetten. Dit is een feit: de tweede poging
 * bereikt het netwerk niet, wat er ook in de configuratie staat.
 */
export function eenmaligeFetch(basis: typeof fetch): typeof fetch {
  let gebruikt = false;
  return ((invoer: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (gebruikt) {
      return Promise.reject(new StopFail("tweede_netwerkpoging", "er was al een Retrieval-poging gedaan"));
    }
    gebruikt = true;
    return basis(invoer, init);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
//  Stap 8 — rootfiltering en categorisering
// ---------------------------------------------------------------------------

export type Hitcategorie =
  | "verwachte_fixture"
  | "binnen_root_andere_fixture"
  | "binnen_root_onbekend"
  | "buiten_bronroot"
  | "zonder_locator";

export interface Hituitslag {
  categorieen: Record<Hitcategorie, number>;
  /** Uitsluitend fixturecodes; nooit een pad, bestandsnaam of extract. */
  fixturecodes: string[];
  verwachteFixtureGevonden: boolean;
  /** Hoeveel hits droegen tekstfragmenten; de tekst zelf wordt niet bewaard. */
  hitsMetExtracts: number;
}

/**
 * Leidt de fixturecode af uit het LAATSTE PADSEGMENT van een webUrl.
 *
 * De fixturenaam is `PGB407-DOC-101-Zandloperbaken-hersteldossier.docx`; de
 * code is het deel vóór het vierde streepje. De afleiding is strikt op vorm en
 * raadt niet: een naam die niet aan het patroon voldoet, levert `null` en telt
 * als onbekend. Er wordt bewust GEEN bestandsnaam teruggegeven — alleen de code.
 */
export function fixturecodeUitUrl(webUrl: string): string | null {
  let laatste: string;
  try {
    const pad = decodeURIComponent(new URL(webUrl).pathname);
    laatste = pad.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return null;
  }
  const match = /^(PGB\d{3}-[A-Z]{3}-\d{3})(?:[-.]|$)/.exec(laatste.toUpperCase());
  return match ? match[1] : null;
}

/**
 * Categoriseert de kandidaten van één Retrieval-call.
 *
 * De gedeelde canonicalisering uit #418 herkent ook Office-viewer-URL's. Een
 * hit telt pas wanneer zijn canonieke pad binnen de geregistreerde root én op
 * de geregistreerde SharePoint-host ligt. Sharinglinks blijven buiten scope.
 */
export function categoriseer(
  kandidaten: Array<{ webUrl: string; extracts: string[] }>,
  rootWebUrl: string,
  siteHostnaam: string,
): Hituitslag {
  const categorieen: Record<Hitcategorie, number> = {
    verwachte_fixture: 0,
    binnen_root_andere_fixture: 0,
    binnen_root_onbekend: 0,
    buiten_bronroot: 0,
    zonder_locator: 0,
  };
  const codes = new Set<string>();
  let hitsMetExtracts = 0;

  for (const kandidaat of kandidaten) {
    if (!kandidaat.webUrl) {
      categorieen.zonder_locator++;
      continue;
    }
    // De registry bewaart een leesbare root met spaties; Graph/Copilot kan
    // dezelfde segmenten als `%20` leveren. Lijn alleen die codering uit vóór
    // de gedeelde, segmentbewuste canonicalisering; decodeer nooit `%2F`.
    const binnen = hitBinnenRoot(
      kandidaat.webUrl.replaceAll(" ", "%20"),
      rootWebUrl.replaceAll(" ", "%20"),
    );
    if (!binnen || new URL(binnen).hostname !== siteHostnaam.toLowerCase()) {
      categorieen.buiten_bronroot++;
      continue;
    }
    if (kandidaat.extracts.length > 0) hitsMetExtracts++;
    const code = fixturecodeUitUrl(binnen);
    if (!code) {
      categorieen.binnen_root_onbekend++;
      continue;
    }
    codes.add(code);
    if (code === VERWACHTE_FIXTURE) categorieen.verwachte_fixture++;
    else categorieen.binnen_root_andere_fixture++;
  }

  return {
    categorieen,
    fixturecodes: [...codes].sort(),
    verwachteFixtureGevonden: codes.has(VERWACHTE_FIXTURE),
    hitsMetExtracts,
  };
}

// ---------------------------------------------------------------------------
//  De meting zelf
// ---------------------------------------------------------------------------

export interface Retrievaluitslag {
  scenario: string;
  verwachteFixture: string;
  /** Serververtrouwde status van de verwachte fixture; nooit uit de respons. */
  verwachteFixtureStatus: string | null;
  netwerkpogingen: number;
  latencyMs: number;
  kandidaten: number;
  uitslag: Hituitslag;
}

export interface MeetAfhankelijkheden {
  accessToken: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  modus?: Meetmodus;
}

/**
 * Doet de ene Retrieval-call en levert uitsluitend geaggregeerde uitkomsten.
 *
 * De extracts van Microsoft worden geteld en daarna losgelaten: ze verlaten
 * deze functie niet, komen in geen rapport en worden nergens weggeschreven.
 */
export async function meet(profiel: Labprofiel, deps: MeetAfhankelijkheden): Promise<Retrievaluitslag> {
  const instelling = meetinstelling(deps.modus ?? "sem01");
  const opdracht: CopilotOpdracht = {
    vraag: instelling.vraag,
    rootWebUrl: profiel.rootUrl,
    siteHostnaam: profiel.siteHostnaam,
    maxKandidaten: RETRIEVAL_MAX_KANDIDATEN,
    tokenbron: async () => ({ accessToken: deps.accessToken }),
    signal: deps.signal,
    requestBudget: RETRIEVAL_REQUESTBUDGET,
    // De grendel staat NAAST het budget, niet in plaats daarvan.
    fetchImpl: eenmaligeFetch(deps.fetchImpl),
  };

  const uitkomst = await roepCopilotRetrievalAan(opdracht);
  return {
    scenario: instelling.scenario,
    verwachteFixture: VERWACHTE_FIXTURE,
    verwachteFixtureStatus: spikeFixtureStatus(VERWACHTE_FIXTURE),
    netwerkpogingen: uitkomst.netwerkpogingen,
    latencyMs: uitkomst.latencyMs,
    kandidaten: uitkomst.kandidaten.length,
    uitslag: categoriseer(uitkomst.kandidaten, profiel.rootUrl, profiel.siteHostnaam),
  };
}
