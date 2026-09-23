import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const preview = readFileSync(
  "supabase/checks/2026_09_23_440_driftinventarisatie.generated.sql", "utf8",
);
const productie = readFileSync(
  "supabase/checks/2026_09_23_440_driftinventarisatie_productie.generated.sql", "utf8",
);
const marker = "-- ── 1. Objectverschillen";

test("#440 heeft twee vaste, omgekeerde doelgrendels vóór dezelfde meetbody", () => {
  assert.equal(preview.slice(preview.indexOf(marker)), productie.slice(productie.indexOf(marker)));
  assert.match(preview.slice(0, preview.indexOf(marker)), /host = 'app\.preview\.bestuurdersportaal\.com' and actief/);
  assert.match(preview.slice(0, preview.indexOf(marker)), /host not like '%\.preview\.bestuurdersportaal\.com'/);
  assert.match(productie.slice(0, productie.indexOf(marker)), /host = 'app\.bestuurdersportaal\.com' and actief/);
  assert.match(productie.slice(0, productie.indexOf(marker)), /host like '%\.preview\.bestuurdersportaal\.com'/);
  for (const sql of [preview, productie]) {
    assert.ok(sql.indexOf("VERKEERDE DOELOMGEVING") < sql.indexOf(marker));
    assert.doesNotMatch(sql, /^\\(?:set|i|include|connect|gexec)\b/m);
    assert.match(sql, /-- ── 4\. Afwezigheidscontrole/);
  }
});
