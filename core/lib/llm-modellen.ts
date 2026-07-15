// ============================================================================
//  lib/llm-modellen.ts — centrale, dependency-vrije model-constanten.
// ----------------------------------------------------------------------------
//  Eén bron-van-waarheid voor de model-strings die op MEERDERE plekken in de
//  pipeline nodig zijn, zodat er geen model-drift tussen paden ontstaat (het
//  bekende risico van gedupliceerde modelconfig). Bewust zonder imports (geen
//  SDK, geen aqlab-registry) zodat elk pad — ingest, chat-route, reranker — dit
//  goedkoop kan importeren zonder een zware afhankelijkheidsketen mee te trekken.
//
//  Voor het GENERATIE-model (chat-antwoorden) geldt AI_MODEL in lib/generatie-
//  kern.ts als centrale, env-overschrijfbare bron; die blijft daar staan naast de
//  bijbehorende tokenbudgetten. Dit bestand dekt de gedeelde HULP-modellen.
//
//  LET OP: verifieer elke modelstring tegen het Anthropic-account vóór deploy
//  (identiek aan de hedging bij AI_MODEL).
// ============================================================================

// Goedkoop/snel Haiku-model voor hulptaken: context-prefix bij ingest (R1.2),
// de extractieve map-stap bij grote documenten, en de retrieval-reranker (R1.3).
// Eén constante zodat een upgrade op één plek gebeurt.
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
