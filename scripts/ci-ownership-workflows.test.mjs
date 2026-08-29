import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = [
  "security-baseline.yml",
  "g2-evidence.yml",
  "boundaries.yml",
  "lint-colors.yml",
  "rls-cross-tenant.yml",
  "karakterisering.yml",
  "e2e-security.yml",
];

async function leesWorkflow(naam) {
  const pad = path.join(ROOT, ".github", "workflows", naam);
  const bron = await readFile(pad, "utf8");
  return { naam, bron, data: yaml.load(bron) };
}

function runs(workflow) {
  return Object.values(workflow.data.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
}

test("featurebranches starten PR-workflows eenmaal; push blijft op main/preview", async () => {
  for (const naam of WORKFLOWS.filter((item) => item !== "e2e-security.yml")) {
    const workflow = await leesWorkflow(naam);
    assert.deepEqual(workflow.data.on.push.branches, ["main", "preview"], `${naam}: pushbranches`);
    assert.deepEqual(workflow.data.on.pull_request.branches, ["main", "preview"], `${naam}: PR-doelbranches`);
  }

  const e2e = await leesWorkflow("e2e-security.yml");
  assert.equal(e2e.data.on.push, undefined);
  assert.deepEqual(e2e.data.on.pull_request.branches, ["preview", "main"]);
});

test("snelle controles hebben één primaire PR-workflow", async () => {
  const workflows = await Promise.all(WORKFLOWS.map(leesWorkflow));
  const perWorkflow = Object.fromEntries(workflows.map((workflow) => [workflow.naam, runs(workflow)]));

  assert.match(perWorkflow["g2-evidence.yml"], /bash scripts\/g2-evidence\.sh/);
  assert.doesNotMatch(perWorkflow["security-baseline.yml"], /lint:boundaries|lint:colors|lint:fondsthema|test:xtenant|npm run sanity|npm run typecheck/);
  assert.match(perWorkflow["boundaries.yml"], /lint:boundaries/);
  assert.match(perWorkflow["boundaries.yml"], /check-service-role-leak\.sh/);
  assert.match(perWorkflow["lint-colors.yml"], /check-brand-hex\.mjs/);
  assert.match(perWorkflow["lint-colors.yml"], /toets-fondsthema\.mjs/);
  assert.match(perWorkflow["security-baseline.yml"], /lint:quality:check/);
});

test("RLS-job slaat alleen snelle doublures expliciet over en houdt DB verplicht", async () => {
  const workflow = await leesWorkflow("rls-cross-tenant.yml");
  const job = workflow.data.jobs["cross-tenant"];
  const suiteStap = job.steps.find((step) => step.run === "bash scripts/cross-tenant-ci.sh");

  assert.equal(suiteStap.env.XTENANT_REQUIRE_DB, "1");
  assert.equal(suiteStap.env.XTENANT_FAST_LAGEN, "overslaan");

  const script = await readFile(path.join(ROOT, "scripts", "cross-tenant-ci.sh"), "utf8");
  assert.match(script, /XTENANT_FAST_LAGEN:-uitvoeren/);
  assert.match(script, /XTENANT_REQUIRE_DB:-0/);
  assert.match(script, /node --import tsx --test tests\/cross-tenant\/\*\.test\.ts/);
  assert.match(script, /bash scripts\/testdb-apply-migrations\.sh/);
  assert.match(script, /bash scripts\/rls-cross-tenant-test\.sh/);
});

test("RLS-ontdubbeling faalt gesloten wanneer de verplichte DB ontbreekt", () => {
  const resultaat = spawnSync("bash", ["scripts/cross-tenant-ci.sh"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: "",
      TEST_DATABASE_URL: "",
      XTENANT_FAST_LAGEN: "overslaan",
      XTENANT_REQUIRE_DB: "1",
    },
    encoding: "utf8",
  });

  assert.notEqual(resultaat.status, 0);
  assert.match(resultaat.stdout, /snelle lagen bewust niet herhaald/);
  assert.match(resultaat.stderr, /XTENANT_REQUIRE_DB=1 maar geen TEST_DATABASE_URL\/DATABASE_URL/);
  assert.doesNotMatch(resultaat.stdout, /typecheck groen|app-laag §15-matrix groen/);
});

test("externe Actions in de PR-workflows zijn op volledige SHA gepind", async () => {
  for (const naam of WORKFLOWS) {
    const workflow = await leesWorkflow(naam);
    const uses = [...workflow.bron.matchAll(/^\s*-\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0, `${naam}: minimaal één action`);
    for (const action of uses) {
      assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${naam}: ${action}`);
    }
  }
});

test("zichtbare checknamen blijven stabiel", async () => {
  const verwacht = new Map([
    ["security-baseline.yml", "Security baseline (Sprint 1)"],
    ["g2-evidence.yml", "G2-aftekening (repo-side)"],
    ["rls-cross-tenant.yml", "Cross-tenant isolatie (§15 T1-T14)"],
    ["karakterisering.yml", "Karakterisering (snapshot-verschil = rood)"],
    ["e2e-security.yml", "E2E securityflows (Chromium)"],
  ]);

  for (const [naam, jobnaam] of verwacht) {
    const workflow = await leesWorkflow(naam);
    assert.ok(Object.values(workflow.data.jobs).some((job) => job.name === jobnaam), `${naam}: ${jobnaam}`);
  }
});
