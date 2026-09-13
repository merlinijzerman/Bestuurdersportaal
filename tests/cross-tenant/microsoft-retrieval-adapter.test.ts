// ============================================================================
//  #370 — Contracttests voor de hermetische Microsoft-retrievalfixture.
// ----------------------------------------------------------------------------
//  Geen Graph, Microsoft Search of Azure AI Search; deze suite bewijst alleen
//  dat een toekomstige adapter veilig achter de bestaande providerneutrale
//  grens kan landen en daar fail-closed wordt behandeld.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foutcategorieVoor, voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import { RetrievalAfgebroken, isAfbreking } from "../../core/lib/retrieval/afbreken";
import type {
  Bronresultaat,
  CitaatOpdracht,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalFoutcategorie,
  RetrievalQuery,
} from "../../core/lib/retrieval/contract";
import {
  maakSynthetischeMicrosoftFixtureBron,
  maakMicrosoftRetrievalFixture,
  type MicrosoftFixtureBewijsvariant,
  type MicrosoftFixtureProviderfoutcode,
  type MicrosoftFixtureScenario,
} from "./fixtures/microsoft-retrieval-adapter";

function context(over: Partial<RetrievalContext> = {}): RetrievalContext {
  return {
    fondsId: "11111111-1111-4111-8111-111111111111",
    actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
    taaktype: "chat_generatie",
    bronbeleid: { bronsoorten: ["sharepoint"] },
    correlationId: "corr-fixture-370",
    verzoekStartOp: new Date().toISOString(),
    ...over,
  };
}

function query(over: Partial<RetrievalQuery> = {}): RetrievalQuery {
  return {
    naam: "primair",
    origineleVraag: "Wat staat in het synthetische stuk?",
    zoekvraag: "synthetisch stuk",
    strategie: "gericht",
    maxResultaten: 10,
    maxKandidaten: 20,
    maxContextTekens: 100_000,
    ...over,
  };
}

const GRENZEN = {
  maxPerDoc: 5,
  representatieConstraints: false,
  regimeWeging: false,
  relevantieDrempel: false,
};

const CITAAT: CitaatOpdracht = {
  primaireDocumentIds: new Set<string>(),
  peildatum: "2026-09-11",
  hoofddocumentLabel: " [hoofddocument]",
  sentinel: "FIXTURE370",
};

const ANDER_FONDS_ID = "33333333-3333-4333-8333-333333333333";

async function voerUit(
  scenario: MicrosoftFixtureScenario,
  opties: Parameters<typeof maakMicrosoftRetrievalFixture>[0] = {},
  ctx = context(),
  q = query()
) {
  const fixture = maakMicrosoftRetrievalFixture({ ...opties, scenario });
  const uitkomst = await voerVolledigeRetrievalUit(
    ctx,
    { adapter: fixture.adapter, sporen: [{ query: q, grenzen: GRENZEN }], timeoutMs: 1_000 },
    CITAAT
  );
  return { fixture, uitkomst };
}

test("#370 — capabilities zijn expliciet, defensief gekopieerd en volledig bewijsdragend", () => {
  const fixture = maakMicrosoftRetrievalFixture();
  const a = fixture.adapter.capabilities();
  const b = fixture.adapter.capabilities();
  assert.deepEqual(a, {
    bronsoorten: ["sharepoint"],
    strategieen: ["gericht"],
    ondersteundeFilters: ["modus"],
    versiebewijs: true,
    versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
    permissionProof: true,
    preview: true,
    cancellation: true,
    timeout: true,
  });
  assert.notEqual(a.bronsoorten, b.bronsoorten);
  assert.notEqual(a.ondersteundeFilters, b.ondersteundeFilters);
  assert.notEqual(a.versiebeleid, b.versiebeleid);
  assert.notEqual(a.versiebeleid.sterk, b.versiebeleid.sterk);
});

test("#370 — de geclaimde modusfilter verkleint de set werkelijk", async () => {
  const actueel = maakSynthetischeMicrosoftFixtureBron() as Record<string, unknown>;
  const historisch = {
    ...maakSynthetischeMicrosoftFixtureBron() as Record<string, unknown>,
    resultaatRef: "loc-r-h001",
    documentRef: "loc-d-h001",
    registratieRef: "loc-b-h001",
    versieSoort: "etag",
    versieTag: 'W/"synthetisch-h001"',
    passageNr: 2,
    actueel: false,
    documentstatus: "vervangen",
    geldigTot: "2025-12-31",
  };
  const fixture = maakMicrosoftRetrievalFixture({ bronInvoer: [actueel, historisch] });
  const ctx = context();
  const alleenActueel = await fixture.adapter.zoek(ctx, query({ filters: { modus: "actueel" } }));
  const alleenHistorisch = await fixture.adapter.zoek(ctx, query({ filters: { modus: "historisch" } }));
  assert.equal(alleenActueel.kandidaten.length, 1);
  assert.equal(alleenActueel.kandidaten[0].status.actueel, true);
  assert.equal(alleenHistorisch.kandidaten.length, 1);
  assert.equal(alleenHistorisch.kandidaten[0].status.actueel, false);
  assert.notEqual(alleenActueel.kandidaten[0].ref, alleenHistorisch.kandidaten[0].ref);
});

test("#370 — algemeen resultaat draagt opaque identiteit, versie, locator, tijd en permission proof", async () => {
  const ctx = context();
  const ruweBron = maakSynthetischeMicrosoftFixtureBron() as Record<string, unknown>;
  const { uitkomst } = await voerUit("algemeen", {}, ctx);
  assert.equal(uitkomst.geselecteerd.length, 2);
  assert.deepEqual(new Set(uitkomst.geselecteerd.map((bron) => bron.versie.soort)), new Set(["etag", "ctag"]));
  for (const bron of uitkomst.geselecteerd) {
    assert.match(bron.ref, /^passage_v1_[a-f0-9]{64}$/);
    assert.match(bron.documentIdentiteit.id, /^doc_v1_[a-f0-9]{64}$/);
    assert.equal(bron.passageIdentiteit.id, bron.ref, "de publieke ref is aan de passage-identiteit gebonden");
    assert.equal(bron.documentIdentiteit.fondsId, ctx.fondsId);
    assert.ok(bron.versie.soort === "etag" || bron.versie.soort === "ctag");
    assert.match(bron.versie.waarde ?? "", /^version_v1_[a-f0-9]{64}$/);
    assert.equal(bron.versie.gecontroleerdOp, ctx.verzoekStartOp);
    assert.match(bron.locator.mappad ?? "", /^\/Bestuur\//);
    assert.equal(bron.toegangscontrole?.gebruikerId, ctx.actor.soort === "gebruiker" ? ctx.actor.id : "");
    assert.equal(bron.toegangscontrole?.correlationId, ctx.correlationId);
    assert.equal(bron.toegangscontrole?.resultaatRef, bron.ref);
    assert.equal(bron.toegangscontrole?.bronregistratieRef, bron.bronregistratieRef);
  }
  assert.notEqual(
    uitkomst.geselecteerd.find((bron) => bron.versie.soort === "etag")?.versie.waarde,
    ruweBron.versieTag,
    "de exacte eTag voedt de opaque #367-versie-identiteit maar verlaat de adapter niet rauw"
  );
  assert.equal(uitkomst.bronverwijzingen.length, 2, "citaties blijven centraal gebouwd");
  assert.equal(uitkomst.meta.correlation_id, ctx.correlationId);
  const publiek = JSON.stringify(uitkomst);
  for (const providerPrivaat of [
    "loc-r-7f12",
    "loc-d-19c4",
    "loc-b-3a81",
    'W/"synthetisch-0042"',
    '"synthetisch-0043"',
  ]) {
    assert.ok(!publiek.includes(providerPrivaat), `providerprivate identiteit lekt niet: ${providerPrivaat}`);
  }
});

test("#370 — exacte eTag/cTag-semantiek voedt de opaque versie-identiteit", async () => {
  const basis = maakSynthetischeMicrosoftFixtureBron() as Record<string, unknown>;
  const gewijzigdeTag = { ...basis, versieTag: 'W/"synthetisch-0042-gewijzigd"' };
  const cTag = { ...basis, versieSoort: "ctag", versieTag: '"synthetisch-c0042"' };
  const ctx = context();

  const basisResultaat = await maakMicrosoftRetrievalFixture({ bronInvoer: [basis] }).adapter.zoek(ctx, query());
  const gewijzigdResultaat = await maakMicrosoftRetrievalFixture({ bronInvoer: [gewijzigdeTag] }).adapter.zoek(ctx, query());
  const cTagResultaat = await maakMicrosoftRetrievalFixture({ bronInvoer: [cTag] }).adapter.zoek(ctx, query());

  assert.equal(basisResultaat.kandidaten[0].versie.soort, "etag");
  assert.equal(cTagResultaat.kandidaten[0].versie.soort, "ctag");
  assert.notEqual(
    basisResultaat.kandidaten[0].versie.waarde,
    gewijzigdResultaat.kandidaten[0].versie.waarde,
    "elk teken van de exacte provider-eTag bepaalt de afgeleide versie"
  );
  assert.notEqual(
    basisResultaat.kandidaten[0].versie.waarde,
    cTagResultaat.kandidaten[0].versie.waarde,
    "dezelfde documentbinding met cTag is een andere versie-identiteit dan eTag"
  );
  assert.doesNotMatch(
    JSON.stringify([basisResultaat, gewijzigdResultaat, cTagResultaat]),
    /synthetisch-(?:0042|c0042)/,
    "ruwe provider-tags verlaten de adaptergrens niet"
  );
});

test("#370 — scenario's beperkt, historisch en verplaatst zijn deterministisch", async () => {
  const beperkt = await voerUit("beperkt");
  assert.equal(beperkt.uitkomst.kandidaten.length, 1, "de niet-toegestane bron wordt niet aangeboden (V1)");
  assert.deepEqual(beperkt.fixture.waarneming(), {
    zoekAanroepen: 1,
    versieAanroepen: 1,
    versieIoAanroepen: 1,
    v5Aanroepen: 1,
    v5IoAanroepen: 1,
    aangebodenKandidaten: 1,
    versieReferenties: 1,
    v5Referenties: 1,
  });

  const historisch = await voerUit("historisch");
  assert.equal(historisch.uitkomst.geselecteerd[0].status.actueel, false);
  assert.equal(historisch.uitkomst.geselecteerd[0].status.geldigTot, "2025-12-31");

  const vasteContext = context();
  const algemeen = await voerUit("algemeen", {}, vasteContext);
  const verplaatst1 = await voerUit("verplaatst", {}, vasteContext);
  const verplaatst2 = await voerUit("verplaatst", {}, vasteContext);
  assert.equal(
    verplaatst1.uitkomst.geselecteerd[0].documentIdentiteit.id,
    algemeen.uitkomst.geselecteerd[0].documentIdentiteit.id,
    "verplaatsing verandert de opaque documentidentiteit niet"
  );
  assert.equal(verplaatst1.uitkomst.geselecteerd[0].ref, algemeen.uitkomst.geselecteerd[0].ref);
  assert.equal(verplaatst1.uitkomst.geselecteerd[0].versie.waarde, algemeen.uitkomst.geselecteerd[0].versie.waarde);
  assert.equal(verplaatst1.uitkomst.geselecteerd[0].locator.mappad, "/Bestuur/Archief/Herordend");
  assert.deepEqual(
    verplaatst1.uitkomst.geselecteerd.map(({ toegangscontrole: _bewijs, ...bron }) => bron),
    verplaatst2.uitkomst.geselecteerd.map(({ toegangscontrole: _bewijs, ...bron }) => bron)
  );
});

test("#370 — ontbrekende, ongeldige of verkeerd gebonden publieke identiteit faalt in de poort vóór ranking", async () => {
  const fixture = maakMicrosoftRetrievalFixture();
  const direct = await fixture.adapter.zoek(context(), query());
  const geldig = direct.kandidaten[0];
  const anderePassage = `passage_v1_${"c".repeat(64)}`;
  const gevallen: Array<[string, Bronresultaat]> = [
    ["ref ontbreekt", { ...geldig, ref: "" }],
    ["documentidentiteit ontbreekt", { ...geldig, documentIdentiteit: { ...geldig.documentIdentiteit, id: "" } }],
    ["passage-identiteit ontbreekt", { ...geldig, passageIdentiteit: { id: "" } }],
    ["ref is niet aan passage gebonden", { ...geldig, ref: anderePassage }],
  ];

  for (const [label, kandidaat] of gevallen) {
    const adapter: RetrievalAdapter = {
      ...fixture.adapter,
      async zoek() {
        return { ...direct, kandidaten: [kandidaat], opgehaald: 1 };
      },
    };
    const uitkomst = await voerVolledigeRetrievalUit(
      context(),
      { adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 1_000 },
      CITAAT
    );
    assert.deepEqual(uitkomst.geselecteerd, [], label);
    assert.equal(uitkomst.meta.toelating?.gronden.identiteit_ontbreekt, 1, label);
    assert.deepEqual(uitkomst.meta.selectie_kandidaten ?? [], [], label);
  }
});

test("#370 — werkelijk onvolledige lokale ref, documentidentiteit of locator faalt vóór ranking", async () => {
  const geldig = maakSynthetischeMicrosoftFixtureBron() as Record<string, unknown>;
  const { fondsId: _fonds, ...zonderFondsbinding } = geldig;
  const { resultaatRef: _ref, ...zonderLokaleRef } = geldig;
  const { documentRef: _document, ...zonderDocumentidentiteit } = geldig;
  const { mappad: _locator, ...zonderLocator } = geldig;

  for (const [label, bronInvoer] of [
    ["fondsbinding", zonderFondsbinding],
    ["ongeldige fondsbinding", { ...geldig, fondsId: "niet-een-uuid" }],
    ["lokale ref", zonderLokaleRef],
    ["ongeldige lokale ref", { ...geldig, resultaatRef: "niet-lokaal" }],
    ["documentidentiteit", zonderDocumentidentiteit],
    ["ongeldige documentidentiteit", { ...geldig, documentRef: "niet-lokaal" }],
    ["locator", zonderLocator],
    ["ongeldige locator", { ...geldig, mappad: "geen-lokaal-pad" }],
  ] as const) {
    const { fixture, uitkomst } = await voerUit("algemeen", { bronInvoer: [bronInvoer] });
    assert.deepEqual(uitkomst.kandidaten, [], label);
    assert.deepEqual(uitkomst.geselecteerd, [], label);
    assert.equal(uitkomst.perAdapter[0].fout, "configuratiefout", label);
    assert.equal(fixture.waarneming().aangebodenKandidaten, 0, label);
    assert.equal(fixture.waarneming().v5Referenties, 0, label);
    assert.deepEqual(uitkomst.meta.selectie_kandidaten ?? [], [], label);
  }
});

test("#370 — een onvolledige actoridentiteit faalt in de toelatingspoort vóór ranking", async () => {
  const { uitkomst } = await voerUit(
    "algemeen",
    {},
    context({ actor: { soort: "gebruiker", id: "" } })
  );
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.deepEqual(uitkomst.geselecteerd, []);
  assert.equal(uitkomst.meta.toelating?.gronden.v2_andere_gebruiker, 2);
});

test("#370 — ontbrekend versiebewijs faalt gesloten vóór ranking", async () => {
  const { uitkomst } = await voerUit("algemeen", { versieOntbreekt: true });
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.deepEqual(uitkomst.geselecteerd, []);
  assert.equal(uitkomst.meta.toelating?.gronden.versiebewijs_ontbreekt, 2);
});

test("#370 — bewijsfouten voor tijd, actor, verzoek en lokale refs falen gesloten", async () => {
  const gevallen: Array<[MicrosoftFixtureBewijsvariant, string]> = [
    ["ontbreekt", "geen_bewijs"],
    ["voor_verzoek", "v4_venster"],
    ["andere_actor", "v2_andere_gebruiker"],
    ["ander_verzoek", "v3_ander_verzoek"],
    ["andere_resultaatref", "binding_ander_resultaat"],
    ["andere_bronref", "binding_andere_bron"],
  ];
  for (const [bewijs, grond] of gevallen) {
    const { uitkomst } = await voerUit("algemeen", { bewijs });
    assert.deepEqual(uitkomst.geselecteerd, [], bewijs);
    assert.equal((uitkomst.meta.toelating?.gronden as Record<string, number> | undefined)?.[grond], 2, bewijs);
  }
});

test("#370 — bewijs ouder dan 60 s faalt op leeftijd terwijl het ná verzoekStartOp ligt", async () => {
  const verzoekStart = Date.now() - 120_000;
  const ctx = context({ verzoekStartOp: new Date(verzoekStart).toISOString() });
  const { uitkomst } = await voerUit("algemeen", { bewijs: "verlopen" }, ctx);
  assert.deepEqual(uitkomst.geselecteerd, []);
  assert.equal(uitkomst.meta.toelating?.gronden.v4_venster, 2);

  // De fixture legt het bewijs 1 s ná de verzoekstart; deze test raakt dus de
  // maximumleeftijd en niet de eerdere conditie "vóór verzoekStartOp".
  const direct = await maakMicrosoftRetrievalFixture({ bewijs: "verlopen" }).adapter.zoek(ctx, query());
  assert.ok(Date.parse(direct.kandidaten[0].toegangscontrole!.gecontroleerdOp) > verzoekStart);
});

test("#370 — gewijzigde versie faalt bij de actuele-versieherlezing vóór ranking", async () => {
  const { fixture, uitkomst } = await voerUit("gewijzigd");
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.deepEqual(uitkomst.geselecteerd, []);
  assert.equal(uitkomst.bronverwijzingen.length, 0);
  assert.equal(uitkomst.meta.toelating?.gronden.versie_gewijzigd, 1);
  assert.equal(fixture.waarneming().versieAanroepen, 1);
  assert.equal(fixture.waarneming().v5Aanroepen, 1, "de poort verzamelt beide actuele standen request-lokaal");
});

test("#370 — intrekking tijdens het verzoek is zichtbaar bij V5-herlezing vóór ranking", async () => {
  const { fixture, uitkomst } = await voerUit("ingetrokken");
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.deepEqual(uitkomst.geselecteerd, []);
  assert.equal(uitkomst.bronverwijzingen.length, 0);
  assert.equal(uitkomst.meta.toelating?.gronden.v5_bron_gewijzigd, 1);
  assert.equal(fixture.waarneming().versieAanroepen, 1);
  assert.equal(fixture.waarneming().v5Aanroepen, 1);
});

test("#370 — een niet-ondersteund filter blokkeert vóór zoek()", async () => {
  const fixture = maakMicrosoftRetrievalFixture();
  const uitkomst = await voerVolledigeRetrievalUit(
    context(),
    {
      adapter: fixture.adapter,
      sporen: [{ query: query({ filters: { procesinstantie_ids: ["loc-p-1"] } }), grenzen: GRENZEN }],
      timeoutMs: 1_000,
    },
    CITAAT
  );
  assert.equal(fixture.waarneming().zoekAanroepen, 0);
  assert.equal(uitkomst.perAdapter[0].fout, "configuratiefout");
  assert.equal(uitkomst.meta.toelating?.gronden.filter_niet_ondersteund, 1);
});

test("#370 — alleen strategie gericht is ondersteund; elke andere strategie blokkeert vóór zoek()", async () => {
  for (const strategie of ["volledig", "vergelijk", "bevroren"] as const) {
    const fixture = maakMicrosoftRetrievalFixture();
    const uitkomst = await voerVolledigeRetrievalUit(
      context(),
      {
        adapter: fixture.adapter,
        sporen: [{ query: query({ strategie }), grenzen: GRENZEN }],
        timeoutMs: 1_000,
      },
      CITAAT
    );
    assert.equal(fixture.waarneming().zoekAanroepen, 0, strategie);
    assert.equal(uitkomst.perAdapter[0].fout, "configuratiefout", strategie);
    assert.equal(uitkomst.meta.toelating?.gronden.filter_niet_ondersteund, 1, strategie);
  }
});

test("#370 — ruwe bronnen en beide herlezingen zijn fondsgebonden", async () => {
  const bronA = maakSynthetischeMicrosoftFixtureBron() as Record<string, unknown>;
  const bronB = { ...bronA, fondsId: ANDER_FONDS_ID };
  const fixture = maakMicrosoftRetrievalFixture({ bronInvoer: [bronA, bronB] });
  const fondsA = context();
  const fondsB = context({ fondsId: ANDER_FONDS_ID, correlationId: "corr-fixture-370-fonds-b" });
  const uitA = await fixture.adapter.zoek(fondsA, query());
  assert.equal(uitA.kandidaten.length, 1);

  const uitB = await fixture.adapter.zoek(fondsB, query());
  assert.equal(uitB.kandidaten.length, 1);
  assert.notEqual(uitA.kandidaten[0].ref, uitB.kandidaten[0].ref, "dezelfde ruwe refs krijgen per fonds een andere passage-id");
  assert.notEqual(
    uitA.kandidaten[0].bronregistratieRef,
    uitB.kandidaten[0].bronregistratieRef,
    "dezelfde ruwe registratieref krijgt per fonds een andere opaque binding"
  );

  const kandidaatA = uitA.kandidaten[0];
  const versiestandB = await fixture.adapter.verifieerVersies!(fondsB, [kandidaatA.ref]);
  const registratiestandB = await fixture.adapter.verifieerBronregistratie!(fondsB, [kandidaatA.bronregistratieRef!]);
  assert.equal(versiestandB.size, 0, "een opaque resultaatref uit fonds A resolveert niet onder fonds B");
  assert.equal(registratiestandB.size, 0, "een opaque bronregistratieref uit fonds A resolveert niet onder fonds B");
  assert.equal(fixture.waarneming().versieIoAanroepen, 0, "fonds-B-refcontrole start geen versie-I/O voor fonds A");
  assert.equal(fixture.waarneming().v5IoAanroepen, 0, "fonds-B-refcontrole start geen V5-I/O voor fonds A");

  const ongeldigeContext = context({ fondsId: "client-aangeleverd-fonds" });
  const vroegGeweigerd = await maakMicrosoftRetrievalFixture({ providerFout: "onverwacht" }).adapter.zoek(
    ongeldigeContext,
    query()
  );
  assert.equal(vroegGeweigerd.fout, "configuratiefout", "fondsvalidatie staat vóór de providernaad");
  assert.equal(vroegGeweigerd.provider, "geen");
});

test("#370 — een kandidaat/ref uit fonds A kan onder fonds B niet via versie- of V5-stand worden gelegitimeerd", async () => {
  const fixture = maakMicrosoftRetrievalFixture();
  const fondsA = context();
  const fondsB = context({ fondsId: ANDER_FONDS_ID, correlationId: "corr-fixture-370-aanval" });
  const directA = await fixture.adapter.zoek(fondsA, query());
  const kandidaatA = directA.kandidaten[0];

  // Simuleer de bewezen aanval: de onbetrouwbare adapteruitkomst plakt alleen
  // het scopeveld van fonds B op een verder volledig fonds-A-resultaat. De
  // centrale scopescan alleen zou dit veld accepteren; de fondsgebonden hooks
  // mogen de A-referenties onder B vervolgens niet terugvinden.
  const gemanipuleerd: Bronresultaat = {
    ...kandidaatA,
    documentIdentiteit: { ...kandidaatA.documentIdentiteit, fondsId: ANDER_FONDS_ID },
  };
  const aanvallendeAdapter: RetrievalAdapter = {
    ...fixture.adapter,
    async zoek() {
      return { ...directA, kandidaten: [gemanipuleerd], opgehaald: 1 };
    },
  };
  const uitkomst = await voerVolledigeRetrievalUit(
    fondsB,
    { adapter: aanvallendeAdapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 1_000 },
    CITAAT
  );
  assert.deepEqual(uitkomst.kandidaten, []);
  assert.deepEqual(uitkomst.geselecteerd, []);
  assert.equal(uitkomst.bronverwijzingen.length, 0);
  assert.equal(uitkomst.meta.toelating?.gronden.versiestand_ontbreekt, 1);
  assert.equal(fixture.waarneming().versieIoAanroepen, 0);
  assert.equal(fixture.waarneming().v5IoAanroepen, 0);
});

test("#370 — truncatie is expliciet en behoudt uitsluitend de begrensde kandidaat", async () => {
  const fixture = maakMicrosoftRetrievalFixture({ maxKandidatenTerug: 1 });
  const adapterUitkomst = await fixture.adapter.zoek(context(), query());
  assert.deepEqual(adapterUitkomst.truncatie, { reden: "kandidaten" });
  assert.equal(adapterUitkomst.opgehaald, 2, "de teller blijft vóór de adaptergrens");
  assert.equal(adapterUitkomst.kandidaten.length, 1);

  const { uitkomst } = await voerUit("algemeen", { maxKandidatenTerug: 1 });
  assert.equal(uitkomst.kandidaten.length, 1);
  assert.equal(uitkomst.perAdapter[0].fout, "truncatie");
  assert.equal(uitkomst.fout, "truncatie");
});

test("#370 — echte providerthrows worden genormaliseerd en door de orkestratie gedragen", async () => {
  const gevallen: Array<[MicrosoftFixtureProviderfoutcode, RetrievalFoutcategorie]> = [
    ["niet_gevonden", "geen_resultaten"],
    ["buiten_scope", "buiten_scope"],
    ["toegang", "toestemming_geweigerd"],
    ["configuratie", "configuratiefout"],
    ["provider_timeout", "timeout"],
    ["limiet", "rate_limit"],
    ["onverwacht", "providerfout"],
  ];
  for (const [providerFout, verwacht] of gevallen) {
    const fixture = maakMicrosoftRetrievalFixture({ providerFout });
    const uitkomst = await voerVolledigeRetrievalUit(
      context(),
      { adapter: fixture.adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 1_000 },
      CITAAT
    );
    assert.equal(uitkomst.fout, verwacht, providerFout);
    assert.equal(uitkomst.perAdapter[0].fout, verwacht, providerFout);
    assert.doesNotMatch(JSON.stringify(uitkomst.perAdapter[0]), /synthetische providerfout|stack|message/i);
  }
});

test("#370 — cancellation breekt echte wachtende initiële adapter-I/O af", async () => {
  const controller = new AbortController();
  const fixture = maakMicrosoftRetrievalFixture({ vertragingMs: 5_000 });
  const bezig = fixture.adapter.zoek(context({ signal: controller.signal }), query());
  controller.abort(new RetrievalAfgebroken("annulering"));
  await assert.rejects(
    () => bezig,
    (fout: unknown) => isAfbreking(fout) && foutcategorieVoor(fout) === "annulering"
  );
});

test("#370 — de echte orkestratiedeadline breekt de initiële zoek-I/O af en start geen hooks", async () => {
  const fixture = maakMicrosoftRetrievalFixture({ vertragingMs: 5_000 });
  const bezig = voerVolledigeRetrievalUit(
    context(),
    { adapter: fixture.adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 25 },
    CITAAT
  );
  await assert.rejects(
    () => bezig,
    (fout: unknown) => isAfbreking(fout) && foutcategorieVoor(fout) === "timeout"
  );
  assert.deepEqual(fixture.waarneming(), {
    zoekAanroepen: 1,
    versieAanroepen: 0,
    versieIoAanroepen: 0,
    v5Aanroepen: 0,
    v5IoAanroepen: 0,
    aangebodenKandidaten: 0,
    versieReferenties: 0,
    v5Referenties: 0,
  });
});

test("#370 — cancellation en deadline breken een lopende V5-herlezing af vóór ranking", async () => {
  {
    const controller = new AbortController();
    const fixture = maakMicrosoftRetrievalFixture({ v5VertragingMs: 5_000 });
    const bezig = voerVolledigeRetrievalUit(
      context({ signal: controller.signal }),
      { adapter: fixture.adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 1_000 },
      CITAAT
    );
    await fixture.wachtTotV5Start();
    controller.abort(new RetrievalAfgebroken("annulering"));
    await assert.rejects(
      () => bezig,
      (fout: unknown) => isAfbreking(fout) && foutcategorieVoor(fout) === "annulering"
    );
    assert.equal(fixture.waarneming().v5Aanroepen, 1);
  }

  {
    const fixture = maakMicrosoftRetrievalFixture({ v5VertragingMs: 5_000 });
    const bezig = voerVolledigeRetrievalUit(
      context(),
      { adapter: fixture.adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 25 },
      CITAAT
    );
    await fixture.wachtTotV5Start();
    await assert.rejects(
      () => bezig,
      (fout: unknown) => isAfbreking(fout) && foutcategorieVoor(fout) === "timeout"
    );
    assert.equal(fixture.waarneming().v5Aanroepen, 1);
  }
});

test("#370 — cancellation en deadline breken de actuele-versieherlezing af vóór ranking", async () => {
  {
    const controller = new AbortController();
    const fixture = maakMicrosoftRetrievalFixture({ versieVertragingMs: 5_000 });
    const bezig = voerVolledigeRetrievalUit(
      context({ signal: controller.signal }),
      { adapter: fixture.adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 1_000 },
      CITAAT
    );
    await fixture.wachtTotVersieStart();
    controller.abort(new RetrievalAfgebroken("annulering"));
    await assert.rejects(
      () => bezig,
      (fout: unknown) => isAfbreking(fout) && foutcategorieVoor(fout) === "annulering"
    );
    assert.equal(fixture.waarneming().versieAanroepen, 1);
    assert.equal(fixture.waarneming().v5Aanroepen, 0, "annulering stopt vóór V5");
  }

  {
    const fixture = maakMicrosoftRetrievalFixture({ versieVertragingMs: 5_000 });
    const bezig = voerVolledigeRetrievalUit(
      context(),
      { adapter: fixture.adapter, sporen: [{ query: query(), grenzen: GRENZEN }], timeoutMs: 25 },
      CITAAT
    );
    await fixture.wachtTotVersieStart();
    await assert.rejects(
      () => bezig,
      (fout: unknown) => isAfbreking(fout) && foutcategorieVoor(fout) === "timeout"
    );
    assert.equal(fixture.waarneming().versieAanroepen, 1);
    assert.equal(fixture.waarneming().v5Aanroepen, 0, "deadline stopt vóór V5");
  }
});

test("#370 — de fixture is hermetisch, inhoudsvrij in observatie en niet product-bedraad", () => {
  const fixtureBron = readFileSync(new URL("./fixtures/microsoft-retrieval-adapter.ts", import.meta.url), "utf8");
  const code = fixtureBron
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  for (const verboden of ["fetch(", "https://", "http://", "siteId", "driveId", "itemId", "accessToken", "refreshToken", "writeFile", "createClient"] ) {
    assert.ok(!code.includes(verboden), `de fixture bevat verboden I/O/identiteit: ${verboden}`);
  }

  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const productiecode: string[] = [];
  const verzamel = (map: string) => {
    for (const item of readdirSync(map, { withFileTypes: true })) {
      const pad = join(map, item.name);
      if (item.isDirectory()) verzamel(pad);
      else if ([".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(item.name))) {
        productiecode.push(readFileSync(pad, "utf8"));
      }
    }
  };
  for (const map of ["app", "core", "platform", "fondsen"]) verzamel(join(repo, map));
  const productie = productiecode.join("\n");
  assert.doesNotMatch(
    productie,
    /tests\/cross-tenant\/fixtures\/microsoft-retrieval-adapter|maakMicrosoftRetrievalFixture|MicrosoftFixtureScenario/,
    "geen productiebron importeert of benoemt de testfixture"
  );
  const contract = readFileSync(new URL("../../core/lib/retrieval/contract.ts", import.meta.url), "utf8");
  const orkestratie = readFileSync(new URL("../../core/lib/retrieval/orkestratie.ts", import.meta.url), "utf8");
  assert.doesNotMatch(contract + orkestratie, /MicrosoftFixture|Graph[A-Z]|Azure[A-Z]|SearchResponse|DriveItem/);

  const fixture = maakMicrosoftRetrievalFixture();
  const waarneming = fixture.waarneming();
  assert.deepEqual(Object.keys(waarneming).sort(), [
    "aangebodenKandidaten",
    "v5Aanroepen",
    "v5IoAanroepen",
    "v5Referenties",
    "versieAanroepen",
    "versieIoAanroepen",
    "versieReferenties",
    "zoekAanroepen",
  ]);
  assert.ok(Object.values(waarneming).every((waarde) => typeof waarde === "number"));
});
