// ============================================================================
//  Documentspoor — een letterlijk genoemd (niet-juridisch) document in een
//  vrije vraag.
// ----------------------------------------------------------------------------
//  PUUR en PROVIDERNEUTRAAL: geen I/O, geen DB, geen chunkvorm.
//
//  HET PROBLEEM. Een vrije vraag naar een openbaar DNB-document noemt de
//  volledige titel, maar heeft geen gekozen documentscope. Als het hybride
//  pad na een DB-time-out terugvalt op tekstzoeken, krijgt de OR-terugval
//  veel titelwoorden. `zoek_vector` bevat de contextprefix (met de titel)
//  van ELKE chunk; daardoor wonnen de titel- en inleidingspagina's (p. 1/3/5)
//  de rangschikking. De
//  maatregelen op p. 17 kwamen niet in de antwoordcontext. De twee bestaande
//  bindingen dekten de vraag niet: M3 (`resolveerGenoemdDocument`) staat achter
//  de vlag `vraagrouter_v2`, en #548-R5 bindt alleen juridische documenten.
//
//  DE OPLOSSING (aanvullend, geen scope). Noemt de vraag letterlijk de
//  VOLLEDIGE titel van precies één toegankelijk document, dan zoekt de adapter
//  daarnaast binnen dat document met de vraag zónder die titel, en zet de
//  beste passages vooraan in de kandidatenpool. De gewone retrieval blijft
//  staan; het antwoord wordt niet tot het document beperkt en er verschijnt
//  geen keuzevraag. Twee of meer passende titels: geen binding (exact het
//  gedrag van vóór deze wijziging).
//
//  BEWUST NIET `resolveerGenoemdDocument`. Die laat naast een volledige titel
//  ook één los titelwoord van ≥ 8 tekens tellen; "pensioenfondsen" zou dan elke
//  DNB-good-practice raken en de vraag ambigu maken of aan een verkeerd
//  document binden. Hier geldt het strikte #548-R5-predicaat: de volledige
//  titelkern met woordgrenzen, de langste naam wint, plus een minimale
//  titellengte zodat een kale titel als "Beleggingsbeleid" niet elke vraag
//  over beleggingsbeleid aan één document hangt.
// ============================================================================
import { genoemdeJuridischeDocumenten, naamvorm, titelkern } from "./artikelverwijzing";

/** Minimaal aantal woorden in de titelkern. */
export const MIN_TITELWOORDEN = 3;
/** Minimale lengte van de genormaliseerde titelkern. */
export const MIN_TITELTEKENS = 16;

export interface BenoembaarDocument {
  id: string;
  titel: string | null;
}

export type DocumentspoorBinding =
  | { status: "geen" }
  /** Meer dan één document past letterlijk: niet gokken, geen binding. */
  | { status: "meerdere"; aantal: number }
  /**
   * Precies één document. `restvraag` is de vraag zonder de titel; zo bepaalt
   * de titel niet langer welke passage binnen het document wint.
   */
  | { status: "eenduidig"; documentId: string; restvraag: string };

function isNoembaar(titel: string | null): boolean {
  const kern = titelkern(titel ?? "");
  return kern.length >= MIN_TITELTEKENS && kern.split(" ").length >= MIN_TITELWOORDEN;
}

/**
 * Bindt de vraag aan een letterlijk genoemd document, of niet. De documenten
 * zijn de aanroeper zijn verantwoordelijkheid: alleen wat onder RLS zichtbaar,
 * actief, geïndexeerd en (WP3) schoon gescand is.
 *
 * `teksten` volgt #548-R5: [zoekvraag, origineleVraag]. Een herformulering van
 * een vervolgvraag kan de letterlijk genoemde titel verliezen; de oorspronkelijke
 * gebruikerstaal bindt dan nog. Noemen de teksten samen meer dan één document
 * (ook: elk een ander), dan is er geen binding. De restvraag komt uit de EERSTE
 * tekst die de titel letterlijk bevat, zodat de zoekslag past bij de tekst die
 * de binding droeg.
 */
export function bindGenoemdDocument(
  teksten: string | readonly (string | null | undefined)[],
  documenten: readonly BenoembaarDocument[]
): DocumentspoorBinding {
  const lijst = (typeof teksten === "string" ? [teksten] : teksten)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  const noembaar = documenten.filter((d) => isNoembaar(d.titel));
  if (lijst.length === 0 || noembaar.length === 0) return { status: "geen" };
  const treffers = genoemdeJuridischeDocumenten(lijst, noembaar);
  if (treffers.length === 0) return { status: "geen" };
  if (treffers.length > 1) return { status: "meerdere", aantal: treffers.length };

  const documentId = treffers[0];
  const kern = titelkern(noembaar.find((d) => d.id === documentId)?.titel ?? "");
  const bron = lijst.find((t) => naamvorm(t).includes(` ${kern} `)) ?? lijst[0];
  let rest = naamvorm(bron);
  while (rest.includes(` ${kern} `)) rest = rest.replace(` ${kern} `, " ");
  const restvraag = rest.trim();
  // Zonder resterende inhoud ("Good practice ESG risicobeheer pensioenfondsen?")
  // zoekt het spoor op de volledige tekst; de titel is dan de vraag.
  return { status: "eenduidig", documentId, restvraag: restvraag.length > 0 ? restvraag : bron };
}

/** Minimale lengte van een woord dat de titelopzoeking mag versmallen. */
export const MIN_ZOEKTERM = 6;
/** Maximaal aantal zoektermen in de titelopzoeking (tegen query-explosie). */
export const MAX_ZOEKTERMEN = 8;

/**
 * De woorden waarmee de adapter de titelopzoeking versmalt: een titel kan
 * alleen letterlijk in de vraag staan als zijn woorden dat ook doen, dus elk
 * kandidaatdocument bevat minstens één van deze woorden (de langste eerst).
 * Leeg = geen woord lang genoeg = geen documentquery. Alleen letters en
 * cijfers, zodat een term nooit de PostgREST-filtersyntaxis raakt.
 *
 * Grens, bewust fail-safe: een titel waarvan elk woord korter is dan
 * MIN_ZOEKTERM, of een vraag met meer dan MAX_ZOEKTERMEN langere woorden, kan
 * een binding missen. Dan blijft het gedrag van vóór dit spoor.
 */
export function titelzoektermen(teksten: string | readonly (string | null | undefined)[]): string[] {
  const lijst = (typeof teksten === "string" ? [teksten] : teksten).filter((t): t is string => typeof t === "string");
  const woorden = lijst.flatMap((t) => naamvorm(t).trim().split(" "))
    .filter((w) => w.length >= MIN_ZOEKTERM && /^[\p{L}\p{N}]+$/u.test(w));
  return [...new Set(woorden)]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_ZOEKTERMEN);
}

// ── Benoemde secties binnen het gebonden document ──────────────────────────
//
//  HET PROBLEEM (Productiecanary na PR #574). "GP6 én GP7 uit <titel>": de
//  restvraag hield `gp6` en `gp7`, maar de strikte FTS-poging eist beide in één
//  chunk (0 rijen) en de OR-terugval laat woorden < 4 tekens vallen
//  (`fts-terugval.ts`, MIN_LENGTE). De identificatoren speelden dus geen rol;
//  GP7 kwam toevallig binnen via een gedeeld woord, de GP6-kern niet.
//
//  DE OPLOSSING. Noemt de restvraag identificatoren (letters direct gevolgd door
//  cijfers), dan zoekt het spoor in het ene gebonden document naar KOPPEN van
//  die REEKS ("GP" + nummer). Een kop staat aan het begin van de chunk of na een
//  alineagrens (lege regel), eventueel met markdownopmaak ervoor (`#`, een
//  opsommingsteken, `**`/`__`), en wordt gevolgd door een kopafsluiter (`:`, `.`,
//  een gedachtestreep, een regeleinde of een woord met hoofdletter). Zo telt
//  "\n\n**GP6: Een pensioenfonds …" (de Productievorm) wél, en "zie GP6",
//  "Zoals **GP6** aangeeft" of een regelafbreking midden in een zin niet.
//
//  Drie uitkomsten per identificator:
//    - kop gevonden;
//    - de reeks heeft koppen in dit document maar deze niet ⇒ ONTBREKEND;
//    - de reeks heeft géén koppen ⇒ geen sectie-id maar een inhoudsterm ("CO2").
//  Alles-of-niets: ontbreekt één gevraagde sectie, dan voegt het spoor niets toe
//  (geen gedeeltelijke context die als bewijs van afwezigheid kan gelden).
//  Alleen inhoudstermen ⇒ het bestaande FTS-pad, ongewijzigd.

/** Hoeveel identificatoren uit één vraag het spoor hooguit opzoekt. */
export const MAX_IDENTIFICATOREN = 3;

const RE_IDENTIFICATOR = /^(\p{L}{1,4})(\d{1,3}\p{L}?)$/u;

/**
 * De identificatoren in een (rest)vraag, genormaliseerd, uniek, in volgorde
 * van voorkomen: "GP6 en GP7" → ["gp6", "gp7"]. Alleen letters direct gevolgd
 * door cijfers; een jaartal of los getal telt niet. Bij meer dan de toegestane
 * drie geven we er vier terug als overschrijdingssignaal: nooit stil een
 * gevraagde sectie laten vallen. Of het een SECTIE is, beslist het document.
 */
export function herkenIdentificatoren(tekst: string): string[] {
  const uit: string[] = [];
  for (const w of naamvorm(tekst).trim().split(" ")) {
    if (!RE_IDENTIFICATOR.test(w) || uit.includes(w)) continue;
    uit.push(w);
    if (uit.length > MAX_IDENTIFICATOREN) break;
  }
  return uit;
}

function delen(id: string): { letters: string; nummer: string } {
  const m = id.match(RE_IDENTIFICATOR)!;
  return { letters: m[1].toLowerCase(), nummer: m[2].toLowerCase() };
}

/** De reeks van een identificator: "gp6" → "gp". */
export function reeksVan(id: string): string {
  return delen(id).letters;
}

/** Letters als hoofdletterongevoelige klasse ("gp" → "[gG][pP]"), zonder de i-vlag. */
function klasse(tekst: string): string {
  return [...tekst].map((t) => (t.toLowerCase() === t.toUpperCase() ? t : `[${t.toLowerCase()}${t.toUpperCase()}]`)).join("");
}

/**
 * DB-zijdig voorfilter (PostgREST `imatch`, POSIX) op de REEKS: elk los woord
 * "<letters><cijfers>" ("GP6", "GP 12", "GP-3a"). Bewust ruim; de kopregel
 * (`isSectiekop`) beslist in de app. Alleen letters komen in het patroon.
 */
export function reeksImatch(letters: string): string {
  return `(^|[^[:alnum:]])${letters}[ .-]?[0-9]{1,3}[[:alpha:]]?([^[:alnum:]]|$)`;
}

/**
 * Kopregex voor één identificator (of, met `nummer` = null, voor elke kop van
 * de reeks). Begin van de tekst of na een alineagrens; optionele opmaak;
 * daarna een kopafsluiter. Geen i-vlag: "Een" na de kop moet een hoofdletter
 * blijven, alleen de identificator is hoofdletterongevoelig.
 */
function kopRegex(letters: string, nummer: string | null): RegExp {
  const id = `${klasse(letters)}[ .-]?${nummer === null ? String.raw`\d{1,3}\p{L}?` : klasse(nummer)}`;
  const grens = String.raw`(?:^|\n[ \t]*\n)[ \t]*`;
  const opmaak = String.raw`(?:#{1,6}[ \t]+)?(?:[-•·][ \t]+)?(?:\*\*|__)?[ \t]*`;
  const afsluiter = String.raw`(?:\*\*|__)?(?=[ \t]*(?::|\.(?!\d)|[–—-][ \t]|\n|$)|[ \t]+\p{Lu})`;
  return new RegExp(`${grens}${opmaak}${id}(?![\\p{L}\\p{N}])${afsluiter}`, "u");
}

/** Is deze tekst (ook) de KOP van sectie `id`? Zie de regel bovenaan dit blok. */
export function isSectiekop(tekst: string, id: string): boolean {
  const { letters, nummer } = delen(id);
  return kopRegex(letters, nummer).test(tekst);
}

/**
 * Begint deze tekst zelf met een kop van dezelfde reeks? Voorloopwitruimte en
 * lege regels ("\n\n**GP8: …") tellen niet als inhoud: ook dan is het een
 * nieuwe sectie en nooit een vervolg.
 */
function begintMetReekskop(tekst: string, letters: string): boolean {
  const m = tekst.replace(/^\s+/u, "").match(kopRegex(letters, null));
  return m !== null && m.index === 0;
}

export interface Sectierij {
  id: string;
  chunk_index: number;
  tekst: string;
}

export interface Sectiekeuze {
  /** Per gevonden identificator de kopchunk, in vraagvolgorde. */
  koppen: { id: string; rij: Sectierij }[];
  /** Identificatoren van een reeks MET koppen in dit document, maar zonder eigen kop. */
  ontbrekend: string[];
  /** Identificatoren waarvan de reeks geen enkele kop heeft: inhoudstermen ("co2"). */
  geenReeks: string[];
}

/**
 * Classificeert de identificatoren tegen de rijen van het document: per
 * identificator de eerste kopchunk (laagste chunk_index), anders ontbrekend
 * (de reeks bestaat als kop) of geen reeks (inhoudsterm).
 */
export function classificeerIdentificatoren(ids: readonly string[], rijen: readonly Sectierij[]): Sectiekeuze {
  const gesorteerd = [...rijen].sort((a, b) => a.chunk_index - b.chunk_index);
  const keuze: Sectiekeuze = { koppen: [], ontbrekend: [], geenReeks: [] };
  for (const id of ids) {
    const rij = gesorteerd.find((r) => isSectiekop(r.tekst, id));
    if (rij) keuze.koppen.push({ id, rij });
    else if (gesorteerd.some((r) => kopRegex(reeksVan(id), null).test(r.tekst))) keuze.ontbrekend.push(id);
    else keuze.geenReeks.push(id);
  }
  return keuze;
}

/**
 * Is `volgende` de voortzetting van de sectie die in `kop` begint? Ja, tenzij
 * hij zelf met een kop van dezelfde reeks begint (dan is het een nieuwe sectie).
 */
export function isVervolg(kopId: string, volgende: Sectierij): boolean {
  return !begintMetReekskop(volgende.tekst, reeksVan(kopId));
}
