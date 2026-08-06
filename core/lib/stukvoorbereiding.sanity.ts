// ============================================================
//  Sanity-tests voor core/lib/stukvoorbereiding.ts (T2, bureau-stand).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stukvoorbereiding.sanity.ts
//  Verifieert: de vaste secties per stuksoort, de NIET-uitzetbare slotsectie
//  (G13), de guardrail-verruiming in de instructie (G3/G8), de leesbare beurt en
//  de promptvariant.
// ============================================================

import assert from "node:assert/strict";
import {
  STUKSOORTEN,
  SLOTSECTIE,
  STUK_PROMPTVARIANT,
  isStuksoort,
  stuksoortDef,
  bouwStukZin,
  bouwStukInstructie,
  extraheerStukBlok,
  type Stuksoort,
} from "./stukvoorbereiding";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("stukvoorbereiding sanity-tests:");

const ALLE: Stuksoort[] = ["oplegger", "bestuursnotitie", "memo", "toelichting"];

// ── stuksoorten + validatie ─────────────────────────────────────────────────
check("de vier stuksoorten bestaan, in vaste volgorde", () => {
  assert.deepEqual(
    STUKSOORTEN.map((s) => s.id),
    ALLE
  );
});

check("isStuksoort accepteert alleen de vier waarden", () => {
  for (const id of ALLE) assert.equal(isStuksoort(id), true);
  for (const fout of ["", "notitie", "besluit", null, undefined, 3]) {
    assert.equal(isStuksoort(fout), false);
  }
});

// ── G13: de slotsectie is niet uitzetbaar ───────────────────────────────────
check("SLOTSECTIE staat in GEEN enkele per-stuksoort-lijst (alleen bijgevoegd)", () => {
  for (const s of STUKSOORTEN) {
    assert.equal(
      s.secties.includes(SLOTSECTIE),
      false,
      `${s.id} draagt de slotsectie in zijn eigen lijst — die hoort alleen te worden toegevoegd`
    );
  }
});

check("elke stuksoort-instructie eindigt met de verplichte slotsectie", () => {
  for (const id of ALLE) {
    const instr = bouwStukInstructie(id);
    // De slotsectie staat als kop in de instructie ...
    assert.ok(
      instr.includes(`## ${SLOTSECTIE}`),
      `${id} mist de kop "## ${SLOTSECTIE}"`
    );
    // ... en na de laatste inhoudelijke sectie (dus als laatste kop).
    const laatsteKop = instr.lastIndexOf("## ");
    assert.equal(
      instr.slice(laatsteKop).startsWith(`## ${SLOTSECTIE}`),
      true,
      `${id}: de slotsectie is niet de laatste kop`
    );
    // ... en de instructie verbiedt expliciet hem weg te laten.
    assert.ok(
      instr.includes(`laat u nooit weg`),
      `${id}: de niet-uitzetbaarheid staat niet in de instructie`
    );
  }
});

check("de vaste inhoudelijke secties komen als koppen in de instructie", () => {
  for (const id of ALLE) {
    const instr = bouwStukInstructie(id);
    for (const sectie of stuksoortDef(id)!.secties) {
      assert.ok(instr.includes(`## ${sectie}`), `${id} mist kop "## ${sectie}"`);
    }
  }
});

// ── G3/G8: de guardrail-verruiming ──────────────────────────────────────────
check("de instructie draagt de verruiming: voorstel van het bureau, geen besluit", () => {
  const instr = bouwStukInstructie("bestuursnotitie");
  const lower = instr.toLowerCase();
  assert.ok(lower.includes("voorstel ván het bureau áán het bestuur"));
  assert.ok(lower.includes("nooit als besluit"));
  assert.ok(lower.includes("concept ter bewerking"));
  // G8: geen gaten dichten met algemene kennis.
  assert.ok(lower.includes("niet in met algemene kennis"));
});

// ── zichtbare beurt + promptvariant ─────────────────────────────────────────
check("bouwStukZin is kort, benoemt stuksoort en onderwerp", () => {
  const zin = bouwStukZin("bestuursnotitie", "Wijziging beleggingsbeleid");
  assert.equal(zin, "Bereid een bestuursnotitie voor over «Wijziging beleggingsbeleid».");
  // Zonder onderwerp valt de haakjes-clausule weg (geen lege «»).
  assert.equal(bouwStukZin("memo", "  "), "Bereid een memo voor.");
});

check("promptvariant is de gepinde waarde", () => {
  assert.equal(STUK_PROMPTVARIANT, "bureau_stuk_v1");
});

// ── T5 A3/A5: kaal stuk + afbakening voor de export ─────────────────────────
check("de instructie verbiedt conversationele omlijsting en een eigen titel", () => {
  const instr = bouwStukInstructie("bestuursnotitie");
  assert.ok(/UITSLUITEND het stuk zelf/.test(instr), instr);
  assert.ok(/géén begroeting, inleiding, aanhef of/.test(instr), instr);
  assert.ok(/eigen titelregel/.test(instr), instr);
  assert.ok(/geen afsluitende vraag/.test(instr), instr);
});

check("extraheerStukBlok knipt een lead-in vóór de eerste kop weg", () => {
  const ruw = [
    "Graag, Merlin. Hieronder de herschreven notitie.",
    "",
    "## Samenvatting",
    "De kern van het voorstel.",
    "",
    "## Aannames en open punten",
    "- De renteaanname is nog niet bevestigd.",
  ].join("\n");
  const blok = extraheerStukBlok(ruw);
  assert.ok(!blok.includes("Graag, Merlin"), blok);
  assert.ok(blok.startsWith("## Samenvatting"), blok);
  assert.ok(blok.includes("Aannames en open punten"), blok);
});

check("extraheerStukBlok knipt een conversationele afsluiting ná het stuk weg", () => {
  const ruw = [
    "## Kern",
    "De inhoud van het memo.",
    "",
    "## Aannames en open punten",
    "- Nog te verifiëren bij de uitvoerder.",
    "",
    "Een paar keuzes wil ik graag aan u voorleggen. Wilt u dat ik het compacter maak?",
  ].join("\n");
  const blok = extraheerStukBlok(ruw);
  assert.ok(!blok.includes("Een paar keuzes"), blok);
  assert.ok(!blok.includes("Wilt u dat ik"), blok);
  assert.ok(blok.trimEnd().endsWith("bij de uitvoerder."), blok);
});

check("extraheerStukBlok laat een schoon stuk (koppen/lijsten/tabel) ongemoeid", () => {
  const schoon = [
    "## Samenvatting",
    "De kern.",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "## Aannames en open punten",
    "- Openstaand punt.",
  ].join("\n");
  assert.equal(extraheerStukBlok(schoon), schoon.trim());
});

console.log(`\n${n} sanity-tests geslaagd.`);
