// AQLab platform-console: elke service-role-read moet via withPlatformRead.
// Broninspectie vult de runtime wrapper-tests aan en voorkomt dat een nieuwe
// serverpagina de live AAL2/capability/auditpoort ongemerkt omzeilt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lees = (...delen: string[]) => readFileSync(join(root, ...delen), "utf8");

const paginas = [
  ["app", "(platform)", "platform", "(beveiligd)", "aqlab", "page.tsx"],
  ["app", "(platform)", "platform", "(beveiligd)", "aqlab", "dashboard", "page.tsx"],
  ["app", "(platform)", "platform", "(beveiligd)", "aqlab", "promoveren", "page.tsx"],
  ["app", "(platform)", "platform", "(beveiligd)", "aqlab", "runs", "[runId]", "page.tsx"],
] as const;

test("AQL-P1 — AQLab-pagina's maken nooit rechtstreeks een service-role-client", () => {
  for (const pad of paginas) {
    const bron = lees(...pad);
    assert.ok(!bron.includes("createServiceSupabase"), `${pad.join("/")} omzeilt de read-wrapper`);
    assert.ok(!bron.includes("createPlatformSupabase"), `${pad.join("/")} omzeilt de read-wrapper`);
    assert.ok(bron.includes("platform-lees"), `${pad.join("/")} gebruikt de centrale read-service niet`);
  }
});

test("AQL-P2 — centrale AQLab-readservice gebruikt uitsluitend withPlatformRead", () => {
  const bron = lees("platform", "lib", "aqlab", "platform-lees.ts");
  assert.ok(bron.includes("withPlatformRead("));
  assert.ok(!bron.includes("createServiceSupabase"));
  assert.ok(!bron.includes("createPlatformSupabase"));
  for (const handeling of [
    "aqlab.console.read",
    "aqlab.dashboard.read",
    "aqlab.promotie.read",
    "aqlab.run.read",
  ]) {
    assert.ok(bron.includes(handeling), `auditlabel ontbreekt: ${handeling}`);
  }
});
