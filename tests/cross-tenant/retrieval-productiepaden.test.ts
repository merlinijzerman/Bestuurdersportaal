// #369 F4-T2-2 — contracttests voor /zoeken en /vergelijk.
// Hermetisch: geen database, embeddingprovider of service-roleclient.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  geldigeUuid,
  bevatClientScopeSturing,
  groepeerZoekresultaten,
  maakZoekRespons,
  maakVergelijkSpoor,
  maakZoekSpoor,
} from "../../core/lib/retrieval/productiepaden-core";
import { binnenServerScope, voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import { voerVergelijkingBinnenDeadline } from "../../core/lib/vergelijk-deadline";
import type { VergelijkDeps } from "../../core/lib/vergelijk-kern";
import { RetrievalAfgebroken } from "../../core/lib/retrieval/afbreken";
import { geldigeUuidVoorQuery } from "../karakterisering/uuid.mjs";
import type {
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
} from "../../core/lib/retrieval/contract";

const ROOT = join(import.meta.dirname, "..", "..");
const lees = (pad: string) => readFileSync(join(ROOT, pad), "utf8");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const DOC_A = `doc_v1_${"a".repeat(64)}`;
const DOC_B = `doc_v1_${"b".repeat(64)}`;
const PASSAGE_A = `passage_v1_${"a".repeat(64)}`;
const PASSAGE_B = `passage_v1_${"b".repeat(64)}`;

function bron(overrides: Partial<Bronresultaat> = {}): Bronresultaat {
  return {
    ref: PASSAGE_A,
    bronsoort: "fonds",
    titel: "Premiebeleid",
    documentIdentiteit: {
      id: DOC_A,
      fondsId: "fonds-1",
      bibliotheek: "fonds",
      bron: "Bestuur",
      procesId: UUID_B,
    },
    passageIdentiteit: { id: PASSAGE_A },
    versie: { soort: "status-datum", waarde: "2026-09-11", gecontroleerdOp: null },
    locator: { pagina: 3, paragraaf: "2.1" },
    passage: "De premie bedraagt 24 procent.",
    status: { documentstatus: "vastgesteld", bronstatus: "actief", geldigTot: null, actueel: true },
    rang: { positie: 0, score: 0.9 },
    weergave: { documentdatum: "2026-09-11", opslagPad: "fonds/premie.pdf" },
    ...overrides,
  };
}

const context: RetrievalContext = {
  fondsId: "fonds-1",
  actor: { soort: "gebruiker", id: "user-1" },
  taaktype: "rerank",
  bronbeleid: { bronsoorten: ["fonds"] },
  correlationId: "req-1",
  verzoekStartOp: new Date().toISOString(),
};

function adapter(zoek: RetrievalAdapter["zoek"]): RetrievalAdapter {
  return {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds", "generiek", "notulen"],
      strategieen: ["gericht", "vergelijk"],
      ondersteundeFilters: ["modus", "bronsoort", "procesinstantie_ids"],
      versiebewijs: true,
      versiebeleid: { sterk: [], gedegradeerd: ["status-datum"] },
      permissionProof: false,
      preview: false,
      cancellation: true,
      timeout: true,
    }),
    zoek,
    verifieerVersies: async (_ctx, refs) => new Map(refs.map((ref) => [ref, {
      beschikbaar: true,
      documentIdentiteit: ref === PASSAGE_A ? DOC_A : DOC_B,
      passageIdentiteit: ref,
      versie: { soort: "status-datum" as const, waarde: "2026-09-11" },
    }])),
  };
}

test("T2-2 — processcope accepteert alleen UUID's; provider-/fondswaarden zijn geen scope", () => {
  assert.equal(geldigeUuid(UUID_A), true);
  for (const waarde of ["", "ander-fonds", "microsoft", "../preview", `${UUID_A}?provider=graph`]) {
    assert.equal(geldigeUuid(waarde), false, waarde);
  }
  assert.equal(bevatClientScopeSturing(["q", "modus", "bronsoort", "procesinstantie"]), false);
  for (const sleutel of [
    "fonds_id",
    "fondsId",
    "tenant_id",
    "document_id",
    "documentId",
    "vergadering_id",
    "provider",
    "adapter",
    "actor",
    "scope",
  ]) {
    assert.equal(bevatClientScopeSturing([sleutel]), true, sleutel);
  }
});

test("T2-2 — zoeken en vergelijken bouwen centrale, begrensde opdrachten; R2 houdt vergelijkfilters leeg", () => {
  const vlaggen = { parentRetrieval: true, representatieConstraints: true };
  const zoeken = maakZoekSpoor({
    vraag: "premiebeleid",
    filters: { modus: "actueel", procesinstantie_ids: [UUID_B] },
    hybrideAan: true,
    vlaggen,
  });
  assert.equal(zoeken.query.strategie, "gericht");
  assert.ok(zoeken.query.maxKandidaten > zoeken.query.maxResultaten);
  assert.ok(zoeken.query.maxContextTekens > 0);

  const vergelijk = maakVergelijkSpoor({
    vraag: "premiepercentage",
    documentId: UUID_A,
    hybrideAan: false,
    vlaggen,
  });
  assert.equal(vergelijk.query.strategie, "vergelijk");
  assert.deepEqual(vergelijk.query.documentScope, [UUID_A]);
  assert.equal(vergelijk.query.filters, undefined, "expliciet historische stukken mogen niet wegvallen");
  assert.equal(vergelijk.grenzen.representatieConstraints, true);
});

test("T2-2 — /zoeken-succesgrens blijft byte-/structuurcompatibel met de W322-golden", () => {
  const lang = bron({ passage: "x".repeat(230) });
  const resultaat = groepeerZoekresultaten([
    lang,
    bron({ ref: PASSAGE_B, passageIdentiteit: { id: PASSAGE_B }, locator: { pagina: 4 } }),
  ]);
  assert.equal(resultaat.length, 1);
  assert.equal(resultaat[0].procesinstantie_id, UUID_B);
  assert.equal(resultaat[0].treffers.length, 2);
  assert.equal(resultaat[0].treffers[0].fragment.length, 221);
  const respons = maakZoekRespons({
    resultaten: resultaat,
    procesinstanties: [{ id: UUID_B, titel: "Dossier" }],
    methode: "fts_dutch_ranked",
    opgehaald: 2,
    geselecteerd: 2,
    modus: "alles",
  });
  assert.deepEqual(Object.keys(respons).sort(), ["meta", "procesinstanties", "resultaten"]);
  assert.deepEqual(Object.keys(respons.meta).sort(), ["geselecteerd", "methode", "modus", "opgehaald"]);
  assert.deepEqual(Object.keys(respons.resultaten[0].treffers[0]).sort(), ["fragment", "pagina", "paragraaf"]);
  assert.doesNotMatch(JSON.stringify(respons), /citation_id|"bronnen"/);
});

test("T2-2 review — alleen een echte generieke bron mag zonder fonds-id door de serverscope", () => {
  assert.equal(binnenServerScope(context, bron({ documentIdentiteit: { id: DOC_A, fondsId: null, bibliotheek: "fonds" } })), false);
  assert.equal(binnenServerScope(context, bron({ bronsoort: "notulen", documentIdentiteit: { id: DOC_A, fondsId: null, bibliotheek: "fonds" } })), false);
  assert.equal(binnenServerScope(context, bron({ bronsoort: "generiek", documentIdentiteit: { id: DOC_A, fondsId: null, bibliotheek: "fonds" } })), false);
  assert.equal(binnenServerScope(context, bron({ bronsoort: "generiek", documentIdentiteit: { id: DOC_A, fondsId: null, bibliotheek: "generiek" } })), true);
});

test("T2-2 review — requestbrede deadline voorkomt persistentie als een concept-read abort negeert", async () => {
  let persisteerCalls = 0;
  let gedeeldSignaal: AbortSignal | undefined;
  const start = Date.now();
  await assert.rejects(
    voerVergelijkingBinnenDeadline(
      {
        mode: "symmetrisch",
        bronDocumentId: UUID_A,
        doelDocumentId: UUID_B,
        versies: { model: "test", promptVersion: "p", comparatorVersion: "c" },
      },
      {
        timeoutMs: 20,
        depsVoorSignal(signal) {
          gedeeldSignaal = signal;
          const deps: VergelijkDeps = {
            // Simuleert een SDK die AbortSignal negeert. De wrapper moet NA de
            // await alsnog stoppen en mag persisteer nooit bereiken.
            leesConcepten: async () => {
              await new Promise((resolve) => setTimeout(resolve, 35));
              return [];
            },
            leesSemanticUnits: async () => [],
            bepaalExtraDimensies: async () => [],
            retrieveerPassages: async () => [],
            vergelijkWaardeLLM: async () => ({
              bron_value: null, bron_evidence: null, bron_page: null,
              doel_value: null, doel_evidence: null, doel_page: null, gelijk: false,
            }),
            persisteer: async () => { persisteerCalls++; return "mag-niet"; },
            deterministischVertrouwd: false,
          };
          return deps;
        },
      }
    ),
    (e: unknown) => e instanceof RetrievalAfgebroken && e.reden === "timeout"
  );
  assert.equal(gedeeldSignaal?.aborted, true);
  assert.equal(persisteerCalls, 0);
  assert.ok(Date.now() - start < 250, "gedragstest mag niet op een providerdeadline wachten");
});

test("T2-2 review — verlopen deadline na een modelcall kan niet alsnog persisteren", async () => {
  let persisteerCalls = 0;
  await assert.rejects(
    voerVergelijkingBinnenDeadline(
      {
        mode: "symmetrisch",
        bronDocumentId: UUID_A,
        doelDocumentId: UUID_B,
        versies: { model: "test", promptVersion: "p", comparatorVersion: "c" },
      },
      {
        timeoutMs: 20,
        depsVoorSignal() {
          return {
            leesConcepten: async () => [{
              id: "concept-1", key: "premie", label: "Premie", type: "percentage", status: "actief",
            }],
            leesSemanticUnits: async () => [],
            bepaalExtraDimensies: async () => [],
            retrieveerPassages: async (_documentId) => [{ tekst: "Premie 24 procent.", page: 1 }],
            // Ook als de modeladapter het signaal negeert en succesvol terugkomt,
            // controleert de requestwrapper de verstreken deadline na de await.
            vergelijkWaardeLLM: async () => {
              await new Promise((resolve) => setTimeout(resolve, 35));
              return {
                bron_value: "24", bron_evidence: "Premie 24 procent.", bron_page: 1,
                doel_value: "25", doel_evidence: "Premie 25 procent.", doel_page: 1, gelijk: false,
              };
            },
            persisteer: async () => { persisteerCalls++; return "mag-niet"; },
            deterministischVertrouwd: false,
          };
        },
      }
    ),
    (e: unknown) => e instanceof RetrievalAfgebroken && e.reden === "timeout"
  );
  assert.equal(persisteerCalls, 0);
});

test("T2-2 — gemanipuleerd bronbeleid stopt vóór de adapter/netwerkcall", async () => {
  let calls = 0;
  const a = adapter(async () => {
    calls++;
    return { kandidaten: [], methode: "geen", provider: "supabase", latencyMs: 0, opgehaald: 0 };
  });
  const spoor = maakZoekSpoor({
    vraag: "premie",
    filters: { bronsoort: ["sharepoint"] },
    hybrideAan: false,
    vlaggen: {},
  });
  const uitkomst = await voerVolledigeRetrievalUit(
    context,
    { adapter: a, timeoutMs: 5_000, sporen: [spoor] },
    { primaireDocumentIds: new Set(), peildatum: "2026-09-11", hoofddocumentLabel: "" }
  );
  assert.equal(calls, 0);
  assert.equal(uitkomst.fout, "configuratiefout");
});

test("T2-2 — adapter kan bronbeleid of tenantscope niet verruimen; weigering is inhoudsvrij auditeerbaar", async () => {
  const a = adapter(async () => ({
    kandidaten: [
      bron(),
      bron({
        ref: PASSAGE_B,
        bronsoort: "sharepoint",
        documentIdentiteit: { id: DOC_B },
        passageIdentiteit: { id: PASSAGE_B },
      }),
      bron({
        ref: PASSAGE_B,
        documentIdentiteit: { id: DOC_B, fondsId: "fonds-2", procesId: UUID_B },
        passageIdentiteit: { id: PASSAGE_B },
      }),
    ],
    methode: "fts_dutch_ranked",
    provider: "supabase",
    latencyMs: 0,
    opgehaald: 3,
  }));
  const spoor = maakZoekSpoor({ vraag: "premie", filters: {}, hybrideAan: false, vlaggen: {} });
  const uitkomst = await voerVolledigeRetrievalUit(
    context,
    { adapter: a, timeoutMs: 5_000, sporen: [spoor] },
    { primaireDocumentIds: new Set(), peildatum: "2026-09-11", hoofddocumentLabel: "" }
  );
  assert.equal(uitkomst.geselecteerd.length, 1);
  assert.equal(uitkomst.bronverwijzingen.length, 1);
  assert.equal(uitkomst.bronverwijzingen[0].document_id, DOC_A);
  assert.equal(uitkomst.perAdapter[0].fout, "buiten_scope");
  assert.equal(uitkomst.perAdapter[0].geweigerd, 2);
  assert.equal(uitkomst.meta.toelating?.categorieen.buiten_scope, 2);
  assert.equal(uitkomst.meta.toelating?.gronden.buiten_server_scope, 2);
  assert.doesNotMatch(JSON.stringify(uitkomst.meta.toelating), /sp-1|ander-fonds|Premiebeleid/);
});

test("T2-2 — productieroutes hebben geen directe retrievalcall of service-rolefallback", () => {
  const zoeken = lees("app/api/zoeken/route.ts");
  const vergelijk = lees("core/lib/vergelijk-productie.ts");
  for (const [naam, code] of [["zoeken", zoeken], ["vergelijk", vergelijk]] as const) {
    assert.doesNotMatch(code, /zoekRelevanteChunksMetMeta/iu, `${naam} omzeilt de adapter`);
    assert.doesNotMatch(code, /createService(?:Supabase|Client)|SUPABASE_SERVICE_ROLE_KEY/u, `${naam} bevat een service-rolefallback`);
    assert.match(code, /voerVolledigeRetrievalUit/);
  }
  assert.ok(zoeken.indexOf("bevatPersoonsgegevens(q)") < zoeken.indexOf("maakSupabaseAdapter(vlaggen)"));
  assert.ok(zoeken.indexOf("bevatClientScopeSturing(sp.keys())") < zoeken.indexOf("maakSupabaseAdapter(vlaggen)"));
  assert.ok(zoeken.indexOf("maybeSingle()") < zoeken.indexOf("maakSupabaseAdapter(vlaggen)"));
  assert.match(zoeken, /signal: req\.signal/);
  const vergelijkRoute = lees("app/api/vergelijk/route.ts");
  assert.ok(
    vergelijkRoute.indexOf("bevatClientScopeSturing(Object.keys") < vergelijkRoute.indexOf("maakSupabaseAdapter(retrievalVlaggen")
  );
  assert.match(vergelijkRoute, /clientSignal: req\.signal/);
  assert.match(vergelijkRoute, /voerVergelijkingBinnenDeadline/);
});

test("T2-2 audit — persistentie scheidt het HTTP-ordinaal van opaque citation en bewaart actualiteit", () => {
  const vergelijk = lees("core/lib/vergelijk-productie.ts");
  assert.match(vergelijk, /citation_id: b\.verwijzing\.citation_id/);
  assert.doesNotMatch(vergelijk, /citation_id: b\.citation_id/);
  assert.match(vergelijk, /actueel: b\.status\.actueel/);
  assert.match(vergelijk, /opaque_citation_id_ontbreekt/);

  const migratie = lees("supabase/migrations/2026_09_11_369_vergelijk_retrieval_audit.sql");
  assert.match(migratie, /bestuurdersportaal:citation:v1/);
  assert.match(migratie, /jsonb_typeof\(b->'actueel'\) = 'boolean'/);
  assert.match(migratie, /'actueel', b->'actueel'/);
});

test("T2-2 karakterisering — UUID-vormgrens weigert ontbrekende en malformed querywaarden", () => {
  assert.equal(geldigeUuidVoorQuery(undefined), false);
  assert.equal(geldigeUuidVoorQuery(""), false);
  assert.equal(geldigeUuidVoorQuery("geen-uuid"), false);
  assert.equal(geldigeUuidVoorQuery(UUID_A), true);
});

test("T2-2 karakterisering — schema-run slaat runtimevarianten over en queryt nooit een ongeldige uuid", () => {
  const runner = lees("tests/karakterisering/run.mjs");
  const schemaBlok = runner.slice(
    runner.indexOf('if (modus === "schema")'),
    runner.indexOf("const teDraaien =", runner.indexOf('if (modus === "schema")')),
  );
  assert.match(schemaBlok, /const teDoen = kandidaten\.filter\(\(s\) => \{/);
  assert.match(schemaBlok, /const aanwezig = vereisteAanwezig\(s\)/);
  assert.match(schemaBlok, /const overgeslagen = kandidaten\.length - teDoen\.length/);
  assert.match(schemaBlok, /runtimevariant\(en\) zichtbaar overgeslagen/);

  const scenarios = lees("tests/karakterisering/scenarios.mjs");
  assert.match(scenarios, /if \(!geldigeUuidVoorQuery\(runId\)\)/);
  assert.ok(
    scenarios.indexOf("!geldigeUuidVoorQuery(runId)") < scenarios.indexOf('.from("comparison_run")', scenarios.indexOf('slug: "w369.')),
    "de vormgrens moet voor de comparison_run-query staan"
  );
});

test("T2-2 — directe semantic_units-lezing is één gemotiveerde RLS-uitzondering met cancellation", () => {
  const code = lees("core/lib/vergelijk-productie.ts");
  assert.equal((code.match(/\.from\("semantic_units"\)/g) ?? []).length, 1);
  assert.match(code, /Gemotiveerde uitzondering:[\s\S]*semantic_units/);
  assert.match(code, /query = query\.abortSignal\(signal\)/);
});

test("T2-2 — providerfout degradeert alleen in vergelijk; afbraak en auditafronding blijven terminaal", () => {
  const service = lees("core/lib/vergelijk-productie.ts");
  assert.match(
    service,
    /if \(isAfbreking\(e\)\) throw e;[\s\S]*retrieval mislukt[\s\S]*return \[\];/,
    "een gewone providerfout mag best-effort leeg worden, een afbraak nooit"
  );

  const route = lees("app/api/vergelijk/route.ts");
  const afronding = route.indexOf('await rondAf(supabase, actieId, "mislukt")');
  const timeoutRespons = route.indexOf('if (afbreking === "timeout")');
  assert.ok(afronding >= 0 && timeoutRespons > afronding, "sluit ai_actie vóór de timeoutrespons");

  const chat = lees("app/api/chat/route.ts");
  const vergelijkStart = chat.indexOf("resultaat = await voerVergelijkingBinnenDeadline(");
  const governance = chat.indexOf('"schrijf_ai_interactie"', vergelijkStart);
  const voltooid = chat.indexOf('"voltooid"', governance);
  assert.ok(
    vergelijkStart >= 0 && governance > vergelijkStart && voltooid > governance,
    "vergelijking/persistentie → governance-log → ai_actie-afronding"
  );
});
