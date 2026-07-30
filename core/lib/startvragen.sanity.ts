// ============================================================
//  Sanity-tests voor core/lib/startvragen.ts (P2 Deel A).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/startvragen.sanity.ts
//  Verifieert de vaste, generieke voorbeeldvragen: niet leeg, ontdubbeld,
//  vraagvorm (neutraal-kritisch), en geen «...»-verwijzing naar een specifiek
//  stuk/agendapunt (die horen bij de taakkaart "Een document doorgronden").
//
//  Ingreep 1 (30-07-2026): elke startvraag draagt een VASTE bron-intentie. De
//  tests borgen dat de intentie gezet en geldig is, én — als vangnet tegen
//  onbedoeld verschuiven — dat de generieke starters niet stil als fondsvraag
//  worden geprefilld.
// ============================================================

import assert from "node:assert/strict";
import { GENERIEKE_STARTVRAGEN } from "./startvragen";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("startvragen sanity-tests:");

check("niet leeg en een hanteerbaar aantal", () => {
  assert.ok(GENERIEKE_STARTVRAGEN.length >= 1);
  assert.ok(GENERIEKE_STARTVRAGEN.length <= 6);
});

check("geen dubbele vragen", () => {
  const teksten = GENERIEKE_STARTVRAGEN.map((s) => s.vraag);
  assert.equal(new Set(teksten).size, teksten.length);
});

check("elke vraag is een vraagvorm (eindigt op ?)", () => {
  for (const s of GENERIEKE_STARTVRAGEN)
    assert.ok(s.vraag.trim().endsWith("?"), s.vraag);
});

check("geen «...»-verwijzing naar een specifiek stuk/agendapunt (generiek)", () => {
  for (const s of GENERIEKE_STARTVRAGEN) assert.ok(!s.vraag.includes("«"), s.vraag);
});

// ── Ingreep 1 — vaste bron-intentie ────────────────────────────────────────
check("elke startvraag heeft een geldige bron-intentie", () => {
  for (const s of GENERIEKE_STARTVRAGEN)
    assert.ok(s.intent === "fonds" || s.intent === "algemeen", s.vraag);
});

check("de generieke starters zijn intent 'algemeen' (geen stille fondsprefill)", () => {
  // De set onder "Een vrije vraag stellen" is bewust generiek (geen grounding op
  // eigen stukken). Zet iemand hier een fondsvraag neer, dan hoort die vraag bij
  // een andere taakkaart of bij een module-ingang (?intent=fonds&herkomst=…),
  // niet bij de generieke starters. Deze test dwingt die keuze expliciet af.
  for (const s of GENERIEKE_STARTVRAGEN)
    assert.equal(
      s.intent,
      "algemeen",
      `Startvraag met intent 'fonds' in de generieke set: ${s.vraag}`
    );
});

console.log(`\n${n} sanity-tests geslaagd.`);
