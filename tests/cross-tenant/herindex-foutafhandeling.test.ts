// #548 — gedeelde herindexering: atomisch vervangen, opruimen bij een fout,
// nooit "volledig geïndexeerd" na een mislukte poging, terugvindbaar zonder
// chunks; en de eenmalige herindexering raakt uitsluitend generieke documenten.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { herindexeerMetAfhankelijkheden, type HerindexDocument } from "../../core/lib/herindex-kern";
import { BRONBLOKKEN_INDEXERING_VERSIE } from "../../core/lib/chunk-bouw";
import { bepaalHerindexStand, herindexFoutcode } from "../../core/lib/herindex-selectie";
import type { ExtractieResultaatMetOcr } from "../../core/lib/ocr";

const lees = (pad: string) => readFileSync(new URL(`../../${pad}`, import.meta.url), "utf8");

const EXTRACTIE: ExtractieResultaatMetOcr = {
  tekst: "",
  aantalPaginas: 2,
  ocrToegepast: false,
  ocrEngine: null,
  segmenten: [
    {
      pagina: 1, paragraaf: null, opmaak: "alinea_per_regel",
      tekst: ["Artikel 150r. Opschorting individuele waardeoverdracht",
        "2. Het eerste lid is niet van toepassing indien het overdragende pensioenfonds bij de opdrachtaanvaarding, bedoeld in artikel 102a, heeft aangegeven geen gebruik te maken van de mogelijkheid tot waardeoverdracht."].join("\n\n"),
    },
    { pagina: 2, paragraaf: null, opmaak: "alinea_per_regel", tekst: "Toelichting\n\nDit amendement regelt een tijdelijke pauze in waardeoverdrachten." },
  ],
};
EXTRACTIE.tekst = EXTRACTIE.segmenten.map((s) => s.tekst).join("\n\n");

interface Aanroep { soort: string; tabel?: string; waarde?: unknown; filters?: unknown[] }

/** Nep-client: storage, rpc en tabelbuilders; legt alles vast. */
function nepClient(opties: { rpcFout?: string; nogNull?: number } = {}) {
  const log: Aanroep[] = [];
  let rpcPayload: { p_document_id: string; p_chunks: Record<string, unknown>[] } | null = null;
  const client = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from("%PDF-nep")]), error: null }) }) },
    rpc: async (naam: string, args: typeof rpcPayload) => {
      log.push({ soort: "rpc", waarde: naam });
      rpcPayload = args;
      return opties.rpcFout
        ? { data: null, error: { code: "P0001", message: opties.rpcFout } }
        : { data: args!.p_chunks.length, error: null };
    },
    from(tabel: string) {
      const filters: unknown[] = [];
      let soort = "select";
      let waarde: unknown;
      let head = false;
      const b: Record<string, unknown> = {};
      b.select = (_v: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; };
      b.update = (w: unknown) => { soort = "update"; waarde = w; return b; };
      b.delete = () => { soort = "delete"; return b; };
      for (const m of ["eq", "is", "not", "limit", "order"]) b[m] = (...a: unknown[]) => { filters.push([m, ...a]); return b; };
      b.maybeSingle = () => b;
      b.then = (res: (w: unknown) => unknown, rej: (f: unknown) => unknown) => {
        log.push({ soort, tabel, waarde, filters });
        const uit = head
          ? { count: opties.nogNull ?? 0, error: null }
          : soort === "select" && tabel === "document_chunks"
            ? { data: { prefix_model: "claude-haiku-4-5-20251001" }, error: null }
            : { data: null, error: null };
        return Promise.resolve(uit).then(res, rej);
      };
      return b;
    },
  };
  return { client, log, payload: () => rpcPayload };
}

const DOC = (bibliotheek: "fonds" | "generiek"): HerindexDocument => ({
  id: bibliotheek === "fonds" ? "f1" : "g1",
  titel: "Amendement 36 067 nr. 90",
  opslag_pad: `${bibliotheek}/x.pdf`,
  bestandstype: "pdf",
  documenttype: "wetsgeschiedenis",
  wetsgeschiedenis_subtype: "aangenomen_amendement",
});
const BEGRENZING = { reserveerOcr: async () => true, gateway: {} as never };
const deps = (verrijk: () => Promise<{ verwerkt: number; resterend: number }>) => ({
  extraheer: async () => EXTRACTIE,
  verrijk: async () => verrijk(),
});

const statusUpdates = (log: Aanroep[]) =>
  log.filter((a) => a.soort === "update" && a.tabel === "documenten").map((a) => a.waarde as Record<string, unknown>);

test("#548 herindex geslaagd: atomisch vervangen (r2, 0..n-1), pas daarna geindexeerd/beschikbaar", async () => {
  const nep = nepClient();
  const r = await herindexeerMetAfhankelijkheden(nep.client as never, DOC("generiek"), BEGRENZING,
    deps(async () => ({ verwerkt: 3, resterend: 0 })));
  assert.equal(r.status, "verwerkt");
  const p = nep.payload()!;
  assert.equal(p.p_document_id, "g1");
  assert.ok(p.p_chunks.every((c, i) => c.chunk_index === i && c.indexering_versie === BRONBLOKKEN_INDEXERING_VERSIE));
  assert.ok(p.p_chunks.every((c) => !("embedding" in c)), "geen embeddings in de atomische set");
  // Geen losse DELETE/INSERT op document_chunks meer: de RPC doet het in één transactie.
  assert.ok(!nep.log.some((a) => a.tabel === "document_chunks" && (a.soort === "delete" || a.soort === "insert")));
  assert.deepEqual(statusUpdates(nep.log).at(-1), {
    geindexeerd: true, verwerkingsstatus: "beschikbaar", paginas: 2, ocr_toegepast: false, ocr_engine: null,
  });
});

test("#548 vervangen mislukt: oude chunkset blijft, niets opgeruimd, nooit geindexeerd=true", async () => {
  const nep = nepClient({ rpcFout: "insert faalde" });
  let verrijkt = false;
  const r = await herindexeerMetAfhankelijkheden(nep.client as never, DOC("generiek"), BEGRENZING,
    deps(async () => { verrijkt = true; return { verwerkt: 1, resterend: 0 }; }));
  assert.equal(r.status, "mislukt");
  assert.equal(r.reden, "vervangen_mislukt");
  assert.equal(verrijkt, false);
  assert.ok(!nep.log.some((a) => a.tabel === "document_chunks" && a.soort === "delete"));
  assert.ok(!statusUpdates(nep.log).some((u) => u.geindexeerd === true));
});

for (const [naam, verrijk] of [
  ["verrijking gooit (provider)", async () => { throw new Error("embedding 503"); }],
  ["verrijking zonder voortgang", async () => ({ verwerkt: 0, resterend: 12 })],
] as const) {
  test(`#548 ${naam}: alle chunks opgeruimd, status mislukt, niet doorzoekbaar`, async () => {
    const nep = nepClient();
    const r = await herindexeerMetAfhankelijkheden(nep.client as never, DOC("generiek"), BEGRENZING, deps(verrijk));
    assert.equal(r.status, "mislukt");
    assert.equal(r.reden, "verrijking_mislukt");
    const del = nep.log.find((a) => a.tabel === "document_chunks" && a.soort === "delete");
    assert.ok(del, "chunks van het document verwijderd");
    assert.deepEqual(del!.filters, [["eq", "document_id", "g1"]]);
    assert.deepEqual(statusUpdates(nep.log).at(-1), { geindexeerd: false, verwerkingsstatus: "mislukt" });
    assert.ok(!statusUpdates(nep.log).some((u) => u.geindexeerd === true));
  });
}

test("#548 verrijking meldt klaar maar er zijn nog chunks zonder embedding: opruimen", async () => {
  const nep = nepClient({ nogNull: 4 });
  const r = await herindexeerMetAfhankelijkheden(nep.client as never, DOC("generiek"), BEGRENZING,
    deps(async () => ({ verwerkt: 1, resterend: 0 })));
  assert.equal(r.status, "mislukt");
  assert.ok(nep.log.some((a) => a.tabel === "document_chunks" && a.soort === "delete"));
});

test("#548 gedeelde route: fonds en generiek krijgen dezelfde chunkstructuur", async () => {
  const f = nepClient();
  const g = nepClient();
  const ok = deps(async () => ({ verwerkt: 1, resterend: 0 }));
  await herindexeerMetAfhankelijkheden(f.client as never, DOC("fonds"), BEGRENZING, ok);
  await herindexeerMetAfhankelijkheden(g.client as never, DOC("generiek"), BEGRENZING, ok);
  assert.deepEqual(f.payload()!.p_chunks, g.payload()!.p_chunks);
  const labels = f.payload()!.p_chunks.map((c) => c.structuur_label);
  assert.ok(labels.includes("Amendement — wijziging — Artikel 150r"));
  assert.ok(!labels.some((l) => String(l).includes("102a")), "artikel 102a is geen kop");
});

test("#548 selectie: document zonder chunks na een mislukte poging is terug te vinden", () => {
  const V = BRONBLOKKEN_INDEXERING_VERSIE;
  const docs = [
    { id: "a", titel: "A", geindexeerd: true },   // klaar op r2
    { id: "b", titel: "B", geindexeerd: false },  // mislukt, geen chunks meer
    { id: "c", titel: "C", geindexeerd: true },   // nog op r1
    { id: "d", titel: "D", geindexeerd: false },  // overgeslagen
    { id: "e", titel: "E", geindexeerd: true },   // eerder mislukt, daarna klaar
  ];
  const jobs = [
    { document_id: "b", status: "mislukt", foutcode: herindexFoutcode(V, "verrijking_mislukt"), aangemaakt: "2026-10-05T10:00:00Z" },
    { document_id: "d", status: "overgeslagen", foutcode: herindexFoutcode(V, "geen_origineel"), aangemaakt: "2026-10-05T10:00:00Z" },
    { document_id: "e", status: "mislukt", foutcode: herindexFoutcode(V, "vervangen_mislukt"), aangemaakt: "2026-10-05T09:00:00Z" },
    { document_id: "e", status: "geslaagd", foutcode: herindexFoutcode(V, "ok"), aangemaakt: "2026-10-05T11:00:00Z" },
    // Een job voor een andere versie telt niet.
    { document_id: "c", status: "mislukt", foutcode: "herindex:r1-structuur-contextueel:x", aangemaakt: "2026-10-05T12:00:00Z" },
  ];
  const stand = bepaalHerindexStand(docs, new Set(["a", "e"]), jobs, V);
  assert.deepEqual(stand.klaar.map((d) => d.id), ["a", "e"]);
  assert.deepEqual(stand.mislukt.map((d) => [d.id, d.reden]), [["b", "verrijking_mislukt"]]);
  assert.deepEqual(stand.overgeslagen.map((d) => d.id), ["d"]);
  assert.deepEqual(stand.teDoen.map((d) => d.id), ["c"]);
  // Chunk 0 op r2 maar geindexeerd=false (afronden mislukt) is níet klaar.
  const half = bepaalHerindexStand([{ id: "a", titel: "A", geindexeerd: false }], new Set(["a"]), [], V);
  assert.deepEqual(half.teDoen.map((d) => d.id), ["a"]);
});

test("#548 eenmalige herindexering raakt alleen generiek; fondsroute ongemoeid", () => {
  const acties = lees("app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties.ts");
  const stand = acties.slice(acties.indexOf("async function leesHerindexStand"), acties.indexOf("export async function curatieHerindexeren"));
  assert.match(stand, /\.from\("documenten"\)[\s\S]*?\.eq\("bibliotheek", "generiek"\)/);
  assert.match(stand, /\.from\("document_chunks"\)[\s\S]*?\.eq\("bibliotheek", "generiek"\)/);
  assert.match(acties, /doc\.bibliotheek !== "generiek" \|\| doc\.fonds_id !== null/);
  // De fonds-backfill selecteert nog steeds alleen baseline-chunks (NULL-versie):
  // bestaande fondsdocumenten op r1 worden niet opnieuw opgepakt.
  const backfill = lees("app/api/documents/reindex-backfill/route.ts");
  assert.match(backfill, /\.eq\("bibliotheek", "fonds"\)\s*\.is\("indexering_versie", null\)/);
});

test("#548 actieve worker: gedeelde chunkbouw zonder bibliotheekafscherming, atomisch vervangen", () => {
  const worker = lees("platform/lib/ingest-orchestrator.ts");
  const stap = worker.slice(worker.indexOf("async function extracteerEnChunk"), worker.indexOf("// Permanente fout"));
  assert.match(stap, /bouwChunkRecordsZonderVerrijking\(\{\s*documentId: doc\.id,\s*segmenten: extractie\.segmenten,\s*documenttype: doc\.documenttype,\s*wetsgeschiedenisSubtype: doc\.wetsgeschiedenis_subtype,\s*\}\)/);
  // Extractie en chunkbouw hangen niet van de bibliotheek af (alleen de
  // OCR-kostenscope doet dat, en die verandert niets aan de tekst).
  assert.match(stap, /extractTekstMetOcrFallback\(buffer, bestandstype, \{/);
  const chunkbouw = stap.slice(stap.indexOf("// Kale chunks"), stap.indexOf("vervangChunksAtomisch("));
  assert.doesNotMatch(chunkbouw, /bibliotheek/);
  assert.match(stap, /vervangChunksAtomisch\(svc, doc\.id, bareRecords\)/);
  assert.doesNotMatch(stap, /\.from\("document_chunks"\)\s*\.insert/);
});
