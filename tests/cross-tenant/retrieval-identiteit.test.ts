import test from "node:test";
import assert from "node:assert/strict";
import {
  maakCitationId,
  maakDocumentIdentiteit,
  maakPassageIdentiteit,
  maakVolledigeVersieHash,
} from "../../core/lib/retrieval/identiteit";
import { bouwCitaties } from "../../core/lib/retrieval/citatie";
import { splitsRetrievalMeta } from "../../core/lib/audit-meta";
import { bepaalBronset, leesLokaleDocumentRefs } from "../../core/lib/bronset";
import { bewijsUitVersierij } from "../../core/lib/retrieval/supabase-versie";
import { voerRetrievalUit, voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import { maakSupabaseAdapter, type Adaptervlaggen } from "../../core/lib/retrieval/supabase-adapter";
import {
  maakContext,
  selecteerBevrorenChunksOpRefs,
  type DocumentChunk,
  type RetrievalMeta,
} from "../../core/lib/rag";
import type { Bronresultaat, RetrievalAdapter, RetrievalContext } from "../../core/lib/retrieval/contract";

const DOC_REF = "11111111-1111-4111-8111-111111111111";
const FONDS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FONDS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPABASE_CTX: RetrievalContext = {
  fondsId: FONDS_A,
  actor: { soort: "gebruiker", id: "user-367" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds"] },
  correlationId: "corr-367-supabase",
  verzoekStartOp: "2026-09-11T09:59:59.000Z",
};

function bron(over: Partial<Bronresultaat> = {}): Bronresultaat {
  const documentId = maakDocumentIdentiteit(`fonds:${FONDS_A}`, DOC_REF);
  const passageId = maakPassageIdentiteit(documentId, "chunk-index:3");
  return {
    ref: passageId,
    bronsoort: "fonds",
    titel: "Oude titel",
    documentIdentiteit: { id: documentId, bibliotheek: "fonds", bron: "upload", fondsId: FONDS_A },
    passageIdentiteit: { id: passageId },
    versie: { soort: "hash", waarde: maakVolledigeVersieHash(DOC_REF, "r1", "a".repeat(64)), gecontroleerdOp: "2026-09-11T10:00:00.000Z" },
    locator: { pagina: 4, mappad: "/oude/map" },
    passage: "Persoonsnaam die alleen in het inhoudsniveau mag staan.",
    status: { actueel: true },
    rang: { positie: 1, score: 0.9 },
    ...over,
  };
}

test("#367 — publieke identiteiten zijn deterministisch, opaque en tenantgebonden", () => {
  const a1 = maakDocumentIdentiteit(`fonds:${FONDS_A}`, DOC_REF);
  const a2 = maakDocumentIdentiteit(`fonds:${FONDS_A}`, DOC_REF);
  const b = maakDocumentIdentiteit(`fonds:${FONDS_B}`, DOC_REF);
  assert.equal(a1, a2);
  assert.notEqual(a1, b, "dezelfde adapterreferentie in een andere tenant mag nooit co-refereren");
  assert.doesNotMatch(a1, new RegExp(DOC_REF));
  assert.match(a1, /^doc_v1_[a-f0-9]{64}$/);
});

test("#367 — het publieke retrievalcontract bevat geen provider- of database-identifiers", async () => {
  const { readFileSync } = await import("node:fs");
  const contract = readFileSync(new URL("../../core/lib/retrieval/contract.ts", import.meta.url), "utf8");
  const code = contract.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(?:driveId|drive_id|itemId|item_id|chunkId|chunk_id|databaseId|database_id|document_id)\b/);
});

test("#367 — de volledige versiehash kantelt op elk R1-ingrediënt", () => {
  const basis = maakVolledigeVersieHash(DOC_REF, "index-v1", "bestand-a");
  assert.notEqual(basis, maakVolledigeVersieHash("ander-document", "index-v1", "bestand-a"));
  assert.notEqual(basis, maakVolledigeVersieHash(DOC_REF, "index-v2", "bestand-a"));
  assert.notEqual(basis, maakVolledigeVersieHash(DOC_REF, "index-v1", "bestand-b"));
  assert.doesNotMatch(basis, /bestand-a|index-v1/);
});

test("#367 — citation-id blijft gelijk bij hernoemen/verplaatsen en wijzigt bij versie", () => {
  const eerste = bron();
  const verplaatst = bron({ titel: "Nieuwe titel", locator: { pagina: 4, mappad: "/nieuwe/map" } });
  const opdracht = { primaireDocumentIds: new Set<string>(), peildatum: "2026-09-11", hoofddocumentLabel: "", sentinel: "S", maxContextTekens: 10_000 };
  const id1 = bouwCitaties([eerste], opdracht).bronnen[0].citation_id;
  const id2 = bouwCitaties([verplaatst], opdracht).bronnen[0].citation_id;
  assert.equal(id1, id2);
  const gewijzigdeVersie = bron({ versie: { ...eerste.versie, waarde: maakVolledigeVersieHash(DOC_REF, "r2", "a".repeat(64)) } });
  assert.notEqual(id1, bouwCitaties([gewijzigdeVersie], opdracht).bronnen[0].citation_id);
  assert.equal(id1, maakCitationId(eerste.documentIdentiteit.id, eerste.passageIdentiteit.id, eerste.versie.soort, eerste.versie.waarde!));
});

test("#367 — Supabase-versiebewijs degradeert expliciet en faalt cross-tenant/corrupt dicht", () => {
  const basis = { id: "chunk", document_id: DOC_REF, indexering_versie: "r1", documenten: {
    id: DOC_REF, fonds_id: FONDS_A, bibliotheek: "fonds", bestand_hash: "a".repeat(64), documentdatum: "2026-09-11",
  } };
  assert.equal(bewijsUitVersierij(basis, DOC_REF, FONDS_A, "nu").soort, "hash");
  assert.deepEqual(
    bewijsUitVersierij({ ...basis, indexering_versie: null }, DOC_REF, FONDS_A, "nu"),
    { soort: "status-datum", waarde: "2026-09-11", gecontroleerdOp: "nu" }
  );
  assert.equal(bewijsUitVersierij(basis, DOC_REF, FONDS_B, "nu").soort, "onbekend");
  assert.equal(bewijsUitVersierij({ ...basis, document_id: "verwisseld" }, DOC_REF, FONDS_A, "nu").soort, "onbekend");
  assert.equal(bewijsUitVersierij(undefined, DOC_REF, FONDS_A, "nu").soort, "onbekend");
});

test("#367 — ongeldige bestand_hash is nooit sterk bewijs", () => {
  const basis = { id: "chunk", document_id: DOC_REF, indexering_versie: "r1", documenten: {
    id: DOC_REF, fonds_id: FONDS_A, bibliotheek: "fonds", bestand_hash: "a".repeat(64), documentdatum: "2026-09-11",
  } };
  for (const bestand_hash of ["kort", "A".repeat(64), `sha256:${"a".repeat(64)}`, `${"a".repeat(63)}g`]) {
    const bewijs = bewijsUitVersierij({ ...basis, documenten: { ...basis.documenten, bestand_hash } }, DOC_REF, FONDS_A, "nu");
    assert.equal(bewijs.soort, "status-datum", bestand_hash);
    assert.notEqual(bewijs.soort, "hash", "ongeldige SHA-256 mag nooit sterk bewijs worden");
  }
  const zonderFallback = bewijsUitVersierij({
    ...basis,
    documenten: { ...basis.documenten, bestand_hash: "ongeldig", documentdatum: null },
  }, DOC_REF, FONDS_A, "nu");
  assert.equal(zonderFallback.soort, "onbekend");
});

test("#367 — correlation is basisniveau; versie-identiteit bronniveau; passage blijft inhoud", () => {
  const meta = {
    correlation_id: "corr-367",
    methode: "geen", opgehaald: 1, geselecteerd: 1, chunks: [],
    bronversie_audit: [{ document_identiteit: "doc", passage_identiteit: "passage", citation_id: "citation", versie: { soort: "hash", waarde: "v" } }],
    sources: [{ fragment: "Naam Persoon" }],
  };
  const uit = splitsRetrievalMeta(meta);
  assert.equal(uit.spoor.correlation_id, "corr-367");
  assert.deepEqual(uit.spoor.bronversie_audit, meta.bronversie_audit);
  assert.equal(JSON.stringify(uit.spoor).includes("Naam Persoon"), false);
  assert.equal(JSON.stringify(uit.inhoud).includes("Naam Persoon"), true);
  assert.deepEqual(uit.onbekend, []);
});

test("#367 — correlation-id blijft gelijk door adapter, poort, selectie, citatie en audit", async () => {
  const correlationId = "corr-367-ongewijzigd";
  const ctx: RetrievalContext = {
    fondsId: FONDS_A,
    actor: { soort: "gebruiker", id: "user-367" },
    taaktype: "chat_generatie",
    bronbeleid: { bronsoorten: ["fonds"] },
    correlationId,
    verzoekStartOp: "2026-09-11T09:59:59.000Z",
  };
  const kandidaat = bron();
  const gezien: string[] = [];
  const controleer = (ontvangen: RetrievalContext) => {
    gezien.push(ontvangen.correlationId);
    assert.equal(ontvangen.correlationId, correlationId);
  };
  const adapter: RetrievalAdapter = {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds"],
      strategieen: ["gericht"],
      modi: ["keyword"],
      ondersteundeFilters: [],
      versiebewijs: true,
      versiebeleid: { sterk: ["hash"], gedegradeerd: [] },
      permissionProof: false,
      preview: false,
      cancellation: false,
      timeout: false,
    }),
    zoek: async (ontvangen) => {
      controleer(ontvangen);
      return { kandidaten: [kandidaat], methode: "fts_dutch_ranked", provider: "supabase", latencyMs: 1, opgehaald: 1 };
    },
    verifieerVersies: async (ontvangen, refs) => {
      controleer(ontvangen);
      return new Map(refs.map((ref) => [ref, {
        beschikbaar: true,
        documentIdentiteit: kandidaat.documentIdentiteit.id,
        passageIdentiteit: kandidaat.passageIdentiteit.id,
        versie: { soort: kandidaat.versie.soort, waarde: kandidaat.versie.waarde },
      }]));
    },
    verrijkSelectie: async (ontvangen, geselecteerd) => {
      controleer(ontvangen);
      return { resultaten: geselecteerd };
    },
    verrijkWeergave: async (ontvangen, geselecteerd) => {
      controleer(ontvangen);
      return geselecteerd;
    },
  };
  const uitkomst = await voerVolledigeRetrievalUit(ctx, {
    adapter,
    sporen: [{
      query: {
        naam: "primair",
        origineleVraag: "vraag",
        zoekvraag: "vraag",
        strategie: "gericht",
        maxResultaten: 1,
        maxKandidaten: 1,
        maxContextTekens: 10_000,
        hybrideAan: false,
      },
      grenzen: { maxPerDoc: 1, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false },
    }],
  }, {
    primaireDocumentIds: new Set(),
    peildatum: "2026-09-11",
    hoofddocumentLabel: "",
  });
  assert.deepEqual(gezien, [correlationId, correlationId, correlationId, correlationId]);
  assert.equal(uitkomst.meta.correlation_id, correlationId);
  assert.match(uitkomst.bronverwijzingen[0].citation_id ?? "", /^citation_v1_/);
});

test("#367 — echte Supabase-adapter herleest via private chunk-id en levert een bron aan ranking", async () => {
  const chunk: DocumentChunk = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    document_id: DOC_REF,
    tekst: "Een inhoudelijke passage over de governance.",
    pagina: 2,
    paragraaf: "2.1",
    chunk_index: 3,
    indexering_versie: "r1",
    rang: 0.91,
    documenten: {
      titel: "Bestuursdocument",
      bron: "upload",
      bibliotheek: "fonds",
      opslag_pad: "fonds/bestuursdocument.pdf",
      fonds_id: FONDS_A,
      bestand_hash: "a".repeat(64),
      documentdatum: "2026-09-11",
    },
  };
  const meta: RetrievalMeta = {
    methode: "fts_dutch_ranked",
    opgehaald: 1,
    geselecteerd: 1,
    chunks: [{ id: chunk.id, document_id: chunk.document_id, rang: chunk.rang ?? null }],
  };
  const gelezen: string[][] = [];
  const retrieval = maakSupabaseAdapter({ parentRetrieval: false } as Adaptervlaggen, {}, {
    zoek: async () => ({ chunks: [chunk], meta }),
    leesVersies: async (chunks) => {
      gelezen.push(chunks.map((c) => c.id));
      return new Map(chunks.map((c) => [c.id, bewijsUitVersierij({
        id: c.id,
        document_id: c.document_id,
        indexering_versie: c.indexering_versie ?? null,
        documenten: {
          id: c.document_id,
          fonds_id: c.documenten.fonds_id ?? null,
          bibliotheek: c.documenten.bibliotheek,
          bestand_hash: c.documenten.bestand_hash ?? null,
          documentdatum: c.documenten.documentdatum ?? null,
        },
      }, c.document_id, FONDS_A, "2026-09-11T10:00:00.000Z")]));
    },
  });
  const uit = await voerRetrievalUit(SUPABASE_CTX, {
    adapter: retrieval.adapter,
    sporen: [{
      query: {
        naam: "primair", origineleVraag: "governance", zoekvraag: "governance",
        strategie: "gericht", maxResultaten: 1, maxKandidaten: 1,
        maxContextTekens: 10_000, hybrideAan: false,
      },
      grenzen: { maxPerDoc: 1, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false },
    }],
  });
  try {
    assert.equal(uit.geselecteerd.length, 1, "de versieherlezing mag de echte Supabasebron niet tot nul reduceren");
    assert.deepEqual(gelezen, [[chunk.id], [chunk.id]], "eerste bewijs en herlezing gebruiken beide de private chunk-id");
    assert.match(uit.geselecteerd[0].ref, /^passage_v1_[a-f0-9]{64}$/);
    assert.notEqual(uit.geselecteerd[0].ref, chunk.id);
    assert.equal(uit.meta.chunks[0].id, uit.geselecteerd[0].ref);
    assert.equal(uit.meta.chunks[0].document_id, uit.geselecteerd[0].documentIdentiteit.id);
    assert.doesNotMatch(JSON.stringify(uit.meta), new RegExp(`${chunk.id}|${chunk.document_id}`));
    assert.equal(retrieval.lokaleDocumentRefVoor(uit.geselecteerd[0].documentIdentiteit.id), chunk.document_id);

    // Rereview: dezelfde nieuw gevormde #367-meta moet in een latere
    // reflectiebeurt via de lokale documentroute terug naar exact de bevroren
    // passage kunnen worden gebonden. Dit is bewust één keten vanaf de echte
    // adapteruitkomst; een losse helpertest had de productiebreuk gemist.
    const bevroren = bepaalBronset(uit.meta);
    const lokaleDocumentRef =
      retrieval.lokaleDocumentRefVoor(uit.geselecteerd[0].documentIdentiteit.id);
    const opgeslagenBronnen = [{ document_id: lokaleDocumentRef }];
    const lokaleRefs = leesLokaleDocumentRefs(opgeslagenBronnen);
    const reflectieChunks = selecteerBevrorenChunksOpRefs([chunk], bevroren.chunkIds);
    const reflectieContext = maakContext(reflectieChunks, 0, "reflectie-sentinel");
    assert.deepEqual(lokaleRefs, [chunk.document_id]);
    assert.equal(reflectieChunks.length, 1, "opaque passage-id moet de private chunk opnieuw vinden");
    assert.equal(reflectieContext.bronnen.length, 1, "reflectie op een #367-antwoord mag niet bronloos worden");
    assert.match(reflectieContext.contextTekst, /governance/);
    assert.deepEqual(
      selecteerBevrorenChunksOpRefs([chunk], [`passage_v1_${"f".repeat(64)}`]),
      [],
      "een verwisselde opaque passage-id mag niet op de private kandidaat binden"
    );
  } finally {
    uit.grendel?.stop();
  }
});

test("#367 — ontbrekende private map-entry faalt gesloten en zero-source is zichtbaar", async () => {
  const chunk: DocumentChunk = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", document_id: DOC_REF,
    tekst: "Passage", pagina: null, paragraaf: null, chunk_index: 0,
    indexering_versie: "r1", rang: 1,
    documenten: { titel: "D", bron: "upload", bibliotheek: "fonds", opslag_pad: null, fonds_id: FONDS_A, bestand_hash: "b".repeat(64) },
  };
  let ronde = 0;
  const retrieval = maakSupabaseAdapter({ parentRetrieval: false } as Adaptervlaggen, {}, {
    zoek: async () => ({ chunks: [chunk], meta: { methode: "fts_dutch_ranked", opgehaald: 1, geselecteerd: 1, chunks: [] } as RetrievalMeta }),
    leesVersies: async (chunks) => {
      ronde++;
      const bewijs = { soort: "hash" as const, waarde: maakVolledigeVersieHash(DOC_REF, "r1", "b".repeat(64)), gecontroleerdOp: "nu" };
      return ronde === 1 ? new Map([[chunk.id, bewijs]]) : new Map([["verkeerde-map-key", bewijs]]);
    },
  });
  const uit = await voerRetrievalUit(SUPABASE_CTX, {
    adapter: retrieval.adapter,
    sporen: [{
      query: { naam: "primair", origineleVraag: "x", zoekvraag: "x", strategie: "gericht", maxResultaten: 1, maxKandidaten: 1, maxContextTekens: 1000, hybrideAan: false },
      grenzen: { maxPerDoc: 1, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false },
    }],
  });
  try {
    assert.equal(uit.geselecteerd.length, 0);
    assert.equal(uit.meta.toelating?.gronden.versiestand_ontbreekt, 1);
  } finally {
    uit.grendel?.stop();
  }
});

test("#367 — lokale download-id blijft server-only en voedt het bestaande UI-pad", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../app/(dashboard)/ai/_components/AntwoordWeergave.tsx", import.meta.url), "utf8");
  assert.match(route, /lokaleDocumentRefVoor\(bron\.document_id\)/);
  assert.doesNotMatch(route, /document_id:\s*lokaleDocumentRefVoor[^\n]*retrievalMeta/);
  assert.match(route, /leesLokaleDocumentRefs/);
  assert.match(route, /haalBevrorenChunks\([\s\S]*reflectieBronsetDocumentRefs/);
  assert.match(route, /id:\s*identiteit\.passageIdentiteit\.id/);
  assert.match(route, /document_id:\s*identiteit\.documentIdentiteit\.id/);
  assert.match(ui, /`\/api\/documents\/\$\{bron\.document_id\}\/bestand`/);
});
