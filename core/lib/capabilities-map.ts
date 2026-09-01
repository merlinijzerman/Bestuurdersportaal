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
  | "ai.stukvoorbereiding"
  // ── W7 (issue #153, besluitregister regel 1) — één gate per domein per
  //    lezen/schrijven, zodat élke route een GEDECLAREERDE poort heeft en de
  //    vlag naar fail-closed kan. Deze 24 zeggen WÁT voor bevoegdheid een route
  //    vereist; ze zeggen (nog) niet wie hem heeft — zie de toekenning hieronder.
  | "agendapunten.manage"
  | "assurance.view"
  | "chat.use"
  | "beheer.backfill"
  | "classification.queue.view"
  | "decisions.manage"
  | "decisions.view"
  | "documents.lifecycle.manage"
  | "documents.view"
  | "dossiers.view"
  | "gesprekken.manage"
  | "inbreng.manage"
  | "notificaties.manage.own"
  | "notificaties.view.own"
  | "organisation.profile.view"
  | "procedures.manage"
  | "procedures.view"
  | "procedures.afwijking.vastleggen"
  // P4 (#169, besluit 0194): een procedure beëindigen resp. heropenen — beide
  // een bestuurlijk oordeel over de voortgang; voorzitter + bestuurder (idem
  // afwijking.vastleggen). Heropenen deelt de rolset zodat het bestuursbureau
  // niet via procedures.manage terugdraait wat het bestuur besloot.
  | "procedures.beeindigen"
  | "procedures.heropenen"
  | "profile.view.own"
  | "reflectie.manage.own"
  | "reflectie.view.own"
  | "risicos.manage"
  | "stemming.deelname"
  | "vergaderingen.manage"
  | "vergelijk.use"
  | "zoeken.use";

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
    // ── W7-gates (#153) — RUIM BIJ BESLUIT, NIET BIJ ONTWERP. ──────────────
    // alle 24 W7-gates.
    // Aanscherpen gebeurt HIER, niet in de routes: haal een naam weg en alle
    // handlers onder die gate worden strenger, zonder één routebestand aan te raken.
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "beheer.backfill",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.lifecycle.manage",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
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
    // ── W7-gates (#153) — RUIM BIJ BESLUIT, NIET BIJ ONTWERP. ──────────────
    // alle 24 W7-gates.
    // Aanscherpen gebeurt HIER, niet in de routes: haal een naam weg en alle
    // handlers onder die gate worden strenger, zonder één routebestand aan te raken.
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "beheer.backfill",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.lifecycle.manage",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "procedures.afwijking.vastleggen",
    "procedures.beeindigen",
    "procedures.heropenen",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
  ],
  bestuurder: [
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "profile.manage.own",
    "stuurinformatie.view",
    "klantbeeld.view",
    // ── W7-gates (#153) — RUIM BIJ BESLUIT, NIET BIJ ONTWERP. ──────────────
    // 22 van de 24 W7-gates. `beheer.backfill` en `documents.lifecycle.manage`
    // niet: dáár dragen ALLE onderliggende routes vandaag al een voorzitter/beheerder-
    // gate, dus scherp declareren is hier gelijk aan wat er draait (regel 3).
    // Aanscherpen gebeurt HIER, niet in de routes: haal een naam weg en alle
    // handlers onder die gate worden strenger, zonder één routebestand aan te raken.
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "inbreng.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "procedures.afwijking.vastleggen",
    "procedures.beeindigen",
    "procedures.heropenen",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "stemming.deelname",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
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
    // ── W7-gates (#153) — RUIM BIJ BESLUIT, NIET BIJ ONTWERP. ──────────────
    // 20 van de 24. Naast de twee scherpe gates ook `inbreng.manage` en
    // `stemming.deelname` niet: álle routes daaronder sluiten het bureau vandaag al uit,
    // via isBureauRol() én via RLS. De toekenning legt vast wat er is (§5.3).
    // Aanscherpen gebeurt HIER, niet in de routes: haal een naam weg en alle
    // handlers onder die gate worden strenger, zonder één routebestand aan te raken.
    "agendapunten.manage",
    "assurance.view",
    "chat.use",
    "classification.queue.view",
    "decisions.manage",
    "decisions.view",
    "documents.view",
    "dossiers.view",
    "gesprekken.manage",
    "notificaties.manage.own",
    "notificaties.view.own",
    "organisation.profile.view",
    "procedures.manage",
    "procedures.view",
    "profile.view.own",
    "reflectie.manage.own",
    "reflectie.view.own",
    "risicos.manage",
    "vergaderingen.manage",
    "vergelijk.use",
    "zoeken.use",
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
