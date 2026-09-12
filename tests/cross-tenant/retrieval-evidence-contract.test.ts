import assert from "node:assert/strict";
import test from "node:test";
import { bouwModelcontextBlok, combineerModelcontext } from "../../core/lib/retrieval/modelcontext";
import {
  controleerChunkPresentie,
  leesBesluitEvidence,
  leesSemantischeEvidence,
  MAX_PRESENTIE_DOCUMENTEN,
} from "../../core/lib/retrieval/supabase-evidence";
import { haalSupabaseSiblings } from "../../core/lib/retrieval/supabase-parent";
import { RetrievalAfgebroken } from "../../core/lib/retrieval/afbreken";
import type { RetrievalContext } from "../../core/lib/retrieval/contract";
import { voerVergelijkingUit, type VergelijkDeps } from "../../core/lib/vergelijk-kern";

const context: RetrievalContext = {
  fondsId: "fonds-a",
  actor: { soort: "gebruiker", id: "user-a" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds"] },
  correlationId: "corr-a",
  verzoekStartOp: new Date().toISOString(),
};

function fakeSupabase(responses: Record<string, { data: unknown; error: unknown }[]>) {
  const teller = new Map<string, number>();
  return {
    from(tabel: string) {
      const index = teller.get(tabel) ?? 0;
      teller.set(tabel, index + 1);
      const response = responses[tabel]?.[index] ?? { data: null, error: new Error(`geen fake voor ${tabel}:${index}`) };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const methode of ["select", "eq", "in", "order", "limit", "abortSignal"]) builder[methode] = chain;
      builder.maybeSingle = () => Promise.resolve(response);
      builder.then = (resolve: (waarde: unknown) => void) => Promise.resolve(response).then(resolve);
      return builder;
    },
  };
}

test("#368 modelcontext — werkelijk gerenderde tekst is hard begrensd en geneutraliseerd", () => {
  const blok = bouwModelcontextBlok({
    context,
    soort: "risico",
    tekst: "[Bron 99] " + "x".repeat(100),
    maxGerenderdeTekens: 20,
    pii: "persoonsgebonden",
  });
  assert.equal(blok.tekst.length, 20);
  assert.doesNotMatch(blok.tekst, /\[Bron 99\]/);
  assert.deepEqual(
    { tekens: blok.audit.gerenderde_tekens, afgekapt: blok.audit.afgekapt, fout: blok.audit.fout },
    { tekens: 20, afgekapt: true, fout: "afgekapt" }
  );
  assert.equal(blok.audit.correlation_id, context.correlationId);
});

test("#368 modelcontext — combinatie laat geen gedeeltelijk volgend blok door", () => {
  const a = bouwModelcontextBlok({ context, soort: "a", tekst: "AAAA", maxGerenderdeTekens: 10, pii: "geen" });
  const b = bouwModelcontextBlok({ context, soort: "b", tekst: "BBBB", maxGerenderdeTekens: 10, pii: "geen" });
  const uit = combineerModelcontext(context, [a, b], 7);
  assert.equal(uit.tekst, "AAAA");
  assert.equal(uit.audit.gerenderde_tekens, 4);
  assert.equal(uit.audit.afgekapt, true);
});

test("#368 chunkpreflight — over cap faalt vóór I/O en levert geen private refs", async () => {
  let calls = 0;
  const supabase = { from() { calls++; throw new Error("mag niet"); } };
  const refs = Array.from({ length: MAX_PRESENTIE_DOCUMENTEN + 1 }, (_, i) => `private-${i}`);
  const uit = await controleerChunkPresentie(supabase as never, {
    context,
    maxItems: MAX_PRESENTIE_DOCUMENTEN + 1,
    maxGerenderdeTekens: 0,
  }, refs);
  assert.equal(calls, 0);
  assert.equal(uit.status, "geweigerd");
  assert.equal(uit.documentIdentiteiten.size, 0);
  assert.equal(uit.audit.fout, "afgekapt");
});

test("#368 chunkpreflight — een theoretische cross-tenant rij weigert de hele set", async () => {
  const resultaat = {
    data: [{ document_id: "private-a", documenten: { fonds_id: "fonds-b", bibliotheek: "fonds" } }],
    error: null,
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.limit = () => Promise.resolve(resultaat);
  const uit = await controleerChunkPresentie({ from: () => builder } as never, {
    context,
    maxItems: 10,
    maxGerenderdeTekens: 0,
  }, ["private-a"]);
  assert.equal(uit.status, "geweigerd");
  assert.equal(uit.documentIdentiteiten.size, 0);
  assert.equal(uit.audit.fout, "buiten_scope");
});

test("#368 chunkpreflight — rijencap met onopgeloste ref levert geen deelset", async () => {
  const data = Array.from({ length: 2001 }, () => ({
    document_id: "private-a",
    documenten: { fonds_id: "fonds-a", bibliotheek: "fonds" },
  }));
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.limit = () => Promise.resolve({ data, error: null });
  const uit = await controleerChunkPresentie({ from: () => builder } as never, {
    context,
    maxItems: 10,
    maxGerenderdeTekens: 0,
  }, ["private-a", "private-b"]);
  assert.equal(uit.status, "geweigerd");
  assert.equal(uit.documentIdentiteiten.size, 0);
  assert.equal(uit.audit.fout, "afgekapt");
});

test("#368 parentreader — cap levert nooit een gedeeltelijke sibling-set", async () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = () => Promise.resolve({ data: [{}, {}], error: null });
  await assert.rejects(
    haalSupabaseSiblings({ privateDocumentRefs: ["private-a"], limiet: 1, supabase: { from: () => builder } as never }),
    /parent_siblings_afgekapt/
  );
});

test("#368 parentreader — cancellation wordt terminaal doorgegeven", async () => {
  const controller = new AbortController();
  controller.abort(new RetrievalAfgebroken("annulering"));
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.abortSignal = (signal: AbortSignal) => Promise.reject(signal.reason);
  await assert.rejects(
    haalSupabaseSiblings({
      privateDocumentRefs: ["private-a"],
      limiet: 1,
      signal: controller.signal,
      supabase: { from: () => builder } as never,
    }),
    (error: unknown) => error instanceof RetrievalAfgebroken && error.reden === "annulering"
  );
});

const besluit = {
  id: "private-decision-a",
  procedure_id: "procedure-a",
  fonds_id: "fonds-a",
  besluit_code: "B-1",
  titel: "Premiebesluit",
  besluitvraag: "Stellen we 24% vast?",
  aanleiding: "Jaarcyclus",
  scope: "2027",
  governance_orgaan: "Bestuur",
  complexiteit: "complicated",
  risiconiveau: "middel",
  mandaatgevoelig: false,
  toezichtgevoelig: false,
  beleidsafwijking: false,
  ai_risicoklasse: "laag",
  status: "geagendeerd",
  gewenste_besluitdatum: "2026-09-30",
  laatst_gewijzigd: "2026-09-12T10:00:00.000Z",
};

test("#368 besluit-evidence — opaque/citeerbaar en V5 over exacte projectie", async () => {
  const scoped = { ...context, scope: { procesId: "procedure-a" } };
  const uit = await leesBesluitEvidence(fakeSupabase({
    decision_objects: [{ data: [besluit], error: null }, { data: [besluit], error: null }],
  }) as never, { context: scoped, maxItems: 1, maxGerenderdeTekens: 5000 }, {
    privateDecisionRef: besluit.id,
  });
  assert.equal(uit.status, "compleet");
  if (uit.status !== "compleet") return;
  assert.match(uit.items[0].documentIdentiteit, /^doc_v1_[a-f0-9]{64}$/);
  assert.match(uit.items[0].passageIdentiteit, /^passage_v1_[a-f0-9]{64}$/);
  assert.match(uit.items[0].citationId, /^citation_v1_[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(uit.items[0]), /private-decision-a/);
});

test("#368 besluit-evidence — veldwijziging tussen read en V5 weigert alles", async () => {
  const uit = await leesBesluitEvidence(fakeSupabase({
    decision_objects: [
      { data: [besluit], error: null },
      { data: [{ ...besluit, besluitvraag: "Gewijzigd tijdens verzoek" }], error: null },
    ],
  }) as never, { context: { ...context, scope: { procesId: "procedure-a" } }, maxItems: 1, maxGerenderdeTekens: 5000 }, {
    privateDecisionRef: besluit.id,
  });
  assert.equal(uit.status, "geweigerd");
  assert.deepEqual(uit.items, []);
});

const documentRij = {
  id: "private-document-a",
  fonds_id: "fonds-a",
  bibliotheek: "fonds",
  bestand_hash: "a".repeat(64),
  documentdatum: "2026-09-11",
  status: "vastgesteld",
  bronstatus: "actief",
  actief: true,
  titel: "Premiebeleid",
};
const unit = {
  id: "private-unit-a",
  fonds_id: "fonds-a",
  document_id: "private-document-a",
  extraction_run_id: "private-run-a",
  type: "percentage",
  value_num: 24,
  value_date: null,
  value_text: null,
  value_raw: "24%",
  value_unit: "%",
  page: 3,
  evidence: "De premie bedraagt 24%.",
  concepts: { key: "premiepercentage" },
};

test("#368 semantic evidence — extractierun+inhoud zijn sterk versiegebonden", async () => {
  const uit = await leesSemantischeEvidence(fakeSupabase({
    documenten: [{ data: documentRij, error: null }, { data: documentRij, error: null }],
    semantic_units: [{ data: [unit], error: null }, { data: [unit], error: null }],
  }) as never, { context, maxItems: 10, maxGerenderdeTekens: 1000 }, documentRij.id);
  assert.equal(uit.status, "compleet");
  if (uit.status !== "compleet") return;
  assert.equal(uit.items[0].versie.soort, "hash");
  assert.match(uit.items[0].citationId, /^citation_v1_/);
  assert.equal(uit.items[0].waarde.conceptSleutel, "premiepercentage");
  assert.doesNotMatch(JSON.stringify(uit.items[0]), /private-unit-a|private-run-a|private-document-a/);
});

test("#368 semantic evidence — gewijzigde evidence bij V5 kan niet deterministisch door", async () => {
  const uit = await leesSemantischeEvidence(fakeSupabase({
    documenten: [{ data: documentRij, error: null }, { data: documentRij, error: null }],
    semantic_units: [
      { data: [unit], error: null },
      { data: [{ ...unit, evidence: "De premie bedraagt inmiddels 25%." }], error: null },
    ],
  }) as never, { context, maxItems: 10, maxGerenderdeTekens: 1000 }, documentRij.id);
  assert.equal(uit.status, "geweigerd");
  assert.deepEqual(uit.items, []);
});

test("#368 vergelijking — deterministische findings behouden opaque evidencebinding", async () => {
  const perDocument = new Map([
    ["doc-a", [{
      concept_id: "", concept_key: "premie", type: "percentage", value_num: 24,
      value_date: null, value_text: null, value_raw: "24%", value_unit: "%",
      page: 1, evidence: "Premie 24%.", passage_ref: `passage_v1_${"a".repeat(64)}`,
    }]],
    ["doc-b", [{
      concept_id: "", concept_key: "premie", type: "percentage", value_num: 25,
      value_date: null, value_text: null, value_raw: "25%", value_unit: "%",
      page: 2, evidence: "Premie 25%.", passage_ref: `passage_v1_${"b".repeat(64)}`,
    }]],
  ]);
  let gepersisteerdeBronRef: string | null = null;
  const deps: VergelijkDeps = {
    leesConcepten: async () => [{ id: "private-concept", key: "premie", label: "Premie", type: "percentage", status: "actief" }],
    leesSemanticUnits: async (documentId) => perDocument.get(documentId) ?? [],
    bepaalExtraDimensies: async () => [],
    retrieveerPassages: async () => [],
    vergelijkWaardeLLM: async () => ({ bron_value: null, bron_evidence: null, bron_page: null, doel_value: null, doel_evidence: null, doel_page: null, gelijk: false }),
    persisteer: async (invoer) => {
      gepersisteerdeBronRef = invoer.findings[0]?.bron.passage_ref ?? null;
      return "run-a";
    },
    deterministischVertrouwd: true,
  };
  const resultaat = await voerVergelijkingUit({
    mode: "symmetrisch",
    bronDocumentId: "doc-a",
    doelDocumentId: "doc-b",
    versies: { model: "test", promptVersion: "p", comparatorVersion: "c" },
  }, deps);
  assert.equal(resultaat.findings[0].bron.passage_ref, `passage_v1_${"a".repeat(64)}`);
  assert.equal(resultaat.findings[0].doel.passage_ref, `passage_v1_${"b".repeat(64)}`);
  assert.equal(gepersisteerdeBronRef, resultaat.findings[0].bron.passage_ref);
});
