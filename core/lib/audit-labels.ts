// ============================================================================
// T6 — Gedeelde labelmap voor auditgebeurtenissen (F2).
// ----------------------------------------------------------------------------
// Er zijn TWEE auditsporen (ontwerpbeslissing 8):
//   • procedure_log      — procesniveau (stap_gestart, bewijs_toegevoegd, …)
//   • governance_events  — besluitniveau (assumption_toegevoegd, dissent_*,
//                          status_gewijzigd, readiness_overruled, …), mét hash.
// De procespagina toonde tot nu toe alleen procedure_log; de onderbouwings-
// historie (aannames/risico's/dissent/status) bleef onzichtbaar. Deze ene
// labelmap wordt gebruikt door zowel de UI (audit-trail-paneel) als de export
// (02_Tijdlijn / 03_Auditlog), zodat scherm en bundel dezelfde taal spreken.
//
// Onbekende event_types vallen terug op een gehumaniseerde vorm i.p.v. de kale
// technische sleutel — zo blijft het spoor leesbaar zonder deze map elke keer
// te moeten bijwerken.
// ============================================================================

export const AUDIT_EVENT_LABEL: Record<string, string> = {
  // ── Procesniveau (procedure_log) ──
  procedure_aangemaakt: "Procedure aangemaakt",
  eigenaar_toegevoegd: "Co-eigenaar toegevoegd",
  stap_gestart: "Stap gestart",
  stap_voltooid: "Stap voltooid",
  checklistitem_voldaan: "Checklist-item afgevinkt",
  checklistitem_geopend: "Checklist-item ongedaan gemaakt",
  bewijs_toegevoegd: "Bewijsstuk toegevoegd",
  besluit_vastgelegd: "Besluit vastgelegd",
  procedure_metadata_gewijzigd: "Proceskenmerken gewijzigd",
  agendapunt_gekoppeld: "Agendapunt gekoppeld",

  // ── Besluitniveau (governance_events) ──
  decision_object_auto_created: "Dossier aangemaakt",
  aangemaakt: "Aangemaakt",
  geimporteerd: "Geïmporteerd",
  classificatie_bevestigd: "Classificatie bevestigd",
  classificatie_gewijzigd: "Classificatie gewijzigd",
  decision_metadata_gewijzigd: "Besluitkenmerken gewijzigd",
  status_gewijzigd: "Status gewijzigd",
  readiness_overruled: "Readiness-horde overruled",
  assumption_toegevoegd: "Aanname toegevoegd",
  assumption_gewijzigd: "Aanname gewijzigd",
  risk_toegevoegd: "Risico toegevoegd",
  risk_gewijzigd: "Risico gewijzigd",
  risk_status_gewijzigd: "Risicostatus gewijzigd",
  risico_aangemaakt: "Risico aangemaakt",
  risico_gewijzigd: "Risico gewijzigd",
  risico_gesloten: "Risico gesloten",
  voorwaarde_toegevoegd: "Voorwaarde toegevoegd",
  voorwaarde_gewijzigd: "Voorwaarde gewijzigd",
  voorwaarde_status_gewijzigd: "Voorwaardestatus gewijzigd",
  actie_toegevoegd: "Actie toegevoegd",
  actie_gewijzigd: "Actie gewijzigd",
  actie_status_gewijzigd: "Actiestatus gewijzigd",
  maatregel_toegevoegd: "Maatregel toegevoegd",
  maatregel_status_gewijzigd: "Maatregelstatus gewijzigd",
  dissent_vastgelegd: "Dissent vastgelegd",
  dissent_formeel_vastgesteld: "Dissent formeel vastgesteld",
  dissent_gewijzigd: "Dissent gewijzigd",
  dissent_zichtbaarheid_gewijzigd: "Zichtbaarheid dissent gewijzigd",
  dissent_ingetrokken: "Dissent ingetrokken",
  agendapunt_hersteld: "Agendapunt hersteld",
  agendapunt_verwijderd: "Agendapunt verwijderd",
  vergadering_gewijzigd: "Vergadering gewijzigd",
  gekoppeld: "Gekoppeld",
  ontkoppeld: "Ontkoppeld",
  auditdossier_geexporteerd: "Auditdossier geëxporteerd",

  // ── T6 afschrift-events (procedure_log) ──
  afschrift_aangemaakt: "Afschrift aangemaakt",
  afschrift_gereed: "Afschrift gereed",
  afschrift_mislukt: "Afschrift mislukt",
  afschrift_gedownload: "Afschrift gedownload",
  afschrift_ingetrokken: "Afschrift ingetrokken",
};

/** Humaniseert een onbekende event_type: "iets_gebeurd" → "Iets gebeurd". */
function humaniseer(eventType: string): string {
  const woorden = eventType.replace(/_/g, " ").trim();
  if (!woorden) return eventType;
  return woorden.charAt(0).toUpperCase() + woorden.slice(1);
}

/** Leesbaar label voor een auditgebeurtenis uit beide sporen. */
export function auditEventLabel(eventType: string): string {
  return AUDIT_EVENT_LABEL[eventType] ?? humaniseer(eventType);
}
