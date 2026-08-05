// ============================================================
//  Sanity-tests voor de T4-fonds-discipline in lib/rag.ts.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/rag-fondsdiscipline.sanity.ts
//
//  Verifieert de PURE app-guard (defense-in-depth náást RLS + de RPC-fondsfilter):
//    • isPublishedGeneriek — published-only-regel voor generieke bronnen (T13/T14)
//    • handhaafFondsdiscipline — fondsgrens (T11/T12) + published-generiek + telling
//
//  Deze functies vormen de laatste expliciete laag op ELK retrievalpad (ook de
//  PostgREST-fallback en haalDocumentChunks, die niet door de RPC lopen). De
//  negatieve DB-tests (fondsgrens onder échte RLS) staan in
//  supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql.
// ============================================================

import assert from "node:assert/strict";
import {
  isPublishedGeneriek,
  handhaafFondsdiscipline,
  type DocumentChunk,
} from "./rag";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const FONDS_A = "11111111-1111-1111-1111-111111111111";
const FONDS_B = "22222222-2222-2222-2222-222222222222";

// Bouwt een minimale DocumentChunk met de voor de guard relevante documenten-velden.
function chunk(
  id: string,
  doc: Partial<DocumentChunk["documenten"]> & { bibliotheek: string }
): DocumentChunk {
  return {
    id,
    document_id: `doc-${id}`,
    tekst: "tekst",
    pagina: null,
    paragraaf: null,
    chunk_index: 0,
    documenten: {
      titel: "Titel",
      bron: "Bron",
      opslag_pad: null,
      ...doc,
    },
  };
}

console.log("rag-fondsdiscipline sanity-tests:");

// ── isPublishedGeneriek ─────────────────────────────────────────────────────
check("isPublishedGeneriek: niet-generiek → altijd true (regel n.v.t.)", () => {
  assert.equal(
    isPublishedGeneriek(chunk("a", { bibliotheek: "fonds", documentstatus: "concept" })),
    true
  );
});

check("isPublishedGeneriek: generiek van_kracht+actief → true", () => {
  assert.equal(
    isPublishedGeneriek(
      chunk("b", { bibliotheek: "generiek", documentstatus: "van_kracht", bronstatus: "actief" })
    ),
    true
  );
});

check("isPublishedGeneriek: generiek van_kracht + bronstatus NULL → true (NULL≡actief)", () => {
  assert.equal(
    isPublishedGeneriek(
      chunk("c", { bibliotheek: "generiek", documentstatus: "van_kracht", bronstatus: null })
    ),
    true
  );
});

check("isPublishedGeneriek: generiek gearchiveerd → false (T13)", () => {
  assert.equal(
    isPublishedGeneriek(
      chunk("d", { bibliotheek: "generiek", documentstatus: "gearchiveerd", bronstatus: "actief" })
    ),
    false
  );
});

check("isPublishedGeneriek: generiek van_kracht + bronstatus uitgesloten → false (T14)", () => {
  assert.equal(
    isPublishedGeneriek(
      chunk("e", { bibliotheek: "generiek", documentstatus: "van_kracht", bronstatus: "uitgesloten" })
    ),
    false
  );
});

check("isPublishedGeneriek: generiek zonder documentstatus → false (fail-closed)", () => {
  assert.equal(
    isPublishedGeneriek(chunk("f", { bibliotheek: "generiek", documentstatus: null })),
    false
  );
});

// ── handhaafFondsdiscipline: fondsgrens (T11/T12) ───────────────────────────
check("fondsgrens: eigen fonds behouden, vreemd fonds gedropt", () => {
  const chunks = [
    chunk("eigen", { bibliotheek: "fonds", fonds_id: FONDS_A }),
    chunk("vreemd", { bibliotheek: "fonds", fonds_id: FONDS_B }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A);
  assert.equal(r.chunks.length, 1);
  assert.equal(r.chunks[0].id, "eigen");
  assert.equal(r.gedropt, 1);
});

check("fondsgrens: fondschunk met ontbrekend fonds_id → gedropt (fail-closed)", () => {
  const chunks = [chunk("leeg", { bibliotheek: "fonds", fonds_id: null })];
  const r = handhaafFondsdiscipline(chunks, FONDS_A);
  assert.equal(r.chunks.length, 0);
  assert.equal(r.gedropt, 1);
});

check("fondsgrens: generieke chunk overleeft de fondsgrens (gedeelde laag)", () => {
  const chunks = [
    chunk("gen", {
      bibliotheek: "generiek",
      fonds_id: null,
      documentstatus: "van_kracht",
      bronstatus: "actief",
    }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A);
  assert.equal(r.chunks.length, 1);
  assert.equal(r.gedropt, 0);
});

check("fondsFilter=null → fondsgrens overgeslagen (RLS-only, geen regressie)", () => {
  const chunks = [
    chunk("a", { bibliotheek: "fonds", fonds_id: FONDS_A }),
    chunk("b", { bibliotheek: "fonds", fonds_id: FONDS_B }),
  ];
  const r = handhaafFondsdiscipline(chunks, null);
  assert.equal(r.chunks.length, 2);
  assert.equal(r.gedropt, 0);
});

// ── handhaafFondsdiscipline: published-generiek is fonds-onafhankelijk ──────
check("published-generiek geldt ook bij fondsFilter=null", () => {
  const chunks = [
    chunk("pub", {
      bibliotheek: "generiek",
      documentstatus: "van_kracht",
      bronstatus: "actief",
    }),
    chunk("oud", {
      bibliotheek: "generiek",
      documentstatus: "gearchiveerd",
      bronstatus: "actief",
    }),
  ];
  const r = handhaafFondsdiscipline(chunks, null);
  assert.equal(r.chunks.length, 1);
  assert.equal(r.chunks[0].id, "pub");
  assert.equal(r.gedropt, 1);
});

check("gecombineerd: eigen fonds + published generiek blijven, rest gedropt", () => {
  const chunks = [
    chunk("eigen", { bibliotheek: "fonds", fonds_id: FONDS_A }),
    chunk("vreemd", { bibliotheek: "fonds", fonds_id: FONDS_B }),
    chunk("gen-pub", {
      bibliotheek: "generiek",
      documentstatus: "van_kracht",
      bronstatus: "actief",
    }),
    chunk("gen-oud", {
      bibliotheek: "generiek",
      documentstatus: "alleen_historisch",
      bronstatus: "actief",
    }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A);
  const ids = r.chunks.map((c) => c.id).sort();
  assert.deepEqual(ids, ["eigen", "gen-pub"]);
  assert.equal(r.gedropt, 2);
});

check("lege input → lege output, gedropt 0", () => {
  const r = handhaafFondsdiscipline([], FONDS_A);
  assert.equal(r.chunks.length, 0);
  assert.equal(r.gedropt, 0);
});

// ── handhaafFondsdiscipline: regel 4 — actualiteitspariteit fonds (B-02) ─────
const PEIL = "2026-08-05";

check("regel4: fonds concept + modus 'actueel' → gedropt", () => {
  const chunks = [
    chunk("concept", { bibliotheek: "fonds", fonds_id: FONDS_A, documentstatus: "concept", bronstatus: "actief" }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A, PEIL, "actueel");
  assert.equal(r.chunks.length, 0);
  assert.equal(r.gedropt, 1);
});

check("regel4: fonds concept + modus 'besluitvorming' → behouden (geen regressie)", () => {
  const chunks = [
    chunk("concept", { bibliotheek: "fonds", fonds_id: FONDS_A, documentstatus: "concept", bronstatus: "actief" }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A, PEIL, "besluitvorming");
  assert.equal(r.chunks.length, 1);
  assert.equal(r.gedropt, 0);
});

check("regel4: fonds concept + géén modus → behouden (default, geen regressie)", () => {
  const chunks = [
    chunk("concept", { bibliotheek: "fonds", fonds_id: FONDS_A, documentstatus: "concept", bronstatus: "actief" }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A, PEIL);
  assert.equal(r.chunks.length, 1);
  assert.equal(r.gedropt, 0);
});

check("regel4: fonds vastgesteld + actief + modus 'actueel' → behouden", () => {
  const chunks = [
    chunk("vast", { bibliotheek: "fonds", fonds_id: FONDS_A, documentstatus: "vastgesteld", bronstatus: "actief" }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A, PEIL, "actueel");
  assert.equal(r.chunks.length, 1);
  assert.equal(r.gedropt, 0);
});

check("regel4: fonds vastgesteld + geldig_tot verstreken + modus 'actueel' → gedropt", () => {
  const chunks = [
    chunk("verlopen", {
      bibliotheek: "fonds", fonds_id: FONDS_A,
      documentstatus: "vastgesteld", bronstatus: "actief", geldig_tot: "2020-01-01",
    }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A, PEIL, "actueel");
  assert.equal(r.chunks.length, 0);
  assert.equal(r.gedropt, 1);
});

check("regel4: generiek onder modus 'actueel' blijft door regel 2 geregeld (published behouden)", () => {
  const chunks = [
    chunk("gen", { bibliotheek: "generiek", documentstatus: "van_kracht", bronstatus: "actief" }),
  ];
  const r = handhaafFondsdiscipline(chunks, FONDS_A, PEIL, "actueel");
  assert.equal(r.chunks.length, 1);
  assert.equal(r.gedropt, 0);
});

console.log(`\n${n} sanity-tests geslaagd.`);
