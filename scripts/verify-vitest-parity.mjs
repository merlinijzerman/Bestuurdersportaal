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
  // Wetsgeschiedenis A-light R-2 (#491) — +29 additieve cases voor de
  // juridische vraagintentie (alle titels met prefix "R-2 "). De 80 bestaande
  // titels zijn ongewijzigd: hun gesorteerde sha256 is nog steeds 048ae929…cd0.
  "core/lib/vraagtype.test.ts": {
    count: 109,
    titlesSha256: "e766a378a65862afc4c76f066e49b14b8495115a515d7876d86d9628f2f5bfa4",
  },
  "core/lib/provider-fout.test.ts": {
    count: 5,
    titlesSha256: "4683b6f5268e537e79cfb5bb4b33a9d48f1b69da50cbc0ac6697385ae11e1736",
  },
  // Productie-incident 30-09-2026: een uitgeputte Mistral-OCR-retrylus op 429
  // moet tijdelijk blijven; een definitieve 400 behoudt de lege fallback.
  // OCR-diagnose 07-10-2026: +1 geval voor onveilige providerresponsen.
  "core/lib/ocr.test.ts": {
    count: 5,
    titlesSha256: "a9b09cfd15a11ff7558805d95a05f48cc353af8a32eaf40f57e02c1689365d5f",
  },
  "platform/lib/generieke-ocr-reservering.test.ts": {
    count: 3,
    titlesSha256: "9855d560e589d0f70dd06c3dc9a29382fb44602e58ce74f07c41dba4e3048816",
  },
  // #311 T3 — contracttests van de AI-gateway (gateway.test.ts) en de
  // secret-/foutlaag (secrets.test.ts); klant-Azure voegt de fonds-/refgrens toe.
  "core/lib/ai-gateway/gateway.test.ts": {
    count: 17,
    titlesSha256: "a00e0e25d2cea6c7ab489c77a8844af8f60fa105e6c1e1db2145f9815b23c014",
  },
  "core/lib/ai-gateway/anthropic-adapter.test.ts": {
    count: 6,
    titlesSha256: "1e2dc25c8736f6c495664a5322231429e3300813cf777505b28f3512c648d5d6",
  },
  "core/lib/ai-gateway/azure-openai-adapter.test.ts": {
    count: 6,
    titlesSha256: "d5d1ceff2deafffb5f546e664c474e2e30f502df41d603ec07489009a362f668",
  },
  "tests/unit/openai-adapter.test.ts": {
    count: 5,
    titlesSha256: "0843d1b066f81b8191775be361d41093c4e121c2a754b56cddafee22b32ac823",
  },
  "core/lib/ai-gateway/secrets.test.ts": {
    count: 4,
    titlesSha256: "df287120841f604a8ea771e66e721b2fffe91cc6339aaca3c70b4dc6fc7a4868",
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

assert.equal(report.numFailedTests, 0, "WP1-pariteit accepteert geen rode tests");

const actualFiles = new Set();
for (const suite of report.testResults) {
  const normalized = String(suite.name).replaceAll("\\", "/");
  const relativePath = Object.keys(expected).find((candidate) => normalized.endsWith(candidate));
  if (!relativePath) {
    assert.match(
      normalized,
      /tests\/component\/.*\.component\.test\.tsx$/,
      `onverwachte niet-component-suite in pariteitsrapport: ${suite.name}`,
    );
    continue;
  }
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

const totaal = Object.values(expected).reduce((som, e) => som + e.count, 0);
console.log(`WP1 testcasepariteit groen: ${actualFiles.size} suites, ${totaal} tests, titelpins conform nulmeting.`);
