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

const hier = dirname(fileURLToPath(import.meta.url));
const routePad = join(hier, "..", "app", "api", "chat", "route.ts");
const bron = readFileSync(routePad, "utf8");

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Regels zónder commentaar, zodat toelichtende comments (die "body.fonds_id"
// mogen noemen) geen vals alarm geven.
const codeRegels = bron
  .split("\n")
  .filter((r) => !r.trim().startsWith("//") && !r.trim().startsWith("*"));
const code = codeRegels.join("\n");

test("body-fonds_id wordt nergens gedereferenced (geen client-bron)", () => {
  assert.ok(
    !/\bbody\.fonds_id\b/.test(code) && !/\bbody\[["']fonds_id["']\]/.test(code),
    "Regressie: app/api/chat/route.ts dereferencet weer body.fonds_id — het " +
      "auditfonds mag UITSLUITEND uit profiel.fonds_id komen (R2, besluit 0042)."
  );
});

test("fondsId wordt server-side afgeleid uit profiel.fonds_id", () => {
  assert.ok(
    /const\s+fondsId\s*=\s*profiel\?\.fonds_id/.test(code),
    "Kon de server-side afleiding `const fondsId = profiel?.fonds_id …` niet " +
      "vinden — is de auditbron gewijzigd?"
  );
});

test("governance_log-insert gebruikt de server-side fondsId", () => {
  // Zoek het governance_log.insert({...})-blok en bevestig dat het
  // `fonds_id: fondsId` bevat (niet een body-waarde of een ander veld).
  const idx = code.indexOf('.from("governance_log").insert(');
  assert.ok(idx !== -1, "governance_log-insert niet gevonden in de route.");
  const blok = code.slice(idx, idx + 400);
  assert.ok(
    /fonds_id:\s*fondsId\b/.test(blok),
    "Regressie: de governance_log-insert gebruikt niet langer `fonds_id: fondsId` " +
      "(de server-side afgeleide waarde)."
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
