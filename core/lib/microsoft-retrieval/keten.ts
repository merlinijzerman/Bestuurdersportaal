// ============================================================================
//  #413 T4-C deel 2b — DE KETEN. Van Copilot-kandidaat naar eigen passage.
// ----------------------------------------------------------------------------
//  De losse modules uit T4-B en T4-C deel 1/2a doen elk één ding. Dit bestand
//  is de enige plek waar ze aan elkaar zitten, en daarmee de plek waar de
//  volgorde van de controles wordt vastgelegd:
//
//    root lezen  →  kandidaten ophalen  →  per hit: rootgrens, register
//                →  DEDUPLICEREN  →  per document: verse bevestiging, download,
//                   eigen extractie, TWEEDE volledige scope- én versiecontrole,
//                   unieke lokalisatie  →  treffer
//
//  ── WAAROM DE ROOT HIER WORDT GELEZEN EN NIET DAARBUITEN ───────────────────
//  De Copilot-call heeft de root-URL nodig om zijn filter te bouwen, en de
//  rootgrens toetst de hits tegen diezelfde URL. Zouden dat twee afzonderlijke
//  lezingen zijn, dan is het filter op root A gebouwd en de grens tegen root B
//  getoetst — en tussen die twee kan de map verplaatst zijn. Daarom leest deze
//  keten de root ÉÉN keer en geeft hij hem door aan `haalKandidaten`. Die
//  callback is geïnjecteerd: deze module kent de Copilot-client niet en doet
//  zelf geen enkele externe aanroep.
//
//  ── DEDUPLICATIE VÓÓR DE DOWNLOADS ─────────────────────────────────────────
//  Copilot levert per PASSAGE een hit, dus tien hits kunnen drie documenten
//  zijn. Zonder deduplicatie downloaden en extraheren wij hetzelfde bestand
//  tien keer, en dat is niet alleen verspilling: elke extra download is een
//  extra venster waarin het bestand kan wijzigen. Samenvoegen gebeurt daarom
//  VÓÓR de eerste byte, op de canonieke URL die de registeropzoeking oplevert —
//  niet op de ruwe `webUrl`, want twee verschillende ruwe vormen kunnen
//  hetzelfde document zijn.
//
//  ── GRENZEN GELDEN DE BEURT, NIET DE STAP ──────────────────────────────────
//  Elke afzonderlijke stap was al begrensd (25 MiB per download, 30 s per
//  download). Dat begrenst de optelsom niet: acht documenten van 25 MiB zijn
//  samen 200 MiB, en acht downloads van 30 s zijn samen vier minuten. De
//  grenzen hieronder gelden daarom de hele beurt — aantal kandidaten, aantal
//  documenten, totale bytes, totaal extractiewerk en één deadline over alles.
//
//  ── HET EXTRACT IS NERGENS INHOUD ──────────────────────────────────────────
//  De ruwe Microsoft-tekst komt deze module binnen als AANWIJZER en verlaat
//  hem niet. `KetenTreffer` draagt uitsluitend `passage` uit onze EIGEN
//  extractie; de ruwe `webUrl` en de ruwe extracts staan in geen enkel veld van
//  de uitkomst en in geen enkele teller.
//
//  ── WAT HIER NIET STAAT ────────────────────────────────────────────────────
//  Geen tokenbron, geen consent, geen billing, geen vlag, geen chat- of
//  zoekaansluiting en geen live aanroep. Het access token komt als string
//  binnen, precies zoals `downloadItem` hem al aanneemt; wie hem mint is T4-D.
// ============================================================================
import type { Bestandstype, ExtractieResultaat } from "../document-extractie";
import { extractTekst } from "../document-extractie";
import { TIMEOUT_DEFAULT_MS, TIMEOUT_MAX_MS, bewaakNaIO } from "../retrieval/afbreken";
import type { CopilotKandidaat } from "./client";
import {
  MAX_DOWNLOAD_BYTES,
  downloadItem,
  type DownloadOpdracht,
  type DownloadResultaat,
} from "./download";
import {
  bevestigKandidaatItem,
  bevestigVersieOngewijzigd,
  leesRoot,
  type BronSnapshot,
  type ItemAfwijzing,
  type ItemLezer,
  type RootUitkomst,
  type Versiebewijs,
} from "./driveitem";
import { lokaliseerEersteBruikbare, type Lokalisatie } from "./extractlokalisatie";
import { zoekBronreferentie, type GeregistreerdDocument } from "./mapping";

// ── Afwijsgronden ───────────────────────────────────────────────────────────

/**
 * Waarom een hit of een document afvalt. Gesloten opsomming, inhoudsvrij: deze
 * waarden zijn bedoeld om samen met tellers in `meta.adapters` te belanden, en
 * daar horen geen URL's, identifiers of providerfoutteksten.
 *
 * `grens` is geen inhoudelijk oordeel. Een document dat onder `grens` valt is
 * niet afgekeurd maar niet bekeken: het beurtbudget was op. Dat verschil moet
 * zichtbaar blijven, anders leest een beheerder een uitgeput budget als een
 * document dat de toets niet doorstond.
 */
export type KetenAfwijzing =
  | "root"
  | "mapping"
  | "binding"
  | "rechten_configuratie"
  | "versie"
  | "download"
  | "extractie"
  | "lokalisatie"
  | "grens";

export const KETEN_AFWIJZINGEN: readonly KetenAfwijzing[] = [
  "root",
  "mapping",
  "binding",
  "rechten_configuratie",
  "versie",
  "download",
  "extractie",
  "lokalisatie",
  "grens",
] as const;

function legeTelling(): Record<KetenAfwijzing, number> {
  const leeg = {} as Record<KetenAfwijzing, number>;
  for (const grond of KETEN_AFWIJZINGEN) leeg[grond] = 0;
  return leeg;
}

// ── Grenzen ─────────────────────────────────────────────────────────────────

export interface KetenGrenzen {
  /** Hits die wij überhaupt in behandeling nemen. */
  maxKandidaten: number;
  /** Documenten die wij ophalen en extraheren. */
  maxDocumenten: number;
  /** Opgetelde ontvangen bytes over alle downloads van deze beurt. */
  maxTotaalBytes: number;
  /** Opgetelde tekenlengte van alle eigen extracties van deze beurt. */
  maxExtractieTekens: number;
  /** Eén deadline over de VOLLEDIGE keten, rootlezing meegerekend. */
  deadlineMs: number;
  /** Aanwijzers per document; meer dan dit voegt geen bewijskracht toe. */
  maxExtractsPerDocument: number;
}

/**
 * De ketendeadline is AFGELEID van het beurtbudget en niet los gekozen.
 *
 * Een eerdere versie zette hier 45 s terwijl de hele retrievalbeurt op
 * `TIMEOUT_DEFAULT_MS` (20 s) staat. Dat is geen krappe of ruime keuze maar een
 * onmogelijke: de beurt valt dan altijd eerder om dan de keten, het ketenbudget
 * bindt nooit, en welk document nog net is verwerkt hangt af van het toeval in
 * plaats van van deze grens. De tellers zouden bovendien `deadlineVerlopen:
 * false` melden terwijl de arm wel degelijk is afgekapt — door de beurt.
 *
 * Driekwart van het beurtbudget laat ruimte voor de rest van de beurt: de
 * andere sporen, het samenvoegen en de generatie. Deze arm mag de beurt niet
 * alleen opeten.
 */
export const KETEN_DEADLINE_MS = Math.floor(TIMEOUT_DEFAULT_MS * 0.75);

/** Absolute bovengrens: de keten kan nooit langer lopen dan een beurt mág duren. */
export const KETEN_DEADLINE_MAX_MS = TIMEOUT_MAX_MS;

/**
 * Bewust krappe defaults. Een aanroeper die zijn RESTERENDE beurtbudget kent,
 * geeft dat mee; de default is wat geldt zolang niemand dat doet.
 */
export const KETEN_GRENZEN: KetenGrenzen = {
  maxKandidaten: 25,
  maxDocumenten: 6,
  maxTotaalBytes: 60 * 1024 * 1024,
  maxExtractieTekens: 4_000_000,
  deadlineMs: KETEN_DEADLINE_MS,
  maxExtractsPerDocument: 8,
};

function grenzenVan(gedeeltelijk: Partial<KetenGrenzen> | undefined): KetenGrenzen {
  const samen = { ...KETEN_GRENZEN, ...(gedeeltelijk ?? {}) };
  // Een onbruikbare waarde mag nooit "geen grens" betekenen; dan zou een
  // configuratiefout de begrenzing stil uitzetten.
  const gezond = (waarde: number, standaard: number): number =>
    Number.isFinite(waarde) && waarde > 0 ? Math.floor(waarde) : standaard;
  return {
    maxKandidaten: gezond(samen.maxKandidaten, KETEN_GRENZEN.maxKandidaten),
    maxDocumenten: gezond(samen.maxDocumenten, KETEN_GRENZEN.maxDocumenten),
    maxTotaalBytes: gezond(samen.maxTotaalBytes, KETEN_GRENZEN.maxTotaalBytes),
    maxExtractieTekens: gezond(samen.maxExtractieTekens, KETEN_GRENZEN.maxExtractieTekens),
    // Ook een MEEGEGEVEN deadline wordt geklemd: een aanroeper die meer vraagt
    // dan een beurt mag duren, vraagt om een budget dat toch niet bindt.
    deadlineMs: Math.min(KETEN_DEADLINE_MAX_MS, gezond(samen.deadlineMs, KETEN_GRENZEN.deadlineMs)),
    maxExtractsPerDocument: gezond(samen.maxExtractsPerDocument, KETEN_GRENZEN.maxExtractsPerDocument),
  };
}

// ── Uitkomst ────────────────────────────────────────────────────────────────

/**
 * Eén bevestigde treffer. Alles hierin komt uit onze eigen registratie, uit een
 * verse Graph-lezing of uit onze eigen extractie — niets uit de Copilot-respons.
 */
/**
 * De GRONDSLAG waaronder deze treffer is toegelaten, zoals die bij de laatste
 * GESLAAGDE grondslagcontrole is vastgesteld.
 *
 * Waarom dit uit de keten moet komen en niet later kan worden samengesteld: de
 * centrale toelatingspoort eist een `Toegangsbewijs` met een controlemoment, een
 * configuratieversie en een bronregistratiereferentie. Zou de adapterlaag die
 * zelf verzinnen, dan is `gecontroleerdOp` het moment waarop díé laag toevallig
 * draaide in plaats van het moment waarop de grondslag werkelijk is vastgesteld
 * — en toetst V4 een venster dat niets meer bewaakt.
 */
export interface KetenGrondslag {
  /** Opaque bronregistratiereferentie; providerneutraal voor de poort. */
  bronregistratieRef: string;
  /** De versie waaronder is toegelaten; V5 vergelijkt hierop. */
  configuratieversie: number;
  /** ISO-tijdstip van de LAATSTE GESLAAGDE grondslagcontrole. */
  vastgesteldOp: string;
}

export interface KetenTreffer {
  /** Registerreferentie; hiermee bouwt de adapter later zijn bronverwijzing. */
  ref: string;
  /** Waaronder deze treffer is toegelaten; zie `KetenGrondslag`. */
  grondslag: KetenGrondslag;
  /** Naam uit de VERSE lezing, niet uit de mogelijk verouderde registratie. */
  naam: string;
  mappad: string;
  bestandstype: Bestandstype;
  /** UIT DE EIGEN EXTRACTIE. Nooit de Microsoft-tekst. */
  passage: string;
  pagina: number | null;
  paragraaf: string | null;
  /** Adapterprivate; hetzelfde bewijs vóór én na de download. */
  versie: Versiebewijs;
  /** Positie van de EERSTE hit voor dit document; bepaalt de volgorde. */
  volgorde: number;
}

/**
 * Uitsluitend vaste enumsleutels en numerieke tellers — geen URL's, geen
 * identifiers, geen providerfoutteksten. Deze vorm is bedoeld om ongewijzigd in
 * `meta.adapters` te belanden.
 *
 * DE KETEN KENT TWEE EENHEDEN. Vóór de deduplicatie is dat de HIT, erna het
 * DOCUMENT. De meeste gronden horen bij één van beide, maar `root` hoort bij
 * allebei: een hit kan buiten de rootgrens vallen (dan bestaat het document nog
 * niet), en een document kan bij de verse lezing buiten de root blijken te
 * liggen omdat het is verplaatst. Dezelfde constatering, twee momenten.
 *
 * Daarom zijn de balansen NIET op de gronden gebouwd maar op twee eigen
 * totalen. Zouden ze op de gronden rusten, dan zou een grond die in beide fasen
 * voorkomt de optelsom stil laten kloppen terwijl er iets was zoekgeraakt:
 *
 *   `hits       = hitsAfgewezen + hitsBuitenGrens + hitsGegroepeerd`
 *   `documenten = treffers + documentenAfgewezen`
 *   `Σ afwijzingen = hitsAfgewezen + documentenAfgewezen`
 *
 * De gronden blijven daarmee wat ze zijn: diagnostiek, niet boekhouding.
 */
export interface KetenTelling {
  /** Hits zoals ontvangen, vóór enige beoordeling. */
  hits: number;
  /** Hits die buiten `maxKandidaten` vielen; niet beoordeeld, niet afgewezen. */
  hitsBuitenGrens: number;
  /** Hits die op de rootgrens of het register afvielen. */
  hitsAfgewezen: number;
  /**
   * Hits die in een document zijn opgegaan. Staat hier opdat de balans van
   * BUITENAF na te rekenen is: een teller die alleen van binnenuit klopt, is
   * geen bewijs dat er niets is zoekgeraakt.
   */
  hitsGegroepeerd: number;
  /** Onderscheiden documenten na deduplicatie. */
  documenten: number;
  /** Documenten die geen treffer werden, om welke grond dan ook. */
  documentenAfgewezen: number;
  afwijzingen: Record<KetenAfwijzing, number>;
  gedownloadeBytes: number;
  geextraheerdeTekens: number;
  /**
   * De ketendeadline is verlopen voordat al het werk af was.
   *
   * WIE DIT VELD NEGEERT, LEEST EEN AFGEKAPTE UITSLAG ALS EEN VOLLEDIGE. De
   * treffers die er staan zijn stuk voor stuk volledig getoetst — scope,
   * versie en unieke lokalisatie — en blijven dus geldig; wat ontbreekt is de
   * wetenschap wat er nóg had kunnen staan. `grens` vertelt hoeveel documenten
   * daardoor niet zijn bekeken.
   */
  deadlineVerlopen: boolean;
}

export type KetenResultaat =
  | { ok: true; treffers: KetenTreffer[]; telling: KetenTelling }
  /** De scope was niet houdbaar; er zijn GEEN treffers, ook niet gedeeltelijk. */
  | { ok: false; afwijzing: ItemAfwijzing; telling: KetenTelling };

// ── Opdracht ────────────────────────────────────────────────────────────────

export type KandidaatBron = (
  root: { rootWebUrl: string; siteHostnaam: string },
  signal: AbortSignal,
) => Promise<readonly CopilotKandidaat[]>;

export interface KetenOpdracht {
  /** Opnieuw gelezen binnen dit verzoek; nooit uit een request-payload. */
  bron: BronSnapshot;
  /** Tenant van het DELEGATED token; moet die van de bron zijn. */
  tokenTenantId: string;
  /**
   * Geïnjecteerd, nooit hier gemint. Deze module kent geen tokenbron, geen
   * consentpad en geen vlag; T4-D bouwt dat en geeft het resultaat door.
   */
  accessToken: string;
  leesItem: ItemLezer;
  /**
   * Leest de bronregistratie OPNIEUW, tijdens het verzoek.
   *
   * `bron` hierboven is een momentopname van vóór de beurt. Wordt de bron
   * ingetrokken, gepauzeerd of opnieuw geconfigureerd terwijl wij bezig zijn,
   * dan zegt die momentopname daar niets over — en zonder herlezing zou een
   * passage worden vrijgegeven op grond van een registratie die op dat moment
   * niet meer bestaat. Verplicht: zonder herlezing is er geen grondslag om op
   * toe te laten.
   */
  herleesBron: () => Promise<BronSnapshot | undefined>;
  /** De private registeropzoeking; levert hoogstens één rij. */
  zoekRegister: (canoniek: string, signal?: AbortSignal) => Promise<GeregistreerdDocument | undefined>;
  /** Levert de kandidaten bij de ZOJUIST GELEZEN root. Geïnjecteerd. */
  haalKandidaten: KandidaatBron;
  /** Het beurtsignaal. Breekt dit af, dan werpt de keten. */
  signal?: AbortSignal;
  grenzen?: Partial<KetenGrenzen>;
  /** Uitsluitend voor tests. */
  downloadImpl?: (opdracht: DownloadOpdracht) => Promise<DownloadResultaat>;
  /** Uitsluitend voor tests. */
  extractImpl?: (bytes: Buffer, type: Bestandstype, signal?: AbortSignal) => Promise<ExtractieResultaat>;
}

// ── Hulpmiddelen ────────────────────────────────────────────────────────────

/**
 * Onze eigen extractie kent vier formaten. Het register kent er zeven: de
 * SharePoint-preview toont ook `doc`, `ppt` en `xls`. Die oude binaire vormen
 * kunnen wij niet uitlezen, en zonder eigen extractie is er niets om het
 * extract in terug te vinden — fail-closed, vóór de download.
 */
export function extractieType(bestandstype: string | null): Bestandstype | null {
  switch (bestandstype) {
    case "pdf":
    case "docx":
    case "pptx":
    case "xlsx":
      return bestandstype;
    default:
      return null;
  }
}

/**
 * De ketendeadline. EIGEN klasse, bewust geen `RetrievalAfgebroken`: een
 * verlopen ketenbudget is geen afbreking van de beurt. `isAfbreking()` mag hem
 * daarom niet herkennen — anders zou een trage SharePoint de hele beurt als
 * geannuleerd laten eindigen terwijl de andere sporen nog resultaat hadden.
 */
class KetenDeadline extends Error {
  constructor() {
    super("copilot-keten: het ketenbudget is verlopen");
    this.name = "KetenDeadline";
  }
}

interface Groep {
  document: GeregistreerdDocument;
  canoniek: string;
  volgorde: number;
  extracts: string[];
  /** Hits die in deze groep zijn opgegaan; nodig om bij verwerping te tellen. */
  hits: number;
}

// ── De keten ────────────────────────────────────────────────────────────────

/**
 * Voert de volledige keten uit voor één bron.
 *
 * WERPT bij een afbreking van de beurt en bij een providerstoring — die mogen
 * niet stil tot een lege uitslag degraderen.
 *
 * `ok: false` betekent dat de SCOPE ZELF niet houdbaar was, niet dat er
 * kandidaten zijn afgewezen. Twee gevallen:
 *   • de root is niet vast te stellen — dan is er niets te doorzoeken;
 *   • de registratie of de root is TIJDENS het verzoek gewijzigd — dan rust
 *     alles wat tot dan toe is toegelaten op een grondslag die niet meer
 *     bestaat, en worden ook de reeds gevonden treffers losgelaten.
 */
export async function voerKetenUit(opdracht: KetenOpdracht): Promise<KetenResultaat> {
  const grenzen = grenzenVan(opdracht.grenzen);
  const afwijzingen = legeTelling();
  const telling: KetenTelling = {
    hits: 0,
    hitsBuitenGrens: 0,
    hitsAfgewezen: 0,
    hitsGegroepeerd: 0,
    documenten: 0,
    documentenAfgewezen: 0,
    afwijzingen,
    gedownloadeBytes: 0,
    geextraheerdeTekens: 0,
    deadlineVerlopen: false,
  };

  const verlopen = new KetenDeadline();
  const eigenKlok = new AbortController();
  // BEWUST GEEN `unref()`. Een niet-gerefereerde timer houdt de event-loop niet
  // open, en dan mag Node het proces verlaten terwijl de keten nog op haar
  // eigen klok wacht: de deadline vuurt niet, de keten levert niets op en er is
  // geen fout. Gemeten: met `unref()` vertrok het proces na 2 ms bij een keten
  // die 600 ms te gaan had. Een deadline die de runtime mag overslaan is geen
  // deadline. Weglaten kost niets, want `clearTimeout` staat in de `finally`
  // hieronder en de timer kan de keten dus nooit overleven.
  const eindtijd = Date.now() + grenzen.deadlineMs;
  const timer = setTimeout(() => eigenKlok.abort(verlopen), grenzen.deadlineMs);
  const keten = opdracht.signal
    ? AbortSignal.any([opdracht.signal, eigenKlok.signal])
    : eigenKlok.signal;

  /**
   * NA ELKE STAP, ook na een geslaagde. Beurtafbreking wint: die werpt door.
   * Daarna pas onze eigen klok, die als budgetuitkomst wordt afgehandeld.
   *
   * DE WANDKLOK STAAT HIER NIET VOOR NIETS NAAST DE TIMERVLAG. Een
   * `setTimeout`-callback is een macrotaak: blokkeert een synchrone stap de
   * event-loop — en onze eigen extractie van een groot PDF doet precies dat —
   * dan is de deadline allang verstreken terwijl `eigenKlok.signal.aborted`
   * nog `false` is, want de callback heeft nooit kunnen draaien. Wie alleen de
   * vlag leest, laat daarna doodleuk de volgende stap vertrekken.
   *
   * Wat hier wordt afgedwongen is dus niet "geen synchroon werk meer na de
   * deadline" — dat kán deze keten niet, want een blokkerende extractie is niet
   * te onderbreken zonder worker. Wat wél wordt afgedwongen: na de deadline
   * wordt niets meer TOEGELATEN. De bytegrens per download is wat begrenst
   * hoeveel synchroon werk er überhaupt mogelijk is.
   */
  const bewaak = (): void => {
    bewaakNaIO(opdracht.signal);
    if (eigenKlok.signal.aborted) throw verlopen;
    if (Date.now() >= eindtijd) {
      // Ook de controller afbreken: alles wat nog op `keten` wacht moet mee.
      eigenKlok.abort(verlopen);
      throw verlopen;
    }
  };

  /**
   * Wacht op geïnjecteerd werk, maar NOOIT langer dan de deadline.
   *
   * Een signaal in de signatuur zegt alleen dat een implementatie kán stoppen;
   * het dwingt niet af dat zij het dóét. Zonder deze race wachtte de keten op
   * wat de aanroeper toevallig teruggeeft: gemeten liep een registerlezing met
   * een budget van 300 ms door tot 5.003 ms, en de "deadline" was daarmee niet
   * meer dan een commentaarregel.
   *
   * De verlaten belofte krijgt een `catch`: een afgedankte belofte die later
   * alsnog faalt, sloopt het proces als unhandled rejection.
   */
  const metDeadline = async <T>(werk: Promise<T>): Promise<T> => {
    if (keten.aborted) {
      void werk.catch(() => {});
      throw keten.reason ?? verlopen;
    }
    let ontkoppel = (): void => {};
    const grens = new Promise<never>((_, afwijzen) => {
      const opAbort = () => afwijzen(keten.reason ?? verlopen);
      keten.addEventListener("abort", opAbort, { once: true });
      ontkoppel = () => keten.removeEventListener("abort", opAbort);
    });
    try {
      return await Promise.race([werk, grens]);
    } finally {
      ontkoppel();
      void werk.catch(() => {});
    }
  };

  try {
    return await draaiKeten(opdracht, grenzen, telling, keten, bewaak, metDeadline, verlopen);
  } finally {
    clearTimeout(timer);
  }
}

/** Wacht op geïnjecteerd werk, maar nooit langer dan de ketendeadline. */
type MetDeadline = <T>(werk: Promise<T>) => Promise<T>;

async function draaiKeten(
  opdracht: KetenOpdracht,
  grenzen: KetenGrenzen,
  telling: KetenTelling,
  keten: AbortSignal,
  bewaak: () => void,
  metDeadline: MetDeadline,
  verlopen: KetenDeadline,
): Promise<KetenResultaat> {
  const { bron } = opdracht;
  const afwijzingen = telling.afwijzingen;
  const treffers: KetenTreffer[] = [];

  // Wat er bij een verlopen deadline nog OPEN staat. Zonder deze twee tellers
  // zou een afgekapte beurt niet te onderscheiden zijn van een beurt waarin
  // alles is bekeken en niets bruikbaar was.
  let openHits = 0;
  let openDocumenten = 0;

  try {
    // Elke Graph-lezing loopt door de race. `leesRoot()` en de twee
    // bevestigingen roepen de lezer zelf aan; door HEM te omwikkelen valt ook
    // hun I/O onder de deadline, zonder dat driveitem.ts er iets van hoeft te
    // weten.
    const leesItem: ItemLezer = (itemId, signal) => metDeadline(opdracht.leesItem(itemId, signal));

    // ── Stap 1: de root, ÉÉN keer ───────────────────────────────────────────
    bewaak();
    const root = await leesRoot(bron, leesItem, keten);
    bewaak();
    if (!root.ok) return { ok: false, afwijzing: root.afwijzing, telling };

    // ── Stap 2: de kandidaten, bij DEZE root ────────────────────────────────
    const rauw = await metDeadline(
      opdracht.haalKandidaten(
        { rootWebUrl: root.rootWebUrl, siteHostnaam: bron.siteHostnaam },
        keten,
      ) as Promise<readonly CopilotKandidaat[]>,
    );
    bewaak();

    // ── Stap 3: rootgrens, register en DEDUPLICATIE — zonder één byte ───────
    const groepen = new Map<string, Groep>();
    /** Twee canonieke URL's die hetzelfde document aanwijzen zijn ambigu. */
    const refNaarCanoniek = new Map<string, string>();
    const ambigueRefs = new Set<string>();

    telling.hits = rauw.length;
    for (let index = 0; index < rauw.length; index++) {
      openHits = rauw.length - index;
      if (index >= grenzen.maxKandidaten) {
        telling.hitsBuitenGrens += rauw.length - index;
        break;
      }
      const hit = rauw[index];
      bewaak();
      const mapping = await zoekBronreferentie(hit.webUrl, root.rootWebUrl, (canoniek) =>
        metDeadline(opdracht.zoekRegister(canoniek, keten)),
      );
      bewaak();
      if (!mapping.ok) {
        afwijzingen[mapping.afwijzing] += 1;
        telling.hitsAfgewezen += 1;
        continue;
      }

      // De tellers worden HIER bijgewerkt en niet na afloop van de lus: verloopt
      // de deadline halverwege, dan springt de uitvoering naar de catch en is
      // alles wat "na de lus" gebeurt nooit uitgevoerd. Een balans die alleen
      // klopt als de lus zijn einde haalt, klopt precies niet op het moment dat
      // je hem nodig hebt.
      telling.hitsGegroepeerd += 1;

      const bestaand = groepen.get(mapping.canoniek);
      if (bestaand) {
        voegExtractsToe(bestaand, hit.extracts, grenzen.maxExtractsPerDocument);
        bestaand.hits += 1;
        continue;
      }

      // Het register dwingt één rij per canonieke URL af, maar niet één
      // canonieke URL per document. Wijzen twee verschillende canonieke vormen
      // naar hetzelfde `ref`, dan is niet aan te wijzen wélke de geldige locator
      // is — en hoogstens één van beide kan straks gelijk zijn aan de verse
      // `webUrl`. Beide vallen fail-closed af, vóór de download.
      const eerder = refNaarCanoniek.get(mapping.document.ref);
      if (eerder !== undefined && eerder !== mapping.canoniek) {
        ambigueRefs.add(mapping.document.ref);
      } else {
        refNaarCanoniek.set(mapping.document.ref, mapping.canoniek);
      }

      const groep: Groep = {
        document: mapping.document,
        canoniek: mapping.canoniek,
        volgorde: index,
        extracts: [],
        hits: 1,
      };
      voegExtractsToe(groep, hit.extracts, grenzen.maxExtractsPerDocument);
      groepen.set(mapping.canoniek, groep);
    }
    openHits = 0;

    // De ambigue groepen eruit, mét hun hits.
    for (const [canoniek, groep] of [...groepen]) {
      if (!ambigueRefs.has(groep.document.ref)) continue;
      afwijzingen.mapping += groep.hits;
      telling.hitsAfgewezen += groep.hits;
      telling.hitsGegroepeerd -= groep.hits;
      groepen.delete(canoniek);
    }

    // DETERMINISTISCHE VOLGORDE. De invoegvolgorde van een Map is al die van de
    // eerste hit, maar dat expliciet maken kost niets en overleeft een
    // herschrijving naar parallelle opzoekingen.
    const gesorteerd = [...groepen.values()].sort(
      (a, b) =>
        a.volgorde - b.volgorde || (a.canoniek < b.canoniek ? -1 : a.canoniek > b.canoniek ? 1 : 0),
    );
    telling.documenten = gesorteerd.length;

    // ── Stap 4: per document ────────────────────────────────────────────────
    // `slots` telt uitsluitend documenten waarvoor WERK is begonnen. Een
    // document dat gratis afvalt — een formaat dat wij niet lezen, of een
    // document zonder aanwijzer — kost geen call en mag dus geen plek van het
    // beurtbudget opsouperen.
    let slots = 0;
    for (let index = 0; index < gesorteerd.length; index++) {
      openDocumenten = gesorteerd.length - index;
      const groep = gesorteerd[index];
      const resterendeBytes = grenzen.maxTotaalBytes - telling.gedownloadeBytes;
      if (
        slots >= grenzen.maxDocumenten ||
        resterendeBytes <= 0 ||
        telling.geextraheerdeTekens >= grenzen.maxExtractieTekens
      ) {
        afwijzingen.grens += 1;
        telling.documentenAfgewezen += 1;
        continue;
      }

      const uitkomst = await verwerkDocument(opdracht, groep, {
        bron,
        root,
        leesItem,
        keten,
        bewaak,
        metDeadline,
        telling,
        grenzen,
        resterendeBytes,
      });
      // De GRONDSLAG is weggevallen: de registratie of de root is tijdens dit
      // verzoek gewijzigd. Dat geldt niet één document maar de hele scope —
      // ook de treffers die al waren toegelaten rusten op wat er niet meer is.
      if (!uitkomst.ok && uitkomst.grondslagWeg) {
        return { ok: false, afwijzing: "rechten_configuratie", telling };
      }
      if (uitkomst.verbruikt) slots += 1;
      if (uitkomst.ok) {
        treffers.push(uitkomst.treffer);
      } else {
        afwijzingen[uitkomst.afwijzing] += 1;
        telling.documentenAfgewezen += 1;
      }
    }
    openDocumenten = 0;
  } catch (fout) {
    if (fout !== verlopen) throw fout;
    // De deadline is verlopen. Wat nog niet is bekeken — inclusief datgene waar
    // wij middenin zaten — is niet afgewezen maar niet beoordeeld. De treffers
    // die er al liggen zijn wél volledig getoetst en blijven staan.
    telling.deadlineVerlopen = true;
    telling.hitsBuitenGrens += openHits;
    afwijzingen.grens += openDocumenten;
    telling.documentenAfgewezen += openDocumenten;
  }

  return { ok: true, treffers, telling };
}

/**
 * Voegt aanwijzers toe, ontdubbeld en begrensd.
 *
 * Ontdubbelen omdat twee identieke extracts twee keer dezelfde zoekactie zijn;
 * begrenzen omdat een document met vijftig hits anders vijftig keer de volledige
 * eigen tekst doorzoekt. Er gaat geen bewijs verloren: `lokaliseerEersteBruikbare`
 * neemt toch de eerste die uniek terug te vinden is.
 */
function voegExtractsToe(groep: Groep, extracts: readonly string[], max: number): void {
  for (const extract of extracts) {
    if (groep.extracts.length >= max) return;
    if (typeof extract !== "string" || extract.length === 0) continue;
    if (groep.extracts.includes(extract)) continue;
    groep.extracts.push(extract);
  }
}

interface DocumentContext {
  bron: BronSnapshot;
  root: RootUitkomst;
  /** De lezer ZOALS DE KETEN HEM GEBRUIKT: al door de deadlinerace gehaald. */
  leesItem: ItemLezer;
  keten: AbortSignal;
  bewaak: () => void;
  metDeadline: MetDeadline;
  telling: KetenTelling;
  grenzen: KetenGrenzen;
  resterendeBytes: number;
}

/**
 * `verbruikt` zegt of dit document een plek van het beurtbudget heeft gekost.
 * Alleen werk telt: zodra de eerste Graph-lezing is gedaan. Een document dat op
 * een gratis controle afvalt, laat het budget onaangeroerd — anders zouden zes
 * bestanden met een onleesbaar formaat het budget opmaken zonder dat er één
 * byte is opgehaald.
 *
 * `grondslagWeg` is geen documentuitkomst maar een BEURTuitkomst: de
 * registratie of de root is tijdens dit verzoek gewijzigd, en dan klopt de
 * scope waaronder álles is beoordeeld niet meer.
 */
type DocumentUitkomst =
  | { ok: true; verbruikt: boolean; treffer: KetenTreffer }
  | { ok: false; verbruikt: boolean; afwijzing: KetenAfwijzing; grondslagWeg?: boolean };

/**
 * Is de registratie waarop wij deze beurt bouwen nog dezelfde?
 *
 * Elke waarde hier bepaalt mede de SCOPE: een andere drive of root betekent een
 * andere verzameling documenten, een andere configuratieversie betekent dat de
 * bron opnieuw is ingericht, en een status die niet `actief` is, betekent dat
 * er niets meer uit mag komen.
 */
function bronOngewijzigd(eerste: BronSnapshot, nu: BronSnapshot): boolean {
  return (
    nu.status === "actief" &&
    nu.id === eerste.id &&
    nu.tenantId === eerste.tenantId &&
    nu.siteHostnaam === eerste.siteHostnaam &&
    nu.driveId === eerste.driveId &&
    nu.rootItemId === eerste.rootItemId &&
    nu.configuratieversie === eerste.configuratieversie
  );
}

async function verwerkDocument(
  opdracht: KetenOpdracht,
  groep: Groep,
  ctx: DocumentContext,
): Promise<DocumentUitkomst> {
  const { bron, root, leesItem, keten, bewaak, metDeadline, telling, grenzen } = ctx;
  const rootGraphPad = root.rootGraphPad;
  const document = groep.document;

  // Zonder eigen extractie is er niets om het extract in terug te vinden. Dit
  // staat vóór elke netwerkstap: een bestand dat wij toch niet kunnen lezen,
  // hoeven wij niet op te halen.
  const type = extractieType(document.bestandstype);
  if (!type) return { ok: false, verbruikt: false, afwijzing: "extractie" };
  // Geen aanwijzer, geen citaat. Ook dit kost geen call.
  if (groep.extracts.length === 0) return { ok: false, verbruikt: false, afwijzing: "extractie" };

  // ── Verse bevestiging: volledige scope + versiebewijs ──────────────────────
  bewaak();
  const bevestigd = await bevestigKandidaatItem(
    {
      bron,
      tokenTenantId: opdracht.tokenTenantId,
      document,
      hitCanoniek: groep.canoniek,
      rootGraphPad,
      signal: keten,
    },
    leesItem,
  );
  bewaak();
  if (!bevestigd.ok) return { ok: false, verbruikt: true, afwijzing: bevestigd.afwijzing };

  // ── Download, binnen het RESTERENDE beurtbudget ───────────────────────────
  const doeDownload = opdracht.downloadImpl ?? downloadItem;
  const gedownload = await metDeadline(
    doeDownload({
      accessToken: opdracht.accessToken,
      driveId: bron.driveId,
      itemId: document.itemId,
      siteHostnaam: bron.siteHostnaam,
      signal: keten,
      maxBytes: Math.min(MAX_DOWNLOAD_BYTES, ctx.resterendeBytes),
    }),
  );
  bewaak();
  if (!gedownload.ok) return { ok: false, verbruikt: true, afwijzing: gedownload.afwijzing };
  telling.gedownloadeBytes += gedownload.bytes.byteLength;
  // DE KETEN TELT ZELF NA. `maxBytes` is een instructie aan de downloader, geen
  // bewijs: een implementatie die hem negeert of verkeerd klemt, zou het
  // beurtbudget stil laten overschrijden. Wat werkelijk binnenkwam is wat telt.
  if (gedownload.bytes.byteLength > ctx.resterendeBytes) {
    return { ok: false, verbruikt: true, afwijzing: "grens" };
  }

  // ── Eigen extractie ───────────────────────────────────────────────────────
  const doeExtractie = opdracht.extractImpl ?? extractTekst;
  let extractie: ExtractieResultaat;
  try {
    extractie = await metDeadline(doeExtractie(gedownload.bytes, type, keten));
  } catch (fout) {
    // Een afbreking of een verlopen ketenbudget is GEEN mislukte extractie;
    // zonder deze regel zou een afgebroken beurt als kwaliteitsuitkomst eindigen.
    bewaakNaIO(opdracht.signal, fout);
    bewaak();
    if (fout instanceof KetenDeadline) throw fout;
    return { ok: false, verbruikt: true, afwijzing: "extractie" };
  }
  bewaak();
  const segmenten = extractie.segmenten ?? [];
  const tekens = segmenten.reduce((som, segment) => som + segment.tekst.length, 0);
  telling.geextraheerdeTekens += tekens;
  // Ook hier natellen: het extractiebudget is een TOTAAL over de beurt, en een
  // document dat het alsnog overschrijdt wordt niet toegelaten. Anders is de
  // grens een gemiddelde in plaats van een grens.
  if (telling.geextraheerdeTekens > grenzen.maxExtractieTekens) {
    return { ok: false, verbruikt: true, afwijzing: "grens" };
  }

  // ── De TWEEDE lezing: volledige scope ÉN versie, ná de bytes ──────────────
  // Bewust vóór de lokalisatie. Is het bestand in het downloadvenster gewijzigd
  // of verplaatst, dan is de grond `versie` of `binding` — niet `lokalisatie`.
  // Andersom zou een gewijzigd bestand als "extract niet teruggevonden" worden
  // geboekt, en dan wijst de teller de verkeerde oorzaak aan.
  //
  // Deze controle draait tegen de root van het BEGIN van de beurt. Dat mag,
  // omdat de grondslagcontrole hieronder als laatste komt: blijkt de root daar
  // verplaatst, dan valt de hele beurt weg en doet de uitkomst van deze stap er
  // niet meer toe. Blijkt hij onveranderd, dan was het pad hier al het juiste.
  const onveranderd = await bevestigVersieOngewijzigd(
    {
      bron,
      document,
      hitCanoniek: groep.canoniek,
      rootGraphPad,
      versieVoor: bevestigd.versie,
      signal: keten,
    },
    leesItem,
  );
  bewaak();
  if (!onveranderd.ok) return { ok: false, verbruikt: true, afwijzing: onveranderd.afwijzing };

  // ── Lokalisatie: het extract verliest hier zijn rol ───────────────────────
  const lokalisatie = lokaliseerEersteBruikbare(segmenten, groep.extracts);
  if (!lokalisatie.ok) return { ok: false, verbruikt: true, afwijzing: lokalisatie.afwijzing };

  // ── DE GRONDSLAG, ALS LAATSTE EXTERNE CONTROLE VÓÓR TOELATING ─────────────
  // Deze twee stonden eerder vóór de tweede DriveItem-lezing en de lokalisatie.
  // Dat liet precies het venster open dat zij moeten dekken: een intrekking
  // tijdens die laatste stappen werd niet meer gezien, en de passage ging er
  // alsnog uit. Wat na deze controle nog komt is uitsluitend LOKAAL werk.
  //
  // Waarom dit ook met terugwerkende kracht geldt: als de registratie en de
  // root hier onveranderd blijken, dan golden ze ook op elk eerder moment in
  // dit document — en rustten alle voorgaande controles dus op de juiste
  // scope. Blijken ze wél gewijzigd, dan wordt niets van deze beurt toegelaten
  // en doen die voorgaande uitkomsten er niet meer toe. In beide gevallen is
  // één controle op dit punt voldoende, en twee zou alleen extra werk zijn.
  const rootNu = await leesRoot(bron, leesItem, keten);
  bewaak();
  if (!rootNu.ok || rootNu.rootWebUrl !== root.rootWebUrl || rootNu.rootGraphPad !== root.rootGraphPad) {
    return { ok: false, verbruikt: true, afwijzing: "rechten_configuratie", grondslagWeg: true };
  }

  // De autoritatieve registratie komt HIER, als allerlaatste externe lezing.
  const bronNu = await metDeadline(opdracht.herleesBron());
  if (!bronNu || !bronOngewijzigd(bron, bronNu)) {
    return { ok: false, verbruikt: true, afwijzing: "rechten_configuratie", grondslagWeg: true };
  }
  // HIER, en niet eerder of later: dit is het moment waarop de grondslag voor
  // het laatst en met succes is vastgesteld. Elk ander tijdstip zou een venster
  // beschrijven dat niet is gecontroleerd.
  const grondslag: KetenGrondslag = {
    bronregistratieRef: bronNu.id,
    configuratieversie: bronNu.configuratieversie,
    vastgesteldOp: new Date().toISOString(),
  };

  // DE LAATSTE POORT, en bewust ná de grondslag: dit is een LOKALE controle op
  // onze eigen klok, geen externe lezing. De lokalisatie hierboven is synchroon
  // en kan op een groot document lang blokkeren; zonder deze controle zou een
  // treffer worden toegelaten die pas ná de deadline is vastgesteld. `bewaak()`
  // kijkt naar de wandklok en niet alleen naar de timervlag, juist omdat die
  // vlag na blokkerend werk nog niet gezet hoeft te zijn.
  bewaak();

  return {
    ok: true,
    verbruikt: true,
    treffer: maakTreffer(groep, bevestigd.naam, type, bevestigd.versie, lokalisatie.lokalisatie, grondslag),
  };
}

/**
 * Bouwt de treffer uit UITSLUITEND vertrouwde bestanddelen: het register, de
 * verse lezing en onze eigen extractie. De ruwe `webUrl` en de ruwe extracts
 * komen er niet in voor — niet als veld, niet als fragment.
 */
function maakTreffer(
  groep: Groep,
  naam: string,
  bestandstype: Bestandstype,
  versie: Versiebewijs,
  lokalisatie: Lokalisatie,
  grondslag: KetenGrondslag,
): KetenTreffer {
  return {
    ref: groep.document.ref,
    grondslag,
    naam,
    mappad: groep.document.mappad,
    bestandstype,
    passage: lokalisatie.passage,
    pagina: lokalisatie.pagina,
    paragraaf: lokalisatie.paragraaf,
    versie,
    volgorde: groep.volgorde,
  };
}
