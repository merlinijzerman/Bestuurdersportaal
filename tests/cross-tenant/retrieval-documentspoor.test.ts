// ============================================================================
//  §15-matrix — Documentspoor: letterlijk genoemd (niet-juridisch) document in
//  een vrije vraag. Hermetisch: geen netwerk, geen database.
//
//  Het faalpatroon (Productie 8 oktober 2026, correlatie 563b709d, fonds
//  Horizon, vrije chat zonder documentscope): "Welke beheersmaatregelen noemt
//  DNB in de Good practice ESG risicobeheer pensioenfondsen voor ESG-risico's?"
//  De hybride RPC liep na 8.047 ms tegen 57014; het R1-tekstpad gaf 30
//  kandidaten; de selectie nam tien generieke passages, uit het DNB-document
//  alleen p. 1/3/5 (titel, inhoud, inleiding). De maatregelen (GP6/GP7, p. 17)
//  kwamen niet in de antwoordcontext.
//
//  WAT DEZE TEST WEL EN NIET BEWIJST. De DNB-fixture hieronder is SYNTHETISCH
//  en representatief (eigen tekst, geen kopie van de DNB-publicatie; de
//  Productiechunks komen uit Mistral-OCR en zijn niet lokaal beschikbaar). De
//  zoek-RPC is nagebootst: het hoofdspoor levert de Productievolgorde (p. 1/3/5
//  voorop, p. 17 afwezig); de zoekslag binnen het document is een eenvoudige
//  OR-telling over dezelfde termen als `bouwTerugvalFtsQuery`. De test bewijst
//  dus de BINDING, de GRENZEN, de SELECTIE en de CONTEXTOPBOUW — niet de
//  Postgres-rangschikking, niet de echte RPC onder RLS en niet het modelantwoord.
//
//  Read-only Productiefeiten (opdrachtgever, 8-10-2026), hier als invoer:
//   - titel van 2745d314: exact "Good practice ESG risicobeheer pensioenfondsen",
//     actief, geïndexeerd, generiek;
//   - Horizon: fondsvlag zoek_tekst_v2 = true; GEEN fondsrij voor
//     parent_retrieval of documentspoor (env PARENT_RETRIEVAL onbekend);
//   - ts_rank_cd van de restvraag-OR binnen de 131 chunks: p. 17 chunk 96 op
//     gedeelde rang 1–3 (1,4, gelijk met p. 11/13), chunk 98 lager. De RPC
//     sorteert `rang desc, chunk_index asc`, dus chunk 96 valt binnen de vier.
//
//  Lagen:
//   (B) BINDING   — welk document de vraag letterlijk noemt; M3 ter vergelijking.
//   (G) GRENZEN   — vlag, scope, juridische vragen, budget/gate, tijdslimiet.
//   (E) EIND-TOT-EIND — adapter + orkestratie + citatie (contextTekst).
//   (N) NEGATIEF  — ambigu, ander fonds, concept, gearchiveerd, ongescand,
//                   bronsoortfilter.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/retrieval-documentspoor.test.ts
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { bindGenoemdDocument, titelzoektermen } from "../../core/lib/retrieval/genoemd-document";
import { resolveerGenoemdDocument } from "../../core/lib/vraagrouter";
import { bouwTerugvalFtsQuery } from "../../core/lib/fts-terugval";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import { maakSupabaseAdapter, type Adaptervlaggen } from "../../core/lib/retrieval/supabase-adapter";
import {
  DOCUMENTSPOOR_MAX,
  vulAanMetGenoemdDocument,
  zoekRelevanteChunksMetMeta,
  type DocumentChunk,
  type RetrievalFilters,
  type RetrievalMeta,
} from "../../core/lib/rag";
import { bepaalJuridischeVraagintentie } from "../../core/lib/vraagtype";
import { maakVolledigeVersieHash } from "../../core/lib/retrieval/identiteit";
import type {
  AdapterUitkomst,
  Bronresultaat,
  CitaatOpdracht,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../../core/lib/retrieval/contract";

// ── Fixture ─────────────────────────────────────────────────────────────────
const HORIZON = "c9f583dc-0000-4000-8000-00000000000a";
const ANDER_FONDS = "c9f583dc-0000-4000-8000-00000000000b";
const VRAAG = "Welke beheersmaatregelen noemt DNB in de Good practice ESG risicobeheer pensioenfondsen voor ESG-risico’s?";
// Exact de Productietitel van 2745d314 (read-only bevestigd door de opdrachtgever, 8-10-2026).
const ESG_TITEL = "Good practice ESG risicobeheer pensioenfondsen";
const HASH = "a".repeat(64);
const SCHOON = { verdict: "clean", sha256: HASH };

type Status = "van_kracht" | "concept" | "gearchiveerd";
interface Doc {
  id: string;
  titel: string;
  bibliotheek: "generiek" | "fonds";
  fonds_id: string | null;
  documenttype: string | null;
  status: Status;
  geindexeerd: boolean;
  scan: boolean;
}
const D = {
  esg: "e5000000-0000-4000-8000-000000000001",
  renterisico: "e5000000-0000-4000-8000-000000000002",
  compliance: "e5000000-0000-4000-8000-000000000003",
  liquiditeit: "e5000000-0000-4000-8000-000000000004",
  pf: "e5000000-0000-4000-8000-000000000005",
  horizonBeleid: "e5000000-0000-4000-8000-000000000006",
  anderFonds: "e5000000-0000-4000-8000-000000000007",
  pw: "e5000000-0000-4000-8000-000000000008",
};
const BASIS_DOCS: Doc[] = [
  { id: D.esg, titel: ESG_TITEL, bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.renterisico, titel: "Good practice beheersing renterisico pensioenfondsen", bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.compliance, titel: "Good Practice inrichting compliancefunctie bij pensioenfondsen", bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.liquiditeit, titel: "Good Practice Beheersing Liquiditeitsrisico", bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.pf, titel: "Duurzaam en verantwoord beleggen good practice", bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.horizonBeleid, titel: "Beleid maatschappelijk verantwoord beleggen Horizon 2026", bibliotheek: "fonds", fonds_id: HORIZON, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.anderFonds, titel: "Risicobeheer ESG ander fonds", bibliotheek: "fonds", fonds_id: ANDER_FONDS, documenttype: null, status: "van_kracht", geindexeerd: true, scan: true },
  { id: D.pw, titel: "Pensioenwet", bibliotheek: "generiek", fonds_id: null, documenttype: "wetgeving", status: "van_kracht", geindexeerd: true, scan: true },
];

interface Rij { id: string; document_id: string; pagina: number; chunk_index: number; tekst: string }
// Representatief, eigen formulering. De contextprefix staat in Productie in
// `zoek_vector`; hier zit de titel daarom in elke ESG-chunk (zie `doorzoekbaar`).
const ESG_RIJEN: Rij[] = [
  { id: "esg-p1", document_id: D.esg, pagina: 1, chunk_index: 0, tekst: "Good practice ESG-risicobeheer pensioenfondsen. De Nederlandsche Bank, 2023." },
  { id: "esg-p3", document_id: D.esg, pagina: 3, chunk_index: 2, tekst: "Inhoud. Inleiding; ESG-risicobeheer bij pensioenfondsen; good practices per onderdeel van het risicobeheer." },
  { id: "esg-p5", document_id: D.esg, pagina: 5, chunk_index: 4, tekst: "Inleiding. DNB heeft bij pensioenfondsen onderzocht hoe ESG-risico's in het risicobeheer zijn verankerd. Deze good practice beschrijft de bevindingen." },
  { id: "esg-p9", document_id: D.esg, pagina: 9, chunk_index: 8, tekst: "Risico-identificatie. Het fonds brengt in kaart welke klimaat- en milieurisico's materieel zijn voor de portefeuille." },
  { id: "esg-p17a", document_id: D.esg, pagina: 17, chunk_index: 16, tekst: "GP6 Beheersmaatregelen. Het fonds legt per materieel ESG-risico vast welke beheersmaatregelen het neemt om het risico te mitigeren, zoals engagement, uitsluiting en limieten in het mandaat." },
  { id: "esg-p17b", document_id: D.esg, pagina: 17, chunk_index: 17, tekst: "GP7 Effectiviteit. Het fonds toetst periodiek of de beheersmaatregelen effectief zijn en rapporteert de uitkomst aan het bestuur." },
  { id: "esg-p20", document_id: D.esg, pagina: 20, chunk_index: 19, tekst: "Rapportage. Het bestuur ontvangt periodiek informatie over ESG-risico's en de risicohouding." },
];
const OVERIG_RIJEN: Rij[] = [
  { id: "ren-1", document_id: D.renterisico, pagina: 4, chunk_index: 3, tekst: "Good practice beheersing renterisico pensioenfondsen: beheersmaatregelen voor het renterisico." },
  { id: "comp-1", document_id: D.compliance, pagina: 2, chunk_index: 1, tekst: "Good practice compliancefunctie bij pensioenfondsen: rol van de compliancefunctie." },
  { id: "liq-1", document_id: D.liquiditeit, pagina: 3, chunk_index: 2, tekst: "Good practice liquiditeitsrisico: beheersmaatregelen voor liquiditeit." },
  { id: "pf-1", document_id: D.pf, pagina: 6, chunk_index: 5, tekst: "Good practice duurzaam beleggen: ESG-integratie door pensioenfondsen." },
  { id: "hor-1", document_id: D.horizonBeleid, pagina: 2, chunk_index: 1, tekst: "Horizon hanteert ESG-uitsluitingen en engagement in het beleggingsbeleid." },
];

// ── Nep-PostgREST voor `documenten` (RLS: generiek + eigen fonds) ───────────
interface Aanroep { tabel: string; or: string | null; limiet: number }
function documentenNep(docs: Doc[], fonds: string, log: Aanroep[]) {
  return {
    from: (tabel: string) => {
      assert.equal(tabel, "documenten");
      let or: string | null = null;
      let limiet = Infinity;
      const eq: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (k: string, v: unknown) => { eq[k] = v; return b; };
      b.or = (f: string) => { or = f; return b; };
      b.order = () => b;
      b.limit = (n: number) => { limiet = n; return b; };
      b.abortSignal = () => b;
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        log.push({ tabel, or, limiet });
        const termen = (or ?? "").split(",").filter(Boolean).map((deel) => {
          const m = deel.match(/^titel\.ilike\.%(.+)%$/);
          assert.ok(m, `onverwacht filterdeel: ${deel}`);
          return m[1].toLowerCase();
        });
        const data = docs
          .filter((d) => d.fonds_id === null || d.fonds_id === fonds) // RLS
          .filter((d) => (eq.actief === undefined || eq.actief === true) && (eq.geindexeerd === undefined || d.geindexeerd === eq.geindexeerd))
          .filter((d) => termen.length === 0 || termen.some((t) => d.titel.toLowerCase().includes(t)))
          .sort((a, c) => a.id.localeCompare(c.id))
          .slice(0, limiet)
          .map((d) => ({
            id: d.id, titel: d.titel, documenttype: d.documenttype, bibliotheek: d.bibliotheek, fonds_id: d.fonds_id,
            bestand_hash: d.scan ? HASH : null, scan_resultaat: d.scan ? SCHOON : null,
          }));
        return Promise.resolve({ data, error: null }).then(res, rej);
      };
      return b;
    },
  };
}

// ── Nagebootste zoek-RPC ────────────────────────────────────────────────────
function chunkVan(r: Rij, docs: Doc[], rang: number): DocumentChunk {
  const d = docs.find((x) => x.id === r.document_id)!;
  return {
    id: r.id, document_id: r.document_id, tekst: r.tekst, pagina: r.pagina, paragraaf: null, chunk_index: r.chunk_index, rang,
    documenten: {
      titel: d.titel, bron: "upload", bibliotheek: d.bibliotheek, opslag_pad: null, fonds_id: d.fonds_id,
      documentstatus: d.status, bronstatus: "actief", documentdatum: "2023-01-01", normgewicht: "toezichtverwachting", wettelijk_regime: null,
    },
  };
}
const doorzoekbaar = (r: Rij, docs: Doc[]) => `${docs.find((d) => d.id === r.document_id)!.titel} ${r.tekst}`.toLowerCase();

/** Productievolgorde van het hoofdspoor: DNB p. 1/3/5 voorop, p. 17 afwezig. */
function hoofdspoorKandidaten(docs: Doc[]): DocumentChunk[] {
  const volgorde = ["esg-p1", "esg-p3", "esg-p5", "ren-1", "comp-1", "pf-1", "liq-1", "esg-p20", "hor-1", "esg-p9"];
  const alle = [...ESG_RIJEN, ...OVERIG_RIJEN];
  return volgorde.map((id, i) => chunkVan(alle.find((r) => r.id === id)!, docs, 1 - i / 100));
}

interface ZoekAanroep { vraag: string; hybride: boolean | undefined; scope: string[] | undefined; rerank: unknown }
/**
 * Zoekslag binnen één document: OR-telling over de termen van
 * `bouwTerugvalFtsQuery` (woordbegin, zoals de Nederlandse stemmer grofweg
 * doet), met dezelfde statusfilters als de RPC in modus `actueel`.
 */
function nepZoek(docs: Doc[], aanroepen: ZoekAanroep[], opties: { hangt?: boolean } = {}): typeof zoekRelevanteChunksMetMeta {
  return async (vraag, _fonds, _max, hybride, scope, filters, o) => {
    aanroepen.push({ vraag, hybride, scope, rerank: o?.rerank });
    if (opties.hangt && scope) {
      await new Promise((_, rej) => o?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("afgebroken"), { name: "AbortError" }))));
    }
    const meta = { methode: "fts", opgehaald: 0, geselecteerd: 0, chunks: [] } as unknown as RetrievalMeta;
    if (!scope) return { chunks: hoofdspoorKandidaten(docs), meta };
    const termen = bouwTerugvalFtsQuery(vraag)?.termen ?? [];
    const toegestaan = (r: Rij) => {
      const d = docs.find((x) => x.id === r.document_id)!;
      if (d.status === "gearchiveerd") return false;
      if (filters?.modus === "actueel" && d.status !== "van_kracht") return false;
      return scope.includes(r.document_id);
    };
    const score = (r: Rij) => {
      const woorden = doorzoekbaar(r, docs).split(/[^\p{L}\p{N}]+/u);
      return termen.filter((t) => woorden.some((w) => w.startsWith(t.slice(0, Math.max(4, t.length - 2))))).length;
    };
    const chunks = [...ESG_RIJEN, ...OVERIG_RIJEN]
      .filter(toegestaan)
      .map((r) => ({ r, s: score(r) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.r.chunk_index - b.r.chunk_index)
      .map((x, i) => chunkVan(x.r, docs, 1 - i / 100));
    return { chunks, meta };
  };
}

// ── Orkestratie, zoals de chatroute (CHUNK_BUDGET 10 → maxPerDoc 5, pool 30) ─
const FILTERS: RetrievalFilters = { modus: "actueel", peildatum: "2026-10-08", bronsoort: ["fonds", "generiek"] };
const CITAAT: CitaatOpdracht = { primaireDocumentIds: new Set<string>(), peildatum: "2026-10-08", hoofddocumentLabel: " [hoofddocument]", sentinel: "SENT" };
const GRENZEN = { maxPerDoc: 5, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false };

interface Draai {
  vraag?: string;
  /** Herschreven zoekvraag (gereformuleerd = true); ontbreekt = gelijk aan `vraag`. */
  zoekvraag?: string;
  /** R1-tekstpad (fondsvlag zoek_tekst_v2, env ZOEK_TEKST_V2=on). Standaard aan, zoals Horizon. */
  r1?: { fondsvlag: boolean; env: string | undefined };
  docs?: Doc[];
  spoorAan?: boolean;
  scope?: string[];
  filters?: RetrievalFilters;
  fonds?: string;
  hangt?: boolean;
}
async function draai(o: Draai = {}) {
  const docs = o.docs ?? BASIS_DOCS;
  const fonds = o.fonds ?? HORIZON;
  const vraag = o.vraag ?? VRAAG;
  const log: Aanroep[] = [];
  const zoekAanroepen: ZoekAanroep[] = [];
  const zoek = nepZoek(docs, zoekAanroepen, { hangt: o.hangt });
  let naAdapter: Bronresultaat[] = [];
  let spoor: { status: string; toegevoegd: number } | undefined;
  const r1 = o.r1 ?? { fondsvlag: true, env: "on" };
  const vorigeEnv = process.env.ZOEK_TEKST_V2;
  if (r1.env === undefined) delete process.env.ZOEK_TEKST_V2;
  else process.env.ZOEK_TEKST_V2 = r1.env;
  const retrieval = maakSupabaseAdapter({
    parentRetrieval: false,
    documentspoor: o.spoorAan ?? true,
    zoekTekstV2: r1.fondsvlag,
  } as Adaptervlaggen, {}, {
    zoek,
    leesVersies: async (chunks) => new Map(chunks.map((c) => [c.id, {
      soort: "hash" as const, gecontroleerdOp: "2026-10-08T10:00:00.000Z",
      waarde: maakVolledigeVersieHash(c.document_id, `v-${c.id}`, "c".repeat(64)),
    }])),
    verrijkNotulen: async (c) => c,
    verrijkDocumentmeta: async (c) => c,
    // Het artikel-/sectiespoor is hier niet het onderwerp: doorgeven, geen I/O.
    artikelkandidaten: async (bestaand) => bestaand,
    sectiekandidaten: async (bestaand) => bestaand,
    documentspoor: async (bestaand, opd) => {
      const u = await vulAanMetGenoemdDocument(bestaand, { ...opd, supabase: documentenNep(docs, fonds, log), timeoutMs: 200 });
      spoor = u.meta;
      return u;
    },
  });
  const adapter: RetrievalAdapter = {
    ...retrieval.adapter,
    zoek: async (ctx, q): Promise<AdapterUitkomst> => {
      const u = await retrieval.adapter.zoek(ctx, q);
      naAdapter = u.kandidaten;
      return u;
    },
  };
  const ctx: RetrievalContext = {
    fondsId: fonds,
    actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
    taaktype: "chat_generatie",
    bronbeleid: { bronsoorten: ["fonds", "generiek", "notulen"] },
    correlationId: "corr-documentspoor",
    verzoekStartOp: new Date().toISOString(),
    ...(o.scope ? { scope: { documentIds: o.scope } } : {}),
  };
  const query: RetrievalQuery = {
    naam: "primair", origineleVraag: vraag, zoekvraag: o.zoekvraag ?? vraag, strategie: "gericht",
    maxResultaten: 10, maxKandidaten: 30, maxContextTekens: 120_000, hybrideAan: true,
    filters: o.filters ?? FILTERS,
    ...(o.scope ? { documentScope: o.scope } : {}),
  };
  let uit;
  try {
    uit = await voerVolledigeRetrievalUit(
      ctx,
      { adapter, sporen: [{ query, grenzen: { ...GRENZEN, juridischeIntentie: bepaalJuridischeVraagintentie(vraag) } }] },
      CITAAT
    );
  } finally {
    if (vorigeEnv === undefined) delete process.env.ZOEK_TEKST_V2;
    else process.env.ZOEK_TEKST_V2 = vorigeEnv;
  }
  return { uit, naAdapter, log, zoekAanroepen, spoor };
}
const paginasVan = (lijst: Bronresultaat[], titel = ESG_TITEL) =>
  lijst.filter((b) => b.titel === titel).map((b) => b.locator.pagina);

// ── (B) BINDING ─────────────────────────────────────────────────────────────
const titels = BASIS_DOCS.map((d) => ({ id: d.id, titel: d.titel }));

test("(B) de exacte DNB-vraag bindt precies het ESG-document; de restvraag draagt de titel niet meer", () => {
  const b = bindGenoemdDocument(VRAAG, titels);
  assert.equal(b.status, "eenduidig");
  assert.equal(b.status === "eenduidig" && b.documentId, D.esg);
  const rest = b.status === "eenduidig" ? b.restvraag : "";
  assert.match(rest, /beheersmaatregelen/);
  for (const titelwoord of ["good", "practice", "risicobeheer", "pensioenfondsen"]) {
    assert.ok(!rest.split(" ").includes(titelwoord), `restvraag bevat nog titelwoord ${titelwoord}: ${rest}`);
  }
});

test("(B) M3 ter vergelijking: de brede tak maakt dezelfde vraag ambigu (reden om M3 niet globaal aan te zetten)", () => {
  // `resolveerGenoemdDocument` laat één titelwoord van ≥ 8 tekens tellen:
  // "pensioenfondsen" raakt elke DNB-good-practice met dat woord.
  const m3 = resolveerGenoemdDocument(VRAAG, titels);
  assert.equal(m3.status, "meerdere");
});

test("(B) twee documenten met dezelfde titel: geen binding (fail-closed, niet gokken)", () => {
  const kopie = { id: "kopie", titel: ESG_TITEL };
  assert.deepEqual(bindGenoemdDocument(VRAAG, [...titels, kopie]), { status: "meerdere", aantal: 2 });
});

test("(B) de langste genoemde titel wint; een kortere titel binnen de langere bindt niet", () => {
  const kort = { id: "kort", titel: "ESG risicobeheer pensioenfondsen" };
  const b = bindGenoemdDocument(VRAAG, [...titels, kort]);
  assert.equal(b.status === "eenduidig" && b.documentId, D.esg);
});

test("(B) een korte of losse titel bindt niet; losse titelwoorden binden niet", () => {
  assert.equal(bindGenoemdDocument("Wat zegt ons beleggingsbeleid over ESG?", [{ id: "x", titel: "Beleggingsbeleid" }]).status, "geen");
  assert.equal(bindGenoemdDocument("Welke risico's lopen pensioenfondsen?", titels).status, "geen");
  assert.equal(bindGenoemdDocument("Wat is good practice bij ESG?", titels).status, "geen");
});

test("(B) strikt: een titel met voorvoegsel ('DNB 2023 …') bindt deze vraagvorm niet (geen losse woorden)", () => {
  // De Productietitel heeft GEEN voorvoegsel (bevestigd); deze test borgt alleen
  // dat het predicaat strikt blijft: de volledige titel moet in de vraag staan.
  const metVoorvoegsel = [{ id: D.esg, titel: "DNB 2023 Good Practice ESG-Risicobeheer Pensioenfondsen" }];
  assert.equal(bindGenoemdDocument(VRAAG, metVoorvoegsel).status, "geen");
});

test("(B) zoektermen: alleen lange woorden, alleen letters/cijfers, begrensd", () => {
  assert.deepEqual(titelzoektermen("Wat is de dekkingsgraad?"), ["dekkingsgraad"]);
  assert.deepEqual(titelzoektermen("Wie zit er in het VO?"), []);
  const t = titelzoektermen(VRAAG);
  assert.ok(t.includes("pensioenfondsen") && t.includes("risicobeheer"));
  assert.ok(t.every((w) => /^[\p{L}\p{N}]+$/u.test(w)));
  assert.ok(titelzoektermen("a".repeat(7) + " " + Array.from({ length: 20 }, (_, i) => `woordnummer${i}`).join(" ")).length <= 8);
});

// ── (E) EIND-TOT-EIND ───────────────────────────────────────────────────────
test("(E) zonder spoor (vlag uit) reproduceert de fixture het Productiepatroon: alleen p. 1/3/5, geen p. 17", async () => {
  const { uit, log, zoekAanroepen, spoor } = await draai({ spoorAan: false });
  assert.deepEqual(paginasVan(uit.geselecteerd).sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 3, 5, 9, 20]);
  assert.ok(!uit.contextTekst.includes("GP6"));
  assert.equal(log.length, 0, "vlag uit: geen documentquery");
  assert.equal(zoekAanroepen.length, 1, "vlag uit: alleen het hoofdspoor");
  assert.equal(spoor, undefined);
});

// LET OP — deze nabootsing is optimistischer dan Postgres. In de echte
// `ts_rank_cd`-meting (scripts/meting/documentspoor-fts-rangschikking.sql) staat
// GP6 binnen het document op 1, maar GP7 eindigt gelijk met de titelpagina's op
// plek 6, dus BUITEN de vier van het spoor; ook in Productie staat chunk 98
// lager dan chunk 96. GP7 komt dan alleen mee via de parent-uitbreiding (±1
// chunk) of de vectorarm (R1b). Horizon heeft geen fondsrij parent_retrieval en
// de env-default is onbekend: GP7 is dus NIET bewezen. Deze test borgt GP6.
test("(E) met spoor: GP6 (p. 17) staat in de selectie én in de modelcontext", async () => {
  const { uit, naAdapter, zoekAanroepen, spoor } = await draai();
  // Passage-selectie. Binnen het document scoren p. 5 en p. 17 lexicaal gelijk
  // (de vraag noemt "DNB"); GP6 moet in de vier van het spoor staan.
  const vooraan = naAdapter.slice(0, DOCUMENTSPOOR_MAX);
  assert.ok(vooraan.every((b) => b.titel === ESG_TITEL));
  assert.ok(vooraan.some((b) => b.passage.includes("GP6")), `spoor: ${vooraan.map((b) => b.locator.pagina)}`);
  const esg = paginasVan(uit.geselecteerd);
  assert.ok(esg.includes(17), `p. 17 geselecteerd: ${esg}`);
  assert.ok(esg.length <= 5, "maxPerDoc blijft gelden");
  // Andere bronnen blijven: het spoor is aanvullend, geen scope.
  assert.ok(uit.geselecteerd.some((b) => b.titel !== ESG_TITEL));
  // Antwoordcontext (wat het model krijgt) — niet het modelantwoord zelf.
  assert.match(uit.contextTekst, /GP6 Beheersmaatregelen/);
  // Kosten: één extra zoekslag, op het tekstpad, op één document, zonder reranker.
  assert.equal(zoekAanroepen.length, 2);
  assert.deepEqual(zoekAanroepen[1].scope, [D.esg]);
  assert.equal(zoekAanroepen[1].hybride, false);
  assert.equal(zoekAanroepen[1].rerank, false);
  assert.ok(!/good practice/i.test(zoekAanroepen[1].vraag));
  assert.deepEqual(spoor, { status: "toegevoegd", toegevoegd: Math.min(DOCUMENTSPOOR_MAX, 4) });
});

test("(E) EERLIJKE GRENS: staat het woord van de vraag niet in de passage, dan vindt het tekstpad haar niet vooraan", async () => {
  // Zelfde document, maar p. 17 zegt "mitigerende acties" i.p.v. "beheersmaatregelen".
  const origineel = ESG_RIJEN.map((r) => ({ ...r }));
  try {
    ESG_RIJEN[4].tekst = "GP6. Het fonds legt per materieel risico vast welke mitigerende acties het neemt.";
    ESG_RIJEN[5].tekst = "GP7. Het fonds toetst periodiek of die acties werken en rapporteert aan het bestuur.";
    const { naAdapter } = await draai();
    const top = naAdapter.slice(0, DOCUMENTSPOOR_MAX).map((b) => b.locator.pagina);
    assert.ok(!top.includes(17), `zonder lexicale overlap geen garantie: ${top}`);
  } finally {
    origineel.forEach((r, i) => Object.assign(ESG_RIJEN[i], r));
  }
});

// ── (H) HERFORMULERING ──────────────────────────────────────────────────────
// Route: `origineleVraag = gereformuleerd ? vraag : zoekVraag`. Een herschreven
// zoekvraag kan de letterlijk genoemde titel verliezen.
const HERSCHREVEN = "Welke beheersmaatregelen beschrijft de toezichthouder voor ESG-risico's bij pensioenfondsen?";

test("(H) puur: de herschreven zoekvraag mist de titel, de originele vraag bindt nog; restvraag uit de originele", () => {
  const b = bindGenoemdDocument([HERSCHREVEN, VRAAG], titels);
  assert.equal(b.status === "eenduidig" && b.documentId, D.esg);
  assert.equal(b.status === "eenduidig" && b.restvraag, "welke beheersmaatregelen noemt dnb in de voor esg risico s");
});

test("(H) puur: noemt de zoekvraag de titel ook, dan komt de restvraag uit de zoekvraag", () => {
  const z = "Welke beheersmaatregelen beschrijft de Good practice ESG risicobeheer pensioenfondsen?";
  const b = bindGenoemdDocument([z, VRAAG], titels);
  assert.equal(b.status === "eenduidig" && b.restvraag, "welke beheersmaatregelen beschrijft de");
});

test("(H) puur: zoekvraag en originele vraag noemen elk een ANDER document ⇒ geen binding", () => {
  const z = "Welke beheersmaatregelen noemt de Good practice beheersing renterisico pensioenfondsen?";
  assert.deepEqual(bindGenoemdDocument([z, VRAAG], titels), { status: "meerdere", aantal: 2 });
});

test("(H) eind-tot-eind: herformulering zonder titel bindt via de originele vraag; GP6 in de context", async () => {
  const { uit, zoekAanroepen, spoor } = await draai({ zoekvraag: HERSCHREVEN });
  assert.equal(zoekAanroepen[0].vraag, HERSCHREVEN, "het hoofdspoor zoekt op de herschreven vraag");
  assert.deepEqual(spoor?.status, "toegevoegd");
  assert.deepEqual(zoekAanroepen[1].scope, [D.esg]);
  assert.equal(zoekAanroepen[1].vraag, "welke beheersmaatregelen noemt dnb in de voor esg risico s");
  assert.match(uit.contextTekst, /GP6 Beheersmaatregelen/);
});

// ── (G) GRENZEN ─────────────────────────────────────────────────────────────
test("(G) fail-closed op R1: documentspoor aan maar R1-tekstpad uit ⇒ geen titelquery, geen extra zoekslag", async () => {
  for (const r1 of [
    { fondsvlag: false, env: "on" },      // fonds zonder zoek_tekst_v2
    { fondsvlag: true, env: undefined },  // env-hoofdstop uit
    { fondsvlag: true, env: "off" },
  ]) {
    const { log, zoekAanroepen, spoor, uit } = await draai({ r1 });
    assert.equal(log.length, 0, `geen documentquery bij ${JSON.stringify(r1)}`);
    assert.equal(zoekAanroepen.length, 1, `alleen het hoofdspoor bij ${JSON.stringify(r1)}`);
    assert.equal(spoor, undefined);
    assert.ok(!uit.contextTekst.includes("GP6"));
  }
});

test("(G) een gekozen documentscope wint: geen documentspoor", async () => {
  const { log, zoekAanroepen, spoor } = await draai({ scope: [D.horizonBeleid] });
  assert.equal(log.length, 0);
  assert.equal(zoekAanroepen.length, 1);
  assert.equal(spoor, undefined);
});

test("(G) juridische artikelvraag: ongewijzigd (#500/#548-pad), geen documentspoor", async () => {
  const { log, spoor } = await draai({ vraag: "Wat bepaalt artikel 22 Pensioenwet over hoorrecht?" });
  assert.equal(log.length, 0, "artikelfocus ⇒ geen documentquery");
  assert.equal(spoor, undefined);
});

test("(G) budget: een vraag zonder woord van ≥ 6 tekens krijgt geen documentquery", async () => {
  const { log, zoekAanroepen, spoor } = await draai({ vraag: "Wie zit er in het VO?" });
  assert.equal(log.length, 0);
  assert.equal(zoekAanroepen.length, 1);
  assert.deepEqual(spoor, { status: "geen_zoektermen", toegevoegd: 0 });
});

test("(G) budget: een algemene vraag doet één versmalde titelquery en geen extra zoekslag", async () => {
  const { log, zoekAanroepen, spoor, uit } = await draai({ vraag: "Hoe gaan pensioenfondsen om met klimaatrisico's?" });
  assert.equal(log.length, 1);
  assert.match(log[0].or ?? "", /^titel\.ilike\.%[^,]+%(,titel\.ilike\.%[^,]+%)*$/);
  assert.equal(log[0].limiet, 51);
  assert.equal(zoekAanroepen.length, 1, "geen binding ⇒ geen tweede zoekslag");
  assert.deepEqual(spoor, { status: "geen", toegevoegd: 0 });
  assert.ok(!uit.contextTekst.includes("GP6"));
});

test("(G) harde tijdslimiet: een hangende zoekslag kost de beurt hooguit de limiet en laat de kandidaten ongemoeid", async () => {
  const t0 = Date.now();
  const { spoor, uit } = await draai({ hangt: true });
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(spoor, { status: "timeout", toegevoegd: 0 });
  assert.ok(!uit.contextTekst.includes("GP6"));
});

test("(G) een afgebroken beurt blijft afgebroken (het spoor slikt de afbreking niet in)", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    vulAanMetGenoemdDocument([], {
      teksten: [VRAAG, VRAAG], fondsId: HORIZON, filters: FILTERS, maxKandidaten: 30, signal: ac.signal,
      supabase: documentenNep(BASIS_DOCS, HORIZON, []), zoek: nepZoek(BASIS_DOCS, []),
    })
  );
});

// ── (N) NEGATIEF ────────────────────────────────────────────────────────────
const metEsg = (patch: Partial<Doc>) => BASIS_DOCS.map((d) => (d.id === D.esg ? { ...d, ...patch } : d));

test("(N) ambigu: dezelfde titel ook als fondsdocument ⇒ geen binding, oud gedrag", async () => {
  const docs = [...BASIS_DOCS, { ...BASIS_DOCS[0], id: "e5000000-0000-4000-8000-0000000000f1", bibliotheek: "fonds" as const, fonds_id: HORIZON }];
  const { spoor, zoekAanroepen } = await draai({ docs });
  assert.deepEqual(spoor, { status: "meerdere", toegevoegd: 0 });
  assert.equal(zoekAanroepen.length, 1);
});

test("(N) ander fonds: een titel die alleen in een ander fonds bestaat, bindt nooit (RLS)", async () => {
  const { spoor, zoekAanroepen } = await draai({ vraag: "Wat staat in Risicobeheer ESG ander fonds over engagement?" });
  assert.deepEqual(spoor, { status: "geen", toegevoegd: 0 });
  assert.equal(zoekAanroepen.length, 1);
});

test("(N) ander fonds, omgekeerd: het eigen fondsdocument van Horizon bindt niet voor een ander fonds", async () => {
  const vraag = "Wat staat in Beleid maatschappelijk verantwoord beleggen Horizon 2026 over uitsluitingen?";
  assert.deepEqual((await draai({ vraag })).spoor?.status, "toegevoegd");
  const ander = await draai({ vraag, fonds: ANDER_FONDS });
  assert.deepEqual(ander.spoor, { status: "geen", toegevoegd: 0 });
});

test("(N) concept: binding, maar de zoekslag levert onder modus actueel niets ⇒ oud gedrag", async () => {
  const { spoor, uit } = await draai({ docs: metEsg({ status: "concept" }) });
  assert.deepEqual(spoor, { status: "geen_passages", toegevoegd: 0 });
  assert.ok(!uit.contextTekst.includes("GP6"));
});

test("(N) gearchiveerd: geen passages", async () => {
  const { spoor } = await draai({ docs: metEsg({ status: "gearchiveerd" }) });
  assert.deepEqual(spoor, { status: "geen_passages", toegevoegd: 0 });
});

test("(N) niet geïndexeerd: geen binding", async () => {
  const { spoor } = await draai({ docs: metEsg({ geindexeerd: false }) });
  assert.deepEqual(spoor, { status: "geen", toegevoegd: 0 });
});

test("(N) ongescand onder WP3: geen binding, geen zoekslag", async () => {
  const vorig = process.env.WP3_MALWARESCAN_AAN;
  process.env.WP3_MALWARESCAN_AAN = "true";
  try {
    const { spoor, zoekAanroepen } = await draai({ docs: metEsg({ scan: false }) });
    assert.deepEqual(spoor, { status: "geen", toegevoegd: 0 });
    assert.equal(zoekAanroepen.length, 1);
  } finally {
    if (vorig === undefined) delete process.env.WP3_MALWARESCAN_AAN;
    else process.env.WP3_MALWARESCAN_AAN = vorig;
  }
});

test("(N) bronsoortfilter alleen fonds: een generiek document wordt niet via het spoor binnengehaald", async () => {
  const { spoor, zoekAanroepen } = await draai({ filters: { ...FILTERS, bronsoort: ["fonds"] } });
  assert.deepEqual(spoor, { status: "bronsoort_buiten_filter", toegevoegd: 0 });
  assert.equal(zoekAanroepen.length, 1);
});
