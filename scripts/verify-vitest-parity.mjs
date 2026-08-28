import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reportPath = resolve(process.argv[2] ?? "coverage/vitest-results.json");
const report = JSON.parse(readFileSync(reportPath, "utf8"));

// Nulmeting 28-08-2026: uitgevoerd met de vijf oorspronkelijke *.sanity.ts-
// bestanden op mergecommit ce72607. De titels zijn vóór de harnessmigratie
// vastgelegd; sortering maakt de pin onafhankelijk van Vitest-planning.
const expected = {
  "core/lib/redirect-veilig.test.ts": {
    count: 11,
    titlesSha256: "c85247d32a02d517ed663b7ce47bd2b11e077115d19036f78ce34035b3ed888f",
  },
  "core/lib/vraagtype.test.ts": {
    count: 80,
    titlesSha256: "048ae9292f3d9a2389737d225981fd9fcf92002069931d64d54eabd1a1c33cd0",
  },
  "core/lib/provider-fout.test.ts": {
    count: 5,
    titlesSha256: "4683b6f5268e537e79cfb5bb4b33a9d48f1b69da50cbc0ac6697385ae11e1736",
  },
  "platform/lib/aqlab-checks.test.ts": {
    count: 17,
    titlesSha256: "d15a71dfa140f25cec461f5a92876dde1a0f07de2843c4f057814559d04f1889",
  },
  "tests/karakterisering/audit-inventaris.test.ts": {
    count: 14,
    titlesSha256: "45fd0707da0173b4da3aa423355e5aa7e82423c3e0d6f5235b9aa0bf4d58f62a",
  },
};

assert.equal(report.numTotalTestSuites, 5, "WP1-pariteit verwacht exact vijf suites");
assert.equal(report.numTotalTests, 127, "WP1-pariteit verwacht exact 127 tests");
assert.equal(report.numFailedTests, 0, "WP1-pariteit accepteert geen rode tests");

const actualFiles = new Set();
for (const suite of report.testResults) {
  const normalized = String(suite.name).replaceAll("\\", "/");
  const relativePath = Object.keys(expected).find((candidate) => normalized.endsWith(candidate));
  assert.ok(relativePath, `onverwachte Vitest-suite in pariteitsrapport: ${suite.name}`);
  actualFiles.add(relativePath);

  const titles = suite.assertionResults.map((test) => test.title).sort();
  const titlesSha256 = createHash("sha256").update(titles.join("\n")).digest("hex");
  assert.equal(
    suite.assertionResults.length,
    expected[relativePath].count,
    `testcaseverlies in ${relativePath}`,
  );
  assert.equal(
    titlesSha256,
    expected[relativePath].titlesSha256,
    `testnamen/case-inhoud gedrift in ${relativePath}`,
  );
}

assert.deepEqual(
  [...actualFiles].sort(),
  Object.keys(expected).sort(),
  "één of meer gemigreerde suites ontbreken",
);

console.log("WP1 testcasepariteit groen: 5 suites, 127 tests, titelpins conform nulmeting.");
