// ============================================================================
//  §15-matrix — Documentspoor: meerdere BENOEMDE SECTIES binnen één letterlijk
//  genoemd document. Hermetisch: geen netwerk, geen database.
//
//  Het faalpatroon (Productiecanary na PR #574, documentspoor aan): een vraag
//  naar GP6 én GP7 uit een letterlijk genoemde good practice. Het spoor bond
//  het document en voegde vier passages toe (152–170 ms), met GP7 (chunk 97)
//  maar zonder de GP6-kern (chunk 91; 92 is vervolg). Het antwoord stelde
//  daardoor onterecht dat GP6 ontbrak.
//
//  Oorzaak (gereproduceerd in (R)): na het weghalen van de titel blijven `gp6`
//  en `gp7` in de restvraag, maar
//    - de STRIKTE FTS-poging eist beide in één chunk ⇒ 0 rijen;
//    - de OR-terugval laat woorden < 4 tekens vallen (fts-terugval.ts,
//      MIN_LENGTE) ⇒ de identificatoren verdwijnen uit de rangschikking;
//    - een gedeeld woord ("effectiviteit") trekt GP7 binnen, de GP6-kern niet.
//
//  Kopvorm: de fixture volgt de Productiestructuur (read-only bevestigd door de
//  opdrachtgever): de GP6-kop staat in chunk 91 pas na ~370 tekens als
//  "\n\n**GP6: Een pensioenfonds …", de GP7-kop in chunk 97 na ~135 tekens; 92
//  is GP6-vervolg en 98 begint met doorlopende GP7-tekst. De beoogde set is dus
//  exact vier: 91 + 92 + 97 + 98. De TEKST is synthetisch (eigen formulering). Getoetst:
//  herkenning, kopkeuze, alles-of-niets, begrenzing, toelating en contextopbouw
//  — niet de Postgres-RPC onder RLS en niet het modelantwoord.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/retrieval-documentspoor-secties.test.ts
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  classificeerIdentificatoren,
  herkenIdentificatoren,
  isSectiekop,
  isVervolg,
  MAX_IDENTIFICATOREN,
  reeksImatch,
} from "../../core/lib/retrieval/genoemd-document";
import { bouwTerugvalFtsQuery } from "../../core/lib/fts-terugval";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import { maakSupabaseAdapter, type Adaptervlaggen } from "../../core/lib/retrieval/supabase-adapter";
import {
  DOCUMENTSPOOR_MAX,
  DOCUMENTSPOOR_SECTIE_OPZOEK_MAX,
  vulAanMetGenoemdDocument,
  zoekRelevanteChunksMetMeta,
  type DocumentChunk,
  type RetrievalFilters,
  type RetrievalMeta,
} from "../../core/lib/rag";
import { TOELATING_SELECT } from "../../core/lib/retrieval/artikeltoelating";
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
const FONDS_A = "c9f583dc-0000-4000-8000-00000000000a";
const ANDER_FONDS = "c9f583dc-0000-4000-8000-00000000000b";
const TITEL = "Good practice ESG risicobeheer pensioenfondsen";
const VRAAG_TWEE = `Wat zeggen GP6 en GP7 uit ${TITEL} over beheersmaatregelen en effectiviteit?`;
const HASH = "a".repeat(64);
const SCHOON = { verdict: "clean", sha256: HASH };

type Status = "van_kracht" | "concept" | "gearchiveerd";
interface Doc {
  id: string; titel: string; bibliotheek: "generiek" | "fonds"; fonds_id: string | null;
  documenttype: string | null; status: Status; scan: boolean;
}
const D = {
  esg: "e6000000-0000-4000-8000-000000000001",
  rente: "e6000000-0000-4000-8000-000000000002",
  ander: "e6000000-0000-4000-8000-000000000003",
};
const BASIS: Doc[] = [
  { id: D.esg, titel: TITEL, bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", scan: true },
  { id: D.rente, titel: "Good practice beheersing renterisico pensioenfondsen", bibliotheek: "generiek", fonds_id: null, documenttype: null, status: "van_kracht", scan: true },
  { id: D.ander, titel: "Eigen duurzaamheidskader ander pensioenfonds", bibliotheek: "fonds", fonds_id: ANDER_FONDS, documenttype: null, status: "van_kracht", scan: true },
];
interface Rij { id: string; document_id: string; pagina: number; chunk_index: number; tekst: string }
const STAART_GP5 = "Het fonds bespreekt de uitkomsten van de monitoring in het risicocomité en legt vast welke signalen aanleiding geven tot nader onderzoek. "
  .repeat(3).slice(0, 370);
const STAART_GP6 = "Tot slot legt het fonds vast hoe het de voortgang op deze punten bewaakt en wie daarover aan het bestuur rapporteert. ".slice(0, 135);
const RIJEN: Rij[] = [
  { id: "s-0", document_id: D.esg, pagina: 1, chunk_index: 0, tekst: `${TITEL}. De Nederlandsche Bank, 2023.` },
  { id: "s-4", document_id: D.esg, pagina: 5, chunk_index: 4, tekst: "Inleiding. In GP6 en GP7 beschrijft DNB de beheersing en de toetsing van ESG-risico's." },
  { id: "s-50", document_id: D.esg, pagina: 10, chunk_index: 50, tekst: "De CO2-uitstoot van de portefeuille daalde in de onderzochte periode." },
  { id: "s-51", document_id: D.esg, pagina: 10, chunk_index: 51, tekst: "Fondsen meten de CO2-intensiteit jaarlijks en vergelijken die met een benchmark." },
  { id: "s-85", document_id: D.esg, pagina: 16, chunk_index: 85, tekst: "**GP5: Een pensioenfonds monitort de ontwikkeling van materiële risico's.**\nDe monitoring is periodiek." },
  { id: "s-91", document_id: D.esg, pagina: 17, chunk_index: 91, tekst: `${STAART_GP5}\n\n**GP6: Een pensioenfonds legt per materieel risico vast welke mitigerende acties het neemt**` },
  { id: "s-92", document_id: D.esg, pagina: 17, chunk_index: 92, tekst: "en wie daarvoor verantwoordelijk is. Daarbij worden limieten en uitsluitingen vastgelegd en wordt engagement ingezet." },
  { id: "s-96", document_id: D.esg, pagina: 17, chunk_index: 96, tekst: "Een fonds verwees in zijn beleid naar GP6; zie GP6 ook voor engagement. Zoals **GP6** aangeeft, hoort daar een eigenaar bij." },
  { id: "s-97", document_id: D.esg, pagina: 18, chunk_index: 97, tekst: `${STAART_GP6}\n\n**GP7: Een pensioenfonds toetst periodiek de effectiviteit van de genomen maatregelen**` },
  { id: "s-98", document_id: D.esg, pagina: 18, chunk_index: 98, tekst: "die het fonds voor de materiële risico's heeft genomen, en legt de uitkomst vast in het risicoverslag." },
  // Negatieve vervolgtest: GP8 aan het chunkbegin, en een chunk die met lege
  // regels en daarna een NIEUWE kop (GP9) begint.
  { id: "s-99", document_id: D.esg, pagina: 19, chunk_index: 99, tekst: "**GP8: Een pensioenfonds rapporteert jaarlijks over ESG-risico's aan het bestuur.**" },
  { id: "s-100", document_id: D.esg, pagina: 19, chunk_index: 100, tekst: "\n\n**GP9: Een pensioenfonds evalueert zijn ESG-beleid periodiek**" },
  { id: "s-110", document_id: D.esg, pagina: 21, chunk_index: 110, tekst: "Bijlage. Overzicht van GP1 tot en met GP8.\n\n**GP6** is volgens deze bijlage de kern van de beheersing." },
  { id: "r-6", document_id: D.rente, pagina: 7, chunk_index: 6, tekst: "\n\n**GP6: Een pensioenfonds dekt renterisico af volgens zijn beleid**" },
  { id: "a-6", document_id: D.ander, pagina: 3, chunk_index: 6, tekst: "**GP6: Eigen kader van een ander fonds**" },
];

// ── Nep-PostgREST: `documenten` en `document_chunks`, RLS = generiek + eigen fonds ─
interface Aanroep { tabel: string; soort: "titels" | "opzoeking" | "vervolg" | "toelating"; limiet: number; filter: string | null }
const zichtbaar = (d: Doc, fonds: string) => d.fonds_id === null || d.fonds_id === fonds;
function posixNaarJs(patroon: string): RegExp {
  return new RegExp(
    patroon.replace(/\[\^\[:alnum:\]\]/g, "[^\\p{L}\\p{N}]").replace(/\[\[:alpha:\]\]/g, "\\p{L}"),
    "iu"
  );
}
function nepClient(docs: Doc[], fonds: string, log: Aanroep[], vertraging = 0) {
  return {
    from: (tabel: string) => {
      const st: { cols: string; eq: Record<string, unknown>; ins: Record<string, unknown[]>; or: string[]; limiet: number } =
        { cols: "", eq: {}, ins: {}, or: [], limiet: Infinity };
      const b: Record<string, unknown> = {};
      b.select = (c: string) => { st.cols = c; return b; };
      b.eq = (k: string, v: unknown) => { st.eq[k] = v; return b; };
      b.in = (k: string, v: unknown[]) => { st.ins[k] = v; return b; };
      b.or = (f: string) => { st.or.push(f); return b; };
      b.textSearch = () => b;
      b.order = () => b;
      b.limit = (n: number) => { st.limiet = n; return b; };
      b.abortSignal = () => b;
      b.then = async (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (vertraging) await new Promise((r) => setTimeout(r, vertraging));
        const docVan = (id: string) => docs.find((d) => d.id === id);
        if (tabel === "documenten") {
          log.push({ tabel, soort: "titels", limiet: st.limiet, filter: st.or[0] ?? null });
          const termen = (st.or[0] ?? "").split(",").filter(Boolean).map((deel) => deel.match(/^titel\.ilike\.%(.+)%$/)![1].toLowerCase());
          const data = docs.filter((d) => zichtbaar(d, fonds))
            .filter((d) => termen.some((t) => d.titel.toLowerCase().includes(t)))
            .slice(0, st.limiet)
            .map((d) => ({ id: d.id, titel: d.titel, documenttype: d.documenttype, bibliotheek: d.bibliotheek, fonds_id: d.fonds_id,
              bestand_hash: d.scan ? HASH : null, scan_resultaat: d.scan ? SCHOON : null }));
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
        assert.equal(tabel, "document_chunks");
        const rlsRijen = RIJEN.filter((r) => { const d = docVan(r.document_id); return d && zichtbaar(d, fonds); });
        if (st.cols === TOELATING_SELECT) {
          log.push({ tabel, soort: "toelating", limiet: st.limiet, filter: null });
          const ids = (st.ins.id ?? []) as string[];
          const data = rlsRijen.filter((r) => ids.includes(r.id)).slice(0, st.limiet).map((r) => {
            const d = docVan(r.document_id)!;
            return { id: r.id, document_id: r.document_id, tekst: r.tekst, pagina: r.pagina, paragraaf: null, chunk_index: r.chunk_index,
              documentstatus: d.status, bronstatus: "actief", documentdatum: "2023-01-01", geldig_vanaf: null, geldig_tot: null,
              procesinstantie_id: null, bronorganisatie: null, normgewicht: "toezichtverwachting", extern_url: null, wettelijk_regime: null,
              bibliotheek: d.bibliotheek,
              documenten: { titel: d.titel, bron: "upload", bibliotheek: d.bibliotheek, opslag_pad: null, fonds_id: d.fonds_id, volgende_review: null, actief: true } };
          });
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
        const opDocument = rlsRijen.filter((r) => r.document_id === st.eq.document_id);
        if (st.ins.chunk_index) {
          log.push({ tabel, soort: "vervolg", limiet: st.limiet, filter: null });
          const data = opDocument.filter((r) => (st.ins.chunk_index as number[]).includes(r.chunk_index)).slice(0, st.limiet);
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
        log.push({ tabel, soort: "opzoeking", limiet: st.limiet, filter: st.or[0] ?? null });
        const patronen = (st.or[0] ?? "").split(/,(?=tekst\.imatch\.)/).map((deel) => posixNaarJs(deel.match(/^tekst\.imatch\."(.+)"$/)![1]));
        const data = opDocument.filter((r) => patronen.some((p) => p.test(r.tekst)))
          .sort((a, c) => a.chunk_index - c.chunk_index).slice(0, st.limiet);
        return Promise.resolve({ data, error: null }).then(res, rej);
      };
      return b;
    },
  };
}

// ── Nagebootste zoek-RPC (hoofdspoor + FTS-terugval binnen het document) ────
function chunkVan(r: Rij, docs: Doc[], rang: number): DocumentChunk {
  const d = docs.find((x) => x.id === r.document_id)!;
  return {
    id: r.id, document_id: r.document_id, tekst: r.tekst, pagina: r.pagina, paragraaf: null, chunk_index: r.chunk_index, rang,
    documenten: { titel: d.titel, bron: "upload", bibliotheek: d.bibliotheek, opslag_pad: null, fonds_id: d.fonds_id,
      documentstatus: d.status, bronstatus: "actief", documentdatum: "2023-01-01", normgewicht: "toezichtverwachting", wettelijk_regime: null },
  };
}
const HOOFDSPOOR = ["s-0", "s-4", "r-6"];
function nepZoek(docs: Doc[], aanroepen: string[]): typeof zoekRelevanteChunksMetMeta {
  return async (vraag, _f, _m, _h, scope) => {
    aanroepen.push(vraag);
    const meta = { methode: "fts", opgehaald: 0, geselecteerd: 0, chunks: [] } as unknown as RetrievalMeta;
    if (!scope) return { chunks: HOOFDSPOOR.map((id, i) => chunkVan(RIJEN.find((r) => r.id === id)!, docs, 1 - i / 100)), meta };
    // Zoals het R1-tekstpad: strikt (alle termen) gaf 0; dan de OR-terugval.
    const termen = bouwTerugvalFtsQuery(vraag)?.termen ?? [];
    const chunks = RIJEN.filter((r) => scope.includes(r.document_id))
      .map((r) => ({ r, s: termen.filter((t) => r.tekst.toLowerCase().includes(t.slice(0, 6))).length }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.r.chunk_index - b.r.chunk_index)
      .map((x, i) => chunkVan(x.r, docs, 1 - i / 100));
    return { chunks, meta };
  };
}

const FILTERS: RetrievalFilters = { modus: "actueel", peildatum: "2026-10-09", bronsoort: ["fonds", "generiek"] };

async function spoor(vraag: string, o: { docs?: Doc[]; fonds?: string; vertraging?: number; timeoutMs?: number } = {}) {
  const docs = o.docs ?? BASIS;
  const log: Aanroep[] = [];
  const zoekAanroepen: string[] = [];
  const bestaand = HOOFDSPOOR.map((id, i) => chunkVan(RIJEN.find((r) => r.id === id)!, docs, 1 - i / 100));
  const u = await vulAanMetGenoemdDocument(bestaand, {
    teksten: [vraag, vraag], fondsId: o.fonds ?? FONDS_A, filters: FILTERS, maxKandidaten: 30,
    supabase: nepClient(docs, o.fonds ?? FONDS_A, log, o.vertraging), zoek: nepZoek(docs, zoekAanroepen),
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
  });
  const extra = u.chunks.filter((c) => c.documentspoor).map((c) => c.id);
  return { u, extra, log, zoekAanroepen };
}

// ── (P) PUUR ────────────────────────────────────────────────────────────────
test("(P) identificatoren: letters direct gevolgd door cijfers, uniek, begrensd; jaartallen en losse getallen niet", () => {
  assert.deepEqual(herkenIdentificatoren("wat zeggen gp6 en gp7 uit"), ["gp6", "gp7"]);
  assert.deepEqual(herkenIdentificatoren("GP6, GP6 en P3a"), ["gp6", "p3a"]);
  assert.deepEqual(herkenIdentificatoren("wat gebeurde er in 2023 met 3 fondsen"), []);
  assert.deepEqual(herkenIdentificatoren("welke beheersmaatregelen noemt dnb in de voor esg risico s"), []);
  assert.equal(herkenIdentificatoren("a1 b2 c3 d4 e5").length, MAX_IDENTIFICATOREN + 1,
    "de vierde identifier blijft zichtbaar als overschrijdingssignaal");
});

test("(P) kop: Productievorm na een alineagrens telt; verwijzingen en vet midden in een zin niet", () => {
  // Productievorm: kop na 370 tekens, achter een lege regel, vet, met dubbele punt.
  assert.equal(isSectiekop(`${"x".repeat(370)}\n\n**GP6: Een pensioenfonds legt vast`, "gp6"), true);
  assert.equal(isSectiekop("**GP8: Een pensioenfonds rapporteert", "gp8"), true, "kop aan het chunkbegin");
  assert.equal(isSectiekop("GP6\nHet fonds legt vast", "gp6"), true);
  assert.equal(isSectiekop("GP7 Effectiviteit\nHet fonds", "gp7"), true);
  assert.equal(isSectiekop("Inleiding.\n\n## GP 6. Mitigatie", "gp6"), true);
  assert.equal(isSectiekop("Inleiding.\n\n- GP-6: Mitigatie", "gp6"), true);
  // Geen kop:
  assert.equal(isSectiekop("Een fonds verwees naar GP6; zie GP6 ook.", "gp6"), false, "kruisverwijzing");
  assert.equal(isSectiekop("Zoals **GP6** aangeeft, hoort daar een eigenaar bij.", "gp6"), false, "vet midden in een zin");
  assert.equal(isSectiekop("Bijlage.\n\n**GP6** is volgens deze bijlage de kern.", "gp6"), false, "vet aan alineabegin, lopende zin");
  assert.equal(isSectiekop("zoals beschreven in\nGP6 en GP7 beschrijft DNB", "gp6"), false, "regelafbreking, geen alineagrens");
  assert.equal(isSectiekop("In GP6 en GP7 beschrijft DNB", "gp6"), false);
  assert.equal(isSectiekop("\n\n**GP60: Iets anders", "gp6"), false);
  assert.equal(isSectiekop("\n\n**GP61**", "gp6"), false);
});

test("(P) het DB-voorfilter noemt alleen de reeks (letters), geen vraagtekst", () => {
  assert.equal(reeksImatch("gp"), "(^|[^[:alnum:]])gp[ .-]?[0-9]{1,3}[[:alpha:]]?([^[:alnum:]]|$)");
});

test("(P) classificatie: kop gevonden / ontbrekend in een bekende reeks / inhoudsterm zonder reeks", () => {
  const k = classificeerIdentificatoren(["gp7", "gp6", "gp12", "co2"], RIJEN.filter((r) => r.document_id === D.esg));
  assert.deepEqual(k.koppen.map((x) => [x.id, x.rij.id]), [["gp7", "s-97"], ["gp6", "s-91"]]);
  assert.deepEqual(k.ontbrekend, ["gp12"]);
  assert.deepEqual(k.geenReeks, ["co2"]);
});

// ── (R) REPRODUCTIE van de oorzaak ──────────────────────────────────────────
test("(R) zonder sectiespoor: de terugval kent gp6/gp7 niet en vindt GP7 wel, de GP6-kern niet", async () => {
  const rest = "wat zeggen gp6 en gp7 uit over beheersmaatregelen en effectiviteit";
  const t = bouwTerugvalFtsQuery(rest);
  assert.ok(t && !t.termen.includes("gp6") && !t.termen.includes("gp7"), `termen: ${t?.termen}`);
  const { chunks } = await nepZoek(BASIS, [])(rest, FONDS_A, 4, false, [D.esg], FILTERS, {});
  const ids = chunks.slice(0, DOCUMENTSPOOR_MAX).map((c) => c.id);
  assert.ok(ids.includes("s-97") && !ids.includes("s-91"), `FTS-top: ${ids}`);
});

// ── (S) SECTIES ─────────────────────────────────────────────────────────────
test("(S) twee secties: exact vier — GP6-kop 91 + vervolg 92 en GP7-kop 97 + vervolg 98; geen GP8, geen verwijzingen", async () => {
  const { u, extra, zoekAanroepen } = await spoor(VRAAG_TWEE);
  assert.deepEqual(extra, ["s-91", "s-97", "s-92", "s-98"]);
  assert.deepEqual(u.meta, { status: "toegevoegd", toegevoegd: 4 });
  assert.equal(zoekAanroepen.length, 0, "geen FTS-aanvulling bij een sectievraag");
  assert.deepEqual(u.chunks.slice(0, 4).map((c) => c.id), ["s-91", "s-97", "s-92", "s-98"], "vooraan in de kandidatenpool");
});

test("(S) één sectie: kop + vervolg", async () => {
  const { extra } = await spoor(`Wat staat er in GP6 van de ${TITEL}?`);
  assert.deepEqual(extra, ["s-91", "s-92"]);
});

test("(S) GP7: kop + doorlopend vervolg (98)", async () => {
  const { extra } = await spoor(`Wat staat er in GP7 van de ${TITEL}?`);
  assert.deepEqual(extra, ["s-97", "s-98"]);
});

test("(S) een volgende chunk die met lege regels en daarna een NIEUWE kop begint, is nooit vervolg (GP8 → GP9)", async () => {
  const { extra } = await spoor(`Wat staat er in GP8 van de ${TITEL}?`);
  assert.deepEqual(extra, ["s-99"]);
});

test("(P) vervolgregel: voorloopwitruimte maskeert een nieuwe kop niet", () => {
  const rij = (tekst: string) => ({ id: "x", chunk_index: 1, tekst });
  assert.equal(isVervolg("gp8", rij("\n\n**GP9: Een pensioenfonds evalueert")), false);
  assert.equal(isVervolg("gp8", rij("  \n \n## GP 9. Evaluatie")), false);
  assert.equal(isVervolg("gp8", rij("**GP9: Een pensioenfonds evalueert")), false);
  assert.equal(isVervolg("gp7", rij("die het fonds heeft genomen. Zie ook GP9.")), true, "verwijzing ≠ nieuwe kop");
  assert.equal(isVervolg("gp7", rij("\n\nVervolg van de toelichting bij de maatregelen.")), true);
});

test("(S) ontbrekende sectie van een bekende reeks: niets toegevoegd, geen FTS-aanvulling", async () => {
  const { u, extra, zoekAanroepen } = await spoor(`Wat staat er in GP12 van de ${TITEL}?`);
  assert.deepEqual(u.meta, { status: "sectie_niet_gevonden", toegevoegd: 0 });
  assert.deepEqual(extra, []);
  assert.equal(zoekAanroepen.length, 0);
});

test("(S) alleen genoemd in een overzicht of verwijzing (GP1 in de bijlage): geen kop ⇒ niets toegevoegd", async () => {
  const { u, zoekAanroepen } = await spoor(`Wat zegt GP1 uit ${TITEL}?`);
  assert.equal(u.meta.status, "sectie_niet_gevonden");
  assert.equal(zoekAanroepen.length, 0);
});

test("(S) alles-of-niets: GP6 gevonden, GP12 niet ⇒ niets toegevoegd (geen gedeeltelijke context als bewijs van afwezigheid)", async () => {
  const { u, extra, zoekAanroepen } = await spoor(`Vergelijk GP6 en GP12 uit ${TITEL}.`);
  assert.deepEqual(u.meta, { status: "sectie_onvolledig", toegevoegd: 0 });
  assert.deepEqual(extra, []);
  assert.equal(zoekAanroepen.length, 0);
});

test("(S) vier gevraagde secties worden niet stil tot drie afgekapt", async () => {
  const { u, extra, zoekAanroepen, log } = await spoor(`Vergelijk GP5, GP6, GP7 en GP8 uit ${TITEL}.`);
  assert.deepEqual(u.meta, { status: "te_veel_secties", toegevoegd: 0 });
  assert.deepEqual(extra, []);
  assert.equal(zoekAanroepen.length, 0);
  assert.deepEqual(log.map((a) => a.soort), ["titels"]);
});

test("(S) een volle voorfilterpagina bewijst niet dat een sectie ontbreekt of dat CO2 alleen inhoud is", async () => {
  const start = RIJEN.length;
  try {
    for (let i = 0; i < DOCUMENTSPOOR_SECTIE_OPZOEK_MAX; i++) {
      RIJEN.push({ id: `v-${i}`, document_id: D.esg, pagina: 1, chunk_index: -100 + i,
        tekst: `Overzicht: zie GP${i % 9 + 1} voor de context.` });
    }
    const { u, extra, zoekAanroepen } = await spoor(`Wat staat in GP6 uit ${TITEL}?`);
    assert.deepEqual(u.meta, { status: "sectie_onvolledig", toegevoegd: 0 });
    assert.deepEqual(extra, []);
    assert.equal(zoekAanroepen.length, 0, "geen FTS-terugval na mogelijk afgekapt voorfilter");
  } finally {
    RIJEN.splice(start);
  }
});

test("(S) inhoudsterm met letter+cijfer (CO2, geen kopreeks): het bestaande FTS-pad blijft", async () => {
  const { u, extra, zoekAanroepen, log } = await spoor(`Wat zegt de ${TITEL} over CO2-uitstoot?`);
  assert.deepEqual(log.map((a) => a.soort), ["titels", "opzoeking"]);
  assert.equal(zoekAanroepen.length, 1, "FTS-zoekslag zoals vóór het sectiespoor");
  assert.equal(u.meta.status, "toegevoegd");
  assert.ok(extra.includes("s-50"), `FTS-resultaat: ${extra}`);
});

test("(S) sectie + inhoudsterm (GP6 en CO2): de sectie telt, de inhoudsterm maakt het niet onvolledig", async () => {
  const { extra, zoekAanroepen } = await spoor(`Hoe verhoudt GP6 uit ${TITEL} zich tot CO2?`);
  assert.deepEqual(extra, ["s-91", "s-92"]);
  assert.equal(zoekAanroepen.length, 0);
});

// ── (G) GRENZEN EN KOSTEN ───────────────────────────────────────────────────
test("(G) kosten: één titelquery en drie begrensde chunkqueries op één document; ≤ 4 extra passages", async () => {
  const { log, extra } = await spoor(`Wat zeggen GP5, GP6 en GP7 uit ${TITEL}?`);
  assert.deepEqual(log.map((a) => a.soort), ["titels", "opzoeking", "vervolg", "toelating"]);
  assert.equal(log[1].limiet, DOCUMENTSPOOR_SECTIE_OPZOEK_MAX);
  assert.ok(log[2].limiet <= MAX_IDENTIFICATOREN);
  assert.equal(log[3].limiet, DOCUMENTSPOOR_MAX);
  assert.ok(extra.length <= DOCUMENTSPOOR_MAX);
  // Koppen gaan vóór vervolg: alle drie de koppen zitten erin, daarna past
  // binnen het budget van vier nog één vervolg (92); 98 valt af.
  assert.deepEqual(extra, ["s-85", "s-91", "s-97", "s-92"]);
});

test("(G) het opzoekfilter noemt alleen de gevraagde reeks, één keer", async () => {
  const { log } = await spoor(VRAAG_TWEE);
  assert.equal(log[1].filter, 'tekst.imatch."(^|[^[:alnum:]])gp[ .-]?[0-9]{1,3}[[:alpha:]]?([^[:alnum:]]|$)"');
});

test("(G) tijdslimiet: een trage sectieopzoeking laat de kandidaten ongemoeid", async () => {
  const { u, extra } = await spoor(VRAAG_TWEE, { vertraging: 120, timeoutMs: 50 });
  assert.equal(u.meta.status, "timeout");
  assert.deepEqual(extra, []);
});

test("(G) zonder identificator blijft het bestaande FTS-pad (geen sectiequery)", async () => {
  const { log, zoekAanroepen } = await spoor(`Welke beheersmaatregelen noemt de ${TITEL}?`);
  assert.deepEqual(log.map((a) => a.soort), ["titels"]);
  assert.equal(zoekAanroepen.length, 1);
});

// ── (N) NEGATIEF ────────────────────────────────────────────────────────────
test("(N) ambigu document: dezelfde titel twee keer ⇒ geen binding, geen chunkquery", async () => {
  const docs = [...BASIS, { ...BASIS[0], id: "e6000000-0000-4000-8000-0000000000f1" }];
  const { u, log } = await spoor(VRAAG_TWEE, { docs });
  assert.equal(u.meta.status, "meerdere");
  assert.deepEqual(log.map((a) => a.soort), ["titels"]);
});

test("(N) ander fonds: de titel van een fondsdocument van een ander fonds bindt niet; zijn GP6 komt nooit binnen", async () => {
  const { u, extra, log } = await spoor("Wat staat in GP6 van Eigen duurzaamheidskader ander pensioenfonds?");
  assert.equal(u.meta.status, "geen");
  assert.deepEqual(extra, []);
  assert.deepEqual(log.map((a) => a.soort), ["titels"]);
});

test("(N) ongescand document onder WP3: geen binding, geen chunkquery", async () => {
  const vorig = process.env.WP3_MALWARESCAN_AAN;
  process.env.WP3_MALWARESCAN_AAN = "true";
  try {
    const docs = BASIS.map((d) => (d.id === D.esg ? { ...d, scan: false } : d));
    const { u, log } = await spoor(VRAAG_TWEE, { docs });
    assert.equal(u.meta.status, "geen");
    assert.deepEqual(log.map((a) => a.soort), ["titels"]);
  } finally {
    if (vorig === undefined) delete process.env.WP3_MALWARESCAN_AAN;
    else process.env.WP3_MALWARESCAN_AAN = vorig;
  }
});

test("(N) concept onder modus actueel: de toelating weigert de koppen ⇒ niets toegevoegd", async () => {
  const docs = BASIS.map((d) => (d.id === D.esg ? { ...d, status: "concept" as const } : d));
  const { u, extra } = await spoor(VRAAG_TWEE, { docs });
  assert.equal(u.meta.status, "sectie_niet_gevonden");
  assert.deepEqual(extra, []);
});

test("(N) gearchiveerd: de toelating weigert ⇒ niets toegevoegd", async () => {
  const docs = BASIS.map((d) => (d.id === D.esg ? { ...d, status: "gearchiveerd" as const } : d));
  const { u } = await spoor(VRAAG_TWEE, { docs });
  assert.equal(u.meta.status, "sectie_niet_gevonden");
});

// ── (E) EIND-TOT-EIND: adapter + orkestratie + citatie ─────────────────────
async function draai(vraag: string, spoorAan: boolean) {
  const log: Aanroep[] = [];
  const zoekAanroepen: string[] = [];
  const vorigeEnv = process.env.ZOEK_TEKST_V2;
  process.env.ZOEK_TEKST_V2 = "on";
  const retrieval = maakSupabaseAdapter({ parentRetrieval: false, documentspoor: spoorAan, zoekTekstV2: true } as Adaptervlaggen, {}, {
    zoek: nepZoek(BASIS, zoekAanroepen),
    leesVersies: async (chunks) => new Map(chunks.map((c) => [c.id, {
      soort: "hash" as const, gecontroleerdOp: "2026-10-09T10:00:00.000Z",
      waarde: maakVolledigeVersieHash(c.document_id, `v-${c.id}`, "c".repeat(64)),
    }])),
    verrijkNotulen: async (c) => c,
    verrijkDocumentmeta: async (c) => c,
    artikelkandidaten: async (b) => b,
    sectiekandidaten: async (b) => b,
    documentspoor: (b, opd) => vulAanMetGenoemdDocument(b, { ...opd, supabase: nepClient(BASIS, FONDS_A, log) }),
  });
  let naAdapter: Bronresultaat[] = [];
  const adapter: RetrievalAdapter = {
    ...retrieval.adapter,
    zoek: async (ctx, q): Promise<AdapterUitkomst> => { const u = await retrieval.adapter.zoek(ctx, q); naAdapter = u.kandidaten; return u; },
  };
  const ctx: RetrievalContext = {
    fondsId: FONDS_A, actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" }, taaktype: "chat_generatie",
    bronbeleid: { bronsoorten: ["fonds", "generiek", "notulen"] }, correlationId: "corr-secties", verzoekStartOp: new Date().toISOString(),
  };
  const query: RetrievalQuery = {
    naam: "primair", origineleVraag: vraag, zoekvraag: vraag, strategie: "gericht", maxResultaten: 10, maxKandidaten: 30,
    maxContextTekens: 120_000, hybrideAan: true, filters: FILTERS,
  };
  const citaat: CitaatOpdracht = { primaireDocumentIds: new Set<string>(), peildatum: "2026-10-09", hoofddocumentLabel: " [hoofddocument]", sentinel: "SENT" };
  try {
    const uit = await voerVolledigeRetrievalUit(ctx, { adapter, sporen: [{ query, grenzen: {
      maxPerDoc: 5, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false,
      juridischeIntentie: bepaalJuridischeVraagintentie(vraag) } }] }, citaat);
    return { uit, naAdapter, log, zoekAanroepen };
  } finally {
    if (vorigeEnv === undefined) delete process.env.ZOEK_TEKST_V2;
    else process.env.ZOEK_TEKST_V2 = vorigeEnv;
  }
}

test("(E) twee secties: de GP6-kern, het vervolg en GP7 staan in de modelcontext", async () => {
  const { uit, naAdapter } = await draai(VRAAG_TWEE, true);
  // Het spoor zet exact vier passages uit het gebonden document vooraan (91, 97,
  // 92, 98); de renterisico-GP6 komt (ongewijzigd) uit het hoofdspoor.
  assert.deepEqual(naAdapter.slice(0, 4).map((b) => [b.titel, b.locator.chunkIndex]), [[TITEL, 91], [TITEL, 97], [TITEL, 92], [TITEL, 98]]);
  assert.match(uit.contextTekst, /\*\*GP6: Een pensioenfonds legt per materieel risico vast/);
  assert.match(uit.contextTekst, /en wie daarvoor verantwoordelijk is/, "GP6-vervolg");
  assert.match(uit.contextTekst, /\*\*GP7: Een pensioenfonds toetst periodiek de effectiviteit/);
  assert.match(uit.contextTekst, /die het fonds voor de materiële risico's heeft genomen/, "GP7-vervolg");
  assert.doesNotMatch(uit.contextTekst, /Eigen kader van een ander fonds/, "nooit een document van een ander fonds");
  assert.doesNotMatch(uit.contextTekst, /GP8: Een pensioenfonds rapporteert|GP9: Een pensioenfonds evalueert/, "geen ongevraagde sectie");
});

test("(E) vlag uit: byte-identiek aan het hoofdspoor (geen query, dezelfde kandidaten en context)", async () => {
  const uitgezet = await draai(VRAAG_TWEE, false);
  assert.equal(uitgezet.log.length, 0);
  assert.equal(uitgezet.zoekAanroepen.length, 1);
  assert.deepEqual(uitgezet.naAdapter.map((b) => b.ref.split(":").pop()).length, HOOFDSPOOR.length);
  assert.doesNotMatch(uitgezet.uit.contextTekst, /\*\*GP6: Een pensioenfonds legt/);
  const nogmaals = await draai(VRAAG_TWEE, false);
  assert.equal(nogmaals.uit.contextTekst, uitgezet.uit.contextTekst);
});
