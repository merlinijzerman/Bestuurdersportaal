import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { load } from "js-yaml";

import {
  FIDELITY_CONFIG_ERROR,
  FidelityConfigError,
  verifyNightlyFidelityEnv,
} from "./verify-nightly-fidelity-env.mjs";

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

  if (!fidelity) {
    return ["job fidelity ontbreekt"];
  }
  if (hasKeyDeep(fidelity, "continue-on-error")) {
    violations.push("continue-on-error is niet toegestaan in de fidelityjob");
  }
  if (
    !Number.isFinite(fidelity["timeout-minutes"]) ||
    fidelity["timeout-minutes"] <= 0
  ) {
    violations.push("timeout-minutes ontbreekt");
  }
  if (!workflow.concurrency?.group) {
    violations.push("concurrencygroep ontbreekt");
  }
  if (workflow.concurrency?.["cancel-in-progress"] !== false) {
    violations.push("een lopende fidelityrun mag niet stil worden geannuleerd");
  }
  if (!alert) {
    violations.push("nightly-alert-job ontbreekt");
  } else {
    if (alert.needs !== "fidelity") {
      violations.push("nightly-alert wacht niet op de fidelityjob");
    }
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
    if (
      !alertScript.includes('result === "success"') ||
      !alertScript.includes('state: "closed"')
    ) {
      violations.push("nightly-alert sluit een open incident niet na herstel");
    }
  }

  const steps = Array.isArray(fidelity.steps) ? fidelity.steps : [];
  const preflightIndex = steps.findIndex((step) =>
    String(step?.run ?? "").includes("verify-nightly-fidelity-env.mjs"),
  );
  const suiteIndex = steps.findIndex((step) =>
    String(step?.run ?? "").includes("scripts/cross-tenant-ci.sh"),
  );
  const summaryIndex = steps.findIndex((step) =>
    String(step?.run ?? "").includes("GITHUB_STEP_SUMMARY"),
  );

  if (preflightIndex === -1) {
    violations.push("expliciete DB-preflight ontbreekt");
  }
  if (suiteIndex === -1) {
    violations.push("cross-tenant-ci.sh wordt niet uitgevoerd");
  }
  if (summaryIndex === -1) {
    violations.push("groen DB-laagbewijs in de job summary ontbreekt");
  }
  if (preflightIndex !== -1 && suiteIndex !== -1 && preflightIndex > suiteIndex) {
    violations.push("DB-preflight staat na de cross-tenantsuite");
  }
  if (summaryIndex !== -1 && suiteIndex !== -1 && summaryIndex < suiteIndex) {
    violations.push("DB-laagbewijs wordt vóór de cross-tenantsuite geschreven");
  }

  const preflight = steps[preflightIndex];
  if (!String(preflight?.env?.TEST_DATABASE_URL ?? "").includes("secrets.TEST_DATABASE_URL")) {
    violations.push("DB-preflight ontvangt TEST_DATABASE_URL niet uit secrets");
  }

  const suite = steps[suiteIndex];
  if (String(suite?.env?.XTENANT_REQUIRE_DB ?? "") !== "1") {
    violations.push("XTENANT_REQUIRE_DB staat niet op 1 voor de fidelityrun");
  }
  if (!String(suite?.env?.TEST_DATABASE_URL ?? "").includes("secrets.TEST_DATABASE_URL")) {
    violations.push("fidelityrun ontvangt TEST_DATABASE_URL niet uit secrets");
  }

  const summary = steps[summaryIndex];
  if (!String(summary?.run ?? "").includes("DB-laag: gestart en voltooid")) {
    violations.push("job summary bewijst de voltooide DB-laag niet");
  }

  return violations;
}

function loadYaml(relativePath) {
  return load(readFileSync(resolve(projectRoot, relativePath), "utf8"));
}

test("nightly fidelity-workflow is fail-closed", () => {
  const workflow = loadYaml(".github/workflows/nightly-fidelity.yml");
  assert.deepEqual(validateNightlyWorkflow(workflow), []);
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
    "expliciete DB-preflight ontbreekt",
    "groen DB-laagbewijs in de job summary ontbreekt",
    "DB-preflight ontvangt TEST_DATABASE_URL niet uit secrets",
    "XTENANT_REQUIRE_DB staat niet op 1 voor de fidelityrun",
    "fidelityrun ontvangt TEST_DATABASE_URL niet uit secrets",
    "job summary bewijst de voltooide DB-laag niet",
  ]);
});

test("nightly contracttest is aangesloten op test:contract", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(projectRoot, "package.json"), "utf8"),
  );
  assert.match(
    packageJson.scripts?.["test:contract"] ?? "",
    /test:nightly-fidelity-contract/,
  );
  assert.match(
    packageJson.scripts?.["test:nightly-fidelity-contract"] ?? "",
    /nightly-fidelity-workflow\.test\.mjs/,
  );
});

test("DB-preflight accepteert alleen een gevulde PostgreSQL-URL", () => {
  assert.throws(
    () => verifyNightlyFidelityEnv({}),
    (error) =>
      error instanceof FidelityConfigError &&
      error.code === FIDELITY_CONFIG_ERROR.missing,
  );
  assert.throws(
    () => verifyNightlyFidelityEnv({ TEST_DATABASE_URL: "  " }),
    (error) => error.code === FIDELITY_CONFIG_ERROR.missing,
  );
  assert.throws(
    () => verifyNightlyFidelityEnv({ TEST_DATABASE_URL: "https://example.test" }),
    (error) => error.code === FIDELITY_CONFIG_ERROR.invalid,
  );
  assert.throws(
    () => verifyNightlyFidelityEnv({ TEST_DATABASE_URL: "geen-url" }),
    (error) => error.code === FIDELITY_CONFIG_ERROR.invalid,
  );
  assert.doesNotThrow(() =>
    verifyNightlyFidelityEnv({
      TEST_DATABASE_URL: "postgresql://test-user:test-secret@db.example.test:5432/testdb",
    }),
  );
});

test("DB-preflightfouten bevatten nooit de secretwaarde", () => {
  const secret = "super-geheim-wachtwoord";
  let captured;
  try {
    verifyNightlyFidelityEnv({
      TEST_DATABASE_URL: `https://${secret}@example.test/database`,
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof FidelityConfigError);
  assert.doesNotMatch(String(captured), new RegExp(secret));
});
