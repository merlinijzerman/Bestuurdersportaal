// ============================================================================
//  #500 — Exacte artikelpassage in juridische retrieval.
// ----------------------------------------------------------------------------
//  PUUR en PROVIDERNEUTRAAL: geen I/O, geen DB, geen chunkvorm.
//
//  HET PROBLEEM (productiepilot 29-09-2026). "Wat was de bedoeling van de
//  wetgever bij artikel 150d Pensioenwet?" vond de artikelsgewijze toelichting
//  op artikel 150d (MvT Wtp, p. 395, structuur_label "Artikelsgewijze
//  toelichting — Artikel 150d") niet. Die passage kwam niet eens in de
//  kandidatenset: de strikte FTS-arm eist ALLE inhoudswoorden van de vraag
//  ('bedoel' & 'wetgever' & 'artikel' & '150d' & 'pensioenwet') in één chunk,
//  en de vectorarm (top-40 over alle chunks, waarvan 2.738 uit hetzelfde
//  document) is niet gevoelig voor een artikelnummer. Een boost in de selectie
//  alleen helpt dan niet.
//
//  DE OPLOSSING, in drie delen:
//    1. `bepaalArtikelfocus` — herkent deterministisch een expliciet
//       artikelnummer in de vraag, maar ALLEEN achter de R-3-poort én met een
//       juridisch anker (of een zwak anker zonder fondscontext). "Artikel 5 van
//       ons reglement" opent de poort niet.
//    2. Een gericht kandidatenspoor in de adapter (Supabase: `rag.ts`,
//       `vulAanMetArtikelkandidaten`) dat exact gelabelde passages binnen de
//       BESTAANDE zoek-RPC-filters toevoegt. Dit bestand levert daarvoor de
//       providerneutrale bouwstenen: het exacte-matchpredicaat en de
//       frasequery.
//    3. `boostArtikelpassages` — de centrale selectie zet per document de beste
//       exacte juridische passage vooraan, vóór het R-3-beleid. Dat beleid
//       bepaalt daarna de rollen: bij een normvraag blijft wetsgeschiedenis
//       achter de wet (nooit primaire normbron); bij een bedoelings- of
//       gecombineerde vraag landt de exacte MvT-passage in de kop.
//
//  STRIKT MATCHEN. "artikel 150" matcht nooit "150d" of "1500" en omgekeerd:
//  een nummer is exact gelijk na normalisatie (kleine letters, witruimte). Een
//  label telt als het het artikel noemt ("Artikelsgewijze toelichting —
//  Artikel 150d"); een tekst alleen als hij met dat artikel BEGINT (de kopregel
//  "Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)"), niet als
//  het artikel ergens midden in een alinea staat.
//
//  Zonder poort, zonder artikel of zonder exacte kandidaat is alles hier een
//  no-op: dezelfde array, geen diagnostiek.
// ============================================================================
import type { JuridischeVraagintentieResultaat } from "../vraagtype";
import { bepaalJuridischBeleid, juridischeRolVan } from "./juridisch-beleid";

/** Wettelijk regime dat de vraag expliciet noemt. */
export type ArtikelWet = "pw" | "wvb";

/**
 * De artikelfocus van één beurt. Bestaat alleen als de poort openging. Draagt
 * genormaliseerde artikelnummers, nooit vraagtekst; komt niet in de audit
 * (daar staan alleen tellingen, zie `selectie.juridisch.artikel`).
 */
export interface Artikelfocus {
  /** Genormaliseerde nummers, uniek, in volgorde van voorkomen, bv. ["150d"]. */
  artikelen: string[];
  /** Het genoemde regime (Pensioenwet → pw, Wvb → wvb); `null` = geen of beide. */
  wet: ArtikelWet | null;
}

/** Bovengrens op het aantal artikelen uit één vraag (tegen query-explosie). */
export const MAX_ARTIKELEN = 5;
/** Bovengrens op het aantal geboostte passages: één per document, hooguit 3. */
export const MAX_ARTIKEL_BOOST = 3;
/** Maximale lengte van een kopregel; spiegelt `MAX_KOP` van de structuurparser. */
const MAX_KOP = 120;

// Een artikelnummer: 1–4 cijfers met hooguit twee letters ("150d", "220ha").
// Romeinse wijzigingsartikelen ("Artikel I, onderdeel B") vallen bewust buiten.
const NUM = String.raw`\d{1,4}[a-z]{0,2}`;
const GRENS = String.raw`(?![\p{L}\d])`;
const TREFWOORD = String.raw`(?:artikelen|artikel|artt\.|art\.|art)`;
const RE_VERWIJZING = new RegExp(
  String.raw`(?<![\p{L}\d])${TREFWOORD}\s+(${NUM})${GRENS}((?:\s*,\s*${NUM}${GRENS}|\s+(?:en|of)\s+${NUM}${GRENS})*)`,
  "gu"
);
const RE_LIJSTNUMMER = new RegExp(String.raw`(${NUM})${GRENS}`, "gu");
const RE_BEGINT_MET_ARTIKEL = new RegExp(String.raw`^${TREFWOORD}\s+\d`, "u");

function normaliseer(tekst: string): string {
  return tekst
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Alle expliciete artikelnummers in een tekst, genormaliseerd en uniek:
 * "artikel 150d", "art. 150d", "artikelen 150d en 150e", "artikel 150d, 150e of
 * 150f". Een ander woord na het nummer ("lid", "Pensioenwet") sluit de lijst.
 */
export function herkenArtikelnummers(tekst: string | null | undefined): string[] {
  if (!tekst) return [];
  const uit: string[] = [];
  for (const m of normaliseer(tekst).matchAll(RE_VERWIJZING)) {
    const nummers = [m[1], ...[...(m[2] ?? "").matchAll(RE_LIJSTNUMMER)].map((x) => x[1])];
    for (const n of nummers) if (!uit.includes(n)) uit.push(n);
  }
  return uit;
}

/** Het regime dat de vraag noemt; beide of geen → `null` (geen beperking). */
export function herkenWet(tekst: string | null | undefined): ArtikelWet | null {
  if (!tekst) return null;
  const t = normaliseer(tekst);
  const pw = /(?<![\p{L}])pensioenwet(?![\p{L}])|(?<![\p{L}])pw(?![\p{L}])/u.test(t);
  const wvb = /(?<![\p{L}])wvb(?![\p{L}])|wet verplichte beroepspensioenregeling/u.test(t);
  return pw === wvb ? null : pw ? "pw" : "wvb";
}

/**
 * DE POORT. Een artikelfocus bestaat alleen als (a) het R-3-beleid van toepassing
 * is (dus niet bij `onbekend` of een dichte poort) en (b) die poort openging op
 * een juridisch anker of op een zwak anker zónder fondscontext. Vertrouwen
 * `zeker` alleen is hier NIET genoeg. Daarnaast moet er een expliciet
 * artikelnummer in de vraag staan.
 *
 * `teksten` zijn de vraagrepresentaties van het spoor (zoekvraag en originele
 * vraag); bij een opgeloste vervolgvraag staat het artikel in de zoekvraag.
 */
export function bepaalArtikelfocus(
  teksten: readonly (string | null | undefined)[],
  intentie: JuridischeVraagintentieResultaat | null | undefined
): Artikelfocus | null {
  const besluit = bepaalJuridischBeleid(intentie);
  if (!besluit) return null;
  if (besluit.poort !== "juridisch_anker" && besluit.poort !== "zwak_anker_zonder_fondscontext") return null;
  const artikelen: string[] = [];
  for (const t of teksten) {
    for (const n of herkenArtikelnummers(t)) {
      if (!artikelen.includes(n) && artikelen.length < MAX_ARTIKELEN) artikelen.push(n);
    }
  }
  if (artikelen.length === 0) return null;
  const wetten = new Set(teksten.map(herkenWet).filter((w): w is ArtikelWet => w !== null));
  return { artikelen, wet: wetten.size === 1 ? [...wetten][0] : null };
}

/** Hoe een passage exact bij het artikel hoort: via het structuurlabel of via de kopregel. */
export type Artikelmatch = "kop" | "label";

/**
 * Het exacte-matchpredicaat. `kop` wint van `label`: de passage waarvan de tekst
 * met het artikel begint, is het begin van de artikelsgewijze toelichting.
 */
export function artikelmatch(
  focus: Pick<Artikelfocus, "artikelen">,
  passage: { structuurLabel?: string | null; tekst?: string | null }
): Artikelmatch | null {
  const gezocht = new Set(focus.artikelen);
  const tekst = passage.tekst ? normaliseer(passage.tekst.split("\n", 1)[0] ?? "") : "";
  if (tekst && RE_BEGINT_MET_ARTIKEL.test(tekst)) {
    // Een echte kopregel (kort) mag meerdere artikelen noemen ("Artikel 150d
    // Pensioenwet en artikel 145c Wvb"); anders telt alleen de openingsverwijzing.
    const kop = tekst.length <= MAX_KOP ? tekst : (tekst.match(RE_VERWIJZING)?.[0] ?? "");
    if (herkenArtikelnummers(kop).some((n) => gezocht.has(n))) return "kop";
  }
  if (herkenArtikelnummers(passage.structuurLabel).some((n) => gezocht.has(n))) return "label";
  return null;
}

/**
 * Past de passage bij het genoemde regime? Een tegengesteld regime (Pensioenwet
 * gevraagd, Wvb-bron) nooit. Een wettekst zonder passend regime alleen als de
 * titel de wet noemt, zodat artikel 150d van een andere wet niet wordt geboost.
 */
export function wetVerenigbaar(
  focus: Pick<Artikelfocus, "wet">,
  bron: { wettelijkRegime?: string | null; documenttype?: string | null; titel?: string | null }
): boolean {
  if (!focus.wet) return true;
  const regime = bron.wettelijkRegime ?? null;
  if ((regime === "pw" || regime === "wvb") && regime !== focus.wet) return false;
  if (bron.documenttype === "wetgeving" && regime !== focus.wet) {
    const titel = normaliseer(bron.titel ?? "");
    return focus.wet === "pw"
      ? /(?<![\p{L}])pensioenwet(?![\p{L}])/u.test(titel)
      : /(?<![\p{L}])wvb(?![\p{L}])|wet verplichte beroepspensioenregeling/u.test(titel);
  }
  return true;
}

/**
 * De frasequery waarmee de adapter nieuwe exacte kandidaten door DEZELFDE
 * zoek-RPC laat toelaten: `"artikel 150d" OR "art 150d"`. De nummers zijn door
 * `herkenArtikelnummers` al beperkt tot cijfers en letters.
 */
export function artikelFrasequery(focus: Pick<Artikelfocus, "artikelen">): string {
  return focus.artikelen.flatMap((n) => [`"artikel ${n}"`, `"art ${n}"`]).join(" OR ");
}

// ── #548-R5 — bronbinding: het letterlijk genoemde juridische document ───────
// HET PROBLEEM (Productiehertest 6 oktober 2026). "Wat staat in artikel 19a,
// 19b en 22 van het Besluit uitvoering Pensioenwet en Wet verplichte
// beroepspensioenregeling …" kreeg de focus 19a/19b/22 zonder regime (de titel
// noemt beide wetten). De boost nam per document één passage (Besluit → 19a)
// en boostte daarnaast artikel 22 van de Pensioenwet en van de Wvb; het
// budget verdrong daarna 19b en 22 van het Besluit. Het antwoord citeerde
// art. 22 Pensioenwet (hoorrecht) en verklaarde 19b/22 van het Besluit afwezig.
//
// DE OPLOSSING. (1) Noemt de vraag LETTERLIJK de titel van een juridisch
// document, dan bindt dat document de artikelfocus: alleen zijn exacte
// passages worden geboost; gelijkgenummerde artikelen uit een andere regeling
// gaan achteraan (toelichting blijft toegestaan als het beleid daar om vraagt).
// (2) Per (document, artikel) één kop, zodat meerdere genoemde artikelen elk
// een plek krijgen in plaats van één per document.
//
// Strikt: alleen de volledige titel (zonder vindplaats tussen haakjes), na
// normalisatie, met woordgrenzen. Een titel die alleen BINNEN een langere
// genoemde titel voorkomt ("Pensioenwet" in "Besluit uitvoering Pensioenwet en
// …") bindt niet. Geen losse woorden, geen afkortingen, geen documentlijst in
// de code: de titels komen onder RLS uit de database.

/** Minimale lengte van een genormaliseerde titel om als documentnaam te gelden. */
const MIN_TITEL = 8;

/** Vorm voor letterlijke naamvergelijking; ook gebruikt door `genoemd-document.ts`. */
export function naamvorm(tekst: string): string {
  return ` ${normaliseer(tekst).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()} `;
}

/** De titel zonder vindplaats/toevoeging tussen haakjes ("(BWBR0020892)"). */
export function titelkern(titel: string): string {
  return naamvorm(titel.replace(/\([^)]*\)/g, " ")).trim();
}

/**
 * Welke juridische documenten de vraag letterlijk noemt. Een document wiens
 * titel alleen binnen de genoemde titel van een ANDER document voorkomt, valt
 * af (de langste naam wint). Volgorde = invoervolgorde; leeg = geen binding.
 */
export function genoemdeJuridischeDocumenten(
  teksten: readonly (string | null | undefined)[],
  documenten: readonly { id: string; titel?: string | null }[]
): string[] {
  const vragen = teksten.filter((t): t is string => Boolean(t)).map(naamvorm);
  if (vragen.length === 0) return [];
  type Treffer = { id: string; vraag: number; van: number; tot: number };
  const treffers: Treffer[] = [];
  const kernen = new Map<string, number>();
  for (const d of documenten) {
    const kern = titelkern(d.titel ?? "");
    if (kern.length < MIN_TITEL) continue;
    kernen.set(d.id, kern.length);
    vragen.forEach((v, vraag) => {
      for (let i = v.indexOf(` ${kern} `); i >= 0; i = v.indexOf(` ${kern} `, i + 1)) {
        treffers.push({ id: d.id, vraag, van: i, tot: i + kern.length + 2 });
      }
    });
  }
  const ingesloten = (t: Treffer) =>
    treffers.some((o) => o.id !== t.id && o.vraag === t.vraag && (kernen.get(o.id) ?? 0) > (kernen.get(t.id) ?? 0) &&
      o.van <= t.van && o.tot >= t.tot);
  const vrij = new Set(treffers.filter((t) => !ingesloten(t)).map((t) => t.id));
  return documenten.filter((d) => vrij.has(d.id)).map((d) => d.id);
}

/** De velden die de boost van een kandidaat leest. */
export interface ArtikelKandidaat {
  documentId: string;
  documenttype?: string | null;
  wetsgeschiedenisSubtype?: string | null;
  structuurLabel?: string | null;
  tekst?: string | null;
  titel?: string | null;
  wettelijkRegime?: string | null;
  /**
   * #548-R5 — de adapter stelde vast dat de vraag dit document letterlijk noemt
   * (`genoemdeJuridischeDocumenten`). Draagt minstens één kandidaat deze vlag,
   * dan is de artikelfocus aan die documenten gebonden.
   */
  genoemdDocument?: boolean;
}

export interface ArtikelBoost<T> {
  /** De nieuwe volgorde: geboostte passages vooraan, verdrongen achteraan, de rest ongewijzigd. */
  volgorde: T[];
  /** Kandidaten die exact bij een gevraagd artikel horen (juridisch, verenigbaar). */
  exact: T[];
  /** De geboostte kandidaten, in volgorde. */
  geboost: T[];
  /**
   * #548-R5 — exacte, gelijkgenummerde passages uit een NIET genoemde regeling
   * terwijl de focus aan een genoemd document gebonden is. Ze gaan achteraan.
   */
  verdrongen: T[];
  /** #548-R5 — de focus was gebonden aan een letterlijk genoemd document. */
  documentGenoemd: boolean;
}

export interface ArtikelBoostOpties {
  /**
   * #548-R5 — bij een gebonden focus: mag een exacte passage uit
   * WETSGESCHIEDENIS van een niet-genoemd document toch mee (bedoelings- of
   * gecombineerde vraag)? Standaard niet.
   */
  toelichtingToegestaan?: boolean;
}

/**
 * Zet per (document, gevraagd artikel) de beste exacte JURIDISCHE passage
 * vooraan (hooguit `max(MAX_ARTIKEL_BOOST, aantal artikelen)`), het genoemde
 * document eerst en daarna in de volgorde van de vraag; alle andere
 * kandidaten houden hun relatieve volgorde. Met één artikel en zonder
 * genoemd document is dit exact het #500-gedrag (één per document, hooguit 3).
 * Een niet-juridische bron (fondsdocument, beleidsstuk) wordt nooit geboost,
 * ook niet als hij een "Artikel 5" draagt. `vastVan` markeert kandidaten die
 * hun plek houden (de door de regimeweging gedemoveerde); die worden niet
 * geboost en niet verdrongen.
 *
 * Geen exacte kandidaat → exact dezelfde array (zelfde referentie).
 */
export function boostArtikelpassages<T>(
  items: T[],
  focus: Artikelfocus,
  lees: (item: T) => ArtikelKandidaat,
  vastVan: (item: T) => boolean = () => false,
  opties: ArtikelBoostOpties = {}
): ArtikelBoost<T> {
  const gelezen = new Map(items.map((item) => [item, lees(item)] as const));
  // Gebonden per DOCUMENT: één gemarkeerde passage volstaat, zodat ook een
  // passage die via een ander spoor binnenkwam bij het genoemde document hoort.
  const genoemdeDocumenten = new Set(
    [...gelezen.values()].filter((k) => k.genoemdDocument === true).map((k) => k.documentId)
  );
  const documentGenoemd = genoemdeDocumenten.size > 0;
  const exact: T[] = [];
  const verdrongen: T[] = [];
  type Beste = { item: T; match: Artikelmatch; artikel: number; positie: number; genoemd: boolean };
  const bestePerSleutel = new Map<string, Beste>();
  items.forEach((item, positie) => {
    if (vastVan(item)) return;
    const k = gelezen.get(item)!;
    const rol = juridischeRolVan(k.documenttype, k.wetsgeschiedenisSubtype);
    if (rol === null) return;
    if (!wetVerenigbaar(focus, k)) return;
    const artikelen = focus.artikelen
      .map((n, i) => ({ i, match: artikelmatch({ artikelen: [n] }, k) }))
      .filter((a): a is { i: number; match: Artikelmatch } => a.match !== null);
    if (artikelen.length === 0) return;
    const genoemd = genoemdeDocumenten.has(k.documentId);
    if (documentGenoemd && !genoemd && !(rol === "wetsgeschiedenis" && opties.toelichtingToegestaan)) {
      verdrongen.push(item);
      return;
    }
    exact.push(item);
    for (const { i, match } of artikelen) {
      const sleutel = `${k.documentId}\u0000${i}`;
      const eerder = bestePerSleutel.get(sleutel);
      if (!eerder || (eerder.match === "label" && match === "kop")) {
        bestePerSleutel.set(sleutel, { item, match, artikel: i, positie, genoemd });
      }
    }
  });
  if (exact.length === 0 && verdrongen.length === 0) {
    return { volgorde: items, exact, geboost: [], verdrongen, documentGenoemd };
  }
  const cap = Math.max(MAX_ARTIKEL_BOOST, focus.artikelen.length);
  const geboost: T[] = [];
  for (const b of [...bestePerSleutel.values()].sort(
    (a, b) => Number(b.genoemd) - Number(a.genoemd) || a.artikel - b.artikel || a.positie - b.positie
  )) {
    if (geboost.length >= cap) break;
    if (!geboost.includes(b.item)) geboost.push(b.item);
  }
  // #500-gedrag behouden: zonder genoemd document blijven de geboostte
  // passages in hun onderlinge (relevantie)volgorde.
  if (!documentGenoemd) geboost.sort((a, b) => items.indexOf(a) - items.indexOf(b));
  const vooraan = new Set(geboost);
  const achteraan = new Set(verdrongen);
  return {
    volgorde: [...geboost, ...items.filter((c) => !vooraan.has(c) && !achteraan.has(c)), ...verdrongen],
    exact,
    geboost,
    verdrongen,
    documentGenoemd,
  };
}
