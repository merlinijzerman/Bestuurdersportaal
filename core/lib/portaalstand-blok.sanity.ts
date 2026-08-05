// ============================================================================
//  Sanity-tests voor lib/portaalstand-blok.ts (contextbesef, besluit 0090).
//  Pure opmaak van het portaalstand-contextblok; geen DB.
//  Uitvoeren: npx tsx core/lib/portaalstand-blok.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { bouwPortaalstandBlok } from "./portaalstand-blok";
import type { PortaalContext } from "./portaalcontext-afleiding";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("portaalstand-blok sanity-tests:");

const leeg: PortaalContext = {
  volgendeVergadering: null,
  agendapunten: {
    maatstaf: "eigen_inbreng",
    totaal: 0,
    zonderEigenInbreng: 0,
    eersteZonderInbreng: null,
    zonderGekoppeldStuk: 0,
    eersteZonderStuk: null,
  },
  openStappen: [],
  recentDocument: null,
};

test("lege stand → geen blok", () => {
  assert.equal(bouwPortaalstandBlok(leeg), "");
});

test("volledige stand → benoemde regels + label + instructie", () => {
  const blok = bouwPortaalstandBlok({
    volgendeVergadering: {
      id: "v1",
      titel: "Bestuursvergadering juli",
      datum: "2026-08-05T13:00:00.000Z",
      locatie: null,
    },
    agendapunten: {
      maatstaf: "eigen_inbreng",
      totaal: 4,
      zonderEigenInbreng: 2,
      eersteZonderInbreng: { id: "a1", titel: "Beleggingsbeleid" },
      zonderGekoppeldStuk: 0,
      eersteZonderStuk: null,
    },
    openStappen: [
      {
        id: "s1",
        naam: "Concept beoordelen",
        deadline: "2026-08-01T00:00:00.000Z",
        procedure_id: "p1",
        procedure_titel: "Wijziging beleggingsbeleid",
      },
    ],
    recentDocument: null,
  });
  // Label markeert het expliciet als STAND, geen bron/besluit.
  assert.ok(blok.includes("UW PORTAALSTAND"));
  assert.ok(blok.includes("geen genummerde bron"));
  assert.ok(blok.includes("geen vastgesteld besluit"));
  // De drie stand-elementen.
  assert.ok(blok.includes("«Concept beoordelen»"));
  assert.ok(blok.includes("«Wijziging beleggingsbeleid»"));
  assert.ok(blok.includes("deadline"));
  assert.ok(blok.includes("«Bestuursvergadering juli»"));
  assert.ok(blok.includes("2 van 4"));
  assert.ok(blok.includes("«Beleggingsbeleid»"));
  // De signaleren-niet-adviseren-instructie reist mee (§4b).
  assert.ok(blok.includes("Signaleer"));
  assert.ok(blok.includes("nooit een besluit of opdracht op"));
  assert.ok(blok.includes("benoem dan beide expliciet"));
  // NOOIT genummerde bronnen suggereren.
  assert.ok(!/\[Bron \d+\]/.test(blok));
});

test("processtap zonder deadline → geen 'deadline'-tekst", () => {
  const blok = bouwPortaalstandBlok({
    ...leeg,
    openStappen: [
      {
        id: "s1",
        naam: "Actie oppakken",
        deadline: null,
        procedure_id: "p1",
        procedure_titel: "Procedure X",
      },
    ],
  });
  assert.ok(blok.includes("«Actie oppakken»"));
  assert.ok(!blok.includes("deadline"));
});

test("alleen vergadering, 0 agendapunten → geen inbreng-regel", () => {
  const blok = bouwPortaalstandBlok({
    ...leeg,
    volgendeVergadering: {
      id: "v1",
      titel: "Extra overleg",
      datum: "2026-08-05T13:00:00.000Z",
      locatie: null,
    },
  });
  assert.ok(blok.includes("«Extra overleg»"));
  assert.ok(!blok.includes("zonder uw eigen inbreng"));
});

// ── T1 bureau-rol (ontwerp §6.6) ────────────────────────────────────────────
// De promptregel volgt de maatstaf uit de context. Zonder deze tak zou de
// assistent tegen een bureaugebruiker spreken over "uw eigen inbreng" — een
// uiting die het bureau niet doet en (sinds migratie 2026_08_05) niet kan zien.
test("bureau-maatstaf → regel over gekoppelde stukken, niet over eigen inbreng", () => {
  const blok = bouwPortaalstandBlok({
    ...leeg,
    volgendeVergadering: {
      id: "v1",
      titel: "Bestuursvergadering september",
      datum: "2026-09-02T13:00:00.000Z",
      locatie: null,
    },
    agendapunten: {
      maatstaf: "gekoppeld_stuk",
      totaal: 5,
      zonderEigenInbreng: 0,
      eersteZonderInbreng: null,
      zonderGekoppeldStuk: 3,
      eersteZonderStuk: { id: "a4", titel: "Herstelplan" },
    },
  });
  assert.ok(blok.includes("Agendapunten zonder gekoppeld stuk: 3 van 5"));
  assert.ok(blok.includes("«Herstelplan»"));
  assert.ok(!blok.includes("zonder uw eigen inbreng"));
});

// Nulgrens G23: de bestaande regel is byte-voor-byte ongewijzigd voor de
// bestuurlijke rollen. Kantelt deze assertie, dan is de promptregel voor
// bestuurder/voorzitter/beheerder gewijzigd en dat is per definitie een
// doorbraak van de nulgrens.
test("nulgrens: de bestuurdersregel is letterlijk ongewijzigd", () => {
  const blok = bouwPortaalstandBlok({
    ...leeg,
    volgendeVergadering: {
      id: "v1",
      titel: "Bestuursvergadering september",
      datum: "2026-09-02T13:00:00.000Z",
      locatie: null,
    },
    agendapunten: {
      maatstaf: "eigen_inbreng",
      totaal: 5,
      zonderEigenInbreng: 3,
      eersteZonderInbreng: { id: "a4", titel: "Herstelplan" },
      zonderGekoppeldStuk: 0,
      eersteZonderStuk: null,
    },
  });
  assert.ok(
    blok.includes(
      "- Agendapunten zonder uw eigen inbreng: 3 van 5; eerstvolgende «Herstelplan»"
    )
  );
  assert.ok(!blok.includes("gekoppeld stuk"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
