// ============================================================================
//  AI-sessiemarkering (besluit 0086) — begrensde auto-restore van /ai.
// ----------------------------------------------------------------------------
//  Het actieve AI-gesprek wordt bijgehouden in sessionStorage (per browsertab)
//  in plaats van bij elke mount uit de database te worden afgeleid. Zo landt een
//  terugkerende gebruiker (nieuwe tab / opnieuw ingelogd) op het startpunt, niet
//  in een oud gesprek. De markering wordt expliciet gewist bij uitloggen
//  (core/components/Sidebar.tsx). Puur client-side UI-state: geen serverstate,
//  geen tabel, geen RLS- of auditgevolg. Fase B2-persistentie blijft intact —
//  alle gesprekken blijven in de gesprekken-lade bereikbaar.
// ============================================================================

/** sessionStorage-sleutel voor het id van het actieve AI-gesprek in deze tab. */
export const ACTIEF_GESPREK_SLEUTEL = "ai-actief-gesprek";
