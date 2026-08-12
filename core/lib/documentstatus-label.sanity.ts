// ============================================================================
//  Sanity-suite bij core/lib/documentstatus-label.ts
// ----------------------------------------------------------------------------
//  Draait mee in `npm run sanity` of los met
//  `npx tsx core/lib/documentstatus-label.sanity.ts`.
//
//  Waarom deze suite: dit label is de enige plek waar het model kan zien dat een
//  aangeleverde bron NIET vastgesteld is. Valt het weg, dan verdwijnt het
//  onderscheid tussen "dit geldt" en "dit ligt voor" uit het antwoord, terwijl
//  de retrieval sinds 12-08-2026 juist bewust breder ophaalt. Het label is dus
//  de tegenhanger van die verbreding, geen cosmetiek.
// ============================================================================

import assert from "node:assert/strict";
import { statuslabelVoorBron, heeftAfwijkendeStatus } from "./documentstatus-label";
import { ACTUELE_BRON_STATUSSEN } from "./document-status-transities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── De norm blijft kaal ─────────────────────────────────────────────────────
// Een vastgesteld/van kracht zijnd stuk krijgt bewust GEEN label: anders draagt
// elke bron in elke prompt een marker en verwatert het signaal.
test("vastgesteld en van_kracht krijgen geen label", () => {
  assert.equal(statuslabelVoorBron({ documentstatus: "vastgesteld" }), "");
  assert.equal(statuslabelVoorBron({ documentstatus: "van_kracht" }), "");
  assert.equal(heeftAfwijkendeStatus({ documentstatus: "van_kracht" }), false);
});

// ── De reden dat deze module bestaat ────────────────────────────────────────
test("concept wordt expliciet als niet-vastgesteld gelabeld", () => {
  const label = statuslabelVoorBron({ documentstatus: "concept" });
  assert.ok(label.includes("concept"), "het woord concept moet in het label staan");
  assert.ok(
    label.includes("nog niet vastgesteld"),
    "de betekenis moet erbij staan, niet alleen het statuswoord"
  );
  assert.ok(label.startsWith(" "), "label plakt achter de titel, met spatie ervoor");
});

test("historisch en gearchiveerd dragen hun eigen label", () => {
  assert.ok(statuslabelVoorBron({ documentstatus: "historisch" }).includes("historisch"));
  assert.ok(statuslabelVoorBron({ documentstatus: "gearchiveerd" }).includes("gearchiveerd"));
});

// ── Geen schijnzekerheid bij onbekende waarden ──────────────────────────────
// Een lege of onbekende status mag NIET stilzwijgend als geldend doorgaan; dat
// zou precies de fout zijn die het statusfilter ooit moest voorkomen.
test("lege of onbekende status wordt benoemd, niet stil als geldend behandeld", () => {
  assert.ok(statuslabelVoorBron({}).includes("onbekend"));
  assert.ok(statuslabelVoorBron({ documentstatus: null }).includes("onbekend"));
  assert.ok(statuslabelVoorBron({ documentstatus: "ter_bespreking" }).includes("ter_bespreking"));
});

// ── Voorrangsvolgorde ───────────────────────────────────────────────────────
// Een concept dat óók verlopen is, is in de eerste plaats een concept.
test("documentstatus wint van bronstatus wint van geldigheid", () => {
  assert.ok(
    statuslabelVoorBron(
      { documentstatus: "concept", bronstatus: "historisch", geldig_tot: "2020-01-01" },
      "2026-08-12"
    ).includes("concept")
  );
  assert.ok(
    statuslabelVoorBron(
      { documentstatus: "vastgesteld", bronstatus: "historisch", geldig_tot: "2020-01-01" },
      "2026-08-12"
    ).includes("niet-actuele bron")
  );
  assert.ok(
    statuslabelVoorBron(
      { documentstatus: "van_kracht", bronstatus: "actief", geldig_tot: "2020-01-01" },
      "2026-08-12"
    ).includes("verlopen")
  );
});

// ── Zonder peildatum doen we geen uitspraak over geldigheid ─────────────────
test("geen peildatum: geldig_tot wordt niet beoordeeld", () => {
  assert.equal(
    statuslabelVoorBron({ documentstatus: "vastgesteld", geldig_tot: "2020-01-01" }),
    ""
  );
});

// ── Koppeling met de bron van waarheid ──────────────────────────────────────
// Wordt ACTUELE_BRON_STATUSSEN ooit uitgebreid zonder dat deze module meebeweegt,
// dan valt dat hier om: een nieuwe geldende status zou anders een label krijgen.
test("elke ACTUELE_BRON_STATUS blijft labelloos", () => {
  for (const s of ACTUELE_BRON_STATUSSEN) {
    assert.equal(
      statuslabelVoorBron({ documentstatus: s }),
      "",
      `status ${s} geldt als actueel en hoort geen label te krijgen`
    );
  }
});

console.log(`\n${n} checks groen (documentstatus-label).`);
