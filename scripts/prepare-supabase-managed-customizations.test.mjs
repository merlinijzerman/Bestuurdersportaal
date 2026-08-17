import assert from "node:assert/strict";
import test from "node:test";

import { prepareManagedCustomizations } from "./prepare-supabase-managed-customizations.mjs";

test("laat schone policy- en trigger-SQL byte-voor-byte intact", () => {
  const input = [
    "-- project customizations",
    "drop policy if exists p on storage.objects;",
    "create policy p on storage.objects for select to authenticated using (true);",
    "drop trigger if exists t on auth.users;",
    "CREATE TRIGGER t AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.f();",
    "",
  ].join("\n");
  const result = prepareManagedCustomizations(input);
  assert.equal(result.sql, input);
  assert.equal(result.removedStatusLines, 0);
  assert.equal(result.removedManagedFunctionLines, 0);
  assert.equal(result.removedManagedRlsLines, 0);
});

test("verwijdert uitsluitend de drie bekende psql-statusregels", () => {
  const input = [
    "Output format is unaligned.",
    "Tuples only is on.",
    "-- generated SQL",
    "Pager usage is off.",
    "drop policy if exists p on storage.objects;",
    "",
  ].join("\n");
  const result = prepareManagedCustomizations(input);
  assert.equal(
    result.sql,
    "-- generated SQL\ndrop policy if exists p on storage.objects;\n",
  );
  assert.equal(result.removedStatusLines, 3);
});

test("slaat Supabase-beheerfuncties en standaard-RLS uit legacy-archieven over", () => {
  const input = [
    "-- legacy capture",
    "CREATE OR REPLACE FUNCTION auth.email()",
    " RETURNS text",
    " LANGUAGE sql",
    "AS $function$",
    " select email from auth.users limit 1",
    "$function$",
    "",
    "CREATE OR REPLACE FUNCTION auth.jwt()",
    " RETURNS jsonb",
    " LANGUAGE sql",
    "AS $function$",
    " select '{}'::jsonb",
    "$function$",
    "",
    "alter table auth.users enable row level security;",
    "alter table storage.objects force row level security;",
    "drop policy if exists p on storage.objects;",
    "create policy p on storage.objects for select to authenticated using (true);",
    "",
  ].join("\n");

  const result = prepareManagedCustomizations(input);
  assert.equal(
    result.sql,
    [
      "-- legacy capture",
      "drop policy if exists p on storage.objects;",
      "create policy p on storage.objects for select to authenticated using (true);",
      "",
    ].join("\n"),
  );
  assert.ok(result.removedManagedFunctionLines > 0);
  assert.equal(result.removedManagedRlsLines, 2);
});

test("weigert onbekende psql-statusvarianten fail-closed", () => {
  assert.throws(
    () => prepareManagedCustomizations("Output format is wrapped.\nselect 1;\n"),
    /Onverwachte psql-statusregel/,
  );
});
