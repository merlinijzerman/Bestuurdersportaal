// tests/cross-tenant/w7-autz-matrix.test.ts
// -----------------------------------------------------------------------------
// W7 (#153) — het autorisatiecontract, statisch bewaakt.
//
// `authz-matrix.expected.json` is de leesbare, bevroren matrix: per
// karakteriseringsscenario de zou-uitkomst onder `ENFORCE_CAPABILITY=on`. Deze
// suite bewaakt drie dingen zónder een draaiende server:
//
//   1. de matrix is niet gedreven vanuit een oude hand-kopie maar uit de LEVENDE
//      capability-map × declaraties (hergenereren = byte-identiek);
//   2. de vlag introduceert nooit een 403 op een verzoek dat vandaag SLAAGT
//      (het 2xx-invariant — precies dit ving de mis-declaratie op GET
//      /instellingen, die bestuurder een 200 gaf en die de gate op
//      `fonds.config.manage` naar 403 zou hebben getild);
//   3. nul `TE_BEPALEN`.
//
// De draaiende bevestiging (de flag-on-run tegen `next start`) leeft in de
// karakterisering-workflow; die toetst dat de SERVER dit contract naleeft. Deze
// suite toetst dat het CONTRACT klopt met de code — samen dekken ze
// contract↔code en code↔runtime.
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { rolHeeftCapability } from "../../core/lib/capabilities-map";
import { scenarios } from "../../tests/karakterisering/scenarios.mjs";
import {
  gewrapteHandlers,
  handlerVoor,
  bouwMatrix,
} from "../../tests/karakterisering/authz-matrix.mjs";

const KARAK = join(dirname(fileURLToPath(import.meta.url)), "..", "karakterisering");
const MATRIX_PAD = join(KARAK, "authz-matrix.expected.json");
const SNAP = join(KARAK, "__snapshots__");

const bevroren = JSON.parse(readFileSync(MATRIX_PAD, "utf8"));
const handlers = gewrapteHandlers();

test("AZ-1 — de matrix is byte-identiek aan wat de code oplevert", () => {
  const levend = bouwMatrix(scenarios, handlers, rolHeeftCapability);
  assert.deepEqual(
    levend,
    bevroren.matrix,
    "de gecommitte matrix wijkt af van de levende map × declaraties. " +
      "Draai `node --import tsx scripts/gen/w7-authz-matrix.mjs` en review de diff: " +
      "elke regel die verschuift is een autorisatiewijziging."
  );
});

test("AZ-2 — de teller in de meta klopt met de matrix", () => {
  const drie = bevroren.matrix.filter((r: { vlagAan: string }) => r.vlagAan === "403").length;
  assert.equal(bevroren.meta.weigeringen_403, drie);
  assert.equal(bevroren.meta.scenarios_in_scope, bevroren.matrix.length);
});

test("AZ-3 — de vlag weigert nooit een verzoek dat vandaag SLAAGT (2xx-invariant)", () => {
  // Dit is de kern. Een 403-cel mag corresponderen met een flag-off-status die
  // zelf al 403 is (poort en route-eigen gate zijn het eens) of met een
  // niet-succesvolle vroege uitgang (400/404) op een MUTERENDE route waar de rol
  // toch geen toegang heeft. Wat NIET mag: een 403-cel op een verzoek dat vandaag
  // 2xx teruggeeft — dan tilt de declaratie een werkend verzoek naar 403.
  const regressies: string[] = [];
  for (const r of bevroren.matrix as Array<{ slug: string; method: string; route: string; rol: string; vlagAan: string }>) {
    if (r.vlagAan !== "403") continue;
    let status: number;
    try {
      status = JSON.parse(readFileSync(join(SNAP, `${r.slug}.json`), "utf8")).status;
    } catch {
      assert.fail(`geen snapshot voor ${r.slug} — draai eerst de karakterisering --record`);
    }
    if (status >= 200 && status < 300) {
      regressies.push(`${r.slug} (${r.rol} ${r.method} ${r.route}): vlag-uit ${status} → vlag-aan 403`);
    }
  }
  assert.deepEqual(
    regressies,
    [],
    "Deze declaraties tillen een SLAGEND verzoek naar 403 — een leesregressie of " +
      "een privilege-inperking, geen gedragsbehoud. Herzie de declaratie (vaak: de " +
      "route gebruikt de capability als toggle, niet als gate — declareer dan ruimer)."
  );
});

test("AZ-4 — elke 403-cel op een niet-403 vlag-off-status zit op een muterende methode", () => {
  // Aanvulling op AZ-3: de toegestane uitzondering (wrapper pre-empt een 400/404)
  // mag alleen op POST/PATCH/PUT/DELETE. Een GET die van niet-403 naar 403 gaat is
  // per definitie een leesregressie, ook als de vroege status geen 2xx was.
  const MUTEREND = new Set(["POST", "PATCH", "PUT", "DELETE"]);
  const fout: string[] = [];
  for (const r of bevroren.matrix as Array<{ slug: string; method: string; vlagAan: string }>) {
    if (r.vlagAan !== "403") continue;
    const status = JSON.parse(readFileSync(join(SNAP, `${r.slug}.json`), "utf8")).status;
    if (status !== 403 && !MUTEREND.has(r.method)) {
      fout.push(`${r.slug}: ${r.method} verandert ${status} → 403`);
    }
  }
  assert.deepEqual(fout, [], "een niet-muterende route verandert onder de vlag naar 403");
});

test("AZ-5 — nul TE_BEPALEN en elke in-scope scenario heeft een bekende capability", () => {
  for (const h of handlers) {
    assert.notEqual(h.capability, "TE_BEPALEN", `${h.method} ${h.route} staat nog op TE_BEPALEN`);
  }
  for (const s of scenarios) {
    const h = handlerVoor(handlers, s.method, s.path);
    if (!h) continue; // buiten W7-scope (niet-gewrapt/machineroute)
    assert.ok(h.capability, `${s.slug} raakt een handler zonder capability`);
  }
});
