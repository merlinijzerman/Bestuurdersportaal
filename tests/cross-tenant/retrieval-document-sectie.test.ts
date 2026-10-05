// #548 — volledige sectie uit een fonds- of generiek PDF/DOCX-document:
// toelating (fonds/generiek, status, geldigheid, review, scan), fondsgrens
// bovenop RLS, chunkpoort, oude index en paginering. De client is een nep-
// PostgREST-builder; de RLS-grens zelf toetst de DB-laag
// (supabase/checks/2026_10_05_548_chunks_vervangen_rls.sql en de §15-suite).
import test from "node:test";
import assert from "node:assert/strict";
import { bouwChunkRecordsZonderVerrijking, INDEXERING_VERSIE } from "../../core/lib/chunk-bouw";
import { haalDocumentsectieVoorWeergave } from "../../core/lib/retrieval/document-sectie-ophalen";
import type { TekstSegment } from "../../core/lib/document-extractie";

const FONDS_A = "11111111-1111-4111-8111-111111111111";
const FONDS_B = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);
const PEIL = "2026-10-05";

const LANG = (n: number) =>
  Array.from({ length: n }, (_, i) => `Zin ${i + 1} over het recht op waardeoverdracht met voldoende woorden.`).join(" ");
const SEGMENTEN: TekstSegment[] = [
  {
    pagina: 1, paragraaf: null, opmaak: "alinea_per_regel",
    tekst: ["Hoofdstuk 2 Waardeoverdracht", "Artikel 5. Recht op waardeoverdracht", `1. ${LANG(12)}`].join("\n\n"),
  },
  {
    pagina: 2, paragraaf: null, opmaak: "alinea_per_regel",
    tekst: ["2. Kort lid.", "Artikel 6. Termijnen", "De uitvoerder verstrekt binnen twee maanden een opgave."].join("\n\n"),
  },
];

type Doc = Record<string, unknown> & { id: string };
function doc(id: string, over: Partial<Doc> = {}): Doc {
  return {
    id, titel: "Pensioenreglement Horizon", bestandsnaam: "reglement.docx", dossiernummer: null,
    bron: "Intern", bibliotheek: "fonds", fonds_id: FONDS_A, documenttype: "reglement",
    bestandstype: "docx", status: "vastgesteld", bronstatus: "actief", geldig_vanaf: null,
    geldig_tot: null, volgende_review: null, opslag_pad: `fonds/${id}.docx`, extern_url: null,
    ocr_toegepast: false, bestand_hash: HASH, scan_resultaat: { verdict: "clean", sha256: HASH },
    ...over,
  };
}

function chunksVoor(documentId: string, opties: { versie?: string; status?: string; afwijkend?: number } = {}) {
  return bouwChunkRecordsZonderVerrijking({ documentId, segmenten: SEGMENTEN }).map((c) => ({
    ...c,
    id: `${documentId}-c${c.chunk_index}`,
    indexering_versie: opties.versie ?? c.indexering_versie,
    documentstatus: c.chunk_index === opties.afwijkend ? "concept" : (opties.status ?? "vastgesteld"),
    bronstatus: "actief",
    geldig_vanaf: null,
    geldig_tot: null,
  }));
}

/** Nep-PostgREST: documenten + per document een chunkset; logt elke aanroep. */
function nepSupabase(documenten: Doc[], chunks: Record<string, ReturnType<typeof chunksVoor>>) {
  const log: { tabel: string; methode: string; args: unknown[] }[] = [];
  return {
    log,
    client: {
      from(tabel: string) {
        const staat: { head?: boolean; documentId?: string; range?: [number, number]; gte?: number; lte?: number } = {};
        const builder: Record<string, unknown> = {};
        for (const methode of ["select", "eq", "in", "or", "order", "limit", "range", "gte", "lte", "ilike"]) {
          builder[methode] = (...args: unknown[]) => {
            log.push({ tabel, methode, args });
            if (methode === "select" && (args[1] as { head?: boolean } | undefined)?.head) staat.head = true;
            if (methode === "eq" && args[0] === "document_id") staat.documentId = args[1] as string;
            if (methode === "range") staat.range = [args[0] as number, args[1] as number];
            if (methode === "gte") staat.gte = args[1] as number;
            if (methode === "lte") staat.lte = args[1] as number;
            return builder;
          };
        }
        builder.abortSignal = () => builder;
        builder.then = (resolve: (w: unknown) => unknown, reject: (f: unknown) => unknown) => {
          let uitkomst: unknown;
          if (tabel === "documenten") uitkomst = { data: documenten, error: null };
          else {
            const set = chunks[staat.documentId ?? ""] ?? [];
            if (staat.head) uitkomst = { data: null, count: set.length, error: null };
            else if (staat.range) uitkomst = { data: set.slice(staat.range[0], staat.range[1] + 1), error: null };
            else uitkomst = {
              data: set.filter((c) => c.chunk_index >= (staat.gte ?? 0) && c.chunk_index <= (staat.lte ?? Infinity)),
              error: null,
            };
          }
          return Promise.resolve(uitkomst).then(resolve, reject);
        };
        return builder;
      },
    },
  };
}

const VRAAG = "Geef het volledige artikel 5 van het pensioenreglement Horizon";
const opdracht = (client: unknown, fondsId: string | null = FONDS_A) => ({
  vraag: VRAAG, fondsId, peildatum: PEIL, supabase: client as { from: (n: string) => any },
  signal: new AbortController().signal,
});

test("#548 fonds-DOCX van het eigen fonds: hele artikel 5 over meerdere chunks en pagina's", async () => {
  const nep = nepSupabase([doc("A1")], { A1: chunksVoor("A1") });
  const r = await haalDocumentsectieVoorWeergave(opdracht(nep.client));
  assert.equal(r?.soort, "sectie");
  if (r?.soort !== "sectie") return;
  assert.equal(r.document.id, "A1");
  assert.equal(r.sectie.reden, "ok");
  assert.equal(r.sectie.volledig, true);
  assert.ok(r.sectie.rijen.length >= 3, "meer dan één passage");
  assert.equal(r.sectie.beginPagina, 1);
  assert.equal(r.sectie.eindPagina, 2);
  assert.ok(r.sectie.tekst.startsWith("Artikel 5. Recht op waardeoverdracht"));
  assert.ok(r.sectie.tekst.endsWith("2. Kort lid."));
  assert.ok(!r.sectie.tekst.includes("Artikel 6"));
  // Elke chunkquery is begrensd tot het gekozen document.
  const chunkFilters = nep.log.filter((l) => l.tabel === "document_chunks" && l.methode === "eq");
  assert.ok(chunkFilters.length >= 3 && chunkFilters.every((l) => l.args[0] === "document_id" && l.args[1] === "A1"));
  // Documentquery: actief en alleen PDF/DOCX.
  assert.ok(nep.log.some((l) => l.tabel === "documenten" && l.methode === "eq" && l.args[0] === "actief" && l.args[1] === true));
  assert.ok(nep.log.some((l) => l.tabel === "documenten" && l.methode === "in" &&
    JSON.stringify(l.args) === JSON.stringify(["bestandstype", ["pdf", "docx"]])));
});

test("#548 fondsgrens bovenop RLS: een document van fonds B wordt nooit gekozen of gelezen", async () => {
  // Ook als de query (bv. door een RLS-fout) een B-document zou teruggeven.
  const nep = nepSupabase([doc("B1", { fonds_id: FONDS_B })], { B1: chunksVoor("B1") });
  assert.equal(await haalDocumentsectieVoorWeergave(opdracht(nep.client, FONDS_A)), null);
  assert.ok(!nep.log.some((l) => l.tabel === "document_chunks"), "geen enkele chunkquery voor fonds B");
  // Zonder actief fonds geen fondsdocumenten.
  const nep2 = nepSupabase([doc("A1")], { A1: chunksVoor("A1") });
  assert.equal(await haalDocumentsectieVoorWeergave(opdracht(nep2.client, null)), null);
});

test("#548 met A en B in de resultaten kiest de route het eigen fondsdocument", async () => {
  const nep = nepSupabase([doc("B1", { fonds_id: FONDS_B }), doc("A1")], { A1: chunksVoor("A1"), B1: chunksVoor("B1") });
  const r = await haalDocumentsectieVoorWeergave(opdracht(nep.client));
  assert.equal(r?.soort === "sectie" && r.document.id, "A1");
  assert.ok(!nep.log.some((l) => l.tabel === "document_chunks" && l.args[1] === "B1"));
});

test("#548 generiek: gepubliceerd en review geldig wel; concept of verlopen review niet", async () => {
  const generiek = (over: Partial<Doc>) =>
    doc("G1", { bibliotheek: "generiek", fonds_id: null, status: "van_kracht", bestandstype: "pdf", ...over });
  const ok = nepSupabase([generiek({})], { G1: chunksVoor("G1", { status: "van_kracht" }) });
  const r = await haalDocumentsectieVoorWeergave(opdracht(ok.client));
  assert.equal(r?.soort === "sectie" && r.sectie.reden, "ok");
  for (const over of [{ status: "concept" }, { volgende_review: "2026-01-01" }, { bronstatus: "ingetrokken" }, { geldig_tot: "2026-01-01" }]) {
    const nep = nepSupabase([generiek(over)], { G1: chunksVoor("G1", { status: "van_kracht" }) });
    assert.equal(await haalDocumentsectieVoorWeergave(opdracht(nep.client)), null, JSON.stringify(over));
  }
});

test("#548 fonds: concept-document niet toegelaten (modus actueel)", async () => {
  const nep = nepSupabase([doc("A1", { status: "concept" })], { A1: chunksVoor("A1") });
  assert.equal(await haalDocumentsectieVoorWeergave(opdracht(nep.client)), null);
});

test("#548 PPTX/XLSX vallen buiten de route", async () => {
  const nep = nepSupabase([doc("A1", { bestandstype: "pptx" })], { A1: chunksVoor("A1") });
  assert.equal(await haalDocumentsectieVoorWeergave(opdracht(nep.client)), null);
});

test("#548 oude fondsindex: melding, en de sectietekst wordt niet eens opgehaald", async () => {
  const nep = nepSupabase([doc("A1")], { A1: chunksVoor("A1", { versie: INDEXERING_VERSIE }) });
  const r = await haalDocumentsectieVoorWeergave(opdracht(nep.client));
  assert.equal(r?.soort === "sectie" && r.sectie.reden, "oude_index");
  assert.equal(r?.soort === "sectie" && r.sectie.volledig, false);
  assert.equal(r?.soort === "sectie" && r.sectie.tekst, "");
  assert.ok(!nep.log.some((l) => l.methode === "gte"), "geen tekstquery");
  assert.ok(!nep.log.some((l) => l.methode === "select" && String(l.args[0]).includes("tekst")));
});

test("#548 chunkpoort: één niet-toegelaten chunk in de sectie maakt haar onderbroken", async () => {
  const nep = nepSupabase([doc("A1")], { A1: chunksVoor("A1", { afwijkend: 2 }) });
  const r = await haalDocumentsectieVoorWeergave(opdracht(nep.client));
  assert.equal(r?.soort === "sectie" && r.sectie.volledig, false);
  assert.equal(r?.soort === "sectie" && r.sectie.reden, "onderbroken");
});

test("#548 scanpoort: zonder schoon scanbewijs geen weergave (WP3 aan)", async () => {
  const vorige = process.env.WP3_MALWARESCAN_AAN;
  process.env.WP3_MALWARESCAN_AAN = "true";
  try {
    const nep = nepSupabase([doc("A1", { scan_resultaat: null })], { A1: chunksVoor("A1") });
    assert.equal(await haalDocumentsectieVoorWeergave(opdracht(nep.client)), null);
    const ok = nepSupabase([doc("A1")], { A1: chunksVoor("A1") });
    assert.equal((await haalDocumentsectieVoorWeergave(opdracht(ok.client)))?.soort, "sectie");
  } finally {
    if (vorige === undefined) delete process.env.WP3_MALWARESCAN_AAN;
    else process.env.WP3_MALWARESCAN_AAN = vorige;
  }
});

test("#548 metadata gepagineerd voorbij de PostgREST-rijlimiet (1.000)", async () => {
  const basis = chunksVoor("A1");
  const veel = [
    ...basis,
    ...Array.from({ length: 2400 }, (_, i) => ({
      ...basis[basis.length - 1], id: `A1-x${i}`, chunk_index: basis.length + i, structuur_label: "Artikel 6",
    })),
  ];
  const nep = nepSupabase([doc("A1")], { A1: veel });
  const r = await haalDocumentsectieVoorWeergave(opdracht(nep.client));
  assert.equal(r?.soort === "sectie" && r.sectie.reden, "ok");
  assert.equal(nep.log.filter((l) => l.methode === "range").length, Math.ceil(veel.length / 1000));
});

test("#548 dubbelzinnig: twee even passende documenten → keuzevraag, geen chunks gelezen", async () => {
  const nep = nepSupabase([doc("A1"), doc("A2")], { A1: chunksVoor("A1"), A2: chunksVoor("A2") });
  const r = await haalDocumentsectieVoorWeergave(opdracht(nep.client));
  assert.equal(r?.soort, "dubbelzinnig");
  assert.ok(!nep.log.some((l) => l.tabel === "document_chunks"));
});

test("#548 geen sectieverzoek → route doet niets (gewone RAG)", async () => {
  const nep = nepSupabase([doc("A1")], { A1: chunksVoor("A1") });
  const r = await haalDocumentsectieVoorWeergave({ ...opdracht(nep.client), vraag: "Wat regelt artikel 5?" });
  assert.equal(r, null);
  assert.equal(nep.log.length, 0);
});
