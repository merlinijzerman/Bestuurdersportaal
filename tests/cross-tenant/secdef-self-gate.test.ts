import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const gate = read("supabase/checks/2026_08_31_secdef_self_gate.sql");
const runner = read("scripts/cross-tenant-ci.sh");

test("#212 — elke browser-uitvoerbare DEFINER heeft een expliciete classificatie", () => {
  const expected = [
    "aqlab_assurance_meetwaarden", "contact_aanvraag_insert", "resolve_tenant_host", "fn_afschrift_bevries_kolommen",
    "fn_ai_preflight", "fn_besluit_status_omslag", "fn_procedure_beeindigen",
    "fn_stap_afronden", "lees_governance_audit", "log_word_export",
    "schrijf_ai_interactie", "verwijder_gesprek",
  ];
  for (const fn of expected) {
    assert.match(gate, new RegExp(`\\('${fn.replace(/[()]/g, "\\$&")}`), `${fn} mist uit de #212-inventaris`);
  }
  assert.match(gate, /nieuwe SECURITY DEFINER met authenticated EXECUTE zonder expliciet zelfslot\/allowlist/);
  assert.match(gate, /allowlist verwijst naar geen actuele SECURITY DEFINER/);
});

test("#212 — fonds-, rol- en triggeruitzonderingen zijn fail-closed", () => {
  assert.ok(gate.includes("auth\\.uid\\s*\\(\\)"));
  assert.match(gate, /fonds_id/);
  assert.match(gate, /rol\|capabilit\|voorzitter\|bestuurder\|mag_audit/);
  assert.match(gate, /pg_trigger t where t\.tgfoid = a\.oid/);
  assert.match(gate, /publiek_begrensd/);
  assert.match(gate, /publieke DEFINER-uitzondering mist haar expliciete begrenzing/);
});

test("#212 — de databasegate draait in de verplichte cross-tenant-keten", () => {
  assert.match(runner, /SQL_SECDEF_SELF="supabase\/checks\/2026_08_31_secdef_self_gate\.sql"/);
  assert.match(runner, /psql "\$DB_URL" -v ON_ERROR_STOP=1 -f "\$SQL_SECDEF_SELF"/);
});
