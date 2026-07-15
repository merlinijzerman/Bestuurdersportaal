// ============================================================
//  Sanity-tests voor lib/rerank.ts (R1.3 — Haiku-reranker).
//
//  Geen testframework in de repo; dit script draait standalone met assert.
//  Uitvoeren: npx tsx lib/rerank.sanity.ts
//  Verifieert de risicovolle logica: JSON-parsing (robuust + clamp), stabiele
//  herordening met behoud van kandidaten zonder score, en de fail-safe naar de
//  RRF-volgorde bij API-fout, timeout en onparseerbare uitvoer (met correcte
//  fallback_reason). De LLM-call draait tegen een geïnjecteerde mock-client.
// ============================================================

import assert from "node:assert/strict";
import {
  parseRerankScores,
  pasVolgordeToe,
  rerankChunks,
  type RerankClient,
} from "./rerank";

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

// Mini-chunk voor de tests: alleen `id` + tekst zijn nodig.
type C = { id: string; tekst: string };
const chunk = (id: string, tekst = `tekst ${id}`): C => ({ id, tekst });

// Mock-client die een vaste tekst teruggeeft (of throwt / traag is).
function mockClient(text: string | Error, vertragingMs = 0): RerankClient {
  return {
    create: (async () => {
      if (vertragingMs > 0) await new Promise((r) => setTimeout(r, vertragingMs));
      if (text instanceof Error) throw text;
      return { content: [{ type: "text", text }] };
    }) as unknown as RerankClient["create"],
  };
}

async function main() {
  console.log("rerank sanity-tests:");

  // ── parseRerankScores ──────────────────────────────────────────────────────
  check("parse: geldige JSON-array", () => {
    const m = parseRerankScores('[{"i":1,"score":80},{"i":2,"score":30}]', 2);
    assert.ok(m);
    assert.equal(m!.get(1), 80);
    assert.equal(m!.get(2), 30);
  });

  check("parse: clamp buiten [0,100] + afronden", () => {
    const m = parseRerankScores('[{"i":1,"score":150},{"i":2,"score":-9},{"i":3,"score":42.6}]', 3);
    assert.equal(m!.get(1), 100);
    assert.equal(m!.get(2), 0);
    assert.equal(m!.get(3), 43);
  });

  check("parse: omringende tekst rond de array wordt genegeerd", () => {
    const m = parseRerankScores('Hier is het resultaat: [{"i":1,"score":55}] klaar.', 1);
    assert.equal(m!.get(1), 55);
  });

  check("parse: nummers buiten bereik worden overgeslagen", () => {
    const m = parseRerankScores('[{"i":9,"score":90},{"i":1,"score":50}]', 2);
    assert.equal(m!.get(1), 50);
    assert.equal(m!.has(9), false);
  });

  check("parse: onparseerbaar → null", () => {
    assert.equal(parseRerankScores("geen json hier", 3), null);
    assert.equal(parseRerankScores("", 3), null);
    assert.equal(parseRerankScores("[]", 3), null);
  });

  // ── pasVolgordeToe ─────────────────────────────────────────────────────────
  check("herordening: aflopende score", () => {
    const kandidaten = [chunk("a"), chunk("b"), chunk("c")];
    const scores = new Map([
      [1, 10],
      [2, 90],
      [3, 50],
    ]);
    const { volgorde, scoresPerId } = pasVolgordeToe(kandidaten, scores);
    assert.deepEqual(volgorde.map((c) => c.id), ["b", "c", "a"]);
    assert.deepEqual(scoresPerId, { a: 10, b: 90, c: 50 });
  });

  check("herordening: kandidaten zonder score achteraan, stabiel", () => {
    const kandidaten = [chunk("a"), chunk("b"), chunk("c")];
    const scores = new Map([[2, 70]]); // alleen b scoort
    const { volgorde, scoresPerId } = pasVolgordeToe(kandidaten, scores);
    assert.deepEqual(volgorde.map((c) => c.id), ["b", "a", "c"]);
    assert.deepEqual(scoresPerId, { b: 70 });
  });

  check("herordening: gelijke scores behouden RRF-volgorde (stabiel)", () => {
    const kandidaten = [chunk("a"), chunk("b"), chunk("c")];
    const scores = new Map([
      [1, 50],
      [2, 50],
      [3, 50],
    ]);
    const { volgorde } = pasVolgordeToe(kandidaten, scores);
    assert.deepEqual(volgorde.map((c) => c.id), ["a", "b", "c"]);
  });

  // ── rerankChunks: happy path + fail-safes ──────────────────────────────────
  await checkA("rerank: herordent via mock-client", async () => {
    const kandidaten = [chunk("a"), chunk("b")];
    const r = await rerankChunks("vraag", kandidaten, (c) => c.tekst, {
      client: mockClient('[{"i":1,"score":10},{"i":2,"score":95}]'),
    });
    assert.equal(r.meta.toegepast, true);
    assert.deepEqual(r.chunks.map((c) => c.id), ["b", "a"]);
    assert.deepEqual(r.meta.volgorde_voor, ["a", "b"]);
    assert.deepEqual(r.meta.volgorde_na, ["b", "a"]);
    assert.equal(r.meta.scores.b, 95);
  });

  await checkA("rerank: API-fout → RRF-volgorde + fallback_reason api_error", async () => {
    const kandidaten = [chunk("a"), chunk("b"), chunk("c")];
    const r = await rerankChunks("vraag", kandidaten, (c) => c.tekst, {
      client: mockClient(new Error("boom")),
    });
    assert.equal(r.meta.toegepast, false);
    assert.equal(r.meta.fallback_reason, "api_error");
    assert.deepEqual(r.chunks.map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(r.meta.scores, {});
  });

  await checkA("rerank: timeout → RRF-volgorde + fallback_reason timeout", async () => {
    const kandidaten = [chunk("a"), chunk("b")];
    const r = await rerankChunks("vraag", kandidaten, (c) => c.tekst, {
      client: mockClient('[{"i":1,"score":10},{"i":2,"score":95}]', 100),
      timeoutMs: 20,
    });
    assert.equal(r.meta.toegepast, false);
    assert.equal(r.meta.fallback_reason, "timeout");
    assert.deepEqual(r.chunks.map((c) => c.id), ["a", "b"]);
  });

  await checkA("rerank: onparseerbare uitvoer → RRF-volgorde + onparseerbaar", async () => {
    const kandidaten = [chunk("a"), chunk("b")];
    const r = await rerankChunks("vraag", kandidaten, (c) => c.tekst, {
      client: mockClient("sorry, geen scores"),
    });
    assert.equal(r.meta.toegepast, false);
    assert.equal(r.meta.fallback_reason, "onparseerbaar");
    assert.deepEqual(r.chunks.map((c) => c.id), ["a", "b"]);
  });

  await checkA("rerank: <2 kandidaten → no-op zonder call", async () => {
    let aangeroepen = false;
    const spy: RerankClient = {
      create: (async () => {
        aangeroepen = true;
        return { content: [{ type: "text", text: "[]" }] };
      }) as unknown as RerankClient["create"],
    };
    const r = await rerankChunks("vraag", [chunk("a")], (c) => c.tekst, { client: spy });
    assert.equal(aangeroepen, false);
    assert.equal(r.meta.toegepast, false);
    assert.equal(r.meta.fallback_reason, "geen_herordening_nodig");
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
