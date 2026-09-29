// ============================================================================
//  Sanity-tests voor de foutvertaling van generieke curatiewijzigingen (#499).
//  Uitvoeren: npx tsx platform/lib/generiek-mutatie-fout.sanity.ts
// ============================================================================
import assert from "node:assert/strict";
import {
  auditFoutcode,
  classificeerMutatieFout,
  mutatieFoutMelding,
  type MutatieFoutSoort,
} from "./generiek-mutatie-fout";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
console.log("generiek-mutatie-fout sanity-tests:");

// Exact de vorm die PostgREST teruggaf bij de productie-incident (Pensioenwet).
const timeOut = { code: "57014", message: "canceling statement due to statement timeout" };
const statusovergang = {
  code: "P0001",
  message: "Ongeldige generieke statusovergang: withdrawn → published (niet toegestaan volgens de T10-toestandsmachine)",
};

test("KERN #499: 57014 is een time-out, geen statusovergang", () => {
  assert.equal(classificeerMutatieFout(timeOut), "time_out");
  const melding = mutatieFoutMelding("time_out", "Bijwerken");
  assert.match(melding, /te lang/);
  assert.doesNotMatch(melding, /statusovergang/i);
});

test("de toestandsmachine-weigering blijft als statusovergang herkend", () => {
  assert.equal(classificeerMutatieFout(statusovergang), "statusovergang");
  assert.match(mutatieFoutMelding("statusovergang", "Bijwerken"), /statusovergang is niet toegestaan/);
});

test("een andere P0001 (zonder statusovergang-tekst) is geen statusovergang", () => {
  assert.equal(classificeerMutatieFout({ code: "P0001", message: "iets anders" }), "onbekend");
});

test("CHECK-schending, niet gevonden en ontbrekende RPC hebben een eigen oorzaak", () => {
  assert.equal(classificeerMutatieFout({ code: "23514", message: "x" }), "ongeldige_metadata");
  assert.equal(classificeerMutatieFout({ code: "P0002", message: "x" }), "niet_gevonden");
  assert.equal(classificeerMutatieFout({ code: "PGRST202", message: "x" }), "niet_beschikbaar");
  assert.equal(classificeerMutatieFout(null), "onbekend");
  assert.equal(classificeerMutatieFout({}), "onbekend");
});

test("geen melding lekt interne details (SQL, SQLSTATE, objectnamen, ruwe foutentekst)", () => {
  const soorten: MutatieFoutSoort[] = [
    "time_out", "statusovergang", "ongeldige_metadata", "niet_gevonden", "niet_beschikbaar", "onbekend",
  ];
  for (const s of soorten) {
    const m = mutatieFoutMelding(s, "Bijwerken");
    assert.doesNotMatch(m, /57014|P000|23514|PGRST|statement_timeout|canceling|documenten|chunk|fn_|trigger|T10/i, `${s}: ${m}`);
  }
});

test("elke foutmelding (behalve niet-gevonden) zegt dat er niets is gewijzigd (atomisch)", () => {
  for (const s of ["time_out", "statusovergang", "ongeldige_metadata", "niet_beschikbaar", "onbekend"] as const) {
    assert.match(mutatieFoutMelding(s, "Intrekken"), /niets gewijzigd/, s);
  }
});

test("auditFoutcode laat alleen een SQLSTATE/PGRST-code door, nooit vrije tekst", () => {
  assert.equal(auditFoutcode(timeOut), "57014");
  assert.equal(auditFoutcode({ code: "PGRST202" }), "PGRST202");
  assert.equal(auditFoutcode({ code: "drop table x" }), null);
  assert.equal(auditFoutcode({ code: "" }), null);
  assert.equal(auditFoutcode(undefined), null);
});

console.log(`\n${n} tests geslaagd.`);
