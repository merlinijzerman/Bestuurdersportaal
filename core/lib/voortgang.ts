// ============================================================================
//  Voortgangsfasen voor het AI-antwoordpad (besluit 0087).
// ----------------------------------------------------------------------------
//  Tussen het versturen van een vraag en de eerste letter van het antwoord doet
//  /api/chat het duurste werk (reformulatie op het sterke model, hybride RAG,
//  reranker, promptopbouw). Deze module levert de STATISCHE fase-labels en de
//  pure afleiding "welke fasen worden getoond bij welke vlaggen", zodat server
//  (event-emissie) en client (weergave) één bron delen en de logica los
//  testbaar is (voortgang.sanity.ts).
//
//  GUARDRAIL "geen schijnzekerheid": een fase wordt ALLEEN getoond als de
//  bijbehorende serverstap daadwerkelijk draait. Overgeslagen stappen worden
//  weggelaten, niet grijs getoond. De teksten zijn statisch; alleen de aantallen
//  komen uit de werkelijke verwerking. Geen timers, geen geschatte percentages.
// ============================================================================

export type VoortgangFase =
  | "reformulatie"
  | "retrieval"
  | "web"
  | "analyse"
  | "generatie";

/** Vaste volgorde waarin de fasen elkaar opvolgen. */
export const VOORTGANG_VOLGORDE: readonly VoortgangFase[] = [
  "reformulatie",
  "retrieval",
  "web",
  "analyse",
  "generatie",
];

/** Lopende-regel-tekst per fase (statisch; geen inhoud, geen bronnen). */
export const VOORTGANG_LABEL: Record<VoortgangFase, string> = {
  reformulatie: "Uw vraag wordt in context geplaatst",
  retrieval: "Fondsdocumenten worden doorzocht",
  web: "Toegestane externe bronnen worden voorbereid",
  analyse: "Document wordt geanalyseerd",
  generatie: "Antwoord wordt opgesteld",
};

/** Vlaggen die bepalen welke fasen daadwerkelijk draaien voor deze vraag. */
export interface VoortgangVlaggen {
  /** History-aware reformulatie-stap op het sterke model daadwerkelijk uitgevoerd
   *  (ongeacht of de herschreven vraag afweek — de stap kostte hoe dan ook tijd). */
  reformulatieActief: boolean;
  /** RAG-retrieval uitgevoerd (bibliotheek-modi of targeted scope). De reranker is
   *  GEEN aparte zichtbare fase meer (besluit 0138 — addendum op 0087): zijn uitkomst
   *  telt mee in de betekenisvolle retrieval-regel (aantal geselecteerde passages),
   *  niet in een aparte stap die van een default-uit-vlag afhing. */
  retrievalActief: boolean;
  /** Live web-retrieval toegestaan/voorbereid voor deze vraag. */
  webActief: boolean;
  /** Brede documentanalyse (map-reduce) draait. */
  analyseActief: boolean;
}

/**
 * Pure afleiding: welke fasen tonen we, in welke volgorde, gegeven de vlaggen.
 * `generatie` staat er altijd (het antwoord wordt altijd opgesteld). De overige
 * fasen verschijnen alleen als hun serverstap draait (geen schijnzekerheid).
 */
export function bepaalZichtbareFasen(v: VoortgangVlaggen): VoortgangFase[] {
  const fasen: VoortgangFase[] = [];
  if (v.reformulatieActief) fasen.push("reformulatie");
  if (v.retrievalActief) fasen.push("retrieval");
  if (v.webActief) fasen.push("web");
  if (v.analyseActief) fasen.push("analyse");
  fasen.push("generatie");
  return fasen;
}

// ── Uitkomst-formatters (aantallen uit de werkelijke verwerking) ────────────

/** Extra signalen die de retrieval-regel kan dragen. `ftsArmLeeg` = de lexicale
 *  zoekarm leverde niets op (M5-haakje); de reducer/route zet dit uit de meta. */
export interface RetrievalUitkomstOpties {
  ftsArmLeeg?: boolean;
}

/**
 * "uit 4 documenten — 8 passages geselecteerd" (besluit 0138 — addendum op 0087).
 *
 * VERVANGT het oude "N passages gevonden", dat een CONSTANTE was: `opgehaald` is het
 * ophaalplafond (CHUNK_BUDGET·3, hooguit verlaagd door fondsdiscipline) en varieert
 * dus nauwelijks. Deze regel toont wat bestuurlijk betekenis heeft — het aantal
 * UNIEKE documenten en het aantal DAADWERKELIJK geselecteerde passages — en klopt in
 * beide reranker-standen: met rerank aan is `geselecteerd` het aantal ná de drempel,
 * met rerank uit het aantal ná weging/selectie. Nul is in beide getallen expliciet
 * zichtbaar (geen schijnzekerheid). Optioneel een M5-notitie als de lexicale arm
 * leeg was.
 */
export function retrievalUitkomst(
  documenten: number,
  geselecteerd: number,
  opties: RetrievalUitkomstOpties = {}
): string {
  const docLabel = documenten === 1 ? "document" : "documenten";
  const passLabel = geselecteerd === 1 ? "passage" : "passages";
  const basis = `uit ${documenten} ${docLabel} — ${geselecteerd} ${passLabel} geselecteerd`;
  // M5-haakje: maak zichtbaar dat de lexicale zoekarm niets opleverde (bv. bij een
  // vraag die semantisch wél, maar op trefwoord niet matchte).
  return opties.ftsArmLeeg ? `${basis} · lexicale zoekarm leeg` : basis;
}

/** "3 externe bronnen toegestaan" — aantal actieve whitelist-domeinen. */
export function webUitkomst(aantalToegestaan: number): string {
  return `${aantalToegestaan} externe ${
    aantalToegestaan === 1 ? "bron" : "bronnen"
  } toegestaan`;
}
