// ============================================================================
//  lib/jargon-expansie.ts — NL-pensioenjargon-expansie voor de FTS-arm (R1.4).
// ----------------------------------------------------------------------------
//  Doel (RAG-review B7): Dutch-FTS matcht op morfologie, maar pensioenjargon kent
//  afkorting↔voluit-paren ("Wtp"/"Wet toekomst pensioenen", "ABTN"/…) waar de
//  lexicale arm langs elkaar heen zoekt. Een klein, gecureerd synoniemenlexicon
//  vult de kandidatenpool breder; precisie wordt daarna hersteld door de reranker
//  (R1.3), de relevantie-drempel (R1.5) en de RRF-fusie.
//
//  ALLEEN de FTS-arm. De vectorquery blijft de originele (gereformuleerde) vraag
//  — embeddings vangen semantiek al op en mogen niet met OR-ruis vervuild worden.
//
//  VEILIGHEID (websearch_to_tsquery kent GEEN haakjes-groepering): we voegen de
//  synoniemen als OR-termen ACHTER de originele query toe. Dat levert
//  `(<originele AND-keten>) | syn1 | syn2` — een MONOTONE superset van de
//  originele treffers: een expansie kan nooit een originele treffer wegnemen,
//  alleen recall verbreden. ts_rank_cd scoort volledige-query-treffers het hoogst;
//  de downstream-precisiepoorten filteren de bredere recall. Zou een substitutie
//  ín de query (bv. de afkorting vervángen) zijn gebeurd, dan brak de AND-semantiek
//  van de rest van de vraag — daarom expliciet append-only.
//
//  Pure, deterministische functie (geen SDK/DB); versioneerbaar lexicon.
//  Sanity: lib/jargon-expansie.sanity.ts.
// ============================================================================

// Versiestempel van het lexicon; bump bij inhoudelijke wijziging zodat een
// gedragsverschil traceerbaar blijft in retrieval_meta.jargon_expansie-analyses.
export const JARGON_LEXICON_VERSIE = "r1-jargon-v1";

// Max aantal OR-termen dat we per vraag toevoegen — tegen query-explosie bij een
// vraag die toevallig veel jargon bevat. Ruim boven een normale vraag.
const MAX_EXPANSIES = 6;

// Gecureerd, navolgbaar lexicon. Elke groep is een set ONDERLING equivalente
// termen: matcht één term in de vraag, dan worden de overige als OR toegevoegd
// (beide richtingen: afkorting→voluit én voluit→afkorting). Termen lowercase.
// Meerwoordstermen als spatie-gescheiden frase (worden bij append gequote zodat
// websearch ze als phrase behandelt).
//
// Bewust WEGGELATEN omdat ze te ambigu zijn voor een woordgrens-match in normale
// bestuurstaal (zouden gewone woorden raken): losse 2-lettercodes zonder duidelijk
// jargonprofiel. Aanvullen uit het eigen corpus is een expliciete lexiconwijziging.
type JargonGroep = { termen: string[] };

const LEXICON: JargonGroep[] = [
  { termen: ["wtp", "wet toekomst pensioenen"] },
  { termen: ["pw", "pensioenwet"] },
  { termen: ["abtn", "actuariële en bedrijfstechnische nota"] },
  { termen: ["ufr", "ultimate forward rate"] },
  { termen: ["ftk", "financieel toetsingskader"] },
  { termen: ["dnb", "de nederlandsche bank"] },
  { termen: ["afm", "autoriteit financiële markten"] },
  { termen: ["szw", "sociale zaken en werkgelegenheid"] },
  { termen: ["ecb", "europese centrale bank"] },
  { termen: ["bpf", "bedrijfstakpensioenfonds"] },
  { termen: ["opf", "ondernemingspensioenfonds"] },
  { termen: ["apf", "algemeen pensioenfonds"] },
  { termen: ["ppi", "premiepensioeninstelling"] },
  { termen: ["spr", "solidaire premieregeling"] },
  { termen: ["fpr", "flexibele premieregeling"] },
  { termen: ["cdc", "collective defined contribution"] },
  { termen: ["sfdr", "sustainable finance disclosure regulation"] },
  { termen: ["esg", "environmental social governance"] },
  { termen: ["vev", "vereist eigen vermogen"] },
  { termen: ["mvev", "minimaal vereist eigen vermogen"] },
  { termen: ["aow", "algemene ouderdomswet"] },
  { termen: ["anw", "algemene nabestaandenwet"] },
  { termen: ["kifid", "klachteninstituut financiële dienstverlening"] },
  { termen: ["iorp", "institutions for occupational retirement provision"] },
  { termen: ["vo", "verantwoordingsorgaan"] },
  { termen: ["bo", "belanghebbendenorgaan"] },
  { termen: ["rvt", "raad van toezicht"] },
  { termen: ["vc", "visitatiecommissie"] },
  { termen: ["rj", "raad voor de jaarverslaggeving"] },
];

// Normaliseer voor detectie: lowercase, diakrieten weg (zodat "financiële" ~
// "financiele" matcht), leestekens → spatie, spaties samengevoegd, met
// randspaties zodat elke term op woord-/frasegrens matcht.
function genormaliseerd(tekst: string): string {
  const kaal = tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${kaal} `;
}

// Term (single of multi-word) aanwezig in de genormaliseerde+gepadde query?
// Woord-/frasegrens-match via omringende spaties (voorkomt substring-false-
// positives zoals "vo" in "volgens").
function bevatTerm(gepaddeGenorm: string, term: string): boolean {
  const t = term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return gepaddeGenorm.includes(` ${t} `);
}

// Quote meerwoordstermen zodat websearch_to_tsquery ze als phrase (<->) leest;
// enkelwoordstermen ongewijzigd.
function alsQueryTerm(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

export interface JargonExpansieResultaat {
  // De (mogelijk) verbrede FTS-query; identiek aan de input als er niets matchte.
  query: string;
  // Toegepaste expansies voor het auditspoor (retrieval_meta.jargon_expansie).
  toegepast: { van: string; naar: string }[];
}

// Verbreedt de FTS-query met jargon-synoniemen. Deterministisch en idempotent:
// een term die al (letterlijk of via een eerdere expansie) in de query staat,
// wordt niet opnieuw toegevoegd, dus expandeerFtsQuery(expandeerFtsQuery(q).query)
// levert dezelfde query-string. Gewone woorden (buiten het lexicon) blijven
// ongemoeid.
export function expandeerFtsQuery(vraag: string): JargonExpansieResultaat {
  const genorm = genormaliseerd(vraag);
  const toegepast: { van: string; naar: string }[] = [];
  const teAppenden: string[] = [];

  for (const groep of LEXICON) {
    // Welke termen van deze groep staan al in de vraag?
    const aanwezig = groep.termen.filter((t) => bevatTerm(genorm, t));
    if (aanwezig.length === 0) continue;
    const trigger = aanwezig[0];
    for (const t of groep.termen) {
      if (bevatTerm(genorm, t)) continue; // al aanwezig → niet toevoegen (idempotent)
      teAppenden.push(alsQueryTerm(t));
      toegepast.push({ van: trigger, naar: t });
      if (teAppenden.length >= MAX_EXPANSIES) break;
    }
    if (teAppenden.length >= MAX_EXPANSIES) break;
  }

  if (teAppenden.length === 0) return { query: vraag, toegepast: [] };
  return { query: `${vraag} or ${teAppenden.join(" or ")}`, toegepast };
}
