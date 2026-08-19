import assert from "node:assert/strict";
import test from "node:test";

import { normalizeValidationJson } from "./normalize-supabase-validation-json.mjs";

const validation = {
  manifest_version: 2,
  auth_users: 3,
  content_sha256: { auth_users: "a".repeat(64) },
};

test("verwijdert uitsluitend de drie bekende psql-statusregels vóór het JSON-document", () => {
  const input = [
    "Output format is unaligned.",
    "Tuples only is on.",
    "Pager usage is off.",
    JSON.stringify(validation),
    "",
  ].join("\r\n");

  const result = normalizeValidationJson(input);
  assert.equal(result.removedStatusLines, 3);
  assert.deepEqual(JSON.parse(result.json), validation);
  assert.doesNotMatch(result.json, /Output format|Tuples only|Pager usage/);
});

test("laat een reeds schoon enkel JSON-object ongewijzigd in betekenis", () => {
  const result = normalizeValidationJson(`${JSON.stringify(validation)}\n`);
  assert.equal(result.removedStatusLines, 0);
  assert.deepEqual(JSON.parse(result.json), validation);
});

test("weigert onbekende, dubbele en te late psql-statusregels", () => {
  for (const input of [
    `Output format is wrapped.\n${JSON.stringify(validation)}\n`,
    `Pager usage is off.\nPager usage is off.\n${JSON.stringify(validation)}\n`,
    `${JSON.stringify(validation)}\nTuples only is on.\n`,
  ]) {
    assert.throws(() => normalizeValidationJson(input), /psql-statusregel/i);
  }
});

test("weigert niet-JSON, meerdere documenten en niet-objecten fail-closed", () => {
  for (const input of ["geen json\n", "{}\n{}\n", "[]\n", "null\n"]) {
    assert.throws(() => normalizeValidationJson(input), /JSON/);
  }
});
