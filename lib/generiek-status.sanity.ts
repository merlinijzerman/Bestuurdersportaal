// ============================================================
//  Sanity-tests voor lib/generiek-status.ts (Increment T6).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/generiek-status.sanity.ts
//
//  Kernbewijs (acceptatiecriterium T6): de canonieke `published` valt EXACT
//  samen met de 0045/T4-retrieval-gate (lib/rag.ts::isPublishedGeneriek). We
//  toetsen dat programmatisch over de VOLLEDIGE status × bronstatus-matrix:
//  isActueleGeneriekeBron ⇔ isPublishedGeneriek. Zo kan de contentlaag-definitie
//  niet ongemerkt divergeren van het retrievalpad.
// ============================================================

import assert from "node:assert/strict";
import { isPublishedGeneriek, type DocumentChunk } from "./rag";
import {
  generiekGeldigheidsstatus,
  isActueleGeneriekeBron,
  GENERIEKE_GELDIGHEIDSSTATUS,
} from "./generiek-status";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Bouwt een generieke chunk met de denorm status/bronstatus die isPublishedGeneriek leest.
function generiekeChunk(
  status: string | null,
  bronstatus: string | null
): DocumentChunk {
  return {
    id: "c",
    document_id: "d",
    tekst: "tekst",
    pagina: null,
    paragraaf: null,
    chunk_index: 0,
    documenten: {
      titel: "Titel",
      bron: "DNB",
      opslag_pad: null,
      bibliotheek: "generiek",
      fonds_id: null,
      documentstatus: status,
      bronstatus,
    },
  };
}

const ALLE_STATUS = [
  "concept",
  "ter_bespreking",
  "ter_besluitvorming",
  "vastgesteld",
  "van_kracht",
  "vervangen",
  "alleen_historisch",
  "gearchiveerd",
  null,
];
const ALLE_BRONSTATUS = ["actief", "historisch", "uitgesloten", "actief_na_vaststelling", null];

console.log("generiek-status sanity-tests:");

// ── 1. published valt 1-op-1 samen met de 0045-gate (volledige matrix) ───────
check("isActueleGeneriekeBron ⇔ isPublishedGeneriek over de volledige matrix", () => {
  for (const status of ALLE_STATUS) {
    for (const bronstatus of ALLE_BRONSTATUS) {
      const gate = isPublishedGeneriek(generiekeChunk(status, bronstatus));
      const canon = isActueleGeneriekeBron({ status, bronstatus });
      assert.equal(
        canon,
        gate,
        `divergentie bij status=${status} bronstatus=${bronstatus}: canon=${canon} gate=${gate}`
      );
      // en: published ⇔ actueel
      assert.equal(generiekGeldigheidsstatus({ status, bronstatus }) === "published", gate);
    }
  }
});

// ── 2. published exact = van_kracht + (actief | NULL) ────────────────────────
check("published ≡ status='van_kracht' AND coalesce(bronstatus,'actief')='actief'", () => {
  assert.equal(generiekGeldigheidsstatus({ status: "van_kracht", bronstatus: "actief" }), "published");
  assert.equal(generiekGeldigheidsstatus({ status: "van_kracht", bronstatus: null }), "published");
  assert.equal(generiekGeldigheidsstatus({ status: "van_kracht", bronstatus: "historisch" }), "deprecated");
  assert.equal(generiekGeldigheidsstatus({ status: "van_kracht", bronstatus: "uitgesloten" }), "withdrawn");
});

// ── 3. withdrawn = hardste uitsluiting (gearchiveerd of bronstatus uitgesloten)
check("withdrawn ≡ gearchiveerd OF bronstatus='uitgesloten'", () => {
  assert.equal(generiekGeldigheidsstatus({ status: "gearchiveerd", bronstatus: "actief" }), "withdrawn");
  assert.equal(generiekGeldigheidsstatus({ status: "concept", bronstatus: "uitgesloten" }), "withdrawn");
});

// ── 4. deprecated = verouderd maar leesbaar als historie ─────────────────────
check("deprecated ≡ vervangen/alleen_historisch OF bronstatus='historisch'", () => {
  assert.equal(generiekGeldigheidsstatus({ status: "vervangen", bronstatus: "actief" }), "deprecated");
  assert.equal(generiekGeldigheidsstatus({ status: "alleen_historisch", bronstatus: "actief" }), "deprecated");
  assert.equal(generiekGeldigheidsstatus({ status: "vastgesteld", bronstatus: "historisch" }), "deprecated");
});

// ── 5. draft = al het overige (nog niet gepubliceerd) ────────────────────────
check("draft ≡ concept/ter_bespreking/ter_besluitvorming/vastgesteld (nog niet published)", () => {
  for (const status of ["concept", "ter_bespreking", "ter_besluitvorming", "vastgesteld", null]) {
    assert.equal(generiekGeldigheidsstatus({ status, bronstatus: "actief" }), "draft");
  }
});

// ── 6. de mapping levert altijd één van de vier canonieke waarden ────────────
check("mapping is totaal: elke combinatie geeft een canonieke waarde", () => {
  for (const status of ALLE_STATUS) {
    for (const bronstatus of ALLE_BRONSTATUS) {
      const s = generiekGeldigheidsstatus({ status, bronstatus });
      assert.ok((GENERIEKE_GELDIGHEIDSSTATUS as readonly string[]).includes(s), `onbekende status: ${s}`);
    }
  }
});

console.log(`\n${n} sanity-checks geslaagd.`);
