// ============================================================
//  Sanity-tests voor core/lib/portaalcontext.ts (AI-startpunt P1, besluit 0085).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/portaalcontext.sanity.ts
//  Verifieert de PURE afleidingslogica (geen DB): eigen-inbreng-telling +
//  eerste-punt-selectie, en het weglaten van lege contextkaarten.
// ============================================================

import assert from "node:assert/strict";
// Importeer uit de PURE afleidingsmodule (niet uit ./portaalcontext, dat
// `server-only` laadt en niet los onder tsx draait).
import {
  telEigenInbreng,
  startpuntKaarten,
  heeftEnigeContext,
  type PortaalContext,
} from "./portaalcontext-afleiding";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("portaalcontext sanity-tests:");

const AP = [
  { id: "a1", titel: "Beleggingsbeleid" },
  { id: "a2", titel: "Jaarrekening" },
  { id: "a3", titel: "Mededelingen" },
];

// ── telEigenInbreng: tellingen + eerste-selectie ────────────────────────────
check("geen eigen inbreng → alle punten zonder inbreng, eerste = eerste punt", () => {
  const t = telEigenInbreng(AP, []);
  assert.equal(t.totaal, 3);
  assert.equal(t.zonderEigenInbreng, 3);
  assert.deepEqual(t.eersteZonderInbreng, { id: "a1", titel: "Beleggingsbeleid" });
});

check("deels eigen inbreng → telt alleen resterende, eerste = eerste resterende", () => {
  const t = telEigenInbreng(AP, ["a1"]);
  assert.equal(t.totaal, 3);
  assert.equal(t.zonderEigenInbreng, 2);
  assert.deepEqual(t.eersteZonderInbreng, { id: "a2", titel: "Jaarrekening" });
});

check("volledig voorbereid → 0 zonder inbreng, eerste = null", () => {
  const t = telEigenInbreng(AP, ["a1", "a2", "a3"]);
  assert.equal(t.totaal, 3);
  assert.equal(t.zonderEigenInbreng, 0);
  assert.equal(t.eersteZonderInbreng, null);
});

check("dubbele inbreng-id's tellen niet dubbel af (set-semantiek)", () => {
  const t = telEigenInbreng(AP, ["a1", "a1", "a1"]);
  assert.equal(t.zonderEigenInbreng, 2);
});

check("inbreng-id's die geen agendapunt zijn worden genegeerd", () => {
  const t = telEigenInbreng(AP, ["onbekend", "a2"]);
  assert.equal(t.zonderEigenInbreng, 2);
  assert.deepEqual(t.eersteZonderInbreng, { id: "a1", titel: "Beleggingsbeleid" });
});

check("lege agendapuntlijst → 0/0/null (geen crash)", () => {
  const t = telEigenInbreng([], []);
  assert.equal(t.totaal, 0);
  assert.equal(t.zonderEigenInbreng, 0);
  assert.equal(t.eersteZonderInbreng, null);
});

// ── startpuntKaarten: lege kaarten weglaten ─────────────────────────────────
const LEEG: PortaalContext = {
  volgendeVergadering: null,
  agendapunten: { totaal: 0, zonderEigenInbreng: 0, eersteZonderInbreng: null },
  openStappen: [],
  recentDocument: null,
};

check("geen enkele context → geen kaarten, heeftEnigeContext=false", () => {
  assert.deepEqual(startpuntKaarten(LEEG), []);
  assert.equal(heeftEnigeContext(LEEG), false);
});

check("alleen vergadering → alleen die kaart", () => {
  const ctx: PortaalContext = {
    ...LEEG,
    volgendeVergadering: { id: "v1", titel: "Bestuur", datum: "2026-08-01", locatie: null },
  };
  assert.deepEqual(startpuntKaarten(ctx), ["vergadering"]);
  assert.equal(heeftEnigeContext(ctx), true);
});

check("alle drie aanwezig → drie kaarten in vaste volgorde", () => {
  const ctx: PortaalContext = {
    volgendeVergadering: { id: "v1", titel: "Bestuur", datum: "2026-08-01", locatie: "Zeist" },
    agendapunten: { totaal: 2, zonderEigenInbreng: 1, eersteZonderInbreng: { id: "a2", titel: "X" } },
    openStappen: [
      { id: "s1", naam: "Stap", deadline: null, procedure_id: "p1", procedure_titel: "Proc" },
    ],
    recentDocument: { id: "d1", titel: "Notitie", aangemaakt: "2026-07-20" },
  };
  assert.deepEqual(startpuntKaarten(ctx), ["vergadering", "procedurestap", "document"]);
});

check("vergadering ontbreekt maar stap+document wel → twee kaarten, volgorde behouden", () => {
  const ctx: PortaalContext = {
    ...LEEG,
    openStappen: [
      { id: "s1", naam: "Stap", deadline: null, procedure_id: "p1", procedure_titel: "Proc" },
    ],
    recentDocument: { id: "d1", titel: "Notitie", aangemaakt: "2026-07-20" },
  };
  assert.deepEqual(startpuntKaarten(ctx), ["procedurestap", "document"]);
});

console.log(`\n${n} sanity-tests geslaagd.`);
