import assert from "node:assert/strict";
import {
  afwijkingOpvolgingTekst,
  telAfwijkingenMetOpenOpvolging,
} from "./procedure-overzicht-afwijking";

let geslaagd = 0;
function check(naam: string, fn: () => void) {
  fn();
  geslaagd++;
  console.log(`  ✓ ${naam}`);
}

console.log("procedure-overzicht-afwijking sanity-tests:");

check("alleen afwijkende afrondingen tellen als open opvolging", () => {
  assert.equal(
    telAfwijkingenMetOpenOpvolging([
      { afgerond_met_afwijking: false },
      { afgerond_met_afwijking: true },
      { afgerond_met_afwijking: false },
    ]),
    1
  );
});

check("enkelvoud en meervoud blijven bestuurlijk leesbaar", () => {
  assert.equal(afwijkingOpvolgingTekst(0), null);
  assert.equal(
    afwijkingOpvolgingTekst(1),
    "Stap afgerond met afwijking; opvolging open"
  );
  assert.equal(
    afwijkingOpvolgingTekst(2),
    "2 stappen afgerond met afwijking; opvolging open"
  );
});

console.log(`\nprocedure-overzicht-afwijking: ${geslaagd} checks groen.`);
