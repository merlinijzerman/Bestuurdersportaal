// ============================================================================
//  #548-R5 — gedeelde fixture: genoemd juridisch document + meerdere artikelen.
//  Gebruikt door tests/cross-tenant/retrieval-artikelbron-548.test.ts en de
//  vóór/na-meting scripts/meting/548-r5-artikelbron-meting.mts.
//
//  De ECHTE structuur van het Besluit uitvoering Pensioenwet en Wvb (p. 22-27
//  van de wetten.nl-afdruk, BWBR0020892) gaat door dezelfde PDF-bronblokken en
//  chunkbouw als de ingest: art. 19a (5 chunks), 19b (3) en 22 (1), zoals in
//  Productie. Daarnaast synthetische bronnen die óók een "Artikel 22" hebben:
//  Pensioenwet (hoorrecht), Wvb, een MvT en een fondsreglement.
//
//  De Supabase-client is een nep-PostgREST die de filters van het artikelspoor
//  ECHT uitvoert (documenttype, document_id-scope, imatch, order, limit).
//  Hermetisch: geen netwerk, geen database.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bouwBronblokken } from "../../../core/lib/pdf-bronblokken";
import { bouwChunkRecordsZonderVerrijking } from "../../../core/lib/chunk-bouw";
import { voerVolledigeRetrievalUit } from "../../../core/lib/retrieval/orkestratie";
import { maakSupabaseAdapter, type Adaptervlaggen } from "../../../core/lib/retrieval/supabase-adapter";
import { vulAanMetArtikelkandidaten, vulAanMetSectiekandidaten, type DocumentChunk, type RetrievalFilters, type RetrievalMeta } from "../../../core/lib/rag";
import { bepaalJuridischeVraagintentie } from "../../../core/lib/vraagtype";
import { maakVolledigeVersieHash } from "../../../core/lib/retrieval/identiteit";
import type {
  AdapterUitkomst,
  Bronresultaat,
  CitaatOpdracht,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../../../core/lib/retrieval/contract";

const hier = dirname(fileURLToPath(import.meta.url));

export const VRAAG_EXPLICIET =
  "Wat staat in artikel 19a, 19b en 22 van het Besluit uitvoering Pensioenwet en Wet verplichte beroepspensioenregeling over individuele waardeoverdracht?";
export const VRAAG_BREED =
  "Kun je de termijnen voor individuele waardeoverdrachten achterhalen? Mogelijk in de toelichting van de Pensioenwet?";

// Synthetische id's; de sorteervolgorde spiegelt Productie (het Besluit staat
// ná de Pensioenwet en de MvT in `order by document_id`).
export const FONDS = "11111111-1111-4111-8111-111111111111";
export const MVT_DOC = "1e000000-0000-4000-8000-000000000548";
export const PW_DOC = "3a000000-0000-4000-8000-000000000548";
export const WVB_DOC = "5b000000-0000-4000-8000-000000000548";
export const BESLUIT_DOC = "c9d60000-0000-4000-8000-000000000548";
export const FONDS_DOC = "f0000000-0000-4000-8000-000000000548";
export const BESLUIT_TITEL = "Besluit uitvoering Pensioenwet en Wet verplichte beroepspensioenregeling";

export interface FixtureDocument {
  id: string;
  korteNaam: string;
  titel: string;
  documenttype: string | null;
  wetsgeschiedenis_subtype: string | null;
  bibliotheek: "generiek" | "fonds";
  fonds_id: string | null;
  wettelijk_regime: string | null;
  normgewicht: string | null;
}
export const DOCUMENTEN: FixtureDocument[] = [
  { id: MVT_DOC, korteNaam: "MvT", titel: "Kamerstukken II 2005/06, 30 413, nr. 3 (Memorie van toelichting Pensioenwet)", documenttype: "wetsgeschiedenis", wetsgeschiedenis_subtype: "memorie_van_toelichting", bibliotheek: "generiek", fonds_id: null, wettelijk_regime: "pw", normgewicht: "informatief" },
  { id: PW_DOC, korteNaam: "Pensioenwet", titel: "Pensioenwet", documenttype: "wetgeving", wetsgeschiedenis_subtype: null, bibliotheek: "generiek", fonds_id: null, wettelijk_regime: "pw", normgewicht: "bindend" },
  { id: WVB_DOC, korteNaam: "Wvb", titel: "Wet verplichte beroepspensioenregeling", documenttype: "wetgeving", wetsgeschiedenis_subtype: null, bibliotheek: "generiek", fonds_id: null, wettelijk_regime: "wvb", normgewicht: "bindend" },
  { id: BESLUIT_DOC, korteNaam: "Besluit", titel: BESLUIT_TITEL, documenttype: "wetgeving", wetsgeschiedenis_subtype: null, bibliotheek: "generiek", fonds_id: null, wettelijk_regime: "beide", normgewicht: "bindend" },
  { id: FONDS_DOC, korteNaam: "Fonds", titel: "Pensioenreglement 2026", documenttype: null, wetsgeschiedenis_subtype: null, bibliotheek: "fonds", fonds_id: FONDS, wettelijk_regime: null, normgewicht: null },
];
export const docVan = (id: string): FixtureDocument => DOCUMENTEN.find((d) => d.id === id)!;

export interface Tabelrij {
  id: string;
  document_id: string;
  chunk_index: number;
  pagina: number;
  tekst: string;
  structuur_label: string | null;
}

/** Het Besluit, p. 22-27, exact zoals de ingest het in chunks legt. */
function besluitChunks(): Tabelrij[] {
  const fx = JSON.parse(readFileSync(resolve(hier, "../../fixtures/pdf-tekstitems/besluit-uitvoering-pw-vpl-p22-27.json"), "utf8"));
  const { segmenten } = bouwBronblokken(fx.paginas);
  return bouwChunkRecordsZonderVerrijking({ documentId: BESLUIT_DOC, segmenten }).map((r) => ({
    id: `besluit-${r.chunk_index}`,
    document_id: BESLUIT_DOC,
    chunk_index: r.chunk_index,
    pagina: r.pagina ?? 0,
    tekst: r.tekst,
    structuur_label: r.structuur_label ?? null,
  }));
}

function synthetisch(document_id: string, prefix: string, rijen: [string | null, string][]): Tabelrij[] {
  return rijen.map(([label, tekst], i) => ({ id: `${prefix}-${i}`, document_id, chunk_index: i, pagina: i + 1, tekst, structuur_label: label }));
}

export const TABEL: Tabelrij[] = [
  ...besluitChunks(),
  ...synthetisch(PW_DOC, "pw", [
    ["Artikel 21", "Artikel 21. Informatie over toeslagverlening\nDe pensioenuitvoerder informeert de deelnemer jaarlijks."],
    ["Artikel 22", "Artikel 22. Hoorrecht\nDe pensioenuitvoerder stelt belanghebbenden in de gelegenheid te worden gehoord."],
    ["Artikel 70", "Artikel 70. Recht op waardeoverdracht\nDe gewezen deelnemer heeft recht op waardeoverdracht."],
    ["Artikel 71", "Artikel 71. Uitvoering waardeoverdracht\nDe ontvangende pensioenuitvoerder verzoekt om overdracht."],
    ["Artikel 72", "Artikel 72. Termijnen waardeoverdracht\nDe overdragende uitvoerder draagt de waarde over."],
  ]),
  ...synthetisch(WVB_DOC, "wvb", [
    ["Artikel 22", "Artikel 22. Informatie bij einde deelneming\nDe beroepspensioenuitvoerder informeert de gewezen deelnemer."],
    ["Artikel 66", "Artikel 66. Waardeoverdracht beroepspensioen\nDe gewezen deelnemer heeft recht op waardeoverdracht."],
  ]),
  ...synthetisch(MVT_DOC, "mvt", [
    ["Artikelsgewijze toelichting — Artikel 22", "Artikel 22 (hoorrecht)\nMet dit artikel beoogt de wetgever een hoorrecht te verankeren."],
    ["Artikelsgewijze toelichting — Artikel 70", "Artikel 70 (waardeoverdracht)\nHet recht op waardeoverdracht wordt verduidelijkt."],
    ["§ 4.3", "Algemeen deel over waardeoverdracht en de termijnen daarvan."],
  ]),
  ...synthetisch(FONDS_DOC, "fonds", [
    ["Artikel 22", "Artikel 22 Waardeoverdracht\nHet fonds voert waardeoverdracht uit binnen zes maanden."],
    [null, "Toelichting van het bestuur op de uitvoering van waardeoverdrachten."],
  ]),
];
export const rijVan = (id: string): Tabelrij => TABEL.find((r) => r.id === id)!;

// ── Nep-PostgREST ───────────────────────────────────────────────────────────
function splitsOr(filter: string): string[] {
  const delen: string[] = [];
  let huidig = "";
  let inAanhaling = false;
  for (const teken of filter) {
    if (teken === '"') inAanhaling = !inAanhaling;
    if (teken === "," && !inAanhaling) {
      delen.push(huidig);
      huidig = "";
    } else huidig += teken;
  }
  if (huidig) delen.push(huidig);
  return delen;
}
function orPredicaat(filter: string): (r: Tabelrij) => boolean {
  const termen = splitsOr(filter).map((deel) => {
    const m = deel.match(/^([a-z_]+)\.imatch\."(.*)"$/);
    assert.ok(m, `onbekend filterdeel: ${deel}`);
    const re = new RegExp(m[2], "i");
    return (r: Tabelrij) => re.test(String((r as unknown as Record<string, unknown>)[m[1]] ?? ""));
  });
  return (r) => termen.some((t) => t(r));
}
function toelatingsRij(r: Tabelrij) {
  const d = docVan(r.document_id);
  return {
    id: r.id,
    document_id: r.document_id,
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: null,
    chunk_index: r.chunk_index,
    documentstatus: "van_kracht",
    bronstatus: "actief",
    documentdatum: "2026-01-01",
    geldig_vanaf: null,
    geldig_tot: null,
    procesinstantie_id: null,
    bronorganisatie: null,
    normgewicht: d.normgewicht,
    extern_url: null,
    wettelijk_regime: d.wettelijk_regime,
    bibliotheek: d.bibliotheek,
    documenten: { titel: d.titel, bron: "upload", bibliotheek: d.bibliotheek, opslag_pad: null, fonds_id: d.fonds_id, volgende_review: null, actief: true },
  };
}

export interface Aanroep {
  tabel: string;
  methode: string;
  args: unknown[];
}
export function postgrestNep(log: Aanroep[] = []) {
  return {
    from: (naam: string) => {
      let or: (r: Tabelrij) => boolean = () => true;
      let documentIds: string[] | null = null;
      let ids: string[] | null = null;
      let documenttypen: string[] | null = null;
      let toelating = false;
      let limiet = Infinity;
      // Het sectiespoor (#548): ilike op de tekst en een chunk_index-venster.
      let ilike: RegExp | null = null;
      let eqDocument: string | null = null;
      let vanaf = -Infinity;
      let tot = Infinity;
      const builder: Record<string, unknown> = {};
      const leg = (methode: string, args: unknown[]) => log.push({ tabel: naam, methode, args });
      builder.select = (kolommen: string) => {
        leg("select", [kolommen]);
        // De toelating joint de documentrij (`documenten!inner` of, sinds R1b,
        // met vastgepinde FK `documenten!document_chunks_document_id_fkey!inner`).
        toelating = /documenten!(?:[a-z_]+!)?inner/.test(kolommen);
        return builder;
      };
      builder.order = () => builder;
      builder.eq = (k: string, v: unknown) => {
        if (k === "document_id") eqDocument = String(v);
        if (k === "documenttype") documenttypen = [String(v)];
        return builder;
      };
      builder.ilike = (k: string, patroon: string) => {
        if (k === "tekst") {
          const kern = patroon.split("%").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
          ilike = new RegExp(`^${kern}$`, "is");
        }
        return builder;
      };
      builder.gte = (_k: string, v: number) => {
        vanaf = v;
        return builder;
      };
      builder.lte = (_k: string, v: number) => {
        tot = v;
        return builder;
      };
      builder.textSearch = () => builder;
      builder.abortSignal = () => builder;
      builder.in = (k: string, v: string[]) => {
        leg("in", [k, v]);
        if (k === "document_id") documentIds = v;
        if (k === "id") ids = v;
        if (k === "documenttype") documenttypen = v;
        return builder;
      };
      builder.or = (f: string) => {
        if (!toelating) or = orPredicaat(f);
        return builder;
      };
      builder.limit = (n: number) => {
        leg("limit", [n]);
        limiet = n;
        return builder;
      };
      builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (naam === "documenten") {
          const data = DOCUMENTEN
            .filter((d) => !documenttypen || (d.documenttype !== null && documenttypen.includes(d.documenttype)))
            .filter((d) => !ids || ids.includes(d.id))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, limiet)
            .map((d) => ({ id: d.id, titel: d.titel, documenttype: d.documenttype, bestand_hash: null, scan_resultaat: null }));
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
        if (toelating) {
          const data = TABEL.filter((t) => (ids ?? []).includes(t.id)).map(toelatingsRij);
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
        const data = TABEL
          .filter((r) => (!documentIds || documentIds.includes(r.document_id)) && or(r))
          .filter((r) => (!eqDocument || r.document_id === eqDocument) && (!ilike || ilike.test(r.tekst)))
          .filter((r) => r.chunk_index >= vanaf && r.chunk_index <= tot)
          .sort((a, b) => a.document_id.localeCompare(b.document_id) || a.chunk_index - b.chunk_index)
          .slice(0, limiet)
          .map(({ id, document_id, chunk_index, tekst, structuur_label }) => ({ id, document_id, chunk_index, tekst, structuur_label }));
        return Promise.resolve({ data, error: null }).then(res, rej);
      };
      return builder;
    },
  };
}

// ── De hybride zoek-RPC, nagebootst ─────────────────────────────────────────
export function chunkVan(r: Tabelrij, rang: number): DocumentChunk {
  const d = docVan(r.document_id);
  return {
    id: r.id,
    document_id: r.document_id,
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: null,
    chunk_index: r.chunk_index,
    rang,
    documenten: {
      titel: d.titel,
      bron: "upload",
      bibliotheek: d.bibliotheek,
      opslag_pad: null,
      fonds_id: d.fonds_id,
      documentstatus: "van_kracht",
      bronstatus: "actief",
      documentdatum: "2026-01-01",
      normgewicht: d.normgewicht,
      wettelijk_regime: d.wettelijk_regime,
    },
  };
}

/**
 * Wat de zoek-RPC op de expliciete vraag teruggeeft: de 19a-passages van het
 * Besluit scoren hoog ("waardeoverdracht"), 19b en 22 niet; verder de
 * Pensioenwet over waardeoverdracht, andere §6.2-artikelen, het fondsreglement,
 * MvT en Wvb. 30 kandidaten (= de kandidatenpool bij 10 resultaten).
 */
export function hybrideKandidaten(): DocumentChunk[] {
  const besluit = TABEL.filter((r) => r.document_id === BESLUIT_DOC);
  const label = (l: string) => besluit.filter((r) => r.structuur_label === l);
  const volgorde: Tabelrij[] = [
    ...label("Artikel 19a"),
    rijVan("pw-3"), rijVan("pw-4"), rijVan("pw-2"),
    ...label("Artikel 18"), ...label("Artikel 20"), ...label("Artikel 21"), ...label("Artikel 23"),
    rijVan("fonds-0"), rijVan("fonds-1"),
    ...label("Artikel 19"), ...label("Artikel 17g"),
    rijVan("mvt-2"), rijVan("mvt-1"), rijVan("wvb-1"),
    ...label("Artikel 23a"), ...label("Artikel 24"),
    rijVan("pw-1"),
  ];
  return volgorde.slice(0, 30).map((r, i) => chunkVan(r, 1 - i / 100));
}

// ── Orkestratie + adapter, zoals de chat-route ──────────────────────────────
export const FILTERS: RetrievalFilters = { modus: "actueel", peildatum: "2026-10-06", bronsoort: ["fonds", "generiek"] };
const CTX: RetrievalContext = {
  fondsId: FONDS,
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds", "generiek", "notulen"] },
  correlationId: "corr-548-r5",
  verzoekStartOp: new Date().toISOString(),
};
const CITAAT: CitaatOpdracht = {
  primaireDocumentIds: new Set<string>(),
  peildatum: "2026-10-06",
  hoofddocumentLabel: " [hoofddocument]",
  sentinel: "SENT",
};
// De chat-route: CHUNK_BUDGET 10 → maxPerDoc 5, kandidatenpool 30.
const GRENZEN = { maxPerDoc: 5, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false };
const query = (vraag: string): RetrievalQuery => ({
  naam: "primair",
  origineleVraag: vraag,
  zoekvraag: vraag,
  strategie: "gericht",
  maxResultaten: 10,
  maxKandidaten: 30,
  maxContextTekens: 120_000,
  hybrideAan: true,
  filters: FILTERS,
});

export async function draai(vraag: string, kandidaten: () => DocumentChunk[] = hybrideKandidaten) {
  const log: Aanroep[] = [];
  const client = postgrestNep(log);
  const vaste = { soort: "hash" as const, gecontroleerdOp: "2026-10-06T10:00:00.000Z" };
  let naAdapter: Bronresultaat[] = [];
  const retrieval = maakSupabaseAdapter({ parentRetrieval: false } as Adaptervlaggen, {}, {
    zoek: async () => ({
      chunks: kandidaten(),
      meta: { methode: "hybride_rrf", opgehaald: 30, geselecteerd: 0, chunks: [] } as unknown as RetrievalMeta,
    }),
    leesVersies: async (chunks) =>
      new Map(chunks.map((c) => [c.id, { ...vaste, waarde: maakVolledigeVersieHash(c.document_id, `r1-${c.id}`, "c".repeat(64)) }])),
    verrijkNotulen: async (chunks) => chunks,
    verrijkDocumentmeta: async (chunks) => {
      for (const c of chunks) {
        const d = docVan(c.document_id);
        c.documenten.documenttype = d.documenttype;
        c.documenten.wetsgeschiedenis_subtype = d.wetsgeschiedenis_subtype;
      }
      return chunks;
    },
    artikelkandidaten: (bestaand, o) => vulAanMetArtikelkandidaten(bestaand, { ...o, supabase: client }),
    sectiekandidaten: (bestaand, o) => vulAanMetSectiekandidaten(bestaand, { ...o, supabase: client }),
  });
  const adapter: RetrievalAdapter = {
    ...retrieval.adapter,
    zoek: async (ctx, q): Promise<AdapterUitkomst> => {
      const u = await retrieval.adapter.zoek(ctx, q);
      naAdapter = u.kandidaten;
      return u;
    },
  };
  const intentie = bepaalJuridischeVraagintentie(vraag);
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter, sporen: [{ query: query(vraag), grenzen: { ...GRENZEN, juridischeIntentie: intentie } }] },
    CITAAT
  );
  return { uit, naAdapter, log };
}

/** "Besluit 19a", "Pensioenwet 22", … — welk artikel uit welke regeling een passage is. */
export function artikelVan(b: Pick<Bronresultaat, "titel" | "locator">): string | null {
  const doc = DOCUMENTEN.find((d) => d.titel === b.titel);
  const rij = doc && TABEL.find((r) => r.document_id === doc.id && r.chunk_index === b.locator.chunkIndex);
  const m = rij?.structuur_label?.match(/Artikel (\d+[a-z]*)/);
  return m ? `${doc!.korteNaam} ${m[1]}` : null;
}
export const artikelenIn = (lijst: Bronresultaat[]): string[] =>
  lijst.map(artikelVan).filter((a): a is string => a !== null);
