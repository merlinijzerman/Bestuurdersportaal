import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const summaryPath = resolve(process.argv[2] ?? "coverage/coverage-summary.json");

console.log("## Vitest coveragebaseline");
if (!existsSync(summaryPath)) {
  console.log("");
  console.log("Geen coverage-samenvatting beschikbaar; beoordeel de rode Vitest-stap.");
  process.exit(0);
}

const { total } = JSON.parse(readFileSync(summaryPath, "utf8"));
console.log("");
console.log("| Metriek | Gedekt | Totaal | Percentage |");
console.log("|---|---:|---:|---:|");
for (const [label, key] of [
  ["Regels", "lines"],
  ["Branches", "branches"],
  ["Functies", "functions"],
  ["Statements", "statements"],
]) {
  const metric = total[key];
  console.log(`| ${label} | ${metric.covered} | ${metric.total} | ${metric.pct}% |`);
}
console.log("");
console.log("Informatieve WP1-baseline; er geldt nog geen blokkerende coveragedrempel.");
