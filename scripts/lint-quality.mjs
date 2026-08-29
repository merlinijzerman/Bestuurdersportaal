#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { ESLint } from "eslint";
import {
  maakBaseline,
  normaliseerLintResultaten,
  renderSamenvatting,
  vergelijkMetBaseline,
} from "./lint-quality-lib.mjs";

const BASELINE_PAD = new URL("../lint-quality-baseline.json", import.meta.url);
const DOELEN = ["app", "core", "platform", "fondsen"];
const schrijfBaseline = process.argv.includes("--write-baseline");
const controleer = process.argv.includes("--check");

if (schrijfBaseline && controleer) {
  throw new Error("Gebruik --write-baseline en --check niet tegelijk.");
}

const eslint = new ESLint({ overrideConfigFile: "eslint.quality.config.mjs", errorOnUnmatchedPattern: false });
const resultaten = await eslint.lintFiles(DOELEN);
const actueel = normaliseerLintResultaten(resultaten);

if (schrijfBaseline) {
  if (actueel.fouten.length > 0) {
    process.stdout.write(renderSamenvatting(actueel));
    throw new Error("Baseline niet geschreven: qualitylint bevat errors.");
  }
  const baseline = maakBaseline(actueel);
  await writeFile(BASELINE_PAD, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  process.stdout.write(renderSamenvatting(actueel));
  process.stdout.write("Baseline bijgewerkt in lint-quality-baseline.json.\n");
  process.exit(0);
}

let toenames = [];
if (controleer) {
  const baseline = JSON.parse(await readFile(BASELINE_PAD, "utf8"));
  if (baseline.schemaVersie !== 1 || !baseline.bestanden) {
    throw new Error("Onbekende of onvolledige lintbaseline; genereer deze niet stil in CI.");
  }
  toenames = vergelijkMetBaseline(actueel, baseline);
}

process.stdout.write(renderSamenvatting(actueel, toenames));
if (toenames.length > 0 || actueel.fouten.length > 0) process.exitCode = 1;
