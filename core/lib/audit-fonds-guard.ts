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

  // T8: het auditspoor wordt uitsluitend via de definer-RPC geschreven.
  //
  // Vóór plateau A stond hier een inspectie van `.from("governance_log")
  // .insert(` op `fonds_id: fondsId`. Die controle had twee zwakke plekken: zij
  // keek alleen naar de EERSTE van de twee inserts in de route (de tweede, ná
  // de stream, was ongedekt), en zij kon per definitie alleen bewaken wat er in
  // dít bestand stond. Sinds plateau A leidt `schrijf_ai_interactie()` het fonds
  // en de gebruiker server-side af uit `auth.uid()`; fonds_id is daar geen
  // parameter meer. Het invariant is daarmee structureel geborgd in plaats van
  // per aanroeppunt bewaakt — en deze guard bewaakt dat die borging blijft staan.
  const rpcAanroepen = code.match(/\.rpc\(\s*["']schrijf_ai_interactie["']/g) ?? [];
  if (rpcAanroepen.length === 0) {
    fouten.push(
      "T8-REGRESSIE: geen aanroep van `schrijf_ai_interactie` gevonden in de " +
        "route — schrijft het auditspoor weer langs een ander pad?"
    );
  }

  // Geen enkele directe insert in het auditspoor meer, op geen van beide takken.
  if (/\.from\(\s*["']governance_log["']\s*\)\s*\.insert\(/.test(code)) {
    fouten.push(
      "T8-REGRESSIE: app/api/chat/route.ts doet een DIRECTE insert in " +
        "governance_log. Het auditspoor loopt sinds plateau A uitsluitend via " +
        "`schrijf_ai_interactie()`, dat fonds_id en gebruiker_naam server-side " +
        "afleidt; een directe insert omzeilt die borging."
    );
  }

  // En evenmin een directe insert in de inhoudstabel: die hoort in dezelfde
  // transactie als de spoorregel te ontstaan, anders kan inhoud zonder spoor
  // (of andersom) achterblijven.
  if (/\.from\(\s*["']governance_log_inhoud["']\s*\)\s*\.insert\(/.test(code)) {
    fouten.push(
      "T8-REGRESSIE: directe insert in governance_log_inhoud — spoor en inhoud " +
        "moeten in één transactie via `schrijf_ai_interactie()`."
    );
  }

  return fouten;
}
