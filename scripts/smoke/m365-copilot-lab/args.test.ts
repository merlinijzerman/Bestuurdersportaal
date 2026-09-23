import assert from "node:assert/strict";
import test from "node:test";
import { parseerSmokeArgumenten } from "./args";

test("standaard blijft uitsluitend SEM01", () => {
  assert.deepEqual(parseerSmokeArgumenten([]), {
    dryRun: false, geenBrowser: false, rapportPad: null, wachtMs: 300_000, modus: "sem01",
  });
});

test("de exacte canary vraagt een expliciete gesloten vlag", () => {
  assert.deepEqual(parseerSmokeArgumenten(["--exacte-canary", "--dry-run"]).modus, "exacte_canary");
  assert.equal(parseerSmokeArgumenten(["--exacte-canary", "--dry-run"]).dryRun, true);
});

test("vrije vraag, onbekende vlag en dubbele modus falen vóór aanmelden", () => {
  for (const args of [
    ["--vraag=Zandloperbaken 12"], ["--exacte-canary=ja"],
    ["--exacte-canary", "--exacte-canary"], ["--dry-rnu"],
  ]) assert.throws(() => parseerSmokeArgumenten(args));
});

test("ongeldige wachttijd faalt gesloten", () => {
  for (const waarde of ["0", "NaN", "1.5", "1801", "-3", ""]) {
    assert.throws(() => parseerSmokeArgumenten([`--wacht-s=${waarde}`]));
  }
});
