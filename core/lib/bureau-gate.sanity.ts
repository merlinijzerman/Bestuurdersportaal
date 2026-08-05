// ============================================================
//  Sanity-tests voor core/lib/bureau-gate.ts (T1 bureau-rol, besluit 0128).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/bureau-gate.sanity.ts
//
//  Waarom deze suite bestaat: `isBureauRol` staat tussen zeven schrijfroutes en
//  vier UI-componenten. Een fout hier — een typefout in de rolwaarde, of een
//  fail-open op een onbekende rol — is niet zichtbaar in de interface en zou pas
//  opvallen wanneer het bureau een stem uitbrengt.
// ============================================================

import assert from "node:assert/strict";
import { BUREAU_ROL, isBureauRol, BUREAU_WEIGERING } from "./bureau-gate";
import { ROL_CAPABILITIES } from "./capabilities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("bureau-gate sanity-tests:");

test("de rolwaarde is exact 'bestuursbureau'", () => {
  // Deze string staat óók in de CHECK-constraint (migratie 2026_08_05), in
  // TENANT_ROLLEN en in elf RLS-predicaten. Eén tekentje verschil en de gate
  // sluit nergens meer.
  assert.equal(BUREAU_ROL, "bestuursbureau");
});

test("de rolwaarde komt overeen met de sleutel in ROL_CAPABILITIES", () => {
  assert.ok(
    BUREAU_ROL in ROL_CAPABILITIES,
    "BUREAU_ROL moet een bestaande sleutel in de capability-mapping zijn"
  );
});

test("isBureauRol herkent de bureau-rol", () => {
  assert.equal(isBureauRol("bestuursbureau"), true);
});

test("isBureauRol raakt de drie bestaande rollen niet (nulgrens G23)", () => {
  for (const rol of ["bestuurder", "voorzitter", "beheerder"]) {
    assert.equal(isBureauRol(rol), false, `${rol} mag niet als bureau gelden`);
  }
});

test("onbekende, lege en ontbrekende rol gelden niet als bureau", () => {
  // Bewust GEEN fail-closed: deze functie WEIGERT een handeling. Zou een
  // onbekende rol hier `true` opleveren, dan zou een profiel zonder rol
  // plotseling geen inbreng meer mogen plaatsen — een gedragswijziging voor een
  // bestaande gebruiker, en dus een doorbraak van de nulgrens.
  assert.equal(isBureauRol("auditor"), false);
  assert.equal(isBureauRol(""), false);
  assert.equal(isBureauRol(null), false);
  assert.equal(isBureauRol(undefined), false);
});

test("isBureauRol is hoofdlettergevoelig (geen stille normalisatie)", () => {
  // De DB-waarde is kleingeschreven en de CHECK dwingt dat af; een variant met
  // hoofdletter bestaat niet en hoort dus ook niet stilzwijgend te matchen.
  assert.equal(isBureauRol("Bestuursbureau"), false);
  assert.equal(isBureauRol("BESTUURSBUREAU"), false);
});

test("elke weigeringsmelding legt uit waarom, niet alleen dat", () => {
  const sleutels = ["inbreng", "stemmen", "stemronde", "dissent"] as const;
  for (const s of sleutels) {
    const melding = BUREAU_WEIGERING[s];
    assert.ok(melding.length > 40, `melding '${s}' is te kort om iets uit te leggen`);
    assert.ok(
      melding.includes("bestuursbureau") || melding.includes("Bestuursbureau"),
      `melding '${s}' benoemt de rol niet`
    );
    assert.ok(melding.trim().endsWith("."), `melding '${s}' eindigt niet op een punt`);
  }
});

test("de vier weigeringsmeldingen zijn onderling verschillend", () => {
  const waarden = Object.values(BUREAU_WEIGERING);
  assert.equal(
    new Set(waarden).size,
    waarden.length,
    "twee handelingen delen dezelfde melding — dan is niet te zien wat er geweigerd is"
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
