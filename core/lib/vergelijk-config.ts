// ============================================================================
//  core/lib/vergelijk-config.ts — feature-flags voor de vergelijkmodus (T5).
// ----------------------------------------------------------------------------
//  Twee onafhankelijke, fail-safe-naar-UIT vlaggen:
//
//   1. VERGELIJKMODUS — de hoofdschakelaar. Uit = geen vergelijking, chat volledig
//      ongewijzigd (terugdraaibaarheid: de intentie-poort en de service-ingang doen
//      niets). Aan = de vergelijkmodus is beschikbaar.
//
//   2. VERGELIJK_DETERMINISTISCH_VERTROUWD — de contingentie-poort uit de werkopdracht.
//      Het deterministische cijfer/datum-pad leunt op T8-extractie op ECHT dossier en
//      op OCCURRENCE-niveau; die twee interne poorten zijn nog niet afgetekend
//      (HANDOVER 12-08-2026, besluit 0171). Zolang deze vlag UIT staat valt ELKE
//      dimensie terug op LLM-vergelijking (method='llm'), óók als beide zijden een
//      semantic_unit hebben. Zet 'm pas op 'on' NÁ het aftekenen van die poorten.
//      Extra veiligheid: zonder gevulde semantic_units (flag SEMANTISCHE_EXTRACTIE uit)
//      vuurt het deterministische pad sowieso niet — dit is de expliciete tweede grendel.
//
//  Bewust dependency-vrij (geen SDK/Supabase) — zelfde patroon als llm-modellen.ts.
// ============================================================================

/** Hoofdschakelaar. Fail-safe: alles behalve exact "on" telt als uit. */
export function vergelijkmodusAan(): boolean {
  return process.env.VERGELIJKMODUS === "on";
}

/**
 * Vertrouwens-poort voor het deterministische pad. Fail-safe naar UIT: zolang dit
 * niet exact "on" is, gebruikt de service uitsluitend het LLM-pad voor de
 * waardevergelijking (de contingentie uit de werkopdracht, structureel gemaakt).
 */
export function deterministischVertrouwd(): boolean {
  return process.env.VERGELIJK_DETERMINISTISCH_VERTROUWD === "on";
}
