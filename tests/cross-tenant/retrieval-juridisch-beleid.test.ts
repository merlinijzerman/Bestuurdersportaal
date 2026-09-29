// ============================================================================
//  §15-matrix — Wetsgeschiedenis A-light R-3 (#492): juridisch bronbeleid in de
//  CENTRALE selectie. Hermetisch: geen netwerk, geen database.
//
//  Vier lagen:
//   (P) DE POORT — het beleid grijpt alleen in bij een aantoonbaar juridische
//       vraag (juridisch anker, zwak anker zonder fondscontext, of vertrouwen
//       zeker); anders exact het bestaande gedrag. Positief én negatief.
//   (S) PURE SELECTIE via `selecteerEnVerrijk` (core/lib/retrieval/selectie.ts):
//       wet + MvT, alleen MvT, wet + amendement, beide rollen, gemengde PW/Wvb,
//       historische peildatum, fondsdocumenten, onbekende intentie.
//   (N) NEGATIEVE CONTROLE — zonder de juridische weging worden de invarianten
//       aantoonbaar rood.
//   (C) CONTRACT — de R-2-intentie bereikt via `Spoor.grenzen` de centrale
//       orkestratie (`voerVolledigeRetrievalUit`), providerneutraal (stub-
//       adapter zonder Supabase), en de route geeft haar daar door.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/retrieval-juridisch-beleid.test.ts
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { selecteerEnVerrijk, type SelectieBron } from "../../core/lib/retrieval/selectie";
import {
  bepaalJuridischBeleid,
  juridischeAntwoordgrens,
} from "../../core/lib/retrieval/juridisch-beleid";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import {
  bepaalJuridischeVraagintentie,
  juridischeInlineMelding,
  type JuridischeVraagintentieResultaat,
} from "../../core/lib/vraagtype";
import { splitsRetrievalMeta, projecteerSpoorMeta } from "../../core/lib/audit-meta";
import type {
  AdapterUitkomst,
  Bronresultaat,
  CitaatOpdracht,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../../core/lib/retrieval/contract";
import type { RetrievalFilters, RetrievalMeta } from "../../core/lib/rag";
import {
  maakDocumentIdentiteit,
  maakPassageIdentiteit,
  maakVolledigeVersieHash,
} from "../../core/lib/retrieval/identiteit";

const hier = dirname(fileURLToPath(import.meta.url));
const root = join(hier, "..", "..");
const lees = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

// ── Vragen (de echte R-2-classifier, geen handgemaakte uitkomsten) ──────────
const NORMVRAAG = bepaalJuridischeVraagintentie("Wat bepaalt artikel 150d Pensioenwet?");
const BEDOELING = bepaalJuridischeVraagintentie("Waarom is artikel 150d Pensioenwet zo geformuleerd?");
const BEIDE = bepaalJuridischeVraagintentie(
  "Wat bepaalt artikel 150d Pensioenwet en wat was de bedoeling van de wetgever?"
);
const PEILDATUM = bepaalJuridischeVraagintentie("Wat gold op 1 januari 2022 volgens de Pensioenwet?");
const ONBEKEND = bepaalJuridischeVraagintentie("Wat is de dekkingsgraad van het fonds?");
// De R-2-heuristiek geeft peildatum/onzeker ook zonder enig juridisch anker.
const ANKERLOZE_PEILDATUM = bepaalJuridischeVraagintentie("Welke afspraak gold vorig jaar?");

// ── Fixtures ────────────────────────────────────────────────────────────────
// Elke passage krijgt een eigen woordenschat, zodat de Jaccard-dedup nooit
// toevallig ingrijpt: wat hier afvalt, valt af door beleid, quotum of budget.
let teller = 0;
function bron(
  soort: "wet" | "mvt" | "amendement" | "fonds" | "generiek",
  doc: string,
  over: Partial<SelectieBron> = {}
): SelectieBron {
  teller++;
  const juridisch =
    soort === "wet"
      ? { documenttype: "wetgeving", wetsgeschiedenisSubtype: null, normgewicht: "bindend" }
      : soort === "mvt"
        ? { documenttype: "wetsgeschiedenis", wetsgeschiedenisSubtype: "memorie_van_toelichting", normgewicht: "informatief" }
        : soort === "amendement"
          ? { documenttype: "wetsgeschiedenis", wetsgeschiedenisSubtype: "aangenomen_amendement", normgewicht: "informatief" }
          : soort === "generiek"
            ? { documenttype: "beleidsdocument", wetsgeschiedenisSubtype: null, normgewicht: "sector_guidance" }
            : { documenttype: null, wetsgeschiedenisSubtype: null, normgewicht: null };
  return {
    id: `${soort}-${doc}-${teller}`,
    document_id: doc,
    tekst: `uniek${teller}a uniek${teller}b uniek${teller}c uniek${teller}d`,
    rang: 1 / teller,
    titel: `${soort} ${doc}`,
    bibliotheek: soort === "fonds" ? "fonds" : "generiek",
    wettelijkRegime: null,
    ...juridisch,
    ...over,
  };
}

async function selecteer(
  kandidaten: SelectieBron[],
  intentie: JuridischeVraagintentieResultaat | undefined,
  opties: { max?: number; perDoc?: number; filters?: RetrievalFilters; regime?: boolean; constraints?: boolean } = {}
) {
  return selecteerEnVerrijk(kandidaten, "hybride_rrf", {
    filters: opties.filters,
    maxResults: opties.max ?? 3,
    maxPerDoc: opties.perDoc ?? 3,
    representatieConstraints: opties.constraints ?? false,
    regimeWeging: opties.regime ?? false,
    relevantieDrempel: false,
    ...(intentie ? { juridischeIntentie: intentie } : {}),
  });
}

const ids = (r: { chunks: SelectieBron[] }) => r.chunks.map((c) => c.id);
const redenVan = (r: { extra: Partial<RetrievalMeta> }, doc: string) =>
  r.extra.selectie_kandidaten?.find((k) => k.document_id === doc)?.reden;

/** De kerninvariant voor normatieve vragen, los van de selectie geformuleerd. */
function assertWetIsPrimaireNormbron(chunks: SelectieBron[]) {
  const eersteJuridisch = chunks.find(
    (c) => c.documenttype === "wetgeving" || c.documenttype === "wetsgeschiedenis"
  );
  assert.ok(eersteJuridisch, "er hoort een juridische bron geselecteerd te zijn");
  assert.equal(eersteJuridisch.documenttype, "wetgeving", "de eerste juridische bron is de actuele wet");
}

// ── (P) DE POORT ────────────────────────────────────────────────────────────

test("R3-P1 — poort OPEN: juridisch anker, zwak anker zonder fondscontext, vertrouwen zeker", () => {
  assert.deepEqual(bepaalJuridischBeleid(NORMVRAAG), { beleid: "geldend_recht", poort: "juridisch_anker" });
  assert.deepEqual(bepaalJuridischBeleid(PEILDATUM), { beleid: "historische_peildatum", poort: "juridisch_anker" });
  assert.deepEqual(
    bepaalJuridischBeleid(bepaalJuridischeVraagintentie("Wat regelt artikel 5?")),
    { beleid: "geldend_recht", poort: "zwak_anker_zonder_fondscontext" }
  );
  // Constructief: zonder enig anker, maar met vertrouwen zeker.
  assert.deepEqual(
    bepaalJuridischBeleid({ intentie: "geldend_recht", vertrouwen: "zeker", signalen: ["normvraag"] }),
    { beleid: "geldend_recht", poort: "vertrouwen_zeker" }
  );
});

test("R3-P2 — poort DICHT: ankerloze peildatum, zwak anker mét fondscontext, ankerloze normvraag, onbekend", () => {
  assert.equal(ANKERLOZE_PEILDATUM.intentie, "historische_peildatum", "fixture: R-2 geeft hier peildatum");
  assert.equal(ANKERLOZE_PEILDATUM.vertrouwen, "onzeker");
  assert.equal(bepaalJuridischBeleid(ANKERLOZE_PEILDATUM), null, "geen anker + onzeker ⇒ gedrag = onbekend");
  assert.equal(
    bepaalJuridischBeleid({ intentie: "geldend_recht", vertrouwen: "onzeker", signalen: ["zwak_anker", "fondscontext"] }),
    null,
    "artikel X van ons reglement is geen wet"
  );
  const ankerlozeNorm = bepaalJuridischeVraagintentie("Welke termijn geldt voor een waardeoverdracht?");
  assert.equal(ankerlozeNorm.intentie, "geldend_recht");
  assert.equal(bepaalJuridischBeleid(ankerlozeNorm), null);
  assert.equal(bepaalJuridischBeleid(ONBEKEND), null);
  assert.equal(bepaalJuridischBeleid(undefined), null);
  // Een onbekende waarde (bv. uit een oudere of gemanipuleerde bron) is nooit beleid.
  assert.equal(
    bepaalJuridischBeleid({ intentie: "iets_anders", vertrouwen: "zeker", signalen: ["juridisch_anker"] } as never),
    null
  );
});

test("R3-P3 — dichte poort gedraagt zich BYTE-IDENTIEK aan geen intentie, ook mét juridische kandidaten", async () => {
  const kandidaten = [bron("mvt", "mvt-1"), bron("fonds", "f-1"), bron("wet", "pw-1"), bron("mvt", "mvt-2")];
  const zonder = await selecteer(kandidaten, undefined, { max: 2 });
  const dicht = await selecteer(kandidaten, ANKERLOZE_PEILDATUM, { max: 2 });
  assert.equal(JSON.stringify(dicht), JSON.stringify(zonder));
  assert.equal(dicht.extra.selectie?.juridisch, undefined);
});

test("R3-P4 — historische peildatum: de poort opent UITSLUITEND op een (zwak) juridisch anker", async () => {
  const kandidaten = [bron("wet", "pw-1"), bron("mvt", "mvt-1"), bron("fonds", "f-1")];
  const zonder = await selecteer(kandidaten, undefined, { max: 3 });
  // Negatief: een datum of een vergadering maakt een vraag niet juridisch.
  for (const vraag of ["Welke afspraak gold op 1 januari 2022?", "Wat gold er in de vorige vergadering?"]) {
    const intentie = bepaalJuridischeVraagintentie(vraag);
    assert.equal(bepaalJuridischBeleid(intentie), null, vraag);
    assert.deepEqual(juridischeAntwoordgrens(intentie, []), [], `${vraag}: geen melding`);
    const r = await selecteer(kandidaten, intentie, { max: 3 });
    assert.equal(JSON.stringify(r), JSON.stringify(zonder), `${vraag}: selectie byte-identiek`);
  }
  const datumZonderAnker = bepaalJuridischeVraagintentie("Welke afspraak gold op 1 januari 2022?");
  assert.equal(datumZonderAnker.intentie, "historische_peildatum", "fixture: R-2 ziet een peildatum");
  assert.equal(datumZonderAnker.vertrouwen, "zeker", "fixture: zeker alleen is dus niet genoeg");
  // Constructief: zeker zonder anker opent de poort voor peildatum niet, voor geldend recht wel.
  assert.equal(bepaalJuridischBeleid({ intentie: "historische_peildatum", vertrouwen: "zeker", signalen: ["peildatum", "datum"] }), null);
  assert.notEqual(bepaalJuridischBeleid({ intentie: "geldend_recht", vertrouwen: "zeker", signalen: ["normvraag"] }), null);

  // Positief: met anker volgen melding én uitsluiting.
  for (const [vraag, poort] of [
    ["Wat gold op 1 januari 2022 volgens de Pensioenwet?", "juridisch_anker"],
    ["Wat bepaalde artikel 150d Pensioenwet in 2021?", "juridisch_anker"],
  ] as const) {
    const intentie = bepaalJuridischeVraagintentie(vraag);
    assert.deepEqual(bepaalJuridischBeleid(intentie), { beleid: "historische_peildatum", poort }, vraag);
    const r = await selecteer(kandidaten, intentie, { max: 3 });
    assert.ok(!r.chunks.some((c) => c.documenttype === "wetgeving"), `${vraag}: actuele wet uitgesloten`);
    assert.equal(redenVan(r, "pw-1"), "juridisch_uitgesloten");
    assert.deepEqual(juridischeAntwoordgrens(intentie, r.chunks), ["historische_wetsversie_niet_beschikbaar"], vraag);
  }
  // Zwak anker zonder fondscontext volstaat ook (constructief, geen sterk anker).
  assert.deepEqual(
    bepaalJuridischBeleid({ intentie: "historische_peildatum", vertrouwen: "zeker", signalen: ["zwak_anker", "peildatum", "datum"] }),
    { beleid: "historische_peildatum", poort: "zwak_anker_zonder_fondscontext" }
  );
  assert.equal(
    bepaalJuridischBeleid({ intentie: "historische_peildatum", vertrouwen: "zeker", signalen: ["zwak_anker", "peildatum", "datum", "fondscontext"] }),
    null
  );
});

// ── (S) PURE SELECTIE ───────────────────────────────────────────────────────

test("R3-S1 — wet + MvT, normatieve vraag: de wet gaat vóór, de MvT verdringt haar niet uit het budget", async () => {
  // De MvT scoort het hoogst; de wet staat pas vierde, buiten het budget van 2.
  const kandidaten = [bron("mvt", "mvt-1"), bron("mvt", "mvt-2"), bron("fonds", "f-1"), bron("wet", "pw-1")];
  const r = await selecteer(kandidaten, NORMVRAAG, { max: 2 });
  assertWetIsPrimaireNormbron(r.chunks);
  assert.deepEqual(r.chunks.map((c) => c.document_id), ["pw-1", "f-1"]);
  assert.equal(redenVan(r, "mvt-1"), "juridisch_gedemoveerd");
  assert.equal(redenVan(r, "mvt-2"), "juridisch_gedemoveerd");
  assert.deepEqual(r.extra.selectie?.juridisch, {
    beleid: "geldend_recht",
    poort: "juridisch_anker",
    kandidaten: { wetgeving: 1, wetsgeschiedenis: 2 },
    geselecteerd: { wetgeving: 1, wetsgeschiedenis: 0 },
    gedemoveerd: 2,
    uitgesloten: 0,
  });
  assert.equal(r.extra.selectie?.afgevallen_telling.juridisch_gedemoveerd, 2);
  assert.deepEqual(juridischeAntwoordgrens(NORMVRAAG, r.chunks), []);
});

test("R3-S2 — alleen MvT, normatieve vraag: geen verzonnen norm, wel de melding dat de actuele normbasis ontbreekt", async () => {
  const kandidaten = [bron("mvt", "mvt-1"), bron("fonds", "f-1")];
  const zonder = await selecteer(kandidaten, undefined, { max: 2 });
  const r = await selecteer(kandidaten, NORMVRAAG, { max: 2 });
  assert.deepEqual(ids(r), ids(zonder), "zonder actuele wet verandert de volgorde niet");
  assert.equal(r.extra.selectie?.juridisch?.gedemoveerd, 0);
  assert.deepEqual(juridischeAntwoordgrens(NORMVRAAG, r.chunks), ["geen_actuele_normbasis"]);
  const melding = juridischeInlineMelding("geen_actuele_normbasis");
  assert.equal(melding.type, "geen_actuele_normbasis");
  assert.match(melding.tekst, /geen geldende norm/);
});

test("R3-S3 — wet + aangenomen amendement: bij een normvraag nooit de norm; bij een bedoelingsvraag samen geselecteerd", async () => {
  const kandidaten = [bron("amendement", "am-1"), bron("fonds", "f-1"), bron("fonds", "f-2"), bron("wet", "pw-1")];
  const norm = await selecteer(kandidaten, NORMVRAAG, { max: 2 });
  assertWetIsPrimaireNormbron(norm.chunks);
  assert.ok(!norm.chunks.some((c) => c.document_id === "am-1"), "het amendement is geen zelfstandige norm");
  assert.equal(redenVan(norm, "am-1"), "juridisch_gedemoveerd");

  // Budget 2: zonder beleid zou het amendement met een fondsstuk de selectie
  // vormen; met beleid staan wet en amendement aaneen vooraan.
  const bedoeling = await selecteer(kandidaten, BEDOELING, { max: 2 });
  assert.deepEqual(bedoeling.chunks.map((c) => c.document_id), ["pw-1", "am-1"]);
  assert.equal(bedoeling.chunks[0].documenttype, "wetgeving", "de actuele wet blijft de normatieve basis");
  assert.deepEqual(juridischeAntwoordgrens(BEDOELING, bedoeling.chunks), []);
});

test("R3-S4 — wet + MvT, bedoelingsvraag: beide rollen, wet eerst; de rest behoudt zijn relevantievolgorde", async () => {
  const kandidaten = [
    bron("mvt", "mvt-1"),
    bron("mvt", "mvt-2"),
    bron("wet", "pw-1"),
    bron("wet", "pw-2"),
  ];
  const r = await selecteer(kandidaten, BEDOELING, { max: 3 });
  assert.deepEqual(r.chunks.map((c) => c.document_id), ["pw-1", "mvt-1", "mvt-2"]);
});

test("R3-S5 — geldend recht én wetsgeschiedenis: representatie voor beide rollen, ook als de wet domineert", async () => {
  const kandidaten = [
    bron("wet", "pw-1"),
    bron("wet", "pw-2"),
    bron("wet", "pw-3"),
    bron("mvt", "mvt-1"),
  ];
  const zonder = await selecteer(kandidaten, undefined, { max: 2 });
  assert.ok(!zonder.chunks.some((c) => c.documenttype === "wetsgeschiedenis"), "fixture: zonder beleid valt de MvT weg");
  const r = await selecteer(kandidaten, BEIDE, { max: 2 });
  assert.deepEqual(r.chunks.map((c) => c.document_id), ["pw-1", "mvt-1"]);
  assert.equal(r.extra.selectie?.juridisch?.beleid, "geldend_recht_en_wetsgeschiedenis");
});

test("R3-S6 — gemengde PW/Wvb: de regimeweging blijft dominant en wordt niet door het juridisch beleid omzeild", async () => {
  const filters: RetrievalFilters = { primairRegime: "pw" };
  // De Wvb-wetspassage scoort het hoogst; de fondsregime is PW.
  const kandidaten = [
    bron("wet", "wvb-1", { wettelijkRegime: "wvb" }),
    bron("mvt", "mvt-pw", { wettelijkRegime: "pw" }),
    bron("fonds", "f-1"),
    bron("wet", "pw-1", { wettelijkRegime: "pw" }),
  ];
  const r = await selecteer(kandidaten, NORMVRAAG, { max: 2, filters, regime: true });
  assert.deepEqual(r.chunks.map((c) => c.document_id), ["pw-1", "f-1"]);
  assert.ok(!r.chunks.some((c) => c.wettelijkRegime === "wvb"), "geen Wvb-norm bij een PW-fonds");
  // Bij een bedoelingsvraag komt de Wvb-wet ook niet via de 'kop' terug omhoog.
  const b = await selecteer(kandidaten, BEDOELING, { max: 3, filters, regime: true });
  assert.ok(!b.chunks.some((c) => c.wettelijkRegime === "wvb"));
  assert.equal(b.chunks[0].document_id, "pw-1");
});

test("R3-S7 — historische peildatum: de actuele wet wordt uitgesloten en de grens meldt het eerlijk", async () => {
  const kandidaten = [bron("wet", "pw-1"), bron("mvt", "mvt-1"), bron("fonds", "f-1")];
  const r = await selecteer(kandidaten, PEILDATUM, { max: 3 });
  assert.ok(!r.chunks.some((c) => c.documenttype === "wetgeving"), "actuele tekst is geen historisch antwoord");
  assert.equal(redenVan(r, "pw-1"), "juridisch_uitgesloten");
  assert.equal(r.extra.selectie?.juridisch?.uitgesloten, 1);
  assert.equal(r.extra.selectie?.afgevallen_telling.juridisch_uitgesloten, 1);
  assert.deepEqual(juridischeAntwoordgrens(PEILDATUM, r.chunks), ["historische_wetsversie_niet_beschikbaar"]);
  // Ook zonder enige juridische bron (bv. bronmodus algemeen) blijft de grens gelden.
  assert.deepEqual(juridischeAntwoordgrens(PEILDATUM, []), ["historische_wetsversie_niet_beschikbaar"]);
  assert.match(juridischeInlineMelding("historische_wetsversie_niet_beschikbaar").tekst, /niet beschikbaar/);
  // Een dichte poort meldt niets.
  assert.deepEqual(juridischeAntwoordgrens(ANKERLOZE_PEILDATUM, []), []);
});

test("R3-S8 — fondsdocumenten en niet-juridische generieke bronnen behouden hun volgorde en zakken hoogstens één plek", async () => {
  const kandidaten = [
    bron("fonds", "f-1"),
    bron("mvt", "mvt-1"),
    bron("generiek", "g-1"),
    bron("fonds", "f-2"),
    bron("wet", "pw-1"),
  ];
  const zonder = await selecteer(kandidaten, undefined, { max: 5 });
  const nietJuridisch = (r: { chunks: SelectieBron[] }) =>
    r.chunks.filter((c) => c.document_id.startsWith("f-") || c.document_id.startsWith("g-")).map((c) => c.id);
  // geldend recht / peildatum: een niet-juridische bron zakt NOOIT; bedoeling en
  // beide rollen: hoogstens één plek (de aaneengesloten kop wet + toelichting).
  for (const [intentie, maxZakken] of [[NORMVRAAG, 0], [PEILDATUM, 0], [BEDOELING, 1], [BEIDE, 1]] as const) {
    const r = await selecteer(kandidaten, intentie, { max: 5 });
    assert.deepEqual(nietJuridisch(r), nietJuridisch(zonder), `relatieve volgorde (${intentie.intentie})`);
    for (const doc of ["f-1", "g-1", "f-2"]) {
      const voor = zonder.chunks.findIndex((c) => c.document_id === doc);
      const na = r.chunks.findIndex((c) => c.document_id === doc);
      assert.ok(na >= 0 && na - voor <= maxZakken, `${doc} (${intentie.intentie}): ${voor} → ${na}`);
    }
  }
});

test("R3-S9 — onbekende intentie: exact het bestaande gedrag, ook met constraints en regimeweging", async () => {
  const kandidaten = [
    bron("mvt", "mvt-1", { wettelijkRegime: "pw" }),
    bron("fonds", "f-1"),
    bron("wet", "wvb-1", { wettelijkRegime: "wvb" }),
    bron("wet", "pw-1", { wettelijkRegime: "pw" }),
    bron("mvt", "mvt-2"),
  ];
  for (const opties of [
    { max: 2 },
    { max: 3, filters: { primairRegime: "pw" as const, bronsoortprofiel: "gecombineerd" as const }, regime: true, constraints: true },
  ]) {
    const zonder = await selecteer(kandidaten, undefined, opties);
    const onbekend = await selecteer(kandidaten, ONBEKEND, opties);
    assert.equal(JSON.stringify(onbekend), JSON.stringify(zonder), "byte-identiek");
    assert.equal("juridisch" in (onbekend.extra.selectie ?? {}), false);
    assert.deepEqual(
      Object.keys(onbekend.extra.selectie?.afgevallen_telling ?? {}),
      ["weging", "zwak_generiek", "quotum", "dedup", "budget"],
      "geen nieuwe telsleutels"
    );
  }
});

// ── (N) NEGATIEVE CONTROLE ──────────────────────────────────────────────────

test("R3-N1 — negatieve controle: zonder juridische weging worden de invarianten rood", async () => {
  // Dezelfde fixtures als S1/S3/S5/S7, maar met de weging GENEUTRALISEERD (geen
  // intentie naar de selectie). Elk van deze asserts moet dan falen; bleef één
  // groen, dan bewees de bijbehorende test niets over het beleid.
  const s1 = [bron("mvt", "mvt-1"), bron("mvt", "mvt-2"), bron("fonds", "f-1"), bron("wet", "pw-1")];
  const neutraal1 = await selecteer(s1, undefined, { max: 2 });
  assert.throws(() => assertWetIsPrimaireNormbron(neutraal1.chunks), "S1 hoort rood te worden");

  const s3 = [bron("amendement", "am-1"), bron("fonds", "f-1"), bron("fonds", "f-2"), bron("wet", "pw-1")];
  const neutraal3 = await selecteer(s3, undefined, { max: 2 });
  assert.ok(neutraal3.chunks.some((c) => c.document_id === "am-1"), "S3 hoort rood te worden: amendement als enige juridische bron");

  const s5 = [bron("wet", "pw-1"), bron("wet", "pw-2"), bron("wet", "pw-3"), bron("mvt", "mvt-1")];
  const neutraal5 = await selecteer(s5, undefined, { max: 2 });
  assert.ok(!neutraal5.chunks.some((c) => c.documenttype === "wetsgeschiedenis"), "S5 hoort rood te worden");

  const s7 = [bron("wet", "pw-1"), bron("mvt", "mvt-1"), bron("fonds", "f-1")];
  const neutraal7 = await selecteer(s7, undefined, { max: 3 });
  assert.ok(neutraal7.chunks.some((c) => c.documenttype === "wetgeving"), "S7 hoort rood te worden");

  // En met een GEFORCEERD dichte poort (intentie zonder anker, onzeker) evenzo:
  // de poort is dus werkelijk de schakelaar.
  const dicht = await selecteer(s1, { ...NORMVRAAG, vertrouwen: "onzeker", signalen: ["normvraag"] }, { max: 2 });
  assert.throws(() => assertWetIsPrimaireNormbron(dicht.chunks));
});

// ── (C) CONTRACT: de intentie bereikt de centrale orkestratie ───────────────

const FONDS = "11111111-1111-4111-8111-111111111111";
const CTX: RetrievalContext = {
  fondsId: FONDS,
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["sharepoint"] },
  correlationId: "corr-r3",
  verzoekStartOp: new Date().toISOString(),
};
const CITAAT: CitaatOpdracht = {
  primaireDocumentIds: new Set<string>(),
  peildatum: "2026-09-29",
  hoofddocumentLabel: " [hoofddocument]",
  sentinel: "SENT",
};
const QUERY: RetrievalQuery = {
  naam: "primair",
  origineleVraag: "Wat bepaalt artikel 150d Pensioenwet?",
  zoekvraag: "artikel 150d",
  strategie: "gericht",
  maxResultaten: 1,
  maxKandidaten: 10,
  maxContextTekens: 100_000,
};
const GRENZEN = { maxPerDoc: 3, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false };

/** Providerneutraal: een niet-Supabase-bron met alleen `weergave.documenttype`. */
function extern(doc: string, n: number, documenttype: string, subtype: string | null): Bronresultaat {
  const documentId = maakDocumentIdentiteit("extern", doc);
  const passageId = maakPassageIdentiteit(documentId, `passage:${n}`);
  return {
    ref: passageId,
    bronsoort: "sharepoint",
    titel: `Stuk ${doc}`,
    documentIdentiteit: { id: documentId, bibliotheek: "fonds", bron: "SharePoint", fondsId: FONDS },
    passageIdentiteit: { id: passageId },
    versie: { soort: "etag", waarde: maakVolledigeVersieHash(doc, `etag-${n}`, "a".repeat(64)), gecontroleerdOp: "2026-09-10T10:00:00.000Z" },
    bronregistratieRef: "bron-extern",
    toegangscontrole: {
      toegestaan: true,
      resultaatRef: passageId,
      bronregistratieRef: "bron-extern",
      gebruikerId: "22222222-2222-4222-8222-222222222222",
      correlationId: CTX.correlationId,
      gecontroleerdOp: new Date().toISOString(),
      basis: "delegated_user",
      bronconfiguratieVersie: 3,
    },
    locator: { mappad: "/Gedeelde documenten" },
    passage: `woord${n}a woord${n}b woord${n}c`,
    status: { documentstatus: "van_kracht", actueel: true },
    rang: { positie: n, score: 1 / n },
    curatie: { normgewicht: null, wettelijkRegime: null },
    weergave: { documenttype, wetsgeschiedenisSubtype: subtype },
  };
}

function stub(kandidaten: Bronresultaat[]): RetrievalAdapter {
  const perRef = new Map(kandidaten.map((b) => [b.ref, b]));
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"],
      strategieen: ["gericht"],
      ondersteundeFilters: [],
      versiebewijs: true,
      versiebeleid: { sterk: ["etag"], gedegradeerd: [] },
      permissionProof: true,
      preview: true,
      cancellation: true,
      timeout: true,
    }),
    async verifieerBronregistratie(_ctx, refs) {
      return new Map(refs.map((r) => [r, { verbonden: true, versie: 3 }]));
    },
    async verifieerVersies(_ctx, refs) {
      return new Map(refs.map((ref) => {
        const b = perRef.get(ref);
        return [ref, {
          beschikbaar: !!b,
          documentIdentiteit: b?.documentIdentiteit.id ?? null,
          passageIdentiteit: b?.passageIdentiteit.id ?? null,
          versie: { soort: b?.versie.soort ?? "onbekend", waarde: b?.versie.waarde ?? null },
        }];
      }));
    },
    async zoek(): Promise<AdapterUitkomst> {
      return { kandidaten, methode: "hybride_rrf", provider: "microsoft", latencyMs: 1, opgehaald: kandidaten.length };
    },
  };
}

test("R3-C1 — de R-2-intentie bereikt via Spoor.grenzen de centrale orkestratie (providerneutraal)", async () => {
  const kandidaten = [extern("mvt", 1, "wetsgeschiedenis", "memorie_van_toelichting"), extern("wet", 2, "wetgeving", null)];
  const adapter = stub(kandidaten);
  const met = await voerVolledigeRetrievalUit(
    CTX,
    { adapter, sporen: [{ query: QUERY, grenzen: { ...GRENZEN, juridischeIntentie: NORMVRAAG } }] },
    CITAAT
  );
  assert.equal(met.geselecteerd.length, 1);
  assert.equal(met.geselecteerd[0].weergave?.documenttype, "wetgeving", "de wet verdringt de MvT");
  assert.equal(met.meta.selectie?.juridisch?.beleid, "geldend_recht");
  assert.equal(met.meta.selectie?.juridisch?.poort, "juridisch_anker");

  const zonder = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: stub(kandidaten), sporen: [{ query: QUERY, grenzen: GRENZEN }] },
    CITAAT
  );
  assert.equal(zonder.geselecteerd[0].weergave?.documenttype, "wetsgeschiedenis", "zonder intentie: bestaand gedrag");
  assert.equal(zonder.meta.selectie?.juridisch, undefined);
});

test("R3-C2 — de chatroute geeft de ene intentie door aan de bibliotheeksporen, niet aan een gekozen document", () => {
  const route = lees("app", "api", "chat", "route.ts");
  assert.ok(route.includes("const grenzenBibliotheek = { ...grenzenPrimair, juridischeIntentie };"));
  assert.match(
    route,
    /maakQuery\("primair", undefined, CHUNK_BUDGET, retrievalFilters\),\s*grenzen: grenzenBibliotheek,/,
    "het ongescopete primaire spoor draagt het beleid"
  );
  assert.match(
    route,
    /maakQuery\("aanvullend"[\s\S]{0,400}?juridischeIntentie,\s*\},\s*primair: false,/,
    "het aanvullende bibliotheekspoor draagt het beleid"
  );
  // Een bewust gekozen document of SharePoint-bron blijft ongemoeid.
  assert.match(route, /maakQuery\("primair_portaal", scopeDocumentIds, CHUNK_BUDGET, undefined\),\s*grenzen: grenzenPrimair,/);
  assert.ok(!/const grenzenPrimair = \{[^}]*juridisch/.test(route), "grenzenPrimair kent het beleid niet");
  // De antwoordgrens komt uit dezelfde variabele, via de bestaande inline-meldingen.
  assert.ok(route.includes("juridischeAntwoordgrens(\n      juridischeIntentie,"));
  assert.equal(route.split("...juridischeMeldingen,").length - 1, 2, "pre-stream én finale meldingen");
});

test("R3-C3 — de diagnostiek is gesloten, inhoudsvrij en migratievrij op basisniveau leesbaar", async () => {
  const r = await selecteer([bron("mvt", "mvt-1"), bron("wet", "pw-1")], NORMVRAAG, { max: 1 });
  const juridisch = r.extra.selectie?.juridisch;
  assert.ok(juridisch);
  const { spoor, onbekend } = splitsRetrievalMeta({ methode: "hybride_rrf", opgehaald: 2, geselecteerd: 1, selectie: r.extra.selectie });
  assert.deepEqual(onbekend, []);
  for (const metBron of [false, true]) {
    const gelezen = projecteerSpoorMeta(spoor, metBron) as { selectie?: { juridisch?: unknown } };
    assert.deepEqual(gelezen.selectie?.juridisch, juridisch);
  }
  // Gesloten waarden, geen vraag- of documenttekst.
  const json = JSON.stringify(juridisch);
  for (const woord of ["150d", "pensioenwet", "uniek", "mvt-1", "pw-1"]) assert.ok(!json.toLowerCase().includes(woord), woord);
  // SQL: `selectie` staat op basisniveau en wordt als geheel doorgelaten.
  const dir = join(root, "supabase", "migrations");
  const laatste = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /create or replace function public\.meta_projectie\(/.test(readFileSync(join(dir, f), "utf8")))
    .pop();
  const sql = readFileSync(join(dir, laatste!), "utf8");
  const basis = sql.match(/c_basis constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(basis && /'selectie'/.test(basis[1]));
  assert.ok(!/'\{selectie\}'/.test(sql), "binnen `selectie` wordt niets weggefilterd");
});
