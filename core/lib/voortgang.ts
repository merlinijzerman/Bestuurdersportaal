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
  | "rerank"
  | "web"
  | "analyse"
  | "generatie";

/** Vaste volgorde waarin de fasen elkaar opvolgen. */
export const VOORTGANG_VOLGORDE: readonly VoortgangFase[] = [
  "reformulatie",
  "retrieval",
  "rerank",
  "web",
  "analyse",
  "generatie",
];

/** Lopende-regel-tekst per fase (statisch; geen inhoud, geen bronnen). */
export const VOORTGANG_LABEL: Record<VoortgangFase, string> = {
  reformulatie: "Uw vraag wordt in context geplaatst",
  retrieval: "Fondsdocumenten worden doorzocht",
  rerank: "Meest relevante passages worden gekozen",
  web: "Toegestane externe bronnen worden voorbereid",
  analyse: "Document wordt geanalyseerd",
  generatie: "Antwoord wordt opgesteld",
};

/** Vlaggen die bepalen welke fasen daadwerkelijk draaien voor deze vraag. */
export interface VoortgangVlaggen {
  /** History-aware reformulatie-stap op het sterke model daadwerkelijk uitgevoerd
   *  (ongeacht of de herschreven vraag afweek — de stap kostte hoe dan ook tijd). */
  reformulatieActief: boolean;
  /** RAG-retrieval uitgevoerd (bibliotheek-modi of targeted scope). */
  retrievalActief: boolean;
  /** Reranker toegepast (fondsvlag rerank aan én er is geretrieved). */
  rerankActief: boolean;
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
  if (v.rerankActief) fasen.push("rerank");
  if (v.webActief) fasen.push("web");
  if (v.analyseActief) fasen.push("analyse");
  fasen.push("generatie");
  return fasen;
}

// ── Uitkomst-formatters (aantallen uit de werkelijke verwerking) ────────────

/** "18 passages gevonden" — het aantal opgehaalde passages na retrieval. */
export function retrievalUitkomst(opgehaald: number): string {
  return `${opgehaald} ${opgehaald === 1 ? "passage" : "passages"} gevonden`;
}

/** "6 relevant bevonden" — na reranken/drempel. Nul is expliciet zichtbaar. */
export function rerankUitkomst(geselecteerd: number): string {
  return `${geselecteerd} relevant bevonden`;
}

/** "3 externe bronnen toegestaan" — aantal actieve whitelist-domeinen. */
export function webUitkomst(aantalToegestaan: number): string {
  return `${aantalToegestaan} externe ${
    aantalToegestaan === 1 ? "bron" : "bronnen"
  } toegestaan`;
}
