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
import { bewijsUitVersierij } from "../../core/lib/retrieval/supabase-versie";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import type { Bronresultaat, RetrievalAdapter, RetrievalContext } from "../../core/lib/retrieval/contract";

const DOC_REF = "11111111-1111-4111-8111-111111111111";
const FONDS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FONDS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function bron(over: Partial<Bronresultaat> = {}): Bronresultaat {
  const documentId = maakDocumentIdentiteit(`fonds:${FONDS_A}`, DOC_REF);
  const passageId = maakPassageIdentiteit(documentId, "chunk-index:3");
  return {
    ref: passageId,
    bronsoort: "fonds",
    titel: "Oude titel",
    documentIdentiteit: { id: documentId, bibliotheek: "fonds", bron: "upload", fondsId: FONDS_A },
    passageIdentiteit: { id: passageId },
    versie: { soort: "hash", waarde: maakVolledigeVersieHash(DOC_REF, "r1", "sha256:bestand"), gecontroleerdOp: "2026-09-11T10:00:00.000Z" },
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
  const gewijzigdeVersie = bron({ versie: { ...eerste.versie, waarde: "version_v1_gewijzigd" } });
  assert.notEqual(id1, bouwCitaties([gewijzigdeVersie], opdracht).bronnen[0].citation_id);
  assert.equal(id1, maakCitationId(eerste.documentIdentiteit.id, eerste.passageIdentiteit.id, eerste.versie.soort, eerste.versie.waarde!));
});

test("#367 — Supabase-versiebewijs degradeert expliciet en faalt cross-tenant/corrupt dicht", () => {
  const basis = { id: "chunk", document_id: DOC_REF, indexering_versie: "r1", documenten: {
    id: DOC_REF, fonds_id: FONDS_A, bibliotheek: "fonds", bestand_hash: "hash", documentdatum: "2026-09-11",
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
