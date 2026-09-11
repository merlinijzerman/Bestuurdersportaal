// ============================================================================
//  #322 F4-T2-1/PR-D — G-12: de hybride fusie krijgt een verslapte FTS-poging.
// ----------------------------------------------------------------------------
//  Het gemeten gebrek: in de hybride chatgolden had ELKE chunk `fts_rang: null`.
//  De FTS-arm kreeg de strikte AND-keten van `websearch_to_tsquery`, en bij een
//  natuurlijke vraag bevat zelden één chunk álle inhoudswoorden. De fusie was
//  daarmee feitelijk alleen vector. Het FTS-pad had voor precies dit geval een
//  verslapte tweede poging; het hybride pad niet.
//
//  De beslisregel (akkoord opdrachtgever, 11-09), over ALLE strikte pogingen:
//    1. primaire RPC-fout                      → FTS-terugval, geen verslapping
//    2. strikte pogingen samen: nul kandidaten → FTS-terugval
//    3. wel kandidaten, nergens `fts_rang`     → één verslapte hybride poging
//    4. ergens een `fts_rang`                  → geen verslapping
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  maakHybrideRpc,
  moetHybrideVerslappen,
  voerHybridePogingenUit,
  type DocumentChunk,
  type HybrideDeps,
} from "../../core/lib/rag";
import { bouwTerugvalFtsQuery } from "../../core/lib/fts-terugval";
import { RetrievalAfgebroken, isAfbreking } from "../../core/lib/retrieval/afbreken";

/** Een chunk; `fts` = de rang in de FTS-arm, `null` = alleen via de vectorarm. */
function chunk(id: string, fts: number | null): DocumentChunk {
  return { id, document_id: `doc-${id}`, fts_rang: fts, vec_rang: 1 } as unknown as DocumentChunk;
}

// Een vraag met meerdere inhoudswoorden: `bouwTerugvalFtsQuery` levert dan een
// OR-keten op die verschilt van de strikte query.
const VRAAG = "hoe staat het met de dekkingsgraad en het herstelplan van het fonds";
const STRIKT = "strikte-query";
const VECTOR = [0.1, 0.2, 0.3];

interface Aanroep {
  ftsQuery: string;
  embedding: number[];
}

/** Nep-RPC: per aanroep het volgende antwoord uit de lijst; legt elke aanroep vast. */
function nepDeps(antwoorden: (DocumentChunk[] | null)[], extra: Partial<HybrideDeps> = {}) {
  const aanroepen: Aanroep[] = [];
  let i = 0;
  const deps: HybrideDeps = {
    async draai(ftsQuery, embedding) {
      aanroepen.push({ ftsQuery, embedding });
      // Niet `?? []`: dan wordt een bedoelde `null` (RPC-fout) ongemerkt een
      // lege array, en toetst de test precies het geval dat hij moet toetsen niet.
      const antwoord = i < antwoorden.length ? antwoorden[i] : [];
      i++;
      return antwoord;
    },
    async embed() {
      return [9, 9, 9];
    },
    ftsQueryVoor: (t) => `strikt(${t})`,
    ...extra,
  };
  return { deps, aanroepen };
}

// ── De beslisregel als pure functie ─────────────────────────────────────────

test("G-12 — de beslisregel: alleen kandidaten zónder enige FTS-bijdrage verslappen", () => {
  assert.equal(moetHybrideVerslappen([]), false, "geen pogingen");
  assert.equal(moetHybrideVerslappen([[]]), false, "geval 2: nul kandidaten → FTS-terugval, niet verslappen");
  assert.equal(moetHybrideVerslappen([[], []]), false, "geval 2 over twee pogingen");
  assert.equal(moetHybrideVerslappen([[chunk("a", null), chunk("b", null)]]), true, "geval 3");
  assert.equal(moetHybrideVerslappen([[chunk("a", null), chunk("b", 4)]]), false, "geval 4: één fts-rang volstaat");
});

test("G-12 — beoordeeld over ALLE strikte pogingen samen, niet per poging", () => {
  // Het gat uit de review: een lege primaire poging naast een originele met
  // alleen vectorresultaten. Per poging bekeken geeft de primaire niets om te
  // beoordelen en wordt de originele nooit bekeken.
  assert.equal(moetHybrideVerslappen([[], [chunk("x", null)]]), true);
  // …en omgekeerd: een fts-rang in de ORIGINELE poging telt ook.
  assert.equal(moetHybrideVerslappen([[chunk("a", null)], [chunk("b", 2)]]), false);
});

// ── De vier gevallen door de echte pogingenlogica ───────────────────────────

test("G-12 geval 1 — primaire RPC-fout: FTS-terugval, GEEN verslapte poging", async () => {
  const { deps, aanroepen } = nepDeps([null]);
  const uit = await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps);
  assert.equal(uit.soort, "rpc_fout");
  assert.equal(aanroepen.length, 1, "de RPC zelf is stuk; een tweede aanroep ervan helpt niet");
});

test("G-12 geval 2 — strikte pogingen samen nul kandidaten: geen verslapping", async () => {
  const { deps, aanroepen } = nepDeps([[], []]);
  const uit = await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, "een andere originele vraag", deps);
  assert.equal(uit.soort, "pogingen");
  assert.equal(aanroepen.length, 2, "primair + origineel, geen derde");
  if (uit.soort === "pogingen") {
    assert.equal(uit.pogingen.flatMap((p) => p.chunks).length, 0, "de aanroeper valt terug op FTS");
    assert.equal(uit.pogingMeta.some((m) => m.naam === "verslapt"), false);
  }
});

test("G-12 geval 3 — kandidaten zonder enige fts-rang: één verslapte poging", async () => {
  const { deps, aanroepen } = nepDeps([[chunk("a", null), chunk("b", null)], [chunk("c", 1)]]);
  const uit = await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps);
  assert.equal(aanroepen.length, 2, "primair + verslapt");
  const verwacht = bouwTerugvalFtsQuery(VRAAG);
  assert.ok(verwacht, "de testvraag moet een verslapte query opleveren");
  assert.equal(aanroepen[1].ftsQuery, verwacht!.query, "de verslapte OR-keten van het FTS-pad");
  assert.notEqual(aanroepen[1].ftsQuery, STRIKT);
  if (uit.soort === "pogingen") {
    assert.deepEqual(uit.pogingen.map((p) => p.naam), ["primair", "verslapt"]);
  }
});

test("G-12 geval 3 — het GAT: lege primaire poging + originele met alleen vector", async () => {
  const { deps, aanroepen } = nepDeps([[], [chunk("x", null)], [chunk("y", 3)]]);
  const uit = await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, "een andere originele vraag", deps);
  assert.equal(aanroepen.length, 3, "primair + origineel + verslapt");
  if (uit.soort === "pogingen") {
    assert.deepEqual(uit.pogingen.map((p) => p.naam), ["primair", "origineel", "verslapt"]);
  }
});

test("G-12 geval 4 — een fts-rang in de primaire poging: geen verslapping", async () => {
  const { deps, aanroepen } = nepDeps([[chunk("a", 1), chunk("b", null)]]);
  await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps);
  assert.equal(aanroepen.length, 1, "precisie heeft gewerkt");
});

test("G-12 geval 4 — een fts-rang alleen in de ORIGINELE poging: ook geen verslapping", async () => {
  const { deps, aanroepen } = nepDeps([[chunk("a", null)], [chunk("b", 2)]]);
  await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, "een andere originele vraag", deps);
  assert.equal(aanroepen.length, 2, "primair + origineel, geen verslapping");
});

// ── Grenzen van de verslapte poging ─────────────────────────────────────────

test("G-12 — hergebruikt de PRIMAIRE vector; geen extra embedding", async () => {
  let embeds = 0;
  const { deps, aanroepen } = nepDeps([[chunk("a", null)]], {
    async embed() {
      embeds++;
      return [9, 9, 9];
    },
  });
  await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps);
  assert.equal(embeds, 0, "geen Mistral-call voor de verslapte poging");
  assert.equal(aanroepen[1].embedding, VECTOR, "exact dezelfde vector als de primaire poging");
});

test("G-12 — bij één zoekterm draait hij niet, en komt er GEEN meta-regel bij", async () => {
  // Bij één term is de verslapte query gelijk aan de strikte. Een extra regel in
  // `retrieval_pogingen` zou dan bestaande snapshots veranderen zonder dat er
  // iets gebeurd is.
  const { deps, aanroepen } = nepDeps([[chunk("a", null)]]);
  const uit = await voerHybridePogingenUit("uitbesteding", STRIKT, VECTOR, undefined, deps);
  assert.equal(aanroepen.length, 1);
  if (uit.soort === "pogingen") {
    assert.deepEqual(uit.pogingMeta.map((m) => m.naam), ["primair"]);
  }
});

test("G-12 — faalt de verslapte poging, dan blijft de strikte uitkomst staan", async () => {
  const { deps } = nepDeps([[chunk("a", null)], null]);
  const uit = await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps);
  assert.equal(uit.soort, "pogingen", "non-destructief, geen rpc_fout");
  if (uit.soort === "pogingen") {
    assert.deepEqual(uit.pogingen.map((p) => p.naam), ["primair"]);
    const v = uit.pogingMeta.find((m) => m.naam === "verslapt");
    assert.ok(v, "de mislukte poging staat wél in het spoor");
    assert.equal(v!.rijen, null);
  }
});

// ── Deadline ────────────────────────────────────────────────────────────────

test("G-12 — een verstreken deadline start de verslapte poging NIET", async () => {
  const ac = new AbortController();
  const { deps, aanroepen } = nepDeps([[chunk("a", null)]], { signal: ac.signal });
  // De primaire poging slaagt; daarna verstrijkt de deadline.
  const eersteDraai = deps.draai;
  deps.draai = async (q, e) => {
    const r = await eersteDraai(q, e);
    ac.abort(new RetrievalAfgebroken("timeout"));
    return r;
  };
  await assert.rejects(
    () => voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps),
    (e: unknown) => isAfbreking(e)
  );
  assert.equal(aanroepen.length, 1, "de extra RPC mag na de deadline niet meer vertrekken");
});

// ── Het parameterblok: alleen p_query verschilt ─────────────────────────────

test("G-12 — de verslapte poging deelt EXACT het parameterblok van de strikte", async () => {
  // Het risico van elke extra poging: stilletjes breder zoeken dan de gebruiker
  // vroeg. Hier op het RPC-grensvlak gemeten, met een nep-client die elke
  // aanroep vastlegt.
  const vastgelegd: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      vastgelegd.push({ fn, args });
      const p = Promise.resolve({ data: [], error: null });
      return Object.assign(p, { abortSignal: () => p });
    },
  };
  const gedeeld = {
    p_limit: 30,
    p_document_ids: ["doc-1"],
    p_fonds_id: "fonds-1",
    p_modus: "actueel",
    p_peildatum: "2026-09-11",
  };
  const draai = maakHybrideRpc(client, gedeeld);
  await draai(STRIKT, VECTOR);
  await draai("verslapt | query", VECTOR);

  assert.equal(vastgelegd.length, 2);
  const [a, b] = vastgelegd;
  assert.equal(a.fn, "zoek_chunks_hybride");
  assert.equal(b.fn, "zoek_chunks_hybride");
  const zonderQuery = (o: Record<string, unknown>) => {
    const { p_query: _q, ...rest } = o;
    return rest;
  };
  assert.deepEqual(zonderQuery(b.args), zonderQuery(a.args), "scope, filters en fonds identiek");
  assert.notEqual(a.args.p_query, b.args.p_query, "alleen de query verschilt");
});

// ── Het auditspoor ──────────────────────────────────────────────────────────

test("G-12 — de verslapte poging staat in `retrieval_pogingen`, met query en aantal", async () => {
  const { deps } = nepDeps([[chunk("a", null)], [chunk("b", 1), chunk("c", 2)]]);
  const uit = await voerHybridePogingenUit(VRAAG, STRIKT, VECTOR, undefined, deps);
  assert.equal(uit.soort, "pogingen");
  if (uit.soort === "pogingen") {
    const v = uit.pogingMeta.find((m) => m.naam === "verslapt");
    assert.ok(v);
    assert.equal(v!.rijen, 2);
    assert.equal(v!.query, bouwTerugvalFtsQuery(VRAAG)!.query);
  }
});

test("G-12 — `retrieval_pogingen` blijft INHOUD: hij draagt vraag-afgeleide tekst", async () => {
  // De verslapte query is afgeleid van de vraag van de gebruiker en hoort dus
  // niet in het basisspoor. Het veld staat in geen van beide allowlists en valt
  // fail-closed in de inhoud — daardoor ook geen migratie op `meta_projectie`.
  const { META_BASIS, META_BRON } = await import("../../core/lib/audit-meta");
  assert.equal((META_BASIS as readonly string[]).includes("retrieval_pogingen"), false);
  assert.equal((META_BRON as readonly string[]).includes("retrieval_pogingen"), false);
});
