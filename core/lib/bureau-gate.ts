// ============================================================================
//  Bureau-gate (T1 plateau A, ontwerp §5.3, besluit 0128) — de server-side
//  weigering van de bestuurlijke deelnamehandelingen voor rol `bestuursbureau`.
// ----------------------------------------------------------------------------
//  WAAROM EEN EIGEN MODULE EN NIET requireCapability().
//  Stemmen, inbrengen en dissent vastleggen hangen in dit portaal niet aan een
//  capability — er bestaat geen `voting.*`/`meetings.*` in het capability-model.
//  Het vergaderdomein toetst met losse rolstrings (`rol === "voorzitter" || …`),
//  op zeventien plaatsen. Die conventie volgen we hier, maar dan met één bron van
//  waarheid voor de rolwaarde en de meldingen, zodat een nieuwe route niet stil
//  een variant introduceert en de rol-testset op één symbool kan pinnen.
//
//  ⚠ DEZE MODULE IS NIET DE BEVEILIGINGSLAAG. ⚠
//  De app gebruikt een browser-client met de anon-key (core/lib/supabase.ts), dus
//  de gebruiker heeft zijn eigen JWT en kan PostgREST rechtstreeks aanroepen —
//  langs elke route heen. De harde weigering staat daarom in RLS
//  (migratie 2026_08_05_bestuursbureau_rol.sql: elf policies dragen
//  `rol is distinct from 'bestuursbureau'`). Wat hier gebeurt is defense in depth
//  én UX: een leesbare melding in plaats van een kale RLS-weigering, conform het
//  UX-principe "maak vereisten en blokkers expliciet".
//
//  Puur en zonder I/O, dus testbaar onder tsx (bureau-gate.sanity.ts).
// ============================================================================

/** De waarde in `profielen.rol`; gelijk aan de CHECK-constraint en TENANT_ROLLEN. */
export const BUREAU_ROL = "bestuursbureau";

/** Is dit de bureau-rol? Onbekende/ontbrekende rol = nee (geen fail-closed hier:
 *  deze functie WEIGERT, en een onbekende rol hoort niet extra te worden geraakt —
 *  dat zou het gedrag van bestaande rollen kunnen wijzigen, zie nulgrens G23). */
export function isBureauRol(rol: string | null | undefined): boolean {
  return rol === BUREAU_ROL;
}

/**
 * Meldingen per geweigerde handeling. Bewust uitgeschreven: ze leggen aan de
 * gebruiker uit WAAROM iets niet mag, niet alleen DÁT het niet mag. De scheiding
 * tussen ondersteunen en bestuurlijk deelnemen is de kern van deze rol.
 */
export const BUREAU_WEIGERING = {
  inbreng:
    "Inbreng op een agendapunt is een bestuurlijke uiting. Het bestuursbureau ondersteunt de voorbereiding en plaatst zelf geen inbreng.",
  stemmen:
    "Het bestuursbureau neemt niet deel aan de besluitvorming en brengt geen stem uit.",
  stemronde:
    "Het openen, sluiten of intrekken van een stemronde is een bestuurlijke handeling. Het bestuursbureau voert die niet uit.",
  dissent:
    "Dissent is een bestuurlijk standpunt. Het bestuursbureau legt geen dissent vast.",
} as const;

export type BureauWeigeringSleutel = keyof typeof BUREAU_WEIGERING;
