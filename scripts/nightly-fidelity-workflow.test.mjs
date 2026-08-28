import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { load } from "js-yaml";

import {
  PREVIEW_FIDELITY_CONFIG_ERROR,
  PreviewFidelityConfigError,
  verifyPreviewFidelityEnv,
} from "./verify-preview-fidelity-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

function hasKeyDeep(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((child) => hasKeyDeep(child, key));
}

export function validateNightlyWorkflow(workflow) {
  const violations = [];
  const fidelity = workflow?.jobs?.fidelity;
  const alert = workflow?.jobs?.["nightly-alert"];

  if (!fidelity) return ["job fidelity ontbreekt"];
  if (hasKeyDeep(fidelity, "continue-on-error")) {
    violations.push("continue-on-error is niet toegestaan in de fidelityjob");
  }
  if (!Number.isFinite(fidelity["timeout-minutes"]) || fidelity["timeout-minutes"] <= 0) {
    violations.push("timeout-minutes ontbreekt");
  }
  if (!workflow.concurrency?.group) violations.push("concurrencygroep ontbreekt");
  if (workflow.concurrency?.["cancel-in-progress"] !== false) {
    violations.push("een lopende fidelityrun mag niet stil worden geannuleerd");
  }

  if (!alert) {
    violations.push("nightly-alert-job ontbreekt");
  } else {
    if (alert.needs !== "fidelity") violations.push("nightly-alert wacht niet op de fidelityjob");
    if (!String(alert.if ?? "").includes("always()")) {
      violations.push("nightly-alert draait niet gegarandeerd na rood of groen");
    }
    if (alert.permissions?.issues !== "write") {
      violations.push("nightly-alert heeft geen issues: write");
    }
    const alertScript = (Array.isArray(alert.steps) ? alert.steps : [])
      .map((step) => String(step?.with?.script ?? ""))
      .join("\n");
    if (
      !alertScript.includes("nightly-fidelity-alert") ||
      !alertScript.includes("issues.create(") ||
      !alertScript.includes("issues.createComment(")
    ) {
      violations.push("nightly-alert opent of actualiseert geen herkenbaar incident");
    }
    if (!alertScript.includes('result === "success"') || !alertScript.includes('state: "closed"')) {
      violations.push("nightly-alert sluit een open incident niet na herstel");
    }
  }

  const steps = Array.isArray(fidelity.steps) ? fidelity.steps : [];
  const allRuns = steps.map((step) => String(step?.run ?? "")).join("\n");
  const preflightIndex = steps.findIndex((step) =>
    String(step?.run ?? "").includes("verify-preview-fidelity-env.mjs"),
  );
  const suiteIndex = steps.findIndex((step) =>
    String(step?.run ?? "").includes("scripts/preview-fidelity-readonly.sh"),
  );
  const summaryIndex = steps.findIndex((step) =>
    String(step?.run ?? "").includes("GITHUB_STEP_SUMMARY"),
  );

  if (preflightIndex === -1) violations.push("expliciete Preview-doelpreflight ontbreekt");
  if (suiteIndex === -1) violations.push("read-only Preview-fidelityrunner ontbreekt");
  if (summaryIndex === -1) violations.push("groen Preview-bewijs in de job summary ontbreekt");
  if (preflightIndex !== -1 && suiteIndex !== -1 && preflightIndex > suiteIndex) {
    violations.push("Preview-doelpreflight staat na de fidelityrunner");
  }
  if (summaryIndex !== -1 && suiteIndex !== -1 && summaryIndex < suiteIndex) {
    violations.push("Preview-bewijs wordt vóór de fidelityrunner geschreven");
  }

  const preflight = steps[preflightIndex];
  if (!String(preflight?.env?.DRIFT_DB_PASSWORD ?? "").includes("secrets.DRIFT_DB_PASSWORD")) {
    violations.push("preflight ontvangt DRIFT_DB_PASSWORD niet uit secrets");
  }
  if (!allRuns.includes("drift_lezer.${EXPECTED_PREVIEW_REF}")) {
    violations.push("Preview-URL wordt niet met de least-privilege rol opgebouwd");
  }
  if (allRuns.includes("cross-tenant-ci.sh") || allRuns.includes("testdb-apply-migrations.sh")) {
    violations.push("muterende test-DB-runner is niet toegestaan tegen vaste Preview");
  }

  const suite = steps[suiteIndex];
  if (!String(suite?.env?.PGOPTIONS ?? "").includes("default_transaction_read_only=on")) {
    violations.push("Preview-fidelity forceert geen read-only transacties");
  }
  const summary = steps[summaryIndex];
  if (!String(summary?.run ?? "").includes("Preview-catalogus: read-only gestart en voltooid")) {
    violations.push("job summary bewijst de voltooide read-only Preview-laag niet");
  }

  return violations;
}

function loadYaml(relativePath) {
  return load(readFileSync(resolve(projectRoot, relativePath), "utf8"));
}

test("nightly Preview-fidelityworkflow is fail-closed en read-only", () => {
  assert.deepEqual(validateNightlyWorkflow(loadYaml(".github/workflows/nightly-fidelity.yml")), []);
});

test("bewust verslapte workflowfixture wordt afgekeurd (proven-red)", () => {
  const relaxedFixture = {
    concurrency: { group: "nightly-fidelity", "cancel-in-progress": false },
    jobs: {
      fidelity: {
        "continue-on-error": true,
        "timeout-minutes": 30,
        steps: [{ run: "bash scripts/cross-tenant-ci.sh", env: {} }],
      },
    },
  };

  assert.deepEqual(validateNightlyWorkflow(relaxedFixture), [
    "continue-on-error is niet toegestaan in de fidelityjob",
    "nightly-alert-job ontbreekt",
    "expliciete Preview-doelpreflight ontbreekt",
    "read-only Preview-fidelityrunner ontbreekt",
    "groen Preview-bewijs in de job summary ontbreekt",
    "preflight ontvangt DRIFT_DB_PASSWORD niet uit secrets",
    "Preview-URL wordt niet met de least-privilege rol opgebouwd",
    "muterende test-DB-runner is niet toegestaan tegen vaste Preview",
    "Preview-fidelity forceert geen read-only transacties",
    "job summary bewijst de voltooide read-only Preview-laag niet",
  ]);
});

test("read-only runner bevat harde mutatie- en datatoegangsgrenzen", () => {
  const runner = readFileSync(resolve(projectRoot, "scripts/preview-fidelity-readonly.sh"), "utf8");
  assert.match(runner, /default_transaction_read_only=on/);
  assert.match(runner, /public\.profielen/);
  assert.match(runner, /storage\.objects/);
  assert.match(runner, /insert into public\.fondsen/);
  assert.doesNotMatch(runner, /testdb-apply-migrations|cross-tenant-ci\.sh/);
});

test("nightly contracttest is aangesloten op test:contract", () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  assert.match(packageJson.scripts?.["test:contract"] ?? "", /test:nightly-fidelity-contract/);
  assert.match(packageJson.scripts?.["test:nightly-fidelity-contract"] ?? "", /nightly-fidelity-workflow\.test\.mjs/);
});

const veiligeOmgeving = {
  EXPECTED_PREVIEW_REF: "previewpreviewpreviw",
  PRODUCTION_REF: "productieproductiepr",
  EXPECTED_PREVIEW_POOLER_HOST: "preview.pooler.example.test",
};

test("Preview-preflight accepteert uitsluitend de bekende read-only doelbinding", () => {
  assert.throws(
    () => verifyPreviewFidelityEnv({}),
    (error) => error instanceof PreviewFidelityConfigError && error.code === PREVIEW_FIDELITY_CONFIG_ERROR.missing,
  );
  assert.throws(
    () => verifyPreviewFidelityEnv({...veiligeOmgeving, PREVIEW_DATABASE_URL: "https://example.test"}),
    (error) => error.code === PREVIEW_FIDELITY_CONFIG_ERROR.invalid,
  );
  assert.throws(
    () => verifyPreviewFidelityEnv({...veiligeOmgeving, PREVIEW_DATABASE_URL: "postgresql://postgres:secret@preview.pooler.example.test:5432/postgres"}),
    (error) => error.code === PREVIEW_FIDELITY_CONFIG_ERROR.unsafe,
  );
  assert.doesNotThrow(() =>
    verifyPreviewFidelityEnv({
      ...veiligeOmgeving,
      PREVIEW_DATABASE_URL: "postgresql://drift_lezer.previewpreviewpreviw:secret@preview.pooler.example.test:5432/postgres",
    }),
  );
});

test("Preview-preflight weigert Productie en lekt geen secretwaarde", () => {
  const secret = "super-geheim-wachtwoord";
  let captured;
  try {
    verifyPreviewFidelityEnv({
      ...veiligeOmgeving,
      PREVIEW_DATABASE_URL: `postgresql://drift_lezer.productieproductiepr:${secret}@preview.pooler.example.test:5432/postgres`,
    });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof PreviewFidelityConfigError);
  assert.equal(captured.code, PREVIEW_FIDELITY_CONFIG_ERROR.unsafe);
  assert.doesNotMatch(String(captured), new RegExp(secret));
});
