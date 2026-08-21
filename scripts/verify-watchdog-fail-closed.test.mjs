import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import { CONTROLEJOBS, controleerFailClosed } from "./verify-watchdog-fail-closed.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workflowMet(overschrijving = {}) {
  const alertStap = {
    name: "Completion marker en ouderdom controleren",
    run: 'node scripts/send-backup-alert.mjs\nexit 1',
  };
  return {
    jobs: {
      "freshness-alert": { steps: [{ ...alertStap }] },
      "inventory-freshness-alert": { steps: [{ ...alertStap }] },
      ...overschrijving,
    },
  };
}

test("de echte watchdog is fail-closed", async () => {
  const tekst = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "supabase-backup-watchdog.yml"),
    "utf8"
  );
  assert.deepEqual(controleerFailClosed(yaml.load(tekst)), []);
});

test("accepteert een bewaking waarin elke afwijking de run rood maakt", () => {
  assert.deepEqual(controleerFailClosed(workflowMet()), []);
});

test("weigert een afwijking die de run groen laat", () => {
  const workflow = workflowMet({
    "freshness-alert": {
      steps: [{ name: "Ouderdom", run: "node scripts/send-backup-alert.mjs" }],
    },
  });
  const bevindingen = controleerFailClosed(workflow);
  assert.equal(bevindingen.length, 1);
  assert.match(bevindingen[0], /maakt de run niet rood/);
});

test("weigert continue-on-error op job- en stapniveau", () => {
  const opJob = controleerFailClosed(
    workflowMet({ "freshness-alert": { "continue-on-error": true, steps: [] } })
  );
  assert.ok(opJob.some((bevinding) => /job mag niet doorlopen/.test(bevinding)));

  const opStap = controleerFailClosed(
    workflowMet({
      "freshness-alert": {
        steps: [
          { name: "Ouderdom", "continue-on-error": true, run: 'node scripts/send-backup-alert.mjs\nexit 1' },
        ],
      },
    })
  );
  assert.ok(opStap.some((bevinding) => /stap mag niet doorlopen/.test(bevinding)));
});

test("weigert een hernoemde of weggehaalde controlejob", () => {
  const workflow = workflowMet();
  delete workflow.jobs[CONTROLEJOBS[0]];
  assert.ok(controleerFailClosed(workflow).some((bevinding) => /job ontbreekt/.test(bevinding)));
});

test("weigert een controlejob die niets meer vaststelt", () => {
  const workflow = workflowMet({
    "inventory-freshness-alert": { steps: [{ name: "Niets", run: "echo ok" }] },
  });
  assert.ok(
    controleerFailClosed(workflow).some((bevinding) => /stelt geen enkele afwijking meer vast/.test(bevinding))
  );
});
