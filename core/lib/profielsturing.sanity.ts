// ============================================================
//  Sanity-tests voor lib/profielsturing.ts — schrijfvoorkeuren (31-07-2026).
//
//  WAAROM: de voorkeuren detailniveau/antwoordvoorkeur landden eerder als kaal
//  etiket in de prompt ("antwoordvoorkeur \"puntsgewijs\"") zonder gedrag, en
//  werden overstemd door de veel concretere stijlregels in TOON_BLOK. Deze
//  suite bewaakt de vertaalslag naar échte instructies: dat elke toegestane
//  waarde iets oplevert, dat "standaard" bewust niets stuurt, dat een onbekende
//  waarde stil terugvalt i.p.v. te gokken, en dat de compliance-grens bij
//  "beknopt" (bron/onzekerheid blijft staan) in de instructie geborgd is.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/profielsturing.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { voorkeurInstructies, type ProfielVoorkeuren } from "./profielsturing";

function v(over: Partial<ProfielVoorkeuren> = {}): ProfielVoorkeuren {
  return {
    bestuurlijkeRol: null,
    primaireExpertiseNaam: null,
    secundaireNamen: [],
    gremiaNamen: [],
    focusNamenLijst: [],
    antwoordvoorkeur: null,
    detailniveau: null,
    ...over,
  };
}

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("profielsturing sanity-tests (schrijfvoorkeuren):");

test("niets ingevuld → geen instructies", () => {
  assert.deepEqual(voorkeurInstructies(v()), []);
});

test("elke toegestane antwoordvoorkeur levert een instructie op", () => {
  for (const keuze of ["kern-eerst", "puntsgewijs", "lopende tekst"]) {
    const r = voorkeurInstructies(v({ antwoordvoorkeur: keuze }));
    assert.equal(r.length, 1, `geen instructie voor "${keuze}"`);
    assert.ok(r[0].length > 40, `instructie voor "${keuze}" is te dun`);
  }
});

test("beknopt en uitgebreid sturen; standaard stuurt bewust NIET", () => {
  assert.equal(voorkeurInstructies(v({ detailniveau: "beknopt" })).length, 1);
  assert.equal(voorkeurInstructies(v({ detailniveau: "uitgebreid" })).length, 1);
  // "standaard" = de natuurlijke stijl uit TOON_BLOK ongemoeid laten.
  assert.deepEqual(voorkeurInstructies(v({ detailniveau: "standaard" })), []);
});

test("de drie antwoordvoorkeuren geven ONDERLING verschillende instructies", () => {
  // Regressie op de oorzaak van de bevinding: als twee keuzes hetzelfde
  // opleveren, kan de gebruiker per definitie geen verschil zien.
  const teksten = ["kern-eerst", "puntsgewijs", "lopende tekst"].map(
    (k) => voorkeurInstructies(v({ antwoordvoorkeur: k }))[0]
  );
  assert.equal(new Set(teksten).size, 3);
});

test("puntsgewijs overschrijft expliciet de standaard 'geen bullets'-regel", () => {
  const r = voorkeurInstructies(v({ antwoordvoorkeur: "puntsgewijs" }))[0];
  assert.match(r, /afwijken/i);
  assert.match(r, /opsomming/i);
});

test("beknopt kort uitweidingen in, NOOIT bron/onzekerheid (compliance-grens)", () => {
  const r = voorkeurInstructies(v({ detailniveau: "beknopt" }))[0];
  assert.match(r, /bronmarkeringen/i);
  assert.match(r, /onzekerheden/i);
});

test("onbekende waarde → stille terugval, geen gok", () => {
  assert.deepEqual(voorkeurInstructies(v({ detailniveau: "extreem-kort" })), []);
  assert.deepEqual(voorkeurInstructies(v({ antwoordvoorkeur: "tabel" })), []);
});

test("vorm + detail samen → twee instructies, vorm eerst", () => {
  const r = voorkeurInstructies(
    v({ antwoordvoorkeur: "kern-eerst", detailniveau: "beknopt" })
  );
  assert.equal(r.length, 2);
  assert.match(r[0], /KERN EERST/);
  assert.match(r[1], /BEKNOPT/);
});

console.log(`\n${n} sanity-tests groen (profielsturing).`);
