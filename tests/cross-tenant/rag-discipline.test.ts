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
//   T15 — parent-retrieval (R1.6): de sibling-fetch mag nooit chunks van een
//         ander fonds of niet-gepubliceerde generieke chunks in de aangeleverde
//         passage trekken (de directe .from()-route mist de RPC-poort; de guard
//         draait daarom óók op de siblings).
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
import { verrijkMetParents, type SiblingRij } from "../../core/lib/parent-context";
import { resolveerGenoemdDocument } from "../../core/lib/vraagrouter";

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

test("T14a — genoemde documentscope kan alleen uit de RLS-zichtbare set komen", () => {
  // De chatroute geeft uitsluitend de onder RLS opgehaalde titels aan de pure
  // resolver. Die resolver genereert geen id en kan dus nooit het weggelaten
  // vreemd-fondsdocument kiezen, ook niet bij een letterlijke titelmatch.
  const zichtbaarVoorA = [{ id: "doc-a", titel: "Transitieplan fonds A" }];
  const uitkomst = resolveerGenoemdDocument(
    "Toets de Geheime ALM-studie van fonds B volledig",
    zichtbaarVoorA
  );
  assert.deepEqual(uitkomst, { status: "geen" });
});

// ── T15 — parent-retrieval sibling-fetch respecteert de fondsgrens ───────────
// Bouwt een gemengde sibling-set (zoals een theoretische RLS-lek zou opleveren):
// eigen-fonds siblings + een vreemd-fonds chunk + een gearchiveerde generieke
// chunk, allemaal onder hetzelfde structuur_label. verrijkMetParents moet alleen
// de eigen-fonds tekst in de aangeleverde passage samenvoegen.
function sibling(
  id: string,
  tekst: string,
  doc: Partial<DocumentChunk["documenten"]> & { bibliotheek: string },
  chunk_index = 0,
  structuur_label: string | null = "Artikel 5"
): SiblingRij {
  return {
    id,
    document_id: "d1",
    tekst,
    pagina: null,
    paragraaf: null,
    chunk_index,
    structuur_type: "artikel",
    structuur_label,
    documenten: { titel: "Titel", bron: "Bron", opslag_pad: null, ...doc },
  };
}

// Fake-Supabase die de gemengde rijen aan de fetch-orchestrator teruggeeft.
function fakeOpties(rows: SiblingRij[]): Parameters<typeof verrijkMetParents>[3] {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = () => Promise.resolve({ data: rows, error: null });
  return { supabase: { from: () => builder } } as unknown as Parameters<
    typeof verrijkMetParents
  >[3];
}

test("T15 — parent-retrieval trekt nooit vreemd-fonds of niet-published generiek in de passage", async () => {
  const eigenA = sibling("hit", "ART5-EIGEN-A.", { bibliotheek: "fonds", fonds_id: FONDS_A }, 0);
  const eigenB = sibling("sib", "ART5-EIGEN-B.", { bibliotheek: "fonds", fonds_id: FONDS_A }, 1);
  const vreemdB = sibling("leak", "ART5-LEK-B.", { bibliotheek: "fonds", fonds_id: FONDS_B }, 2);
  const genOud = sibling(
    "gen",
    "ART5-GENERIEK-OUD.",
    { bibliotheek: "generiek", fonds_id: null, documentstatus: "gearchiveerd", bronstatus: "actief" },
    3
  );

  const treffer: DocumentChunk = {
    id: "hit",
    document_id: "d1",
    tekst: "ART5-EIGEN-A.",
    pagina: null,
    paragraaf: null,
    chunk_index: 0,
    documenten: { titel: "Titel", bron: "Bron", opslag_pad: null, bibliotheek: "fonds", fonds_id: FONDS_A },
  };

  const res = await verrijkMetParents(
    [treffer],
    FONDS_A,
    "2026-07-15",
    fakeOpties([eigenA, eigenB, vreemdB, genOud])
  );

  const passage = res.chunks[0].aangeleverde_passage ?? "";
  assert.ok(passage.includes("ART5-EIGEN-A"), "eigen-fonds treffer aanwezig");
  assert.ok(passage.includes("ART5-EIGEN-B"), "eigen-fonds sibling aanwezig");
  assert.ok(!passage.includes("LEK-B"), "vreemd-fonds sibling NIET bijgehaald");
  assert.ok(!passage.includes("GENERIEK-OUD"), "niet-published generiek NIET bijgehaald");
});
