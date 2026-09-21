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
import { bewaakNaIO } from "../retrieval/afbreken";
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
 * Bewust krappe defaults. De keten draait binnen een beurt die zelf al een
 * budget heeft (`TIMEOUT_DEFAULT_MS` is 20 s voor de hele retrieval), dus een
 * ruime default hier zou betekenen dat de beurt eerder omvalt dan de keten —
 * en dan bepaalt niet dit budget maar het toeval welk document nog is verwerkt.
 */
export const KETEN_GRENZEN: KetenGrenzen = {
  maxKandidaten: 25,
  maxDocumenten: 6,
  maxTotaalBytes: 60 * 1024 * 1024,
  maxExtractieTekens: 4_000_000,
  deadlineMs: 45_000,
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
    deadlineMs: gezond(samen.deadlineMs, KETEN_GRENZEN.deadlineMs),
    maxExtractsPerDocument: gezond(samen.maxExtractsPerDocument, KETEN_GRENZEN.maxExtractsPerDocument),
  };
}

// ── Uitkomst ────────────────────────────────────────────────────────────────

/**
 * Eén bevestigde treffer. Alles hierin komt uit onze eigen registratie, uit een
 * verse Graph-lezing of uit onze eigen extractie — niets uit de Copilot-respons.
 */
export interface KetenTreffer {
  /** Registerreferentie; hiermee bouwt de adapter later zijn bronverwijzing. */
  ref: string;
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
  /** De private registeropzoeking; levert hoogstens één rij. */
  zoekRegister: (canoniek: string) => Promise<GeregistreerdDocument | undefined>;
  /** Levert de kandidaten bij de ZOJUIST GELEZEN root. Geïnjecteerd. */
  haalKandidaten: KandidaatBron;
  /** Het beurtsignaal. Breekt dit af, dan werpt de keten. */
  signal?: AbortSignal;
  grenzen?: Partial<KetenGrenzen>;
  /** Uitsluitend voor tests. */
  downloadImpl?: (opdracht: DownloadOpdracht) => Promise<DownloadResultaat>;
  /** Uitsluitend voor tests. */
  extractImpl?: (bytes: Buffer, type: Bestandstype) => Promise<ExtractieResultaat>;
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
 * niet stil tot een lege uitslag degraderen. Levert `ok: false` alleen als de
 * ROOT niet is vast te stellen: dan is er geen scope om in te zoeken en is er
 * ook niets afgewezen.
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
  const timer = setTimeout(() => eigenKlok.abort(verlopen), grenzen.deadlineMs);
  const keten = opdracht.signal
    ? AbortSignal.any([opdracht.signal, eigenKlok.signal])
    : eigenKlok.signal;

  /**
   * NA ELKE STAP, ook na een geslaagde. Beurtafbreking wint: die werpt door.
   * Daarna pas onze eigen klok, die als budgetuitkomst wordt afgehandeld.
   */
  const bewaak = (): void => {
    bewaakNaIO(opdracht.signal);
    if (eigenKlok.signal.aborted) throw verlopen;
  };

  try {
    return await draaiKeten(opdracht, grenzen, telling, keten, bewaak, verlopen);
  } finally {
    clearTimeout(timer);
  }
}

async function draaiKeten(
  opdracht: KetenOpdracht,
  grenzen: KetenGrenzen,
  telling: KetenTelling,
  keten: AbortSignal,
  bewaak: () => void,
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
    // ── Stap 1: de root, ÉÉN keer ───────────────────────────────────────────
    bewaak();
    const root = await leesRoot(bron, opdracht.leesItem, keten);
    bewaak();
    if (!root.ok) return { ok: false, afwijzing: root.afwijzing, telling };

    // ── Stap 2: de kandidaten, bij DEZE root ────────────────────────────────
    const rauw = await opdracht.haalKandidaten(
      { rootWebUrl: root.rootWebUrl, siteHostnaam: bron.siteHostnaam },
      keten,
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
      const mapping = await zoekBronreferentie(hit.webUrl, root.rootWebUrl, opdracht.zoekRegister);
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
        rootGraphPad: root.rootGraphPad,
        keten,
        bewaak,
        telling,
        resterendeBytes,
      });
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
  rootGraphPad: string;
  keten: AbortSignal;
  bewaak: () => void;
  telling: KetenTelling;
  resterendeBytes: number;
}

/**
 * `verbruikt` zegt of dit document een plek van het beurtbudget heeft gekost.
 * Alleen werk telt: zodra de eerste Graph-lezing is gedaan. Een document dat op
 * een gratis controle afvalt, laat het budget onaangeroerd — anders zouden zes
 * bestanden met een onleesbaar formaat het budget opmaken zonder dat er één
 * byte is opgehaald.
 */
type DocumentUitkomst =
  | { ok: true; verbruikt: boolean; treffer: KetenTreffer }
  | { ok: false; verbruikt: boolean; afwijzing: KetenAfwijzing };

async function verwerkDocument(
  opdracht: KetenOpdracht,
  groep: Groep,
  ctx: DocumentContext,
): Promise<DocumentUitkomst> {
  const { bron, rootGraphPad, keten, bewaak, telling } = ctx;
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
    opdracht.leesItem,
  );
  bewaak();
  if (!bevestigd.ok) return { ok: false, verbruikt: true, afwijzing: bevestigd.afwijzing };

  // ── Download, binnen het RESTERENDE beurtbudget ───────────────────────────
  const doeDownload = opdracht.downloadImpl ?? downloadItem;
  const gedownload = await doeDownload({
    accessToken: opdracht.accessToken,
    driveId: bron.driveId,
    itemId: document.itemId,
    siteHostnaam: bron.siteHostnaam,
    signal: keten,
    maxBytes: Math.min(MAX_DOWNLOAD_BYTES, ctx.resterendeBytes),
  });
  bewaak();
  if (!gedownload.ok) return { ok: false, verbruikt: true, afwijzing: gedownload.afwijzing };
  telling.gedownloadeBytes += gedownload.bytes.byteLength;

  // ── Eigen extractie ───────────────────────────────────────────────────────
  const doeExtractie = opdracht.extractImpl ?? extractTekst;
  let extractie: ExtractieResultaat;
  try {
    extractie = await doeExtractie(gedownload.bytes, type);
  } catch (fout) {
    // Een afbreking of een verlopen ketenbudget is GEEN mislukte extractie;
    // zonder deze regel zou een afgebroken beurt als kwaliteitsuitkomst eindigen.
    bewaakNaIO(opdracht.signal, fout);
    bewaak();
    return { ok: false, verbruikt: true, afwijzing: "extractie" };
  }
  bewaak();
  const segmenten = extractie.segmenten ?? [];
  telling.geextraheerdeTekens += segmenten.reduce((som, s) => som + s.tekst.length, 0);

  // ── De TWEEDE lezing: volledige scope ÉN versie, ná de bytes ──────────────
  // Bewust vóór de lokalisatie. Is het bestand in het downloadvenster gewijzigd
  // of verplaatst, dan is de grond `versie` of `binding` — niet `lokalisatie`.
  // Andersom zou een gewijzigd bestand als "extract niet teruggevonden" worden
  // geboekt, en dan wijst de teller de verkeerde oorzaak aan.
  bewaak();
  const onveranderd = await bevestigVersieOngewijzigd(
    {
      bron,
      document,
      hitCanoniek: groep.canoniek,
      rootGraphPad,
      versieVoor: bevestigd.versie,
      signal: keten,
    },
    opdracht.leesItem,
  );
  bewaak();
  if (!onveranderd.ok) return { ok: false, verbruikt: true, afwijzing: onveranderd.afwijzing };

  // ── Lokalisatie: het extract verliest hier zijn rol ───────────────────────
  const lokalisatie = lokaliseerEersteBruikbare(segmenten, groep.extracts);
  if (!lokalisatie.ok) return { ok: false, verbruikt: true, afwijzing: lokalisatie.afwijzing };

  return { ok: true, verbruikt: true, treffer: maakTreffer(groep, bevestigd.naam, type, bevestigd.versie, lokalisatie.lokalisatie) };
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
): KetenTreffer {
  return {
    ref: groep.document.ref,
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
