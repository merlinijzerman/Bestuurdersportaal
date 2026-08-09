// ============================================================================
// T6 fase 2 — gedeelde AI-config voor de afschrift-leeswijzer.
// ----------------------------------------------------------------------------
// Model + promptversie liggen SERVER-SIDE vast. De enqueue-route mag deze niet
// uit de client-body overnemen: anders is de herkomst in §6 ("Model: X ·
// promptversie Y") zelf-verklaard en spoofbaar (AI-governance-review M2). De
// concept-route en de enqueue-route lezen beide uit dit bestand.
// ============================================================================

export const AFSCHRIFT_AI_MODEL = "claude-sonnet-4-5";
export const AFSCHRIFT_PROMPTVERSIE = "afschrift-lw-1";
