import assert from "node:assert/strict";
import test from "node:test";

import { prepareManagedCustomizations, splitSqlStatements } from "./prepare-supabase-managed-customizations.mjs";

const portableSql = [
  "-- project customizations",
  "drop policy if exists p on storage.objects;",
  "create policy p on storage.objects for select to authenticated using (true);",
  "drop trigger if exists t on auth.users;",
  "CREATE TRIGGER t AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.f();",
  "",
].join("\n");

test("laat uitsluitend portable policy- en trigger-SQL toe en maakt hashes", () => {
  const result = prepareManagedCustomizations(portableSql);
  assert.match(result.sql, /create policy p on storage\.objects/);
  assert.match(result.sql, /CREATE TRIGGER t AFTER INSERT ON auth\.users/);
  assert.equal(result.manifest.statement_count, 4);
  assert.equal(result.manifest.policies.length, 1);
  assert.equal(result.manifest.policies[0].name, "p");
  assert.match(result.manifest.policies[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.manifest.triggers.length, 1);
  assert.equal(result.manifest.triggers[0].schema, "auth");
  assert.match(result.manifest.sql_sha256, /^[0-9a-f]{64}$/);
});

test("splitst puntkomma's in strings en dollar-quoted functies niet", () => {
  const statements = splitSqlStatements([
    "CREATE OR REPLACE FUNCTION auth.legacy()",
    "RETURNS text LANGUAGE sql AS $function$",
    "select 'a;b';",
    "$function$;",
    "drop policy if exists p on storage.objects;",
  ].join("\n"));
  assert.equal(statements.length, 2);
});

test("verwijdert uitsluitend de drie bekende psql-statusregels", () => {
  const input = [
    "Output format is unaligned.",
    "Tuples only is on.",
    "-- generated SQL",
    "Pager usage is off.",
    "drop policy if exists p on storage.objects;",
    "create policy p on storage.objects for select using (true);",
    "",
  ].join("\n");
  const result = prepareManagedCustomizations(input);
  assert.equal(result.removedStatusLines, 3);
  assert.equal(result.manifest.policies.length, 1);
});

test("slaat Supabase-beheerfuncties en standaard-RLS uit legacy-archieven over", () => {
  const input = [
    "-- legacy capture",
    "CREATE OR REPLACE FUNCTION auth.email()",
    " RETURNS text",
    " LANGUAGE sql",
    "AS $function$",
    " select email from auth.users limit 1;",
    "$function$;",
    "CREATE OR REPLACE FUNCTION auth.jwt()",
    " RETURNS jsonb",
    " LANGUAGE sql",
    "AS $function$",
    " select '{}'::jsonb;",
    "$function$;",
    "alter table auth.users enable row level security;",
    "alter table storage.objects force row level security;",
    "drop policy if exists p on storage.objects;",
    "create policy p on storage.objects for select to authenticated using (true);",
    "",
  ].join("\n");

  const result = prepareManagedCustomizations(input);
  assert.doesNotMatch(result.sql, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(result.sql, /row level security/);
  assert.match(result.sql, /create policy p/);
  assert.equal(result.removedManagedFunctionLines, 2);
  assert.equal(result.removedManagedRlsLines, 2);
});

test("weigert onbekende psql-statusvarianten fail-closed", () => {
  assert.throws(
    () => prepareManagedCustomizations("Output format is wrapped.\ndrop policy if exists p on storage.objects;\n"),
    /Onverwachte psql-statusregel/,
  );
});

test("weigert onbekende DDL, DML en portable objecten buiten auth/storage", () => {
  for (const statement of [
    "alter table auth.users drop column email;",
    "delete from auth.users;",
    "create policy p on public.documenten for select using (true);",
    "create trigger t after insert on public.documenten execute function public.f();",
    "create trigger t after insert on auth.users execute function auth.managed_hook();",
  ]) {
    assert.throws(() => prepareManagedCustomizations(statement), /Niet-toegestaan|buiten auth\/storage|buiten portable/);
  }
});
