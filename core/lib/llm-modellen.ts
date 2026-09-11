// ============================================================================
//  lib/llm-modellen.ts — centrale, dependency-vrije model-constanten.
// ----------------------------------------------------------------------------
//  Eén bron-van-waarheid voor de model-strings die op MEERDERE plekken in de
//  pipeline nodig zijn, zodat er geen model-drift tussen paden ontstaat (het
//  bekende risico van gedupliceerde modelconfig). Bewust zonder imports (geen
//  SDK, geen aqlab-registry) zodat elk pad — ingest, chat-route, reranker — dit
//  goedkoop kan importeren zonder een zware afhankelijkheidsketen mee te trekken.
//
//  Het generatiemodel in lib/generatie-kern.ts is alleen een code-default voor
//  tests/AQLab; productiepaden resolveren provider en model via de AI-gateway.
//  Dit bestand dekt de gedeelde HULP-modeldefaults voor platformtaken.
//
//  LET OP: verifieer elke modelstring tegen het Anthropic-account vóór deploy
//  voordat een platformtaak het als expliciete modelkeuze gebruikt.
// ============================================================================

// Goedkoop/snel Haiku-model voor hulptaken: context-prefix bij ingest (R1.2),
// de extractieve map-stap bij grote documenten, en de retrieval-reranker (R1.3).
// Eén constante zodat een upgrade op één plek gebeurt.
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
