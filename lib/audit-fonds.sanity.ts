// ============================================================================
//  Regressie-guard R2 (increment T2) — het auditfonds in de chat-route komt
//  SERVER-SIDE uit de sessie (profiel.fonds_id), nooit uit de request-body.
// ----------------------------------------------------------------------------
//  R2 zelf is al in T1.3 (besluit 0042) geïmplementeerd: app/api/chat/route.ts
//  leidt `fondsId` af uit `profiel.fonds_id` en gebruikt die voor de
//  retrieval-scope én de governance_log-insert; de body-`fonds_id` wordt
//  geaccepteerd maar genegeerd. Er valt dus geen nieuwe pure functie te unit-
//  testen — de logica zit in de grote route-handler. Deze guard borgt het
//  INVARIANT tegen een stille regressie: hij inspecteert de route-broncode en
//  faalt zodra iemand de body-`fonds_id` weer als bron zou gebruiken of de
//  governance_log-insert loskoppelt van de server-side `fondsId`.
//
//  Proportioneel gekozen boven een end-to-end-test: er is geen testframework
//  (repo-conventie = tsx-sanity), en een echte HTTP-roundtrip met auth/stream
//  valt buiten dit pad. De inventarisatie (geen enkele andere auditschrijver
//  vertrouwt body.fonds_id) staat in decisions/0044 en de HANDOVER-entry.
//
//  Uitvoeren: npx tsx lib/audit-fonds.sanity.ts   (of via `npm run sanity`)
// ============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { controleerChatAuditFondsbron } from "./audit-fonds-guard";

const hier = dirname(fileURLToPath(import.meta.url));
const routePad = join(hier, "..", "app", "api", "chat", "route.ts");
const bron = readFileSync(routePad, "utf8");

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// De inspectielogica leeft in lib/audit-fonds-guard.ts (gedeeld met de
// §15-matrixsuite, scenario's T5 + T8) — hier alleen de sanity-wrapper.
test("auditfonds-bron-guard: R2-invariant intact (T5 body-negeer + T8 server-afleiding)", () => {
  const fouten = controleerChatAuditFondsbron(bron);
  assert.equal(fouten.length, 0, fouten.join("\n"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
