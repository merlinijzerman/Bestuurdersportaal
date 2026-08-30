// ============================================================
//  Sanity-tests voor de dossierstatus-mapping (Increment B, TO §3.2).
//
//  Dit is de TS-spiegel van de SQL-functie
//  `public.fn_dossierstatus_van_decision`. We toetsen voor ELK van de
//  18 Decision Object-statussen de verwachte dossierstatus + sublabel,
//  plus de fallback-cases en de tijdlijnfase-afleiding.
//
//  De viewtest hoort 1-op-1 met de DB-mapping overeen te komen; deze
//  TS-tabel is de leesbare bron-van-waarheid voor die verwachting.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/dossier.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  dossierstatusVanDecision,
  tijdlijnfaseVanStap,
  type DossierStatus,
} from "./dossier";
import type { DecisionStatus } from "./decision-view";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("dossier sanity-tests:");

// Verwachting per DO-status — exact de tabel uit TO v1.2 §3.2.
const verwacht: Record<
  DecisionStatus,
  { dossierstatus: DossierStatus; sublabel: string | null }
> = {
  concept: { dossierstatus: "lopend", sublabel: null },
  in_onderbouwing: { dossierstatus: "lopend", sublabel: null },
  in_validatie: { dossierstatus: "lopend", sublabel: null },
  in_review: { dossierstatus: "lopend", sublabel: null },
  geagendeerd: { dossierstatus: "ter_besluitvorming", sublabel: null },
  in_bespreking: { dossierstatus: "ter_besluitvorming", sublabel: null },
  besloten: { dossierstatus: "besloten", sublabel: null },
  voorwaardelijk_besloten: {
    dossierstatus: "besloten",
    sublabel: "voorwaardelijk",
  },
  in_uitvoering: { dossierstatus: "in_implementatie", sublabel: null },
  in_evaluatie: { dossierstatus: "in_implementatie", sublabel: "in evaluatie" },
  afgesloten: { dossierstatus: "afgerond", sublabel: null },
  heropend: { dossierstatus: "heropend", sublabel: null },
  afgewezen: { dossierstatus: "afgerond", sublabel: "afgewezen" },
  geannuleerd: { dossierstatus: "afgerond", sublabel: "geannuleerd" },
  teruggezet: { dossierstatus: "lopend", sublabel: "teruggezet" },
  geescaleerd: { dossierstatus: "lopend", sublabel: "geëscaleerd" },
  aangehouden: { dossierstatus: "lopend", sublabel: "aangehouden" },
  beeindigd: { dossierstatus: "beeindigd", sublabel: "beëindigd" },
};

const alle18 = Object.keys(verwacht) as DecisionStatus[];

test("alle 18 Decision Object-statussen zijn gedekt", () => {
  assert.equal(alle18.length, 18, "verwacht 18 statussen");
});

for (const status of alle18) {
  test(`${status} → ${verwacht[status].dossierstatus}${
    verwacht[status].sublabel ? ` (${verwacht[status].sublabel})` : ""
  }`, () => {
    const r = dossierstatusVanDecision(status);
    assert.equal(r.dossierstatus, verwacht[status].dossierstatus);
    assert.equal(r.sublabel, verwacht[status].sublabel);
  });
}

test("onbekende DO-status levert geen afleiding (null/null)", () => {
  const r = dossierstatusVanDecision("iets_onbekends");
  assert.equal(r.dossierstatus, null);
  assert.equal(r.sublabel, null);
});

// ── Tijdlijnfase-afleiding ────────────────────────────────────────────

test("6-staps model valt 1-op-1 op de zes fases", () => {
  const fases = [1, 2, 3, 4, 5, 6].map((v) => tijdlijnfaseVanStap(v, 6));
  assert.deepEqual(fases, [
    "orientatie",
    "analyse",
    "advies",
    "besluitvorming",
    "implementatie",
    "evaluatie",
  ]);
});

test("eerste stap = oriëntatie, laatste stap = evaluatie (willekeurig totaal)", () => {
  for (const totaal of [2, 4, 9]) {
    assert.equal(tijdlijnfaseVanStap(1, totaal), "orientatie");
    assert.equal(tijdlijnfaseVanStap(totaal, totaal), "evaluatie");
  }
});

test("één stap valt op oriëntatie (geen deling door nul)", () => {
  assert.equal(tijdlijnfaseVanStap(1, 1), "orientatie");
});

console.log(`\n${n} sanity-tests geslaagd.`);
