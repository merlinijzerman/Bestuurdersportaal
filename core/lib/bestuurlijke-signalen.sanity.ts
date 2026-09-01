import assert from "node:assert/strict";
import {
  bouwBestuurlijkeSignalen,
  type BestuurlijkSignaalBron,
} from "./bestuurlijke-signalen";

let geslaagd = 0;
function check(naam: string, fn: () => void) {
  fn();
  geslaagd++;
  console.log(`  ✓ ${naam}`);
}

const basis: BestuurlijkSignaalBron = {
  procedureId: "p-1",
  procedureTitel: "Invaarbesluit",
  actief: true,
  afwijkingenOpen: 0,
  bewijs: [],
  besluit: {
    status: "in_onderbouwing",
    gewensteBesluitdatum: null,
    acties: [],
    dissent: [],
  },
};

console.log("bestuurlijke-signalen sanity-tests:");

check("vaste prioriteit wint en begrenst de homepage op drie signalen", () => {
  const signalen = bouwBestuurlijkeSignalen(
    [
      {
        ...basis,
        afwijkingenOpen: 1,
        bewijs: [{ vervuld: false, verplicht: true, blokkerend: true }],
        besluit: {
          status: "in_onderbouwing",
          gewensteBesluitdatum: "2026-10-01",
          acties: [
            {
              actie: "Achterstallig",
              deadline: "2026-08-25",
              status: "open",
              eigenaar_naam: null,
            },
          ],
          dissent: [
            { zichtbaarheid: "formele_dissent", formeel_vastgesteld: false },
          ],
        },
      },
    ],
    "2026-08-30"
  );
  assert.deepEqual(
    signalen.map((signaal) => signaal.soort),
    ["kritieke_vereisten", "actie_te_laat", "afwijking_opvolgen"]
  );
});

check("een externe naam zonder profiel-id geldt wel als toegewezen", () => {
  const signalen = bouwBestuurlijkeSignalen(
    [
      {
        ...basis,
        besluit: {
          ...basis.besluit!,
          acties: [
            {
              actie: "Advies vragen",
              deadline: null,
              status: "open",
              eigenaar_id: null,
              eigenaar_naam: "Externe actuaris",
            },
          ],
        },
      },
    ],
    "2026-08-30"
  );
  assert.equal(signalen.some((signaal) => signaal.soort === "geen_houder"), false);
});

check("alleen een ontbrekend id én naam geeft het houder-signaal", () => {
  const signalen = bouwBestuurlijkeSignalen(
    [
      {
        ...basis,
        besluit: {
          ...basis.besluit!,
          acties: [
            {
              actie: "Toewijzen",
              deadline: null,
              status: "open",
              eigenaar_id: null,
              eigenaar_naam: null,
            },
          ],
        },
      },
    ],
    "2026-08-30"
  );
  assert.equal(signalen[0]?.soort, "geen_houder");
});

check("go/no-go komt alleen uit gewenste besluitdatum, niet uit een stapdeadline", () => {
  const signalen = bouwBestuurlijkeSignalen(
    [
      {
        ...basis,
        besluit: {
          ...basis.besluit!,
          gewensteBesluitdatum: "2026-09-30",
        },
      },
    ],
    "2026-08-30"
  );
  assert.equal(signalen[0]?.soort, "go_no_go");
  assert.match(signalen[0]?.titel ?? "", /30 september/);
});

console.log(`\nbestuurlijke-signalen: ${geslaagd} checks groen.`);
