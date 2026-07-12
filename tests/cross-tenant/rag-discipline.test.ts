// ============================================================================
//  §15-matrix — RAG-fondsdiscipline (T11–T14), app-laag.
// ----------------------------------------------------------------------------
//  Ingebundeld uit increment T4 (besluit 0045): de pure app-guard náást RLS +
//  de RPC-fondsfilter. Importeert de bestaande functies uit lib/rag (geen
//  duplicatie van lib/rag-fondsdiscipline.sanity.ts); hier als benoemde §15-
//  scenario's. De DB-kant onder échte RLS staat in
//  supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql.
//
//   T11 — fonds A vraagt data fonds B → geweigerd (alleen generiek + eigen).
//   T12 — gemanipuleerde namespace/fonds_id → server-side genegeerd/gedropt.
//   T13 — generieke published bron door fonds A → toegestaan (read-only).
//   T14 — deprecated/withdrawn generiek → niet als actuele bron.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/rag-discipline.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublishedGeneriek,
  handhaafFondsdiscipline,
  type DocumentChunk,
} from "../../core/lib/rag";

const FONDS_A = "11111111-1111-1111-1111-111111111111";
const FONDS_B = "22222222-2222-2222-2222-222222222222";

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
    documenten: { titel: "Titel", bron: "Bron", opslag_pad: null, ...doc },
  };
}

test("T11 — fonds A ziet nooit chunks van fonds B (fondsgrens)", () => {
  const r = handhaafFondsdiscipline(
    [
      chunk("eigen", { bibliotheek: "fonds", fonds_id: FONDS_A }),
      chunk("vreemd-B", { bibliotheek: "fonds", fonds_id: FONDS_B }),
    ],
    FONDS_A
  );
  assert.deepEqual(r.chunks.map((c) => c.id), ["eigen"]);
  assert.equal(r.gedropt, 1);
});

test("T12 — gespoofte/ontbrekende fonds_id → gedropt (fail-closed, server-side leidend)", () => {
  // Een fondschunk zonder geldig eigen fonds_id overleeft de grens niet, ook
  // niet als andere velden 'kloppen'. De server-side fondsFilter is leidend.
  const r = handhaafFondsdiscipline(
    [
      chunk("gespooft", { bibliotheek: "fonds", fonds_id: FONDS_B }),
      chunk("leeg", { bibliotheek: "fonds", fonds_id: null }),
    ],
    FONDS_A
  );
  assert.equal(r.chunks.length, 0);
  assert.equal(r.gedropt, 2);
});

test("T13 — generieke published bron blijft zichtbaar voor fonds A (read-only)", () => {
  const gen = chunk("gen-pub", {
    bibliotheek: "generiek",
    fonds_id: null,
    documentstatus: "van_kracht",
    bronstatus: "actief",
  });
  assert.equal(isPublishedGeneriek(gen), true);
  const r = handhaafFondsdiscipline([gen], FONDS_A);
  assert.deepEqual(r.chunks.map((c) => c.id), ["gen-pub"]);
  assert.equal(r.gedropt, 0);
});

test("T14 — deprecated/withdrawn generiek telt niet als actuele bron", () => {
  const gearchiveerd = chunk("gen-oud", {
    bibliotheek: "generiek",
    documentstatus: "gearchiveerd",
    bronstatus: "actief",
  });
  const uitgesloten = chunk("gen-uit", {
    bibliotheek: "generiek",
    documentstatus: "van_kracht",
    bronstatus: "uitgesloten",
  });
  assert.equal(isPublishedGeneriek(gearchiveerd), false);
  assert.equal(isPublishedGeneriek(uitgesloten), false);
  const r = handhaafFondsdiscipline([gearchiveerd, uitgesloten], FONDS_A);
  assert.equal(r.chunks.length, 0);
  assert.equal(r.gedropt, 2);
});
