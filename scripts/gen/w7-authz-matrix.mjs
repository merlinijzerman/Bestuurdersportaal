// W7 — genereert tests/karakterisering/authz-matrix.expected.json uit de
// levende capability-map × declaraties × scenario's. Draaien onder tsx:
//   node --import tsx scripts/gen/w7-authz-matrix.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rolHeeftCapability } from "../../core/lib/capabilities-map.ts";
import { scenarios } from "../../tests/karakterisering/scenarios.mjs";
import { gewrapteHandlers, bouwMatrix, LADDERROLLEN } from "../../tests/karakterisering/authz-matrix.mjs";

const handlers = gewrapteHandlers();
const rijen = bouwMatrix(scenarios, handlers, rolHeeftCapability);
const drie = rijen.filter((r) => r.vlagAan === "403").length;
const meta = {
  _commentaar:
    "GEGENEREERD door scripts/gen/w7-authz-matrix.mjs — niet met de hand wijzigen. " +
    "Dit is het W7-autorisatiecontract: per karakteriseringsscenario de zou-uitkomst " +
    "onder ENFORCE_CAPABILITY=on. 'onveranderd' = de poort laat door en het route-eigen " +
    "gedrag blijft (vergelijk met het byte-identieke snapshot); '403' = de poort weigert. " +
    "De statische test w7-autz-matrix.test.ts hergenereert dit en faalt op elk verschil; " +
    "de flag-on-runner toetst het tegen de draaiende server.",
  scenarios_in_scope: rijen.length,
  weigeringen_403: drie,
  rollen: LADDERROLLEN,
};
const uit = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "karakterisering", "authz-matrix.expected.json");
writeFileSync(uit, JSON.stringify({ meta, matrix: rijen }, null, 2) + "\n", "utf8");
console.log(`geschreven: ${rijen.length} scenario's in scope, ${drie} × 403`);
