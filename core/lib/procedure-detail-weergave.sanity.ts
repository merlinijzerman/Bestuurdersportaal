// ============================================================
//  Sanity-tests voor core/lib/procedure-detail-weergave.ts (WO-3).
//
//  Kernbewijs: de rechter-weergavekeuze volgt de vaste precedentie
//  (geldige ?stap > geldige ?fase > default-stap > leeg) en de
//  sectie-samenvattingen matchen de mockup-koppen.
// ============================================================

import assert from "node:assert/strict";
import {
  kiesWeergave,
  checklistSamenvatting,
  bewijsstukkenSamenvatting,
  vergaderingenSamenvatting,
} from "./procedure-detail-weergave";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const basis = {
  geldigeStapIds: ["s1", "s2", "s3"],
  geldigeFaseCodes: ["I", "II"],
  defaultFaseCode: "I",
  defaultStapId: "s2",
};

// ── kiesWeergave ─────────────────────────────────────────────────────────────

check("kiesWeergave: geldige ?stap wint van alles", () => {
  assert.deepEqual(
    kiesWeergave({ ...basis, stapParam: "s1", faseParam: "I" }),
    { modus: "stap", stapId: "s1" }
  );
});

check("kiesWeergave: geldige ?fase als geen ?stap", () => {
  assert.deepEqual(kiesWeergave({ ...basis, faseParam: "II" }), {
    modus: "fase",
    faseCode: "II",
  });
});

check("kiesWeergave: ongeldige ?stap valt terug op de eerste procesfase", () => {
  assert.deepEqual(kiesWeergave({ ...basis, stapParam: "onbekend" }), {
    modus: "fase",
    faseCode: "I",
  });
});

check("kiesWeergave: ongeldige ?fase valt terug op de eerste procesfase", () => {
  assert.deepEqual(kiesWeergave({ ...basis, faseParam: "ZZ" }), {
    modus: "fase",
    faseCode: "I",
  });
});

check("kiesWeergave: geen params → eerste procesfase", () => {
  assert.deepEqual(kiesWeergave(basis), { modus: "fase", faseCode: "I" });
});

check("kiesWeergave: zonder fase is de default-stap de terugval", () => {
  assert.deepEqual(
    kiesWeergave({ ...basis, defaultFaseCode: null }),
    { modus: "stap", stapId: "s2" }
  );
});

check("kiesWeergave: zonder fase of stap en geen params → leeg", () => {
  assert.deepEqual(
    kiesWeergave({ ...basis, defaultFaseCode: null, defaultStapId: null }),
    { modus: "leeg" }
  );
});

check("kiesWeergave: ?stap heeft voorrang ook als ?fase geldig is", () => {
  assert.deepEqual(
    kiesWeergave({ ...basis, stapParam: "s3", faseParam: "I" }),
    { modus: "stap", stapId: "s3" }
  );
});

// ── checklistSamenvatting ────────────────────────────────────────────────────

check("checklist: 0/8 voldaan · 8× bewijs vereist", () => {
  const items = Array.from({ length: 8 }, () => ({
    voldaan: false,
    bewijs_vereist: true,
  }));
  assert.equal(checklistSamenvatting(items), "0/8 voldaan · 8× bewijs vereist");
});

check("checklist: gemengd voldaan + deels bewijs", () => {
  const items = [
    { voldaan: true, bewijs_vereist: false },
    { voldaan: false, bewijs_vereist: true },
    { voldaan: true, bewijs_vereist: true },
  ];
  assert.equal(checklistSamenvatting(items), "2/3 voldaan · 2× bewijs vereist");
});

check("checklist: geen bewijs vereist → alleen voldaan-teller", () => {
  const items = [
    { voldaan: true, bewijs_vereist: false },
    { voldaan: false, bewijs_vereist: false },
  ];
  assert.equal(checklistSamenvatting(items), "1/2 voldaan");
});

check("checklist: soft-gedeactiveerde items tellen niet mee", () => {
  const items = [
    { voldaan: true, bewijs_vereist: true },
    { voldaan: false, bewijs_vereist: true, actief: false },
  ];
  assert.equal(checklistSamenvatting(items), "1/1 voldaan · 1× bewijs vereist");
});

// ── bewijsstukkenSamenvatting ────────────────────────────────────────────────

check("bewijs: 3 gevraagd, niks vervuld → nog 3 op te voeren", () => {
  const ev = [{ vervuld: false }, { vervuld: false }, { vervuld: false }];
  assert.equal(bewijsstukkenSamenvatting(ev), "3 gevraagd · nog 3 op te voeren");
});

check("bewijs: alles vervuld → alle opgevoerd", () => {
  const ev = [{ vervuld: true }, { vervuld: true }];
  assert.equal(bewijsstukkenSamenvatting(ev), "2 gevraagd · alle opgevoerd");
});

check("bewijs: geen vereisten", () => {
  assert.equal(bewijsstukkenSamenvatting([]), "geen vereisten");
});

// ── vergaderingenSamenvatting ────────────────────────────────────────────────

check("vergaderingen: 0 → geen", () => {
  assert.equal(vergaderingenSamenvatting(0), "geen");
});

check("vergaderingen: 1 → 1 gekoppeld", () => {
  assert.equal(vergaderingenSamenvatting(1), "1 gekoppeld");
});

console.log(`\n${n} checks groen — procedure-detail-weergave.`);
