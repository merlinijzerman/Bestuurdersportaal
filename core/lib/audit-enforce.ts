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
//  daarom zijn eigen handelingstabel (tenant-only, forensisch publiek). Gevolg:
//  géén gedeelde resource met de route-eigen `governance_events`-writes, dus
//  volgens de gedeelde-resource-regel (besluit 0190) is er GEEN "route-eigen"
//  nodig — de tenant-union is twee waarden: `AuditSpec | "geen"`.
//
//  KALE OPT-IN. Alleen `ENFORCE_AUDIT=on`; geen omgevings-default. Het veld landt
//  optioneel en op geen route gedeclareerd, dus bij landing schrijft en logt de
//  poort niets (byte-identiek, nul extra rijen). PUUR en server-loos testbaar.
// ============================================================================

/**
 * Wat een tenant-route declareert. Twee waarden (géén "route-eigen", zie de
 * module-kop):
 *
 *   AuditSpec   de wrapper schrijft een handelingsregel; `handeling` is het
 *               semantische label dat de wrapper niet uit request/ctx kan afleiden
 *               (bv. "besluit.status.wijzigen") en dat het forensische spoor
 *               leesbaar maakt. Route/methode/gebruiker/fonds/tijd leidt de
 *               wrapper zelf af.
 *   "geen"      expliciet geen handelingsregel (bv. een read-achtige POST, of een
 *               route die aantoonbaar geen spoor hoeft — per stuk gemotiveerd,
 *               niet als default; de 38 spoorloze handlers uit de inventaris zijn
 *               juist de I-6-lacune die dit veld dicht, niet een `"geen"`-categorie).
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
