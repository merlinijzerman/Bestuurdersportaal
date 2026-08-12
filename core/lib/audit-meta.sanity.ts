// ============================================================================
//  core/lib/audit-meta.sanity.ts — plateau A / A-7, acceptatiecriterium AC-14.
// ----------------------------------------------------------------------------
//  Bewaakt het allowlist-contract voor `governance_log.retrieval_meta`:
//
//   1. Elke sleutel uit RetrievalMeta (core/lib/rag.ts) is expliciet
//      geclassificeerd. Een nieuw veld laat deze suite falen (FR-40) in plaats
//      van stilzwijgend als inhoud in het auditspoor te belanden.
//   2. De P5-monitoringsleutels blijven op basisniveau. Zakken ze naar bron of
//      inhoud, dan vallen signaal 3, 4 en 6 stil zónder foutmelding — dat is
//      precies het soort stille regressie uit bevinding T-01.
//   3. Inhoudsleutels (de vraag, documentfragmenten, zoektermen) komen nooit in
//      het spoor terecht, ook niet uit een rij van vóór plateau A.
//
//  Uitvoeren: npx tsx core/lib/audit-meta.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  META_BASIS,
  META_BRON,
  META_INHOUD,
  META_BEKEND,
  SUB_NIVEAUS,
  niveauVan,
  splitsRetrievalMeta,
  projecteerSpoorMeta,
} from "./audit-meta";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Fixture: één object met ELKE sleutel uit de RetrievalMeta-interface ──────
// Bij uitbreiding van RetrievalMeta hoort deze fixture mee te groeien; test 1
// hieronder is de reden dat dat niet vergeten kan worden.
const VOLLEDIGE_META: Record<string, unknown> = {
  methode: "hybride_rrf",
  opgehaald: 12,
  geselecteerd: 5,
  chunks: [{ id: "c1", document_id: "d1", rang: 1 }],
  toegepaste_fonds_filter: "f1",
  namespace_conventie: "bibliotheek",
  fondsdiscipline_gedropt: 0,
  body_fonds_id_genegeerd: false,
  bronversie_audit: [
    {
      document_id: "d1",
      bron: "abtn.pdf",
      bibliotheek: "fonds",
      fonds_id: "f1",
      documentstatus: "vastgesteld",
      bronstatus: "van_kracht",
      documentdatum: "2026-01-01",
    },
  ],
  embedding_query_success: true,
  fallback_reason: "geen",
  zoekvraag: "wat is de dekkingsgraad",
  gereformuleerd: true,
  citaties: { totaal: 3, ongeldig: 0 },
  transformatie: false,
  herkomst: "agendapunt:a1",
  scope: {
    document_ids: ["d1"],
    titels: ["ABTN 2026"],
    strategie: "targeted",
    algemene_kennis: false,
    verwerkte_chunks: 40,
    batches: 2,
    afgekapt: false,
  },
  filters: {
    modus: "actueel",
    peildatum: "2026-08-04",
    bronstatus: ["van_kracht"],
    documentstatus: ["vastgesteld"],
    procesinstantie_ids: ["p1"],
    bronsoort: ["fonds"],
  },
  antwoordmodus: "feitelijk",
  besluitbronnen: 2,
  bronbasis: "documenten",
  inline_meldingen: [{ type: "info", tekst: "…" }],
  sources: [
    {
      kind: "document",
      document_id: "d1",
      titel: "ABTN 2026",
      bron: "abtn.pdf",
      pagina: 4,
      paragraaf: "2.1",
      fragment: "De beleidsdekkingsgraad bedroeg …",
      heeft_origineel: true,
    },
  ],
  source_summary: { documenten: 1, web: 0, model_knowledge: 0 },
  web: {
    ingezet: true,
    ophaaltijdstip: "2026-08-04T10:00:00Z",
    bevraagde_domeinen: ["dnb.nl"],
    aantal_geciteerd: 1,
    aantal_gebruikt: 1,
    foutcode: null,
    fallback: false,
    gebruikte_bronnen: [{ url: "https://dnb.nl/x", domein: "dnb.nl", normgewicht: "hoog" }],
  },
  markeringen: { algemene_kennis_markers: 1, instanties: ["DNB"], ontbrekend_signaal: false },
  bron_intent: "fonds",
  bron_vertrouwen: "zeker",
  bron_modus_auto: "documenten",
  alleen_fondsdocumenten: false,
  bron_intent_override: true,
  bron_intent_bron: "chip",
  bron_intent_herkomst: "risicomatrix",
  portaalstand_gebruikt: true,
  profielsturing: "actief",
  profielsturing_aspecten: {
    bestuurlijke_rol: true,
    primaire_expertise: true,
    secundaire_expertises: 2,
    gremia: 1,
    focusgebieden: 3,
    antwoordvoorkeur: "kern-eerst",
    detailniveau: "standaard",
  },
  organisatieprofiel: "actief",
  organisatieprofiel_aspecten: {
    organisatietype: true,
    uitvoerende_partijen: true,
    omvang: true,
    kernfeiten: true,
    missie: false,
    visie: false,
    strategische_speerpunten: true,
    risicohouding: true,
    peildatum: "2026-01-01",
  },
  jargon_expansie: [{ van: "dg", naar: "dekkingsgraad" }],
  rerank: { toegepast: true },
  drempel: { waarde: 0.4, scoreverdeling: { min: 0.1, max: 0.9, mediaan: 0.5 }, gedropt: 2 },
  zwakke_bronbasis: false,
  mogelijk_gerelateerd: [{ document_id: "d2", titel: "Notulen" }],
  parent: { uitgebreid: 3 },
  doorgrond: {
    secties: ["Samenvatting"],
    document_ids: ["d1"],
    vorige_document_id: null,
    promptvariant: "v2",
  },
  bureau: {
    taak: "stukvoorbereiding",
    stuksoort: "bestuursnotitie",
    secties: ["Samenvatting", "Aannames en open punten"],
    bronbereik: ["fonds"],
    promptvariant: "bureau_stuk_v1",
    rol_context: "bestuursbureau",
  },
  startvraag_bron: "voorbeeldvraag",
  niet_vastgesteld: { documenten: 1, chunks: 4, meegenomen: false },
  verduidelijking: false,
  geen_modelcall: false,
  invoer: { beurten: 3, tekens: 240, historie_hash: "abc123" },
  context_geneutraliseerd: 0,
  terugval: { termen: ["dekkingsgraad"], query: "dekkingsgraad | abtn", versie: "v1" },
  duur_ms: 4200,
  duur_model_ms: 5100,
  tokens: { in: 12000, out: 800 },
  tokendekking: {
    map_calls: 0,
    bevat_reranker: false,
    bevat_query_reformulatie: false,
    bevat_web_search: false,
  },
  // T3 — selectie-diagnostiek: telemetrie (basis) + kandidaten (bron).
  selectie: {
    intent: "fonds",
    regime: "actueel",
    constraints: { fondsMin: 1, generiekMin: 0, perSourceMin: 0, maxPerSource: 3, maxTotal: 8 },
    geselecteerd_per_bibliotheek: { fonds: 4, generiek: 1 },
    afgevallen_telling: { weging: 2, zwak_generiek: 1, quotum: 1, dedup: 1, budget: 3 },
  },
  selectie_kandidaten: [
    { document_id: "d1", bibliotheek: "fonds", rang: 1, status: "geselecteerd" },
    { document_id: "d2", bibliotheek: "generiek", rang: 9, status: "afgevallen", reden: "weging" },
  ],
};

console.log("audit-meta sanity-tests:");

// ── 1. Volledigheid en consistentie van de classificatie ────────────────────

test("elke sleutel uit RetrievalMeta is geclassificeerd (FR-40)", () => {
  const { onbekend } = splitsRetrievalMeta(VOLLEDIGE_META);
  assert.deepEqual(
    onbekend,
    [],
    `Niet-geclassificeerde retrieval_meta-sleutels: ${onbekend.join(", ")}. ` +
      "Voeg ze toe aan META_BASIS, META_BRON of META_INHOUD in core/lib/audit-meta.ts " +
      "— een nieuw veld belandt anders fail-closed als inhoud in het auditspoor."
  );
});

test("geen sleutel staat in twee niveaus tegelijk", () => {
  const alle = [...META_BASIS, ...META_BRON, ...META_INHOUD];
  assert.equal(alle.length, new Set(alle).size);
  assert.equal(META_BEKEND.size, alle.length);
});

test("een onbekende sleutel wordt gemeld én valt fail-closed naar inhoud", () => {
  const { spoor, inhoud, onbekend } = splitsRetrievalMeta({
    methode: "geen",
    nieuw_veld_van_morgen: "geheime tekst",
  });
  assert.deepEqual(onbekend, ["nieuw_veld_van_morgen"]);
  assert.equal(inhoud.nieuw_veld_van_morgen, "geheime tekst");
  assert.equal("nieuw_veld_van_morgen" in spoor, false);
});

// ── 2. P5-koppeling: monitoring mag niet stilvallen ─────────────────────────

test("P5-monitoringsleutels blijven op basisniveau", () => {
  // Gelezen door platform/lib/monitoring-health.ts:196 en
  // platform/lib/monitoring-queries.ts:311/356/400 — met de service-role, dus
  // buiten RLS om, maar wél uit governance_log.retrieval_meta.
  for (const sleutel of [
    "embedding_query_success",
    "duur_model_ms",
    "geselecteerd",
    "zwakke_bronbasis",
    "verduidelijking",
    "tokens",
  ]) {
    assert.equal(
      niveauVan(sleutel),
      "basis",
      `${sleutel} moet basisniveau blijven, anders valt een P5-signaal stil`
    );
  }
});

test("P5-sleutels overleven de splitsing daadwerkelijk", () => {
  const { spoor } = splitsRetrievalMeta(VOLLEDIGE_META);
  assert.equal(spoor.embedding_query_success, true);
  assert.equal(spoor.duur_model_ms, 5100);
  assert.equal(spoor.geselecteerd, 5);
  assert.deepEqual(spoor.tokens, { in: 12000, out: 800 });
});

// ── 3. Inhoud komt nooit in het spoor ───────────────────────────────────────

test("de vraag zelf verlaat het auditspoor", () => {
  const { spoor, inhoud } = splitsRetrievalMeta(VOLLEDIGE_META);
  assert.equal("zoekvraag" in spoor, false);
  assert.equal(inhoud.zoekvraag, "wat is de dekkingsgraad");
  assert.equal(JSON.stringify(spoor).includes("wat is de dekkingsgraad"), false);
});

test("documentfragmenten en zoektermen verlaten het auditspoor", () => {
  const { spoor, inhoud } = splitsRetrievalMeta(VOLLEDIGE_META);
  for (const sleutel of ["sources", "terugval", "jargon_expansie"]) {
    assert.equal(sleutel in spoor, false, `${sleutel} hoort niet in het spoor`);
    assert.equal(sleutel in inhoud, true);
  }
  assert.equal(JSON.stringify(spoor).includes("beleidsdekkingsgraad bedroeg"), false);
});

test("gemengde objecten worden per subsleutel gesplitst", () => {
  const { spoor, inhoud } = splitsRetrievalMeta(VOLLEDIGE_META);

  // scope: document_ids blijft (bronidentiteit), titels vertrekt (inhoud)
  const scopeSpoor = spoor.scope as Record<string, unknown>;
  const scopeInhoud = inhoud.scope as Record<string, unknown>;
  assert.deepEqual(scopeSpoor.document_ids, ["d1"]);
  assert.equal("titels" in scopeSpoor, false);
  assert.deepEqual(scopeInhoud, { titels: ["ABTN 2026"] });
  assert.equal(scopeSpoor.strategie, "targeted");

  // invoer: tellingen blijven, de historie-vingerafdruk vertrekt
  assert.deepEqual(spoor.invoer, { beurten: 3, tekens: 240 });
  assert.deepEqual(inhoud.invoer, { historie_hash: "abc123" });
});

test("besluit 0151 — module_scope: sleutels naar bron, status/telemetrie op basis", () => {
  const { spoor, inhoud } = splitsRetrievalMeta({
    methode: "geen",
    opgehaald: 0,
    geselecteerd: 0,
    chunks: [],
    ttft_ms: 812,
    module_scope: {
      soort: "proces",
      procedure_id: "p1",
      bron_ids: ["d1", "d2"],
      validatie: "ok",
      blok_tekens: 640,
    },
  } as unknown as Parameters<typeof splitsRetrievalMeta>[0]);
  const ms = spoor.module_scope as Record<string, unknown>;
  // Objectreferenties (identiteit) staan op bronniveau — niet op basis.
  assert.equal(ms.procedure_id, "p1");
  assert.deepEqual(ms.bron_ids, ["d1", "d2"]);
  // Soort/validatie/blok_tekens blijven basis (telemetrie/status).
  assert.equal(ms.soort, "proces");
  assert.equal(ms.validatie, "ok");
  assert.equal(ms.blok_tekens, 640);
  // ttft_ms is top-level telemetrie (basis), geen inhoud.
  assert.equal(spoor.ttft_ms, 812);
  // Geen module_scope-inhoudsleutels: er reist geen documenttekst mee.
  assert.equal("module_scope" in inhoud, false);
});

// De bronprojectie mag de objectreferenties tonen; de basisprojectie niet.
test("besluit 0151 — module_scope: procedure_id alleen zichtbaar op bronniveau", () => {
  const { spoor } = splitsRetrievalMeta({
    methode: "geen",
    opgehaald: 0,
    geselecteerd: 0,
    chunks: [],
    module_scope: { soort: "risico", risico_id: "r1", validatie: "ok" },
  } as unknown as Parameters<typeof splitsRetrievalMeta>[0]);
  const basis = projecteerSpoorMeta(spoor, false) as { module_scope?: Record<string, unknown> };
  const bron = projecteerSpoorMeta(spoor, true) as { module_scope?: Record<string, unknown> };
  assert.equal(basis.module_scope?.risico_id, undefined);
  assert.equal(basis.module_scope?.soort, "risico");
  assert.equal(bron.module_scope?.risico_id, "r1");
});

test("bronidentiteit blijft in het spoor (verwijderbaar is alleen inhoud)", () => {
  const { spoor } = splitsRetrievalMeta(VOLLEDIGE_META);
  for (const sleutel of ["chunks", "bronversie_audit", "besluitbronnen", "doorgrond"]) {
    assert.equal(sleutel in spoor, true, `${sleutel} hoort in het spoor`);
  }
});

// ── 4. Leesprojectie — spiegel van meta_basisniveau()/meta_bronniveau() ─────

test("basisniveau toont geen bron-ID's, herkomst of objectreferenties (AC-5)", () => {
  const { spoor } = splitsRetrievalMeta(VOLLEDIGE_META);
  const basis = projecteerSpoorMeta(spoor, false);

  for (const sleutel of [
    "chunks",
    "bronversie_audit",
    "besluitbronnen",
    "mogelijk_gerelateerd",
    "doorgrond",
    "herkomst",
  ]) {
    assert.equal(sleutel in basis, false, `${sleutel} mag niet op basisniveau`);
  }
  // ook de bron-subsleutels van gemengde objecten
  assert.equal("document_ids" in (basis.scope as Record<string, unknown>), false);
  assert.equal("procesinstantie_ids" in (basis.filters as Record<string, unknown>), false);
  assert.equal("gebruikte_bronnen" in (basis.web as Record<string, unknown>), false);
  assert.equal("instanties" in (basis.markeringen as Record<string, unknown>), false);

  // telemetrie blijft wél zichtbaar
  assert.equal(basis.methode, "hybride_rrf");
  assert.equal(basis.duur_model_ms, 5100);
  assert.equal((basis.web as Record<string, unknown>).aantal_gebruikt, 1);
});

test("bronniveau toont de bron-ID's wél", () => {
  const { spoor } = splitsRetrievalMeta(VOLLEDIGE_META);
  const bron = projecteerSpoorMeta(spoor, true);

  assert.equal(Array.isArray(bron.chunks), true);
  assert.equal(Array.isArray(bron.bronversie_audit), true);
  assert.equal(bron.herkomst, "agendapunt:a1");
  assert.deepEqual((bron.scope as Record<string, unknown>).document_ids, ["d1"]);
  assert.deepEqual((bron.filters as Record<string, unknown>).procesinstantie_ids, ["p1"]);
});

test("T3 — selectie is basis, selectie_kandidaten is bron", () => {
  // De tellingen/constraints (telemetrie) blijven zichtbaar op basisniveau; de
  // kandidatenlijst met bron-ID's alleen op bronniveau. Geen van beide is inhoud.
  const { spoor, inhoud } = splitsRetrievalMeta(VOLLEDIGE_META);
  assert.equal("selectie" in inhoud, false);
  assert.equal("selectie_kandidaten" in inhoud, false);
  assert.equal(niveauVan("selectie"), "basis");
  assert.equal(niveauVan("selectie_kandidaten"), "bron");

  const basis = projecteerSpoorMeta(spoor, false);
  assert.equal("selectie_kandidaten" in basis, false, "kandidaten (bron-ID's) niet op basisniveau");
  assert.deepEqual((basis.selectie as Record<string, unknown>).afgevallen_telling, {
    weging: 2,
    zwak_generiek: 1,
    quotum: 1,
    dedup: 1,
    budget: 3,
  });

  const bron = projecteerSpoorMeta(spoor, true);
  assert.equal(Array.isArray(bron.selectie_kandidaten), true);
});

test("een rij van vóór plateau A wordt bij het lezen alsnog ontdaan van inhoud", () => {
  // Historische rijen zijn nooit door splitsRetrievalMeta gegaan: zij dragen de
  // vraag en de fragmenten nog gewoon in retrieval_meta. De leesprojectie is
  // daarom allowlist-gebaseerd en niet strip-gebaseerd — zij bouwt de uitvoer op
  // uit bekende sleutels, zodat alles van gisteren vanzelf wegvalt.
  const historisch = {
    ...VOLLEDIGE_META,
    veld_dat_toen_bestond: "oude vrije tekst",
  };

  for (const metBron of [false, true]) {
    const uit = projecteerSpoorMeta(historisch, metBron);
    const json = JSON.stringify(uit);
    assert.equal("zoekvraag" in uit, false);
    assert.equal("sources" in uit, false);
    assert.equal("terugval" in uit, false);
    assert.equal("veld_dat_toen_bestond" in uit, false);
    assert.equal(json.includes("wat is de dekkingsgraad"), false);
    assert.equal(json.includes("beleidsdekkingsgraad bedroeg"), false);
    assert.equal(json.includes("ABTN 2026"), false);
    assert.equal(json.includes("abc123"), false);
  }
});

test("lege of onbruikbare invoer levert lege objecten op", () => {
  for (const invoer of [null, undefined, "tekst", 42, []]) {
    const { spoor, inhoud, onbekend } = splitsRetrievalMeta(invoer);
    assert.deepEqual(spoor, {});
    assert.deepEqual(inhoud, {});
    assert.deepEqual(onbekend, []);
    assert.deepEqual(projecteerSpoorMeta(invoer, true), {});
  }
});

// ── Plateau B / AC-17 — geen reflectiemarkering, nergens ────────────────────
test("AC-17: geen enkele allowlist bevat een reflectiesleutel", () => {
  // Besluit 0112: er bestaat geen tabel, kolom of rij die registreert dát een
  // interactie een reflectie was. Het auditspoor is — ook na 0119 — leesbaar
  // voor houders van een auditcapability; een reflectiemarkering maakt dan
  // zichtbaar dat een specifieke bestuurder op een specifiek moment twijfelde
  // over een specifiek onderwerp. Dat is precies het chilling effect dat de
  // functie moet wegnemen.
  //
  // Deze test is de vangrail bij uitbreiding. Wie ooit "even" een vlag toevoegt
  // om te kunnen meten hoe vaak er gereflecteerd wordt, loopt hier stuk. Dat er
  // géén bruikbaarheidsmeting is, is een bewust aanvaarde beperking (0112);
  // bijstellen gebeurt via de gebruikerstoets (0122), niet via telemetrie.
  const VERBODEN = [
    "reflectie",
    "reflectief",
    "reflection",
    "is_reflectie",
    "reflectie_actief",
    "reflectie_status",
    "reflectie_ingang",
    "reflectie_beurt",
    "bronset",
    "reflectie_bronset_versie",
  ];

  const alleSleutels: string[] = [
    ...META_BASIS,
    ...META_BRON,
    ...META_INHOUD,
    ...Object.keys(SUB_NIVEAUS),
    ...Object.values(SUB_NIVEAUS).flatMap((s) => [...(s.bron ?? []), ...(s.inhoud ?? [])]),
  ];

  for (const sleutel of alleSleutels) {
    for (const verboden of VERBODEN) {
      assert.equal(
        sleutel.toLowerCase().includes(verboden),
        false,
        `allowlist bevat "${sleutel}" — dat lijkt op een reflectiemarkering (besluit 0112)`
      );
    }
  }

  // En de fail-closed kant: zou zo'n sleutel tóch worden meegestuurd, dan valt
  // hij naar `inhoud` (verwijderbaar mét het gesprek) EN wordt hij als onbekend
  // gerapporteerd, zodat test 1 hierboven faalt.
  const metMarkering = splitsRetrievalMeta({
    methode: "geen",
    reflectie_actief: true,
    reflectie_bronset_versie: "abc123",
  });
  assert.deepEqual(metMarkering.spoor, { methode: "geen" });
  assert.deepEqual(metMarkering.onbekend.sort(), [
    "reflectie_actief",
    "reflectie_bronset_versie",
  ]);
  // Ook bij het LEZEN komt zo'n sleutel nooit door de projectie heen — ook niet
  // voor een auditor met bronniveau, en ook niet uit een historische rij.
  for (const metBron of [false, true]) {
    const uit = projecteerSpoorMeta(
      { methode: "geen", reflectie_actief: true, reflectie_bronset_versie: "abc123" },
      metBron
    );
    assert.deepEqual(uit, { methode: "geen" });
  }
});

test("AC-17: de reflectiebeurt zelf levert alleen bestaande, neutrale sleutels", () => {
  // De vorm die app/api/chat/route.ts tijdens een actieve reflectieflow in
  // retrieval_meta zet. Er staat niets in wat verraadt dát dit een reflectie was:
  // `methode: "geen"` produceert ook een antwoord uit algemene kennis.
  const reflectieMeta = {
    methode: "geen",
    opgehaald: 3,
    geselecteerd: 3,
    chunks: [{ id: "c1", document_id: "d1", rang: null }],
    toegepaste_fonds_filter: "f1",
    namespace_conventie: "bibliotheek",
    fondsdiscipline_gedropt: 0,
  };
  const { onbekend, inhoud } = splitsRetrievalMeta(reflectieMeta);
  assert.deepEqual(onbekend, [], "geen onbekende sleutels");
  assert.deepEqual(inhoud, {}, "een reflectiebeurt schrijft geen inhoudsleutels");
});

console.log(`\n${n} sanity-tests geslaagd (audit-meta).`);
