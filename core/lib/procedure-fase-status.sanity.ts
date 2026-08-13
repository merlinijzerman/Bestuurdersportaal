// ============================================================
//  Sanity-tests voor core/lib/procedure-fase-status.ts (WO-2, §7.1).
//
//  Kernbewijs: de afgeleide fase-status, aandachtsvlag, bewijslast-dekking
//  en portfolio-aggregatie volgen exact de regels uit
//  PROCEDURE-ENGINE-V2-ONTWERP §7.1 — parallel-by-default, geen cursor.
//  'heropend' telt als actief; termijn-condities zijn (bewust) nog niet
//  meegenomen (review O2).
// ============================================================

import assert from "node:assert/strict";
import {
  faseStatus,
  bewijslastDekking,
  faseAandacht,
  aggregeerPortfolio,
  type FaseStatus,
} from "./procedure-fase-status";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── faseStatus ──────────────────────────────────────────────────────────────

check("faseStatus: alle stappen afgerond → afgerond", () => {
  assert.equal(
    faseStatus([{ status: "afgerond" }, { status: "afgerond" }]),
    "afgerond"
  );
});

check("faseStatus: geen afgerond, geen actief → nog niet begonnen", () => {
  assert.equal(
    faseStatus([{ status: "geblokkeerd" }, { status: "open" }]),
    "nog_niet_begonnen"
  );
});

check("faseStatus: ≥1 actief → in behandeling", () => {
  assert.equal(
    faseStatus([{ status: "actief" }, { status: "geblokkeerd" }]),
    "in_behandeling"
  );
});

check("faseStatus: heropend telt als actief → in behandeling", () => {
  assert.equal(
    faseStatus([{ status: "heropend" }, { status: "open" }]),
    "in_behandeling"
  );
});

check("faseStatus: deels afgerond, rest niet begonnen → in behandeling", () => {
  assert.equal(
    faseStatus([{ status: "afgerond" }, { status: "geblokkeerd" }]),
    "in_behandeling"
  );
});

check("faseStatus: lege fase → nog niet begonnen (defensief)", () => {
  assert.equal(faseStatus([]), "nog_niet_begonnen");
});

// ── bewijslastDekking ─────────────────────────────────────────────────────────

check("bewijslastDekking: telt alleen verplichte vereisten", () => {
  const d = bewijslastDekking([
    { verplicht: true, vervuld: true },
    { verplicht: true, vervuld: false },
    { verplicht: false, vervuld: false }, // niet-verplicht telt niet mee
  ]);
  assert.deepEqual(d, { verplicht: 2, sluitend: 1, pct: 50 });
});

check("bewijslastDekking: geen verplichte vereisten → 100%", () => {
  const d = bewijslastDekking([{ verplicht: false, vervuld: false }]);
  assert.deepEqual(d, { verplicht: 0, sluitend: 0, pct: 100 });
});

check("bewijslastDekking: afronding op hele procenten", () => {
  const d = bewijslastDekking([
    { verplicht: true, vervuld: true },
    { verplicht: true, vervuld: false },
    { verplicht: true, vervuld: false },
  ]);
  assert.equal(d.pct, 33); // 1/3 = 33,33 → 33
});

// ── faseAandacht ──────────────────────────────────────────────────────────────

const geenStap = { status: "actief" as const, herbevestiging_nodig: false };

check("faseAandacht: afgeronde fase zonder rework → geen vlag (bewijslast telt niet)", () => {
  const status: FaseStatus = "afgerond";
  assert.equal(
    faseAandacht(status, [{ status: "afgerond", herbevestiging_nodig: false }], [
      { verplicht: true, blokkerend: true, vervuld: false },
    ]),
    "geen"
  );
});

check("faseAandacht: herbevestiging_nodig op afgeronde fase → oranje (rework, ongeacht status)", () => {
  // Regressie voor de B-drift: het rework-signaal moet ook op een afgeronde
  // fase een vlag geven, anders lopen fasestrip en tellerregel uiteen.
  assert.equal(
    faseAandacht(
      "afgerond",
      [{ status: "afgerond", herbevestiging_nodig: true }],
      []
    ),
    "oranje"
  );
});

check("faseAandacht: nog-niet-begonnen fase met ontbrekende bewijslast → geen vlag", () => {
  // Bewijslast-vlaggen alleen bij een lopende fase; een niet-begonnen fase
  // heeft nog geen bewijslast en hoort niet op te lichten.
  assert.equal(
    faseAandacht("nog_niet_begonnen", [{ status: "geblokkeerd", herbevestiging_nodig: false }], [
      { verplicht: true, blokkerend: false, vervuld: false },
    ]),
    "geen"
  );
});

check("faseAandacht: verplichte blokkerende bewijslast ontbreekt → rood", () => {
  assert.equal(
    faseAandacht("in_behandeling", [geenStap], [
      { verplicht: true, blokkerend: true, vervuld: false },
    ]),
    "rood"
  );
});

check("faseAandacht: heropende stap → oranje", () => {
  assert.equal(
    faseAandacht(
      "in_behandeling",
      [{ status: "heropend", herbevestiging_nodig: false }],
      []
    ),
    "oranje"
  );
});

check("faseAandacht: herbevestiging_nodig → oranje", () => {
  assert.equal(
    faseAandacht(
      "in_behandeling",
      [{ status: "actief", herbevestiging_nodig: true }],
      []
    ),
    "oranje"
  );
});

check("faseAandacht: verplichte niet-blokkerende bewijslast ontbreekt → oranje", () => {
  assert.equal(
    faseAandacht("in_behandeling", [geenStap], [
      { verplicht: true, blokkerend: false, vervuld: false },
    ]),
    "oranje"
  );
});

check("faseAandacht: rood wint van oranje", () => {
  assert.equal(
    faseAandacht(
      "in_behandeling",
      [{ status: "heropend", herbevestiging_nodig: false }],
      [{ verplicht: true, blokkerend: true, vervuld: false }]
    ),
    "rood"
  );
});

check("faseAandacht: alles sluitend, geen heropend → geen vlag", () => {
  assert.equal(
    faseAandacht("in_behandeling", [geenStap], [
      { verplicht: true, blokkerend: true, vervuld: true },
      { verplicht: true, blokkerend: false, vervuld: true },
    ]),
    "geen"
  );
});

// ── aggregeerPortfolio ────────────────────────────────────────────────────────

check("aggregeerPortfolio: telt uitsluitend lopende procedures", () => {
  const agg = aggregeerPortfolio([
    { isAfgerond: false, heeftAandacht: true, heeftRood: false, besluitrijp: false },
    { isAfgerond: false, heeftAandacht: true, heeftRood: true, besluitrijp: false },
    { isAfgerond: false, heeftAandacht: false, heeftRood: false, besluitrijp: true },
    { isAfgerond: true, heeftAandacht: true, heeftRood: true, besluitrijp: true }, // afgerond → niet geteld
  ]);
  assert.deepEqual(agg, {
    lopend: 3,
    metAandacht: 2,
    tijdkritisch: 1,
    besluitrijp: 1,
  });
});

console.log(`\nprocedure-fase-status.sanity: ${n} checks groen.`);
