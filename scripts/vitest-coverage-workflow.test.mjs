import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "js-yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("security-baseline publiceert coverage altijd zonder een testfout te maskeren", () => {
  const workflow = load(readFileSync(resolve(root, ".github/workflows/security-baseline.yml"), "utf8"));
  const steps = workflow?.jobs?.["security-baseline"]?.steps ?? [];
  const contractIndex = steps.findIndex((step) => String(step?.run ?? "").trim() === "npm run test:coverage-contract");
  const coverageIndex = steps.findIndex((step) => String(step?.run ?? "").trim() === "npm run test:coverage");
  const summaryIndex = steps.findIndex((step) => String(step?.run ?? "").includes("render-vitest-coverage-summary.mjs"));
  const artifactIndex = steps.findIndex((step) => String(step?.uses ?? "").startsWith("actions/upload-artifact@") && step?.with?.name === "vitest-coverage");

  assert.ok(contractIndex >= 0, "Vitest-workflowcontract draait niet in de hosted CI");
  assert.ok(contractIndex < coverageIndex, "workflowcontract moet vóór de echte coveragerun staan");
  assert.ok(coverageIndex >= 0, "Vitest-coveragestap ontbreekt");
  assert.equal(steps[coverageIndex]?.["continue-on-error"], undefined, "een rode Vitest-run moet de job rood houden");
  assert.ok(summaryIndex > coverageIndex, "coveragesamenvatting moet na de run staan");
  assert.ok(artifactIndex > coverageIndex, "coverageartifact moet na de run staan");
  assert.match(String(steps[summaryIndex]?.if ?? ""), /always\(\)/);
  assert.match(String(steps[artifactIndex]?.if ?? ""), /always\(\)/);
  assert.equal(steps[artifactIndex]?.with?.path, "coverage/");
  assert.equal(steps[artifactIndex]?.with?.["if-no-files-found"], "warn");
});

test("coverageconfig is informatief en beperkt tot geselecteerde productiecode", async () => {
  const config = readFileSync(resolve(root, "vitest.config.mts"), "utf8");
  assert.match(config, /provider:\s*"v8"/);
  assert.match(config, /reporter:\s*\["text", "json", "json-summary", "lcov"\]/);
  assert.match(config, /core\/lib\/redirect-veilig\.ts/);
  assert.match(config, /platform\/lib\/aqlab\/evaluation-engine\.ts/);
  assert.doesNotMatch(config, /thresholds\s*:/, "WP1 mag nog geen globale coveragedrempel zetten");
});

test("WP2 houdt Node- en jsdom-tests gescheiden en sluit componenttests aan", () => {
  const config = readFileSync(resolve(root, "vitest.config.mts"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

  assert.match(config, /name:\s*"node"[\s\S]*environment:\s*"node"/);
  assert.match(config, /name:\s*"component"[\s\S]*environment:\s*"jsdom"/);
  assert.match(config, /tests\/component\/\*\*\/\*\.component\.test\.tsx/);
  assert.equal(packageJson.scripts["test:component"], "vitest run --project component");
  assert.match(packageJson.scripts.test, /npm run test:component/);
});

test("resterende sanitytests gebruiken een lege-globbestendige runner", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const runner = readFileSync(resolve(root, "scripts/run-sanity.mjs"), "utf8");

  assert.equal(packageJson.scripts.sanity, "node scripts/run-sanity.mjs");
  assert.match(runner, /entry\.name\.endsWith\("\.sanity\.ts"\)/);
  assert.match(runner, /\["--import", "tsx", file\]/);
  assert.doesNotMatch(runner, /\*\.sanity\.ts/, "shellglobs mogen niet als letterlijk pad worden uitgevoerd");
});
