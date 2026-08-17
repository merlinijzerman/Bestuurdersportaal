import test from "node:test";
import assert from "node:assert/strict";
import { ontleedAntwoord } from "../src/clamd.mjs";

test("clamd OK is uitsluitend exact schoon", () => {
  assert.deepEqual(ontleedAntwoord("stream: OK\0"), { soort: "schoon" });
  assert.equal(ontleedAntwoord("stream: OK extra\0").soort, "fout");
  assert.equal(ontleedAntwoord("").soort, "fout");
});

test("clamd FOUND normaliseert pas in de HTTP-laag", () => {
  assert.deepEqual(ontleedAntwoord("stream: Eicar-Test-Signature FOUND\0"), {
    soort: "gevonden",
    detectie: "Eicar-Test-Signature",
  });
});

test("clamd limiet en fouten zijn nooit schoon", () => {
  assert.equal(
    ontleedAntwoord("INSTREAM size limit exceeded. ERROR\0").soort,
    "limiet"
  );
  assert.equal(ontleedAntwoord("stream: read error ERROR\0").soort, "fout");
  assert.equal(ontleedAntwoord("onbekend protocolantwoord\0").soort, "fout");
});
