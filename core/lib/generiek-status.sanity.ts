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
  GENERIEKE_TRANSITIES,
  generiekTransitieToegestaan,
  generiekTransitieRedenplicht,
  isReviewVerlopen,
  reviewSignaal,
  type GeneriekeGeldigheidsstatus,
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
  "vastgesteld",
  "van_kracht",
  "historisch",
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
check("deprecated ≡ status='historisch' OF bronstatus='historisch'", () => {
  assert.equal(generiekGeldigheidsstatus({ status: "historisch", bronstatus: "actief" }), "deprecated");
  assert.equal(generiekGeldigheidsstatus({ status: "vastgesteld", bronstatus: "historisch" }), "deprecated");
});

// ── 5. draft = al het overige (nog niet gepubliceerd) ────────────────────────
check("draft ≡ concept/vastgesteld (nog niet published)", () => {
  for (const status of ["concept", "vastgesteld", null]) {
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

// ── 7. T10 — canonieke toestandsmachine: exact de toegestane overgangen ──────
const ALLE_CANON: GeneriekeGeldigheidsstatus[] = [
  "draft",
  "published",
  "deprecated",
  "withdrawn",
];
const TOEGESTAAN = new Set(GENERIEKE_TRANSITIES.map((t) => `${t.van}→${t.naar}`));

check("generiekTransitieToegestaan matcht exact de tabel (en no-op = false)", () => {
  for (const van of ALLE_CANON) {
    for (const naar of ALLE_CANON) {
      const verwacht = van !== naar && TOEGESTAAN.has(`${van}→${naar}`);
      assert.equal(
        generiekTransitieToegestaan(van, naar),
        verwacht,
        `overgang ${van}→${naar}: verwacht ${verwacht}`
      );
    }
  }
});

check("withdrawn is terminaal en verboden sprongen worden geweigerd", () => {
  for (const naar of ALLE_CANON) {
    assert.equal(generiekTransitieToegestaan("withdrawn", naar), false, `withdrawn→${naar}`);
  }
  // draft→deprecated en draft→withdrawn zijn geen geldige paden.
  assert.equal(generiekTransitieToegestaan("draft", "deprecated"), false);
  assert.equal(generiekTransitieToegestaan("draft", "withdrawn"), false);
  // herpublicatie mag; herpublicatie vanuit withdrawn niet.
  assert.equal(generiekTransitieToegestaan("deprecated", "published"), true);
  assert.equal(generiekTransitieToegestaan("withdrawn", "published"), false);
});

check("reden verplicht op de risicovolle overgangen (niet op draft→published)", () => {
  assert.equal(generiekTransitieRedenplicht("draft", "published"), false);
  assert.equal(generiekTransitieRedenplicht("published", "deprecated"), true);
  assert.equal(generiekTransitieRedenplicht("published", "withdrawn"), true);
  assert.equal(generiekTransitieRedenplicht("deprecated", "withdrawn"), true);
  assert.equal(generiekTransitieRedenplicht("deprecated", "published"), true);
});

// ── 8. T10 — review-verval (read-time; NULL = niet afgedwongen) ───────────────
check("isReviewVerlopen: verleden = true, toekomst/gelijk/NULL = false", () => {
  assert.equal(isReviewVerlopen("2020-01-01", "2026-07-10"), true);
  assert.equal(isReviewVerlopen("2026-07-10", "2026-07-10"), false); // gelijk = niet verlopen
  assert.equal(isReviewVerlopen("2030-01-01", "2026-07-10"), false);
  assert.equal(isReviewVerlopen(null, "2026-07-10"), false);
  assert.equal(isReviewVerlopen(undefined, "2026-07-10"), false);
});

check("reviewSignaal: verlopen/nadert/geen_datum/actueel", () => {
  const peil = "2026-07-10";
  assert.equal(reviewSignaal("2026-07-09", peil), "verlopen");
  assert.equal(reviewSignaal("2026-07-20", peil, 30), "nadert"); // binnen 30 dagen
  assert.equal(reviewSignaal("2027-07-10", peil, 30), "actueel"); // ruim buiten horizon
  assert.equal(reviewSignaal(null, peil), "geen_datum");
});

console.log(`\n${n} sanity-checks geslaagd.`);
