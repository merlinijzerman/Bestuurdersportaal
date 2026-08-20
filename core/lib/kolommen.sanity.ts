// ============================================================
//  Sanity-tests voor core/lib/kolommen.ts (V0-A).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/kolommen.sanity.ts
//
//  Waarom deze suite bestaat: deze constanten zijn geen gewone strings maar
//  projecties. Elke kolom die erbij komt, komt erbij op ÉLKE callsite die de
//  constante gebruikt — inclusief de callsites die hun resultaat als API-
//  response teruggeven. Dat is precies het foutpad dat het ontdubbelen van
//  PROFIEL_KOLOMMEN had kunnen introduceren: de twee oorspronkelijke definities
//  verschilden in één kolom (`fonds_id`), en naïef samenvoegen zou die kolom
//  hebben toegevoegd aan de response van GET /api/organisatieprofiel.
//
//  De tests hieronder bewaken die eigenschap structureel, niet per callsite.
// ============================================================

import assert from "node:assert/strict";
import {
  PROCEDURE_KOLOMMEN_DOSSIER,
  RISICO_KOLOMMEN_MATRIX,
  DOCUMENT_KOLOMMEN_LEVENSCYCLUS,
  VERGADERING_KOLOMMEN_AGENDA,
  ORGANISATIEPROFIEL_KOLOMMEN,
  ORGANISATIEPROFIEL_KOLOMMEN_MET_FONDS,
} from "./kolommen";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("kolommen sanity-tests:");

const ALLE: [string, string][] = [
  ["PROCEDURE_KOLOMMEN_DOSSIER", PROCEDURE_KOLOMMEN_DOSSIER],
  ["RISICO_KOLOMMEN_MATRIX", RISICO_KOLOMMEN_MATRIX],
  ["DOCUMENT_KOLOMMEN_LEVENSCYCLUS", DOCUMENT_KOLOMMEN_LEVENSCYCLUS],
  ["VERGADERING_KOLOMMEN_AGENDA", VERGADERING_KOLOMMEN_AGENDA],
  ["ORGANISATIEPROFIEL_KOLOMMEN", ORGANISATIEPROFIEL_KOLOMMEN],
  ["ORGANISATIEPROFIEL_KOLOMMEN_MET_FONDS", ORGANISATIEPROFIEL_KOLOMMEN_MET_FONDS],
];

test("elke constante is exact ', '-gescheiden, zonder lege of losse leden", () => {
  for (const [naam, waarde] of ALLE) {
    assert.equal(waarde, waarde.trim(), `${naam}: spatie aan het begin of eind`);
    assert.ok(!/\n/.test(waarde), `${naam}: bevat een regeleinde`);
    assert.ok(!/,\s*$/.test(waarde), `${naam}: eindigt op een komma`);
    // Precies één spatie na elke komma, en nergens een dubbele spatie: PostgREST
    // is daar tolerant in, maar een afwijking hier maakt de vergelijking met een
    // callsite-literal onbetrouwbaar.
    assert.equal(
      waarde,
      waarde.split(",").map((k) => k.trim()).join(", "),
      `${naam}: scheiding is niet consequent ', '`
    );
  }
});

test("geen enkele constante bevat een wildcard", () => {
  // `*` in een gedeelde projectie haalt stilzwijgend elke toekomstige kolom mee,
  // inclusief kolommen die er nog niet zijn (bijvoorbeeld eenheid_id).
  for (const [naam, waarde] of ALLE) {
    assert.ok(!waarde.includes("*"), `${naam}: bevat een wildcard`);
  }
});

test("kolomnamen zijn kale snake_case-identifiers", () => {
  // Vangt een per ongeluk geplakt SQL-fragment, een alias of een ingebedde
  // relatie (`vergaderingen(titel, datum)`) — dat laatste hoort bij de callsite,
  // niet in een gedeelde kolomlijst.
  for (const [naam, waarde] of ALLE) {
    for (const kolom of waarde.split(", ")) {
      assert.match(kolom, /^[a-z][a-z0-9_]*$/, `${naam}: '${kolom}' is geen kale kolomnaam`);
    }
  }
});

test("geen dubbele kolommen binnen één constante", () => {
  for (const [naam, waarde] of ALLE) {
    const kolommen = waarde.split(", ");
    assert.equal(
      new Set(kolommen).size,
      kolommen.length,
      `${naam}: bevat een dubbele kolom`
    );
  }
});

test("de organisatieprofiel-basis bevat GEEN fonds_id", () => {
  // Dit is de kern van de ontdubbeling. GET /api/organisatieprofiel geeft het
  // profiel van het eigen fonds terug (RLS levert er hoogstens één) en heeft
  // fonds_id niet nodig. Komt de kolom hier alsnog binnen, dan lekt hij in die
  // response — een uitbreiding van wat de API prijsgeeft, zonder besluit.
  assert.ok(
    !ORGANISATIEPROFIEL_KOLOMMEN.split(", ").includes("fonds_id"),
    "fonds_id hoort alleen in de _MET_FONDS-variant"
  );
});

test("de platformvariant is de basis plus fonds_id, en niets anders", () => {
  // Zo blijft er één plek waar de kolommen van het organisatieprofiel staan:
  // de variant mag niet uit elkaar groeien met de basis.
  assert.equal(
    ORGANISATIEPROFIEL_KOLOMMEN_MET_FONDS,
    `fonds_id, ${ORGANISATIEPROFIEL_KOLOMMEN}`
  );
  assert.deepEqual(
    ORGANISATIEPROFIEL_KOLOMMEN_MET_FONDS.split(", ").slice(1),
    ORGANISATIEPROFIEL_KOLOMMEN.split(", ")
  );
});

test("de levenscyclusprojectie houdt bibliotheek vast", () => {
  // Beide callsites weigeren op `bibliotheek !== "generiek"`. Verdwijnt de kolom
  // uit de projectie, dan is die check `undefined !== "generiek"` — altijd waar,
  // dus een fail-open op documenten buiten de generieke bibliotheek.
  assert.ok(DOCUMENT_KOLOMMEN_LEVENSCYCLUS.split(", ").includes("bibliotheek"));
});

console.log(`\n${n} kolommen sanity-tests geslaagd.`);
