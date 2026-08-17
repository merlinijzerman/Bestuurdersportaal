import assert from "node:assert/strict";
import test from "node:test";

import { prepareManagedCustomizations } from "./prepare-supabase-managed-customizations.mjs";

test("laat schone SQL byte-voor-byte intact", () => {
  const input = "-- header\ncreate function auth.example() returns void language sql as $$ select; $$;\n";
  const result = prepareManagedCustomizations(input);
  assert.equal(result.sql, input);
  assert.equal(result.removedStatusLines, 0);
});

test("verwijdert uitsluitend de drie bekende psql-statusregels", () => {
  const input = [
    "Output format is unaligned.",
    "Tuples only is on.",
    "-- generated SQL",
    "Pager usage is off.",
    "alter table storage.objects enable row level security;",
    "",
  ].join("\n");
  const result = prepareManagedCustomizations(input);
  assert.equal(
    result.sql,
    "-- generated SQL\nalter table storage.objects enable row level security;\n",
  );
  assert.equal(result.removedStatusLines, 3);
});

test("weigert onbekende psql-statusvarianten fail-closed", () => {
  assert.throws(
    () => prepareManagedCustomizations("Output format is wrapped.\nselect 1;\n"),
    /Onverwachte psql-statusregel/,
  );
});
