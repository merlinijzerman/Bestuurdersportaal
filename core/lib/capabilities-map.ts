// ============================================================================
//  capabilities-map — de PURE capability-mapping (besluit 0006 B11).
// ----------------------------------------------------------------------------
//  Bewust GESCHEIDEN van core/lib/capabilities.ts: die module importeert
//  createServerSupabase (→ next/headers, server-only) voor requireCapability().
//  Een client-component dat alleen de mapping nodig heeft (bv. om cosmetisch een
//  knop te tonen) mag dat server-only pad NIET meebundelen. Deze module bevat
//  daarom uitsluitend pure, isomorfe code — geen imports met server-effecten —
//  en wordt door capabilities.ts her-geëxporteerd zodat bestaande server-imports
//  ongewijzigd blijven.
//
//  UI-zichtbaarheid via deze mapping is COSMETISCH; elke schrijfactie wordt
//  server-side afgedwongen via requireCapability() (capabilities.ts) + RLS.
// ============================================================================

/** Bekende capabilities. Groeit per increment zonder RLS-herontwerp. */
export type Capability =
  | "catalog.manage"
  | "dossiers.manage"
  // Increment C — documentstatus/bronstatus/metadata-beheer (FO §6/§7, TO §5).
  | "documents.metadata.update"
  | "documents.status.change"
  | "documents.bronstatus.change"
  | "metadata.review"
  // Increment E — AI-procesclassificatie beoordelen/terugdraaien (TO §5).
  | "classification.review"
  // Increment D — notulensegmenten voorstellen/bevestigen/corrigeren (FO §8, TO §2.5).
  | "notulen.segment.confirm"
  // Increment C+/B13 — generieke (platform-gecureerde) bibliotheek beheren.
  | "generic.library.manage"
  // Increment F — persoonlijk bestuurdersprofiel (FO §14, besluit 0017).
  | "profile.manage.own"
  // Organisatieprofiel v0.4 — tenant-zelfservice op het fonds-brede contextprofiel.
  | "organisation.profile.manage"
  // Increment T8 (besluit 0040 / v0.4 §9) — beheer van de fonds-configuratielaag.
  | "fonds.config.manage"
  // Increment T11 — LEESrecht op stuurinformatie en klantbeeld (aggregaat).
  | "stuurinformatie.view"
  | "klantbeeld.view"
  // Increment T14 (decisions/0075) — SCHRIJFrecht op de stuurinformatie-invoerlaag.
  | "stuurinformatie.manage"
  // T1 bureau-rol (plateau A, ontwerp §5.2, besluit 0128) — de twee capabilities
  // die het bureau-gedrag van de assistent afgrenzen. In T2 bedraad:
  //  • ai.stukvoorbereiding → producerende taken + Word-export (G2/G15).
  //  • ai.deskresearch      → webpad-gate (T4).
  | "ai.deskresearch"
  | "ai.stukvoorbereiding";

/** Rol → toegekende capabilities. Bron-van-waarheid voor autorisatie in v2. */
export const ROL_CAPABILITIES: Record<string, Capability[]> = {
  beheerder: [
    "catalog.manage",
    "dossiers.manage",
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "metadata.review",
    "classification.review",
    "notulen.segment.confirm",
    "profile.manage.own",
    "organisation.profile.manage",
    "fonds.config.manage",
    "stuurinformatie.view",
    "stuurinformatie.manage",
    "klantbeeld.view",
  ],
  voorzitter: [
    "dossiers.manage",
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "metadata.review",
    "classification.review",
    "notulen.segment.confirm",
    "profile.manage.own",
    "fonds.config.manage",
    "stuurinformatie.view",
    "stuurinformatie.manage",
    "klantbeeld.view",
  ],
  bestuurder: [
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "profile.manage.own",
    "stuurinformatie.view",
    "klantbeeld.view",
  ],
  // T1 bureau-rol (ontwerp §5.2, besluit 0128). Zijtak: ruim op documentbeheer,
  // strikt smaller op alle beoordelende/beherende handelingen. De ai.*-bureau-
  // capabilities hangen uitsluitend hier.
  bestuursbureau: [
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "profile.manage.own",
    "stuurinformatie.view",
    "klantbeeld.view",
    "ai.deskresearch",
    "ai.stukvoorbereiding",
  ],
};

/**
 * Pure mappingcheck — heeft deze rol de capability? Testbaar zonder DB en veilig
 * te importeren in client-code (geen server-effecten).
 * Onbekende of ontbrekende rol = geen capabilities.
 */
export function rolHeeftCapability(
  rol: string | null | undefined,
  cap: Capability
): boolean {
  if (!rol) return false;
  return (ROL_CAPABILITIES[rol] ?? []).includes(cap);
}
