// ============================================================================
//  Gedeelde bron-guard voor het auditfonds-invariant (R2, besluit 0042).
// ----------------------------------------------------------------------------
//  R2: het auditfonds in de chat-route komt SERVER-SIDE uit de sessie
//  (profiel.fonds_id), nooit uit de request-body. Er valt geen pure functie te
//  unit-testen — de logica zit in de grote route-handler — dus borgen we het
//  invariant via bron-inspectie. Deze module bevat ALLEEN de pure controle,
//  zodat zowel de sanity-test (lib/audit-fonds.sanity.ts) als de §15-matrixsuite
//  (tests/cross-tenant/, scenario's T5 + T8) exact dezelfde regels toetsen —
//  één bron van waarheid, geen drift.
//
//  Geen I/O hier: de caller levert de route-broncode aan (leest het bestand).
// ============================================================================

/** Strip commentaarregels zodat toelichtende comments (die "body.fonds_id"
 *  mogen noemen) geen vals alarm geven. */
function alleenCode(bron: string): string {
  return bron
    .split("\n")
    .filter((r) => !r.trim().startsWith("//") && !r.trim().startsWith("*"))
    .join("\n");
}

/** Patronen die body.fonds_id ALS AUDITBRON gebruiken — het verboden gedrag.
 *  Let op: de route MAG body.fonds_id lezen om het T4-manipulatiesignaal te
 *  detecteren/loggen (bodyFondsAfwijkend); dat is juist gewenst. Verboden is
 *  alleen dat de waarde in `fondsId` of rechtstreeks in een `fonds_id:`-veld
 *  terechtkomt. `body(\.|\[["']…["']\])fonds_id` dekt beide toegangsvormen. */
// `body.fonds_id` én `body?.fonds_id` én `body["fonds_id"]`/`body?.["fonds_id"]`.
const body = String.raw`body\s*\??\s*(?:\.\s*fonds_id\b|\[\s*["']fonds_id["']\s*\])`;
const T5_BRON_PATRONEN: ReadonlyArray<RegExp> = [
  // `fondsId = … body.fonds_id …` — body-waarde vloeit in de auditbron.
  new RegExp(String.raw`\bfondsId\s*=\s*[^;]*${body}`),
  // `fonds_id: body.fonds_id` — body-waarde rechtstreeks in een insert/objectveld.
  new RegExp(String.raw`\bfonds_id\s*:\s*${body}`),
  // `const { fonds_id } = body` / `const { fonds_id: x } = body` — destructuring
  // trekt de tenant-id uit de body; op het auditpad nooit toegestaan als bron.
  new RegExp(String.raw`\{[^}]*\bfonds_id\b[^}]*\}\s*=\s*body\b`),
];

/** Controleert de broncode van app/api/chat/route.ts op het R2-invariant.
 *  Retourneert een lijst overtredingen; lege lijst = invariant intact.
 *
 *  Dekt §15-scenario's:
 *   - T5 (API-body met gemanipuleerd fonds_id → server-side genegeerd): de body-
 *     `fonds_id` wordt nergens als auditbron gebruikt (lezen-om-te-loggen mag).
 *   - T8 (auditlog bij geldige actie → server-side afgeleid fonds): `fondsId`
 *     komt uit `profiel.fonds_id` en de governance_log-insert gebruikt die. */
export function controleerChatAuditFondsbron(bron: string): string[] {
  const code = alleenCode(bron);
  const fouten: string[] = [];

  // T5: body-fonds_id mag nergens als bron dienen (lezen om te loggen mag wél).
  if (T5_BRON_PATRONEN.some((p) => p.test(code))) {
    fouten.push(
      "T5-REGRESSIE: app/api/chat/route.ts gebruikt body.fonds_id als auditbron " +
        "(toegekend aan fondsId of in een fonds_id:-veld) — het auditfonds mag " +
        "UITSLUITEND uit profiel.fonds_id komen (R2, besluit 0042)."
    );
  }

  // T8: fondsId server-side afgeleid uit profiel.fonds_id.
  if (!/const\s+fondsId\s*=\s*profiel\?\.fonds_id/.test(code)) {
    fouten.push(
      "T8-REGRESSIE: server-side afleiding `const fondsId = profiel?.fonds_id …` " +
        "niet gevonden — is de auditbron gewijzigd?"
    );
  }

  // T8: de governance_log-insert gebruikt de server-side fondsId.
  const idx = code.indexOf('.from("governance_log").insert(');
  if (idx === -1) {
    fouten.push("T8-REGRESSIE: governance_log-insert niet gevonden in de route.");
  } else {
    const blok = code.slice(idx, idx + 400);
    if (!/fonds_id:\s*fondsId\b/.test(blok)) {
      fouten.push(
        "T8-REGRESSIE: de governance_log-insert gebruikt niet langer " +
          "`fonds_id: fondsId` (de server-side afgeleide waarde)."
      );
    }
  }

  return fouten;
}
