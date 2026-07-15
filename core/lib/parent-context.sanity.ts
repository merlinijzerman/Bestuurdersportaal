// ============================================================
//  Sanity-tests voor lib/parent-context.ts (R1.6 — parent-retrieval).
//
//  Geen testframework in de repo; dit script draait standalone met assert.
//  Uitvoeren: npx tsx lib/parent-context.sanity.ts
//  Verifieert de risicovolle logica: overlap-dedup, samenvoeging in leesvolgorde,
//  per-unit-cap → terugval (null), sibling-selectie (label vs. venster), en de
//  orchestratie (aangeleverde_passage in-place, totaal-cap-terugval) tegen een
//  geïnjecteerde fake-Supabase. De fondsdiscipline-op-siblings zit in de
//  cross-tenant-suite (tests/cross-tenant/rag-discipline.test.ts).
// ============================================================

import assert from "node:assert/strict";
import {
  verwijderOverlap,
  voegSiblingsSamen,
  kiesSiblings,
  verrijkMetParents,
  type SiblingRij,
} from "./parent-context";
import type { DocumentChunk } from "./rag";

const FONDS_A = "11111111-1111-1111-1111-111111111111";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
async function checkA(naam: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function sib(
  id: string,
  document_id: string,
  chunk_index: number,
  tekst: string,
  structuur_type: string | null = "tekst",
  structuur_label: string | null = null
): SiblingRij {
  return {
    id,
    document_id,
    tekst,
    pagina: null,
    paragraaf: null,
    chunk_index,
    structuur_type,
    structuur_label,
    documenten: {
      titel: "Doc",
      bron: "reglement",
      bibliotheek: "fonds",
      opslag_pad: null,
      fonds_id: FONDS_A,
      documentstatus: "van_kracht",
      bronstatus: "actief",
      volgende_review: null,
    },
  };
}

// Fake-Supabase die de meegegeven rijen teruggeeft aan de fetch-orchestrator.
// De hele opties worden bij aanroep gecast (structureel niet gelijk aan de echte
// SupabaseClient; alleen het gebruikte chain-pad wordt nagebootst).
type Opties = NonNullable<Parameters<typeof verrijkMetParents>[3]>;
function fakeOpties(rows: SiblingRij[], extra: Partial<Opties> = {}): Opties {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = () => Promise.resolve({ data: rows, error: null });
  return { supabase: { from: () => builder }, ...extra } as unknown as Opties;
}

async function main() {
  console.log("parent-context sanity-tests:");

  // ── verwijderOverlap ───────────────────────────────────────────────────────
  check("overlap-dedup: staart van A herhaald in B wordt geknipt", () => {
    const a = "Het bestuur besluit tot een aanpassing van het beleid.";
    const b = "van het beleid. De uitvoering start per direct.";
    assert.equal(verwijderOverlap(a, b), " De uitvoering start per direct.");
  });

  check("overlap-dedup: geen overlap → B ongewijzigd", () => {
    assert.equal(verwijderOverlap("abc", "xyz"), "xyz");
  });

  // ── voegSiblingsSamen ──────────────────────────────────────────────────────
  check("samenvoegen in leesvolgorde met dedup", () => {
    const r = voegSiblingsSamen([
      { chunk_index: 1, tekst: "deel twee volgt hierna." },
      { chunk_index: 0, tekst: "deel een. deel twee volgt hierna." },
    ]);
    // Gesorteerd op index: chunk0 dan chunk1; overlap "deel twee volgt hierna."
    assert.equal(r, "deel een. deel twee volgt hierna.");
  });

  check("samenvoegen: losse stukken worden met spatie verbonden", () => {
    const r = voegSiblingsSamen([
      { chunk_index: 0, tekst: "Artikel 5 lid 1." },
      { chunk_index: 1, tekst: "Artikel 5 lid 2." },
    ]);
    assert.equal(r, "Artikel 5 lid 1. Artikel 5 lid 2.");
  });

  check("per-unit-cap overschreden → null (terugval op kale chunk)", () => {
    // Distinct inhoud (geen overlap) zodat de som de cap echt overschrijdt.
    const r = voegSiblingsSamen(
      [
        { chunk_index: 0, tekst: "a".repeat(300) },
        { chunk_index: 1, tekst: "b".repeat(300) },
      ],
      400
    );
    assert.equal(r, null);
  });

  check("lege sibling-set → null", () => {
    assert.equal(voegSiblingsSamen([]), null);
  });

  // ── kiesSiblings ───────────────────────────────────────────────────────────
  check("structuur-unit → siblings op structuur_label", () => {
    const hit = sib("h", "d1", 3, "art5 kern", "artikel", "Artikel 5");
    const doc = [
      sib("a", "d1", 2, "art5 a", "artikel", "Artikel 5"),
      hit,
      sib("b", "d1", 4, "art5 b", "artikel", "Artikel 5"),
      sib("c", "d1", 5, "art6", "artikel", "Artikel 6"),
      sib("v", "d1", 10, "ver weg", "artikel", "Artikel 5"),
    ];
    const s = kiesSiblings(hit, doc).map((c) => c.id);
    assert.deepEqual(s.sort(), ["a", "b", "h", "v"]); // alle Artikel 5, ongeacht afstand
    assert.ok(!s.includes("c"));
  });

  check("tekst-chunk → venster ±1 op chunk_index", () => {
    const hit = sib("h", "d1", 5, "kern", "tekst", null);
    const doc = [
      sib("x", "d1", 3, "te ver"),
      sib("a", "d1", 4, "voor"),
      hit,
      sib("b", "d1", 6, "na"),
      sib("y", "d1", 7, "te ver"),
    ];
    const s = kiesSiblings(hit, doc).map((c) => c.id);
    assert.deepEqual(s.sort(), ["a", "b", "h"]);
  });

  // ── verrijkMetParents (orchestratie met fake-Supabase) ─────────────────────
  await checkA("orchestratie: treffer krijgt aangeleverde_passage", async () => {
    const rows = [
      sib("t1", "d1", 0, "Artikel 5 lid 1.", "artikel", "Artikel 5"),
      sib("t1b", "d1", 1, "Artikel 5 lid 2.", "artikel", "Artikel 5"),
    ];
    // De treffer draagt (net als een echte RPC-treffer) geen structuur_type/-label;
    // de orchestrator leest die uit de gefetchte siblings via het id.
    const { structuur_type: _st, structuur_label: _sl, ...rest } = rows[0];
    const treffer: DocumentChunk = rest;
    const r = await verrijkMetParents([treffer], FONDS_A, "2026-07-15", fakeOpties(rows));
    assert.equal(r.meta.uitgebreid, 1);
    assert.equal(r.chunks[0].aangeleverde_passage, "Artikel 5 lid 1. Artikel 5 lid 2.");
    assert.ok(r.meta.totaal_tekens > 0);
  });

  await checkA("orchestratie: totaal-cap → verdere treffers vallen terug", async () => {
    const rows = [
      sib("t1", "d1", 0, "AAA.", "artikel", "Artikel 1"),
      sib("t1b", "d1", 1, "BBB uitgebreid deel.", "artikel", "Artikel 1"),
      sib("t2", "d2", 0, "CCC.", "artikel", "Artikel 2"),
      sib("t2b", "d2", 1, "DDD uitgebreid deel.", "artikel", "Artikel 2"),
    ];
    const treffers: DocumentChunk[] = [{ ...rows[0] }, { ...rows[2] }];
    const r = await verrijkMetParents(
      treffers,
      FONDS_A,
      "2026-07-15",
      fakeOpties(rows, { totaalCap: 30 }) // alleen de eerste past
    );
    assert.equal(r.meta.uitgebreid, 1);
    assert.equal(r.meta.teruggevallen, 1);
    assert.ok(r.chunks[0].aangeleverde_passage);
    assert.equal(r.chunks[1].aangeleverde_passage, undefined);
  });

  await checkA("orchestratie: geen siblings ophaalbaar → alles kaal", async () => {
    const treffer = sib("t1", "d1", 0, "kern");
    const r = await verrijkMetParents([treffer], FONDS_A, "2026-07-15", fakeOpties([]));
    assert.equal(r.meta.uitgebreid, 0);
    assert.equal(r.meta.teruggevallen, 1);
    assert.equal(r.chunks[0].aangeleverde_passage, undefined);
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
