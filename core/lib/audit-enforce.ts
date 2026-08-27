// ============================================================================
//  Audit-enforce — pure zou-beslissing + env-schakelaar voor de wrapper.
//  (W11, EPIC W, deploy 3 — het MECHANISME, niet de invulling.)
// ----------------------------------------------------------------------------
//  Spiegelt capability-/schema-/ratelimit-enforce, MAAR met één omgekeerde
//  semantiek die je nergens anders mag doortrekken:
//
//    ⚠ DE VLAG-UIT-STAND SCHRIJFT NIETS.
//
//  Bij capability is vlag-uit = DOORLATEN (+ observe-loggen). Een auditregel
//  schrijven is echter geen beslissing maar een EFFECT: schrijft de wrapper er
//  één terwijl de vlag uit is, dan staat er een rij die er niet hoort. Daarom:
//
//    ENFORCE_AUDIT uit  → observe: NIETS schrijven, alleen loggen wát er
//                         geschreven zóú zijn ([AUDIT-OBSERVE]). Dat is de
//                         dataset voor #183.
//    ENFORCE_AUDIT aan  → schrijven: bij een echte AuditSpec schrijft de wrapper
//                         een HANDELINGSREGEL naar de eigen tenant-handelingstabel;
//                         bij "geen" schrijft hij niets.
//
//  WAAROM EEN EIGEN TABEL (besluit 0190). De wrapper schrijft NIET naar
//  `governance_events`: die keten draagt betekenisvolle bestuurlijke feiten
//  (besluit genomen, dissent vastgelegd; publiek: bestuur, accountant,
//  toezichthouder). Een generieke "PATCH /api/x door gebruiker y" per request zou
//  die keten verdunnen met HTTP-ruis — schade, geen redundantie. De wrapper krijgt
//  daarom zijn eigen handelingstabel (tenant-only, forensisch publiek).
//
//  TENANT-UNION = TWEE WAARDEN: `AuditSpec | "geen"` (§4-model, 0191 geamendeerd).
//  Het veld is een INSTRUCTIE aan de wrapper — "schrijf een handelingsregel, of
//  niet" — waar door constructie aan voldaan wordt, geen BEWERING over code elders.
//  Elke te-auditen tenant-handler krijgt dus een `handelingen_log`-regel, óók de
//  bestuurlijke: een forensisch spoor met gaten op precies de gevoeligste
//  handelingen (accountovername op bestuurlijke routes) is een slecht spoor. Het
//  bestuurlijke/domein-spoor (`governance_events`, `*_log`) blijft bestaan; het is
//  alleen NIET het onderwerp van dit veld. Zo stopt de union bij twee waarden i.p.v.
//  één-per-mechanisme (er zijn er ≥10). De machine-kant benoemt wél het dekkende
//  spoor (`"platform-event-log"`), omdat de wrapper daar niet KÁN schrijven (geen
//  `auth.uid()`/fonds) — waar handelen onmogelijk is, rest benoemen.
//
//  KALE OPT-IN. Alleen `ENFORCE_AUDIT=on`; geen omgevings-default. Het veld landt
//  optioneel en op geen route gedeclareerd, dus bij landing schrijft en logt de
//  poort niets (byte-identiek, nul extra rijen). PUUR en server-loos testbaar.
// ============================================================================

/**
 * Wat een tenant-route declareert. TWEE waarden (§4-model):
 *
 *   AuditSpec   de wrapper schrijft een handelingsregel; `handeling` is het
 *               semantische label dat de wrapper niet uit request/ctx kan afleiden.
 *               Route/methode/gebruiker/fonds/tijd leidt de wrapper zelf af. Élke
 *               te-auditen handler krijgt dit — óók de bestuurlijke (die houden
 *               daarnáást hun eigen `governance_events`-regel; andere tabel, andere
 *               vraag, geen dubbeling).
 *   "geen"      expliciet geen handelingsregel — per stuk gemotiveerd, niet als
 *               default. Uitsluitend waar aantoonbaar niets forensisch hoort te
 *               worden vastgelegd (bv. read-achtige POST, AI-concept).
 *
 * `"governance-events"` bestónd hier (0191 §6, drie-waardenmodel) maar is verwijderd:
 * het was een BEWERING over code elders i.p.v. een instructie. De bewijsketen-lacune
 * die die waarde droeg leeft nu in de inventaris-klasse `bestuurlijk-gap` + de
 * bijbehorende gate, niet in de union. Zie het geamendeerde 0191 §4/§6.
 */
export type AuditSpec = { readonly handeling: string };
export type AuditDeclaratie = AuditSpec | "geen";

/**
 * Bepaalt of audit-afdwinging actief is. Kale opt-in, net als de andere
 * enforce-vlaggen; geen omgevings-default. De flip hoort ná #183 in DEZE functie.
 */
export function auditEnforceVoorOmgeving(args: {
  enforceAudit?: string | null;
}): boolean {
  return (args.enforceAudit?.trim().toLowerCase() ?? "") === "on";
}

/** Leest de env-vlag. Apart van de pure functie zodat die testbaar blijft. */
export function auditEnforceAan(): boolean {
  return auditEnforceVoorOmgeving({ enforceAudit: process.env.ENFORCE_AUDIT });
}

/** De zou-actie, vlag-bewust. `observe` = NIETS schrijven, alleen loggen wat er
 *  geschreven zóú zijn; `schrijven` = de handelingsregel wegschrijven; `niets` =
 *  helemaal niets (geen log, geen rij) — voor "geen"/afwezig. */
export type AuditActie =
  | { actie: "niets" }
  | { actie: "observe"; handeling: string }
  | { actie: "schrijven"; handeling: string };

/**
 * Mapt de declaratie + de vlagstand op de actie. Puur: geen I/O, leest geen env.
 * Let op de OMGEKEERDE semantiek t.o.v. capability: `observe` schrijft NIET.
 */
export function beoordeelAudit(args: {
  audit: AuditDeclaratie | undefined;
  handhaven: boolean;
}): AuditActie {
  const { audit, handhaven } = args;
  if (!audit || audit === "geen") return { actie: "niets" };
  return handhaven
    ? { actie: "schrijven", handeling: audit.handeling }
    : { actie: "observe", handeling: audit.handeling };
}
