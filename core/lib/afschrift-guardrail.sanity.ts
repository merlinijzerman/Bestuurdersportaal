// ============================================================
//  Sanity-tests voor de afschrift-guardrail (T6 fase 2, G2).
//
//  De guardrail is de compliance-borging van laag C: hij WEIGERT AI-tekst met
//  een datum/getal/eigennaam die niet in de feitenkaart voorkomt (AC fase-2 1).
//  Deze tests borgen dat faithful tekst wordt geaccepteerd en dat verzonnen
//  feiten (jaartal, getal, naam) worden gevangen — zonder dat legitieme
//  besluitcodes of het procesonderwerp vals-positief worden afgekeurd.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/afschrift-guardrail.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import type { Feitenkaart } from "./afschrift-types";
import { toetsLeeswijzerTegenFeitenkaart, eigennamenIn } from "./afschrift-guardrail";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function fk(): Feitenkaart {
  return {
    procescode: "B-2026-001",
    procedureTitel: "Wijziging beleggingsbeleid 2026",
    versie: "besluitmoment",
    aanleiding: "t.b.v. jaarrekeningcontrole 2026",
    aangemaaktOp: "2026-08-09T12:00:00.000Z",
    aantalBesluiten: 1,
    hoogsteVertrouwelijkheid: "vertrouwelijk",
    doorlooptijdDagen: 47,
    onderbouwingsfase: { start: "2026-03-03T09:00:00.000Z", eind: "2026-04-19T09:00:00.000Z" },
    besluiten: [
      {
        besluitCode: "B-2026-001", titel: "Verhoging hedge-ratio", status: "besloten",
        statusLabel: "Besloten", vertrouwelijkheid: "vertrouwelijk",
        aannames: { totaal: 7, perStatus: { gevalideerd: 5, concept: 2 } },
        risicos: { totaal: 3, perStatus: { geaccepteerd: 1, open: 2 } },
        voorwaarden: { totaal: 2, perStatus: { open: 2 } },
        acties: { totaal: 1, perStatus: { open: 1 } },
        dissent: { totaal: 1, formeel: 1, perZichtbaarheid: { formele_dissent: 1 } },
        vastgelegdeBesluiten: { totaal: 1, laatsteDatum: "2026-04-19T09:00:00.000Z" },
        eersteVastlegging: "2026-03-03T09:00:00.000Z", laatsteVastlegging: "2026-04-19T09:00:00.000Z",
      },
    ],
    bewijs: { totaal: 4, metDocument: 3, zonderDocument: 1 },
    totalen: {
      aannames: 7, aannamesGevalideerd: 5, risicos: 3, risicosGeaccepteerd: 1,
      voorwaarden: 2, voorwaardenOpen: 2, acties: 1, dissent: 1, dissentFormeel: 1,
    },
    afwijkingen: [],
  };
}

console.log("afschrift-guardrail sanity-tests:");

test("faithful tekst met alleen feitenkaart-feiten wordt geaccepteerd", () => {
  const tekst =
    "De onderbouwingsfase liep van 3 maart 2026 tot 19 april 2026; de doorlooptijd bedroeg 47 dagen. " +
    "Voor besluit B-2026-001 zijn 7 aannames vastgelegd, waarvan 5 gevalideerd, en 3 risico's, waarvan 1 geaccepteerd.";
  const r = toetsLeeswijzerTegenFeitenkaart(tekst, fk());
  assert.ok(r.ok, `verwacht ok, kreeg: ${r.overtredingen.join("; ")}`);
});

test("een verzonnen jaartal (2019) wordt geweigerd", () => {
  const r = toetsLeeswijzerTegenFeitenkaart(
    "Het beleid loopt al sinds 2019 en is nu herzien.",
    fk()
  );
  assert.equal(r.ok, false);
  assert.ok(r.overtredingen.some((o) => o.includes('"2019"')));
});

test("een verzonnen getal (12 aannames i.p.v. 7) wordt geweigerd", () => {
  const r = toetsLeeswijzerTegenFeitenkaart("Er zijn 12 aannames vastgelegd.", fk());
  assert.equal(r.ok, false);
  assert.ok(r.overtredingen.some((o) => o.includes('"12"')));
});

test("een verzonnen eigennaam (Jan Jansen) wordt geweigerd", () => {
  const r = toetsLeeswijzerTegenFeitenkaart(
    "Het besluit is genomen op voordracht van Jan Jansen.",
    fk()
  );
  assert.equal(r.ok, false);
  assert.ok(r.overtredingen.some((o) => o.toLowerCase().includes("jansen")));
});

test("een legitieme besluitcode uit de feitenkaart is GEEN overtreding", () => {
  const namen = eigennamenIn("Zie besluit B-2026-001 voor de onderbouwing.");
  assert.ok(namen.includes("B-2026-001"), "code moet als kandidaat herkend worden");
  const r = toetsLeeswijzerTegenFeitenkaart("Zie besluit B-2026-001 voor de onderbouwing.", fk());
  assert.ok(r.ok, `code uit de feitenkaart mag niet vals-positief zijn: ${r.overtredingen.join("; ")}`);
});

test("woorden uit het procesonderwerp (Beleggingsbeleid) zijn geen overtreding", () => {
  const r = toetsLeeswijzerTegenFeitenkaart(
    "De Wijziging van het Beleggingsbeleid is zorgvuldig gedocumenteerd.",
    fk()
  );
  // "Wijziging" en "Beleggingsbeleid" komen in procedureTitel voor.
  assert.ok(r.ok, `verwacht ok, kreeg: ${r.overtredingen.join("; ")}`);
});

test("zinsbegin-hoofdletters worden niet als eigennaam aangezien", () => {
  const namen = eigennamenIn("Het proces verliep goed. De fase was afgerond. Vervolgens sloot men af.");
  assert.deepEqual(namen, [], `zinsbegin-woorden mogen niet gemarkeerd worden, kreeg: ${namen.join(", ")}`);
});

test("maandnamen zijn toegestane vocabulaire, ook mid-zin", () => {
  const r = toetsLeeswijzerTegenFeitenkaart(
    "In maart 2026 begon de onderbouwing en in april 2026 werd besloten.",
    fk()
  );
  assert.ok(r.ok, `maanden mogen niet als eigennaam falen: ${r.overtredingen.join("; ")}`);
});

console.log(`\nafschrift-guardrail: ${n} tests groen.`);
