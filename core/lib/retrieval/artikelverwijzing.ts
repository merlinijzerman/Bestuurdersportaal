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

/** De velden die de boost van een kandidaat leest. */
export interface ArtikelKandidaat {
  documentId: string;
  documenttype?: string | null;
  wetsgeschiedenisSubtype?: string | null;
  structuurLabel?: string | null;
  tekst?: string | null;
  titel?: string | null;
  wettelijkRegime?: string | null;
}

export interface ArtikelBoost<T> {
  /** De nieuwe volgorde: geboostte passages vooraan, de rest ongewijzigd. */
  volgorde: T[];
  /** Kandidaten die exact bij een gevraagd artikel horen (juridisch, verenigbaar). */
  exact: T[];
  /** De geboostte kandidaten, in volgorde. */
  geboost: T[];
}

/**
 * Zet per document de beste exacte JURIDISCHE passage vooraan (hooguit
 * `MAX_ARTIKEL_BOOST`), in hun onderlinge volgorde; alle andere kandidaten
 * houden hun relatieve volgorde. Een niet-juridische bron (fondsdocument,
 * beleidsstuk) wordt nooit geboost, ook niet als hij een "Artikel 5" draagt.
 * `vastVan` markeert kandidaten die hun plek houden (de door de regime-
 * weging gedemoveerde); die worden niet geboost.
 *
 * Geen exacte kandidaat → exact dezelfde array (zelfde referentie).
 */
export function boostArtikelpassages<T>(
  items: T[],
  focus: Artikelfocus,
  lees: (item: T) => ArtikelKandidaat,
  vastVan: (item: T) => boolean = () => false
): ArtikelBoost<T> {
  const exact: T[] = [];
  const bestePerDocument = new Map<string, { item: T; match: Artikelmatch }>();
  for (const item of items) {
    if (vastVan(item)) continue;
    const k = lees(item);
    if (juridischeRolVan(k.documenttype, k.wetsgeschiedenisSubtype) === null) continue;
    const match = artikelmatch(focus, k);
    if (!match || !wetVerenigbaar(focus, k)) continue;
    exact.push(item);
    const eerder = bestePerDocument.get(k.documentId);
    if (!eerder || (eerder.match === "label" && match === "kop")) {
      bestePerDocument.set(k.documentId, { item, match });
    }
  }
  if (exact.length === 0) return { volgorde: items, exact, geboost: [] };
  const kandidaten = new Set([...bestePerDocument.values()].map((b) => b.item));
  const geboost = items.filter((c) => kandidaten.has(c)).slice(0, MAX_ARTIKEL_BOOST);
  const gebooststSet = new Set(geboost);
  return { volgorde: [...geboost, ...items.filter((c) => !gebooststSet.has(c))], exact, geboost };
}
