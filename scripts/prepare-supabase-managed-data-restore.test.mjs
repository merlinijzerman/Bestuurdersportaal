import assert from "node:assert/strict";
import test from "node:test";

import { prepareManagedDataDump } from "./prepare-supabase-managed-data-restore.mjs";

test("verwijdert alleen door pg_dump gegenereerde triggerwissels voor Auth", () => {
  const source = [
    "ALTER TABLE auth.audit_log_entries DISABLE TRIGGER ALL;",
    "COPY auth.audit_log_entries (id) FROM stdin;",
    "1",
    "\\.",
    "ALTER TABLE auth.audit_log_entries ENABLE TRIGGER ALL;",
    "",
  ].join("\n");
  const result = prepareManagedDataDump({ sql: source, schema: "auth" });
  assert.equal(result.removed_trigger_statements, 2);
  assert.match(result.sql, /COPY auth\.audit_log_entries/);
  assert.doesNotMatch(result.sql, /TRIGGER ALL/);
});

test("ondersteunt gequote tabelnamen uit pg_dump", () => {
  const source = [
    'ALTER TABLE ONLY storage."odd-table" DISABLE TRIGGER ALL;',
    'COPY storage."odd-table" (id) FROM stdin;',
    "\\.",
    'ALTER TABLE ONLY storage."odd-table" ENABLE TRIGGER ALL;',
  ].join("\n");
  const result = prepareManagedDataDump({ sql: source, schema: "storage" });
  assert.equal(result.removed_trigger_statements, 2);
});

test("laat toekomstige dumps zonder triggerwissels ongewijzigd", () => {
  const source = "COPY auth.users (id) FROM stdin;\n\\.\n";
  const result = prepareManagedDataDump({ sql: source, schema: "auth" });
  assert.equal(result.removed_trigger_statements, 0);
  assert.equal(result.sql, source);
});

test("weigert triggerwijzigingen buiten het gekozen managed schema", () => {
  const source = "ALTER TABLE public.profielen DISABLE TRIGGER ALL;\n";
  assert.throws(
    () => prepareManagedDataDump({ sql: source, schema: "auth" }),
    /onverwachte triggerwijziging/,
  );
});

test("weigert een niet-ondersteund schema", () => {
  assert.throws(
    () => prepareManagedDataDump({ sql: "select 1;", schema: "public" }),
    /Onverwacht managed schema/,
  );
});
