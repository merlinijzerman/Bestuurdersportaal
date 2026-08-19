import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthConfigDiagnostic } from "./diagnose-supabase-auth-config.mjs";

test("rapporteert alleen veilige mismatchcategorieën en geen Auth-waarden", () => {
  const report = buildAuthConfigDiagnostic(
    {
      site_url: "https://source.example",
      external_google_enabled: true,
      external_google_client_secret: "source-secret",
      smtp_pass: "source-smtp-secret",
    },
    {
      site_url: "https://target.example",
      external_google_enabled: false,
      external_google_client_secret: "target-secret",
      smtp_pass: "target-smtp-secret",
    },
  );

  assert.equal(report.status, "mismatch");
  assert.equal(report.mismatch_count, 2);
  assert.deepEqual(report.mismatches, [
    {
      key: "external_google_enabled",
      category: "provider_setting",
      source_present: true,
      target_present: true,
    },
    {
      key: "site_url",
      category: "auth_security_setting",
      source_present: true,
      target_present: true,
    },
  ]);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /source\.example|target\.example|source-secret|target-secret|smtp/);
  assert.equal(report.secret_values_compared, false);
  assert.equal(report.secret_values_logged, false);
});

test("merkt ontbrekende relevante settings als aanwezigheidssignaal zonder waarde", () => {
  const report = buildAuthConfigDiagnostic(
    { external_google_enabled: true },
    { site_url: "https://target.example" },
  );

  assert.deepEqual(report.mismatches, [
    {
      key: "external_google_enabled",
      category: "provider_setting",
      source_present: true,
      target_present: false,
    },
    {
      key: "site_url",
      category: "auth_security_setting",
      source_present: false,
      target_present: true,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /target\.example/);
});
