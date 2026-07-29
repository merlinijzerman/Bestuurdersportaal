// ============================================================
//  Sanity-tests voor core/lib/startvragen.ts (P2 Deel A).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/startvragen.sanity.ts
//  Verifieert de PURE vragenpool: generatoren vullen uit al-geladen context,
//  de selectie toont max drie met verschillende vraagsoort en signaal bovenaan,
//  en er wordt nooit generieke tekst gemaakt.
// ============================================================

import assert from "node:assert/strict";
import type { PortaalContext } from "./portaalcontext-afleiding";
import {
  genereerContextvragen,
  genereerSignaalvragen,
  kiesStartvragen,
  startvragenVoor,
  NADEREND_DAGEN,
  type Startvraag,
} from "./startvragen";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("startvragen sanity-tests:");

const NU = new Date("2026-07-29T10:00:00.000Z").getTime();

const VOL: PortaalContext = {
  volgendeVergadering: { id: "v1", titel: "Bestuursvergadering augustus", datum: "2026-08-10", locatie: null },
  agendapunten: {
    totaal: 3,
    zonderEigenInbreng: 2,
    eersteZonderInbreng: { id: "a2", titel: "Wijziging beleggingsbeleid ESG" },
  },
  openStappen: [
    {
      id: "s1",
      naam: "Implementatie & evaluatie",
      // 10 dagen na NU → binnen de naderend-horizon.
      deadline: "2026-08-08T10:00:00.000Z",
      procedure_id: "p1",
      procedure_titel: "Beleggingsbeleid",
    },
  ],
  recentDocument: { id: "d1", titel: "Actuarieel rapport Q2 2026", aangemaakt: "2026-07-20" },
};

const LEEG: PortaalContext = {
  volgendeVergadering: null,
  agendapunten: { totaal: 0, zonderEigenInbreng: 0, eersteZonderInbreng: null },
  openStappen: [],
  recentDocument: null,
};

// ── generatoren vullen uit al-geladen titels ────────────────────────────────
check("contextgenerator vult uit titels; alle bron=context", () => {
  const v = genereerContextvragen(VOL);
  assert.ok(v.length >= 2);
  assert.ok(v.every((x) => x.bron === "context"));
  // Titels moeten letterlijk terugkomen (geen generieke placeholder).
  assert.ok(v.some((x) => x.tekst.includes("Wijziging beleggingsbeleid ESG")));
  assert.ok(v.some((x) => x.tekst.includes("Actuarieel rapport Q2 2026")));
});

check("koppeling: documentvraag → document-scope, agendapuntvraag → agendapunt", () => {
  const v = genereerContextvragen(VOL);
  const docVraag = v.find((x) => x.tekst.includes("Actuarieel rapport Q2 2026"));
  const apVraag = v.find((x) => x.tekst.includes("Welk besluit wordt gevraagd"));
  assert.deepEqual(docVraag?.koppeling, {
    soort: "document",
    id: "d1",
    titel: "Actuarieel rapport Q2 2026",
  });
  assert.deepEqual(apVraag?.koppeling, {
    soort: "agendapunt",
    id: "a2",
    titel: "Wijziging beleggingsbeleid ESG",
  });
  // De processtap-vraag heeft geen koppeling (geen scope).
  const stapVraag = v.find((x) => x.tekst.includes("Implementatie & evaluatie"));
  assert.equal(stapVraag?.koppeling, null);
});

check("signaal-agendapuntvraag draagt de agendapunt-koppeling", () => {
  const v = genereerSignaalvragen(VOL, NU);
  const apSignaal = v.find((x) => x.vraagsoort === "persoonlijke_voorbereiding");
  assert.deepEqual(apSignaal?.koppeling, {
    soort: "agendapunt",
    id: "a2",
    titel: "Wijziging beleggingsbeleid ESG",
  });
});

check("signaalgenerator: agendapunt-zonder-inbreng + naderende deadline", () => {
  const v = genereerSignaalvragen(VOL, NU);
  assert.equal(v.length, 2);
  assert.ok(v.every((x) => x.bron === "signaal"));
  assert.ok(v.some((x) => x.vraagsoort === "persoonlijke_voorbereiding"));
  assert.ok(v.some((x) => x.tekst.includes("deadline over 10 dagen")));
});

check("deadline buiten horizon → geen deadline-signaal", () => {
  const ver: PortaalContext = {
    ...VOL,
    openStappen: [{ ...VOL.openStappen[0], deadline: "2026-12-31T10:00:00.000Z" }],
  };
  const v = genereerSignaalvragen(ver, NU);
  assert.ok(!v.some((x) => x.vraagsoort === "besluitrijpheid"));
});

check("deadline in het verleden telt niet als naderend signaal", () => {
  const ver: PortaalContext = {
    ...VOL,
    openStappen: [{ ...VOL.openStappen[0], deadline: "2026-07-01T10:00:00.000Z" }],
    agendapunten: { totaal: 0, zonderEigenInbreng: 0, eersteZonderInbreng: null },
  };
  const v = genereerSignaalvragen(ver, NU);
  assert.equal(v.length, 0);
});

// ── selectie ─────────────────────────────────────────────────────────────────
check("selectie: max drie", () => {
  const uit = startvragenVoor(VOL, NU);
  assert.ok(uit.length <= 3);
  assert.equal(uit.length, 3);
});

check("selectie: elke getoonde vraag een verschillende vraagsoort (criterium 2)", () => {
  const uit = startvragenVoor(VOL, NU);
  const soorten = uit.map((x) => x.vraagsoort);
  assert.equal(new Set(soorten).size, soorten.length);
});

check("selectie: minstens één signaal zodra er een signaal is (criterium 3)", () => {
  const uit = startvragenVoor(VOL, NU);
  assert.ok(uit.some((x) => x.bron === "signaal"));
  // Signaal weegt zwaarder → staat bovenaan.
  assert.equal(uit[0].bron, "signaal");
});

check("criterium 3 ook bij enkel een agendapunt zonder inbreng (geen deadline)", () => {
  const ctx: PortaalContext = {
    ...LEEG,
    agendapunten: { totaal: 1, zonderEigenInbreng: 1, eersteZonderInbreng: { id: "a1", titel: "Jaarrekening" } },
    recentDocument: { id: "d1", titel: "Jaarverslag 2025", aangemaakt: "2026-07-01" },
  };
  const uit = startvragenVoor(ctx, NU);
  assert.ok(uit.some((x) => x.bron === "signaal"));
});

check("geen context → lege lijst, geen generieke tekst", () => {
  assert.deepEqual(startvragenVoor(LEEG, NU), []);
});

check("kiesStartvragen is stabiel bij gelijk gewicht (invoegvolgorde wint)", () => {
  const pool: Startvraag[] = [
    { tekst: "A", bron: "context", vraagsoort: "feitelijk", gewicht: 50, koppeling: null },
    { tekst: "B", bron: "context", vraagsoort: "duiding", gewicht: 50, koppeling: null },
  ];
  const uit = kiesStartvragen(pool, 3);
  assert.deepEqual(uit.map((x) => x.tekst), ["A", "B"]);
});

check("NADEREND_DAGEN grens is inclusief", () => {
  const opDeGrens = new Date(NU + NADEREND_DAGEN * 86400000).toISOString();
  const ctx: PortaalContext = {
    ...LEEG,
    openStappen: [{ id: "s1", naam: "Stap", deadline: opDeGrens, procedure_id: "p1", procedure_titel: "P" }],
  };
  const v = genereerSignaalvragen(ctx, NU);
  assert.equal(v.length, 1);
});

console.log(`\n${n} sanity-tests geslaagd.`);
