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

// ============================================================================
//  Plateau B / B-2 — frequentiebegrenzing van de reflectie-uitnodiging
// ----------------------------------------------------------------------------
//  Maximaal één PROACTIEVE uitnodiging per context per browsersessie (FR-14,
//  besluit 0121). Bewust in sessionStorage en niet in de database: "aan deze
//  gebruiker is op dit moment een reflectie aangeboden" is precies de
//  registratie die besluit 0112 uitsluit.
//
//  Waarom niet "per dag": dat vraagt persistente opslag van het wegklikken, en
//  zonder opslag is een dagteller niet betrouwbaar over browsers, tabbladen en
//  apparaten. Waarom niet localStorage: een begrenzing die maanden aanhoudt is
//  geen begrenzing maar een uitschakeling, en de gebruiker kan hem niet
//  terugdraaien.
//
//  BEST-EFFORT, net als de actief-gesprek-markering hierboven. In private mode
//  of bij geblokkeerde opslag valt de begrenzing weg en verschijnt de uitnodiging
//  vaker. Aanvaard (besluit 0121). De begrenzing geldt per tab; twee tabs
//  betekent twee uitnodigingen. Ook aanvaard — het alternatief vraagt serverstate.
//
//  De PERMANENTE opt-out is iets anders en staat wél in het profiel
//  (`profielen.reflectie_uitnodiging`): dat is een uitgesproken voorkeur van de
//  gebruiker, geen registratie van zijn gedrag.
// ============================================================================

/**
 * De "context" waarin hoogstens één uitnodiging per sessie past. Grof genoeg om
 * niet te zeuren, fijn genoeg om bij een ander onderwerp opnieuw te mogen
 * vragen. Een gesprek-id of een agendapunt-id is de natuurlijke eenheid.
 */
export function reflectieUitnodigingSleutel(contextId: string): string {
  return `reflectie-uitnodiging:${contextId}`;
}

/** Is er in deze browsersessie al een uitnodiging getoond voor deze context? */
export function reflectieUitnodigingGetoond(contextId: string): boolean {
  if (typeof window === "undefined" || !contextId) return true;
  try {
    return window.sessionStorage.getItem(reflectieUitnodigingSleutel(contextId)) !== null;
  } catch {
    // Geblokkeerde opslag: doe alsof hij nog niet is getoond. Liever een keer te
    // vaak vragen dan de functie stil uitschakelen voor wie cookies beperkt.
    return false;
  }
}

/** Markeer deze context als "uitnodiging getoond" voor de rest van de sessie. */
export function markeerReflectieUitnodiging(contextId: string): void {
  if (typeof window === "undefined" || !contextId) return;
  try {
    window.sessionStorage.setItem(reflectieUitnodigingSleutel(contextId), "1");
  } catch {
    // Zie hierboven: best-effort, geen foutmelding aan de gebruiker.
  }
}
