// ============================================================================
//  §15-matrix — #500: exacte artikelpassage in juridische retrieval.
//  Hermetisch: geen netwerk, geen database (de Supabase-client is een nep-
//  client die de aanroepen vastlegt).
//
//  Het faalpatroon uit de productiepilot (29-09-2026): de MvT Wtp is volledig
//  geïndexeerd (2.738 chunks) en de passage "Artikelsgewijze toelichting —
//  Artikel 150d" (p. 395) bestaat, maar kwam nooit in de kandidatenset van de
//  zoek-RPC: de strikte FTS-arm eist 'bedoel' & 'wetgever' in dezelfde chunk,
//  de vectorarm is ongevoelig voor een artikelnummer. Geselecteerd werd een
//  passage over artikel 16 (p. 365).
//
//  Lagen:
//   (H) HERKENNING  — artikelnummers en wetsnaam, strikt (150 ≠ 150d ≠ 1500).
//   (P) POORT       — alleen achter de R-3-poort mét (zwak) juridisch anker.
//   (M) MATCH       — label/kopregel, met de buurartikelen 150, 150c, 150e,
//                     1500 en 15 als negatieven.
//   (S) SELECTIE    — boost + R-3: bedoeling, normvraag, gecombineerd, regime,
//                     fondsdocumenten, byte-identiteit zonder focus.
//   (A) ADAPTER     — het gerichte artikelspoor: toelating uitsluitend via
//                     dezelfde RPC en filters, app-guard, kandidatenpool.
//   (E) EIND-TOT-EIND — orkestratie + Supabase-adapter met de nagebootste
//                     pilotsituatie (exacte passage buiten de kandidatenset).
//   (N) NEGATIEVE CONTROLE — boost of spoor uit ⇒ de acceptatie wordt rood.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/retrieval-artikelpassage.test.ts
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  artikelFrasequery,
  artikelmatch,
  bepaalArtikelfocus,
  boostArtikelpassages,
  herkenArtikelnummers,
  herkenWet,
  wetVerenigbaar,
  type Artikelfocus,
} from "../../core/lib/retrieval/artikelverwijzing";
import { selecteerEnVerrijk, type SelectieBron } from "../../core/lib/retrieval/selectie";
import { juridischeAntwoordgrens } from "../../core/lib/retrieval/juridisch-beleid";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import { maakSupabaseAdapter, type Adaptervlaggen } from "../../core/lib/retrieval/supabase-adapter";
import {
  artikelOpzoekfilter,
  vulAanMetArtikelkandidaten,
  type DocumentChunk,
  type RetrievalFilters,
  type RetrievalMeta,
} from "../../core/lib/rag";
import {
  bepaalJuridischeVraagintentie,
  type JuridischeVraagintentieResultaat,
} from "../../core/lib/vraagtype";
import { maakVolledigeVersieHash } from "../../core/lib/retrieval/identiteit";
import type {
  AdapterUitkomst,
  CitaatOpdracht,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../../core/lib/retrieval/contract";

// ── Vragen (de echte R-2-classifier) ────────────────────────────────────────
const VRAAG_BEDOELING = "Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?";
const VRAAG_BEIDE =
  "Wat bepaalt artikel 150d Pensioenwet over het transitieplan en wat was volgens de memorie van toelichting de bedoeling daarvan?";
const VRAAG_NORM = "Wat bepaalt artikel 150d Pensioenwet?";
const BEDOELING = bepaalJuridischeVraagintentie(VRAAG_BEDOELING);
const BEIDE = bepaalJuridischeVraagintentie(VRAAG_BEIDE);
const NORM = bepaalJuridischeVraagintentie(VRAAG_NORM);
const ONBEKEND = bepaalJuridischeVraagintentie("Wat is de dekkingsgraad van het fonds?");
const focusVan = (vraag: string, intentie = bepaalJuridischeVraagintentie(vraag)) => {
  const f = bepaalArtikelfocus([vraag], intentie);
  assert.ok(f, `verwacht een artikelfocus voor: ${vraag}`);
  return f;
};

// ── (H) HERKENNING ──────────────────────────────────────────────────────────

test("#500-H1 — artikelnummers: varianten, lijsten en strikte grenzen", () => {
  const gevallen: [string, string[]][] = [
    ["artikel 150d Pensioenwet", ["150d"]],
    ["Art. 150d Pw", ["150d"]],
    ["art 150d", ["150d"]],
    ["Wat regelen de artikelen 150d en 150e?", ["150d", "150e"]],
    ["artikel 150d, 150e of 150f", ["150d", "150e", "150f"]],
    ["artikel 150d, eerste lid", ["150d"]],
    ["artikel 150 lid 2", ["150"]],
    ["artikel 1500", ["1500"]],
    ["artikel 15 en artikel 150d", ["15", "150d"]],
    ["ARTIKEL 150D", ["150d"]],
    ["Artikelsgewijze toelichting — Artikel 150d", ["150d"]],
    ["Artikelsgewijze toelichting", []],
    ["Artikel I, onderdeel B", []],
    ["transitieplan 150d", []],
    ["artikel150d", []],
    ["artikel 15000", []],
    ["artikel 150dab", []],
  ];
  for (const [tekst, verwacht] of gevallen) assert.deepEqual(herkenArtikelnummers(tekst), verwacht, tekst);
});

test("#500-H2 — wetsnaam: Pensioenwet → pw, Wvb → wvb, beide of geen → geen beperking", () => {
  assert.equal(herkenWet("artikel 150d Pensioenwet"), "pw");
  assert.equal(herkenWet("artikel 145c Wvb"), "wvb");
  assert.equal(herkenWet("de Wet verplichte beroepspensioenregeling"), "wvb");
  assert.equal(herkenWet("artikel 150d Pensioenwet en artikel 145c Wvb"), null);
  assert.equal(herkenWet("artikel 150d"), null);
  assert.equal(artikelFrasequery({ artikelen: ["150d", "150e"] }), '"artikel 150d" OR "art 150d" OR "artikel 150e" OR "art 150e"');
});

// ── (P) POORT ───────────────────────────────────────────────────────────────

test("#500-P1 — poort OPEN: juridisch anker of zwak anker zonder fondscontext, mét artikel", () => {
  assert.deepEqual(focusVan(VRAAG_BEDOELING), { artikelen: ["150d"], wet: "pw" });
  assert.deepEqual(focusVan(VRAAG_BEIDE), { artikelen: ["150d"], wet: "pw" });
  assert.deepEqual(focusVan(VRAAG_NORM), { artikelen: ["150d"], wet: "pw" });
  assert.deepEqual(focusVan("Wat was de bedoeling van artikel 150d?"), { artikelen: ["150d"], wet: null });
  assert.deepEqual(focusVan("Wat regelen de artikelen 150d en 150e Pensioenwet?"), { artikelen: ["150d", "150e"], wet: "pw" });
  // Opgeloste vervolgvraag: het artikel staat in de zoekvraag, niet in de ruwe vraag.
  assert.deepEqual(bepaalArtikelfocus(["Wat was daarvan de bedoeling?", VRAAG_BEDOELING], BEDOELING), {
    artikelen: ["150d"],
    wet: "pw",
  });
});

test("#500-P2 — poort DICHT: fondscontext, onbekend, alleen vertrouwen zeker, geen artikel", () => {
  const reglement = "Wat staat in artikel 5 van ons reglement?";
  assert.equal(bepaalArtikelfocus([reglement], bepaalJuridischeVraagintentie(reglement)), null);
  assert.equal(bepaalArtikelfocus(["artikel 150d"], ONBEKEND), null, "onbekende intentie");
  assert.equal(bepaalArtikelfocus(["artikel 150d"], null), null, "geen intentie");
  assert.equal(
    bepaalArtikelfocus(["artikel 150d"], { intentie: "geldend_recht", vertrouwen: "zeker", signalen: ["normvraag"] }),
    null,
    "vertrouwen zeker zonder anker is geen artikelpoort"
  );
  const zonderArtikel = "Wat was de bedoeling van de wetgever bij de Pensioenwet?";
  assert.equal(bepaalArtikelfocus([zonderArtikel], bepaalJuridischeVraagintentie(zonderArtikel)), null);
  const fonds = "Wat was de bedoeling van artikel 5 in ons pensioenreglement?";
  assert.equal(bepaalArtikelfocus([fonds], bepaalJuridischeVraagintentie(fonds)), null);
});

// ── (M) MATCH ───────────────────────────────────────────────────────────────

const P395 = {
  structuurLabel: "Artikelsgewijze toelichting — Artikel 150d",
  tekst:
    "Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\nHet transitieplan legt de keuzes van sociale partners vast.",
};

test("#500-M1 — artikel 150d matcht de p.395-passage; de buurartikelen niet", () => {
  assert.equal(artikelmatch({ artikelen: ["150d"] }, P395), "kop");
  assert.equal(artikelmatch({ artikelen: ["150d"] }, { structuurLabel: P395.structuurLabel, tekst: "vervolgtekst" }), "label");
  assert.equal(artikelmatch({ artikelen: ["150d"] }, { structuurLabel: "Artikelsgewijze toelichting — Artikel 150d, onderdeel A" }), "label");
  // De kopregel noemt ook artikel 145c Wvb.
  assert.equal(artikelmatch({ artikelen: ["145c"] }, P395), "kop");
  for (const buur of ["150", "150c", "150e", "1500", "15"]) {
    assert.equal(artikelmatch({ artikelen: [buur] }, P395), null, `artikel ${buur} mag 150d niet raken`);
  }
  for (const buur of ["150", "150c", "150e", "1500", "15"]) {
    const passage = { structuurLabel: `Artikelsgewijze toelichting — Artikel ${buur}`, tekst: `Artikel ${buur} Pensioenwet\nuniek` };
    assert.equal(artikelmatch({ artikelen: ["150d"] }, passage), null, `artikel 150d mag ${buur} niet raken`);
    assert.equal(artikelmatch({ artikelen: [buur] }, passage), "kop", `${buur} matcht zichzelf`);
  }
});

test("#500-M2 — een verwijzing midden in de tekst of in een lange eerste alinea is geen exacte match", () => {
  const f = { artikelen: ["150d"] };
  assert.equal(artikelmatch(f, { tekst: "Zoals artikel 150d Pensioenwet bepaalt, bevat het transitieplan ..." }), null);
  assert.equal(artikelmatch(f, { structuurLabel: "§4.2", tekst: "Het transitieplan (artikel 150d) ..." }), null);
  const lang = "Artikel 150c regelt het invaarbesluit; " + "toelichting ".repeat(12) + "en verwijst naar artikel 150d.";
  assert.equal(artikelmatch(f, { tekst: lang }), null, "alleen de openingsverwijzing telt bij een lange eerste regel");
  assert.equal(artikelmatch({ artikelen: ["150c"] }, { tekst: lang }), "kop");
  assert.equal(artikelmatch(f, { structuurLabel: null, tekst: null }), null);
});

test("#500-M3 — wetsnaam: een tegengesteld regime of een andere wet wordt niet geboost", () => {
  const pw: Pick<Artikelfocus, "wet"> = { wet: "pw" };
  assert.equal(wetVerenigbaar(pw, { documenttype: "wetgeving", wettelijkRegime: "pw", titel: "Pensioenwet" }), true);
  assert.equal(wetVerenigbaar(pw, { documenttype: "wetgeving", wettelijkRegime: "wvb", titel: "Wvb" }), false);
  assert.equal(wetVerenigbaar(pw, { documenttype: "wetgeving", wettelijkRegime: null, titel: "Pensioenwet (BWBR0020809)" }), true);
  assert.equal(wetVerenigbaar(pw, { documenttype: "wetgeving", wettelijkRegime: null, titel: "Wet op het financieel toezicht" }), false);
  assert.equal(wetVerenigbaar(pw, { documenttype: "wetsgeschiedenis", wettelijkRegime: "beide", titel: "Kamerstukken II 2021/22, 36 067, nr. 3" }), true);
  assert.equal(wetVerenigbaar({ wet: null }, { documenttype: "wetgeving", wettelijkRegime: "wvb", titel: "Wvb" }), true);
});

// ── (S) SELECTIE ────────────────────────────────────────────────────────────

let teller = 0;
function bron(
  soort: "wet" | "mvt" | "fonds",
  doc: string,
  over: Partial<SelectieBron> = {}
): SelectieBron {
  teller++;
  const juridisch =
    soort === "wet"
      ? { documenttype: "wetgeving", wetsgeschiedenisSubtype: null, normgewicht: "bindend", wettelijkRegime: "pw", titel: "Pensioenwet" }
      : soort === "mvt"
        ? {
            documenttype: "wetsgeschiedenis",
            wetsgeschiedenisSubtype: "memorie_van_toelichting",
            normgewicht: "informatief",
            wettelijkRegime: "beide",
            titel: "Kamerstukken II 2021/22, 36 067, nr. 3",
          }
        : { documenttype: null, wetsgeschiedenisSubtype: null, normgewicht: null, wettelijkRegime: null, titel: "Pensioenreglement" };
  return {
    id: `${soort}-${doc}-${teller}`,
    document_id: doc,
    tekst: `uniek${teller}a uniek${teller}b uniek${teller}c uniek${teller}d`,
    rang: 1 / teller,
    bibliotheek: soort === "fonds" ? "fonds" : "generiek",
    ...juridisch,
    ...over,
  };
}
const exacteMvt = (over: Partial<SelectieBron> = {}) =>
  bron("mvt", "mvt-wtp", { structuurLabel: P395.structuurLabel, tekst: `${P395.tekst} uniek-p395`, ...over });
const exacteWet = (over: Partial<SelectieBron> = {}) =>
  bron("wet", "pw", { structuurLabel: "Artikel 150d", tekst: "Artikel 150d\n1. Het transitieplan bevat ten minste uniek-pw150d", ...over });

/** Het faalpatroon: veel concurrerende MvT-passages, de exacte als laatste. */
function pilotKandidaten(extra: SelectieBron[] = []): SelectieBron[] {
  const concurrent = Array.from({ length: 24 }, (_, i) =>
    bron("mvt", "mvt-wtp", { structuurLabel: i === 0 ? "Artikelsgewijze toelichting — Artikel 16" : `§${i}` })
  );
  const fonds = [bron("fonds", "f-1"), bron("fonds", "f-2"), bron("fonds", "f-3")];
  return [concurrent[0], fonds[0], ...concurrent.slice(1), fonds[1], fonds[2], ...extra];
}

async function selecteer(
  kandidaten: SelectieBron[],
  intentie: JuridischeVraagintentieResultaat | undefined,
  focus: Artikelfocus | null,
  opties: { max?: number; perDoc?: number; filters?: RetrievalFilters; regime?: boolean } = {}
) {
  return selecteerEnVerrijk(kandidaten, "hybride_rrf", {
    filters: opties.filters,
    maxResults: opties.max ?? 10,
    maxPerDoc: opties.perDoc ?? 5,
    representatieConstraints: false,
    regimeWeging: opties.regime ?? false,
    relevantieDrempel: false,
    ...(intentie ? { juridischeIntentie: intentie } : {}),
    ...(focus ? { artikelfocus: focus } : {}),
  });
}
const eersteJuridisch = (chunks: SelectieBron[]) => chunks.filter((c) => c.documenttype);

test("#500-S1 — bedoelingsvraag: de exacte MvT-passage landt in de kop, boven semantisch hoger scorende MvT-passages", async () => {
  const exact = exacteMvt({ rang: 0.0001 });
  const r = await selecteer(pilotKandidaten([exact]), BEDOELING, focusVan(VRAAG_BEDOELING));
  assert.ok(r.chunks.includes(exact), "de p.395-achtige passage is geselecteerd");
  assert.equal(eersteJuridisch(r.chunks)[0], exact, "zonder wetspassage is zij de eerste juridische bron");
  assert.equal(r.chunks.filter((c) => c.document_id === "mvt-wtp").length, 5, "maxPerDoc blijft gelden");
  assert.deepEqual(r.extra.selectie?.juridisch?.artikel, {
    verwijzingen: 1,
    wet_genoemd: true,
    exact: 1,
    geboost: 1,
    geboost_geselecteerd: 1,
    via_artikelspoor: 0,
  });
});

test("#500-S2 — normvraag: de wet (exact artikel) gaat vóór; wetsgeschiedenis wordt nooit primaire normbron", async () => {
  const wetArt16 = bron("wet", "pw", { structuurLabel: "Artikel 16", tekst: "Artikel 16\nuniek-pw16" });
  const wet150d = exacteWet({ rang: 0.0001 });
  const mvt = exacteMvt();
  const kandidaten = [mvt, wetArt16, ...pilotKandidaten([wet150d])];
  const r = await selecteer(kandidaten, NORM, focusVan(VRAAG_NORM));
  const jur = eersteJuridisch(r.chunks);
  assert.equal(jur[0], wet150d, "het exacte wetsartikel staat vooraan");
  assert.ok(jur.indexOf(wetArt16) < (jur.indexOf(mvt) === -1 ? Infinity : jur.indexOf(mvt)), "elke wetspassage vóór de toelichting");
  assert.deepEqual(juridischeAntwoordgrens(NORM, r.chunks), [], "met actuele wet geen normbasismelding");

  // Alleen de MvT-passage: geen verzonnen norm, wél de normbasismelding.
  const alleenMvt = await selecteer(pilotKandidaten([exacteMvt()]), NORM, focusVan(VRAAG_NORM));
  assert.ok(!alleenMvt.chunks.some((c) => c.documenttype === "wetgeving"));
  assert.deepEqual(juridischeAntwoordgrens(NORM, alleenMvt.chunks), ["geen_actuele_normbasis"]);
});

test("#500-S3 — gecombineerde vraag: wet en MvT naast elkaar in de kop, wet eerst", async () => {
  const wet150d = exacteWet({ rang: 0.0002 });
  const mvt = exacteMvt({ rang: 0.0001 });
  const wetArt16 = bron("wet", "pw", { structuurLabel: "Artikel 16", tekst: "Artikel 16\nuniek-pw16b" });
  const r = await selecteer([wetArt16, ...pilotKandidaten([wet150d, mvt])], BEIDE, focusVan(VRAAG_BEIDE));
  const jur = eersteJuridisch(r.chunks);
  assert.deepEqual(jur.slice(0, 2), [wet150d, mvt], "exacte wet + exacte toelichting aaneen, wet eerst");
  assert.deepEqual(juridischeAntwoordgrens(BEIDE, r.chunks), []);
});

test("#500-S4 — regime en andere wet: een gedemoveerd of onverenigbaar artikel wordt niet geboost", async () => {
  const wvb150d = exacteWet({ wettelijkRegime: "wvb", titel: "Wet verplichte beroepspensioenregeling" });
  const wft150d = exacteWet({ wettelijkRegime: null, titel: "Wet op het financieel toezicht" });
  const kandidaten = pilotKandidaten([wvb150d, wft150d]);
  const r = await selecteer(kandidaten, NORM, focusVan(VRAAG_NORM), {
    regime: true,
    filters: { primairRegime: "pw" } as RetrievalFilters,
  });
  assert.equal(r.extra.selectie?.juridisch?.artikel?.geboost, 0);
  assert.ok(!r.chunks.includes(wvb150d) || r.chunks.indexOf(wvb150d) === r.chunks.length - 1, "Wvb blijft onderaan");
  // Zonder regimeweging en zonder wetsnaam wordt het Wvb-artikel wél exact herkend.
  const zonderWet = await selecteer(pilotKandidaten([wvb150d]), NORM, { artikelen: ["150d"], wet: null });
  assert.equal(zonderWet.extra.selectie?.juridisch?.artikel?.geboost, 1);
});

test("#500-S5 — fondsdocumenten met 'Artikel 5' worden nooit geboost en behouden hun volgorde", async () => {
  const fondsArt5 = bron("fonds", "reglement", { structuurLabel: "Artikel 5", tekst: "Artikel 5 Toeslagverlening uniek-f5" });
  const kandidaten = [bron("fonds", "f-a"), bron("mvt", "m-a"), bron("fonds", "f-b"), bron("wet", "w-a"), fondsArt5];
  const vraag = "Wat regelt artikel 5 Pensioenwet?";
  const intentie = bepaalJuridischeVraagintentie(vraag);
  const met = await selecteer(kandidaten, intentie, focusVan(vraag), { max: 5 });
  const zonder = await selecteer(kandidaten, intentie, null, { max: 5 });
  assert.deepEqual(met.chunks, zonder.chunks, "de fondspassage wordt niet herschikt");
  assert.equal(met.extra.selectie?.juridisch?.artikel?.exact, 0);

  // En "artikel 5 van ons reglement" opent de poort niet eens.
  const reglement = "Wat staat in artikel 5 van ons reglement?";
  assert.equal(bepaalArtikelfocus([reglement], bepaalJuridischeVraagintentie(reglement)), null);
});

test("#500-S6 — geen focus (onbekend, dichte poort, geen artikel): selectie en diagnostiek byte-identiek", async () => {
  const kandidaten = pilotKandidaten([exacteMvt()]);
  const zonderIntentie = await selecteer(kandidaten, undefined, null);
  const onbekend = await selecteer(kandidaten, ONBEKEND, bepaalArtikelfocus([VRAAG_BEDOELING], ONBEKEND));
  assert.equal(JSON.stringify(onbekend), JSON.stringify(zonderIntentie));

  const vraag = "Wat was de bedoeling van de wetgever bij de Pensioenwet?";
  const intentie = bepaalJuridischeVraagintentie(vraag);
  const r3 = await selecteer(kandidaten, intentie, null);
  const metNull = await selecteer(kandidaten, intentie, bepaalArtikelfocus([vraag], intentie));
  assert.equal(JSON.stringify(metNull), JSON.stringify(r3), "juridisch zonder artikel = exact R-3");
  assert.equal(r3.extra.selectie?.juridisch?.artikel, undefined, "geen artikelsleutel");

  // Pure boost: zonder exacte kandidaat dezelfde referentie.
  const items = [bron("mvt", "x"), bron("wet", "y")];
  assert.equal(boostArtikelpassages(items, { artikelen: ["150d"], wet: null }, (c) => ({ documentId: c.document_id, ...c })).volgorde, items);
});

test("#500-S7 — diagnostiek: gesloten tellingen, geen artikelnummer of tekst", async () => {
  const r = await selecteer(pilotKandidaten([exacteMvt()]), BEDOELING, focusVan(VRAAG_BEDOELING));
  const json = JSON.stringify(r.extra.selectie);
  for (const woord of ["150d", "pensioenwet", "transitieplan", "artikelsgewijze", "uniek"]) {
    assert.ok(!json.toLowerCase().includes(woord), woord);
  }
});

// ── (A) ADAPTER: het gerichte artikelspoor ──────────────────────────────────

const FONDS = "11111111-1111-4111-8111-111111111111";
const ANDER_FONDS = "99999999-9999-4999-8999-999999999999";
const MVT_DOC = "d0000000-0000-4000-8000-000000000001";
const PW_DOC = "d0000000-0000-4000-8000-000000000002";

interface Nepaanroep {
  soort: string;
  args: unknown[];
}
function rpcRij(id: string, document_id: string, tekst: string, over: Record<string, unknown> = {}) {
  return {
    id,
    document_id,
    tekst,
    pagina: 395,
    paragraaf: null,
    chunk_index: 1000,
    titel: "Kamerstukken II 2021/22, 36 067, nr. 3",
    bron: "upload",
    bibliotheek: "generiek",
    opslag_pad: null,
    rang: 0.1,
    documentstatus: "van_kracht",
    bronstatus: "actief",
    documentdatum: "2022-03-25",
    geldig_vanaf: null,
    geldig_tot: null,
    procesinstantie_id: null,
    bronorganisatie: null,
    normgewicht: "informatief",
    extern_url: null,
    fonds_id: null,
    volgende_review: null,
    wettelijk_regime: "beide",
    ...over,
  };
}
function nepSupabase(opzoek: unknown[] | { fout: string }, rpc: (args: Record<string, unknown>) => unknown[]) {
  const log: Nepaanroep[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "in", "or", "order", "limit", "eq"]) {
    builder[m] = (...args: unknown[]) => {
      log.push({ soort: m, args });
      return builder;
    };
  }
  builder.abortSignal = () => builder;
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(Array.isArray(opzoek) ? { data: opzoek, error: null } : { data: null, error: { message: opzoek.fout } }).then(res, rej);
  const client = {
    from(tabel: string) {
      log.push({ soort: "from", args: [tabel] });
      return builder;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      log.push({ soort: "rpc", args: [fn, args] });
      const r: Record<string, unknown> = {};
      r.abortSignal = () => r;
      r.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: rpc(args), error: null }).then(res, rej);
      return r;
    },
  };
  return { client, log };
}
function chunk(id: string, document_id: string, tekst: string, over: Partial<DocumentChunk["documenten"]> = {}): DocumentChunk {
  return {
    id,
    document_id,
    tekst,
    pagina: 1,
    paragraaf: null,
    chunk_index: Number(id.replace(/\D/g, "").slice(-4)) || 0,
    rang: 0.5,
    documenten: {
      titel: "Kamerstukken II 2021/22, 36 067, nr. 3",
      bron: "upload",
      bibliotheek: "generiek",
      opslag_pad: null,
      fonds_id: null,
      documentstatus: "van_kracht",
      bronstatus: "actief",
      documentdatum: "2022-03-25",
      normgewicht: "informatief",
      wettelijk_regime: "beide",
      ...over,
    },
  };
}
const OPZOEK_P395 = { id: "c-p395", document_id: MVT_DOC, tekst: P395.tekst, structuur_label: P395.structuurLabel };
const OPZOEK_P396 = { id: "c-p396", document_id: MVT_DOC, tekst: "vervolg van de toelichting", structuur_label: P395.structuurLabel };
const OPZOEK_P394 = {
  id: "c-p394",
  document_id: MVT_DOC,
  tekst: "Artikel 150c Pensioenwet (Invaarbesluit)\nuniek",
  structuur_label: "Artikelsgewijze toelichting — Artikel 150c",
};
const FILTERS: RetrievalFilters = { modus: "actueel", peildatum: "2026-09-29", bronsoort: ["fonds", "generiek"] };

test("#500-A1 — toelating uitsluitend via dezelfde zoek-RPC met hetzelfde filterblok en een frasequery", async () => {
  const { client, log } = nepSupabase([OPZOEK_P395, OPZOEK_P396, OPZOEK_P394], () => [
    rpcRij("c-p395", MVT_DOC, P395.tekst),
    // Een andere frasetreffer (algemeen deel) hoort niet bij de exacte set.
    rpcRij("c-p86", MVT_DOC, "In het transitieplan (artikel 150d) ..."),
  ]);
  const bestaand = [chunk("c-0001", MVT_DOC, "p.365 artikel 16"), chunk("c-0002", MVT_DOC, "p.86")];
  const uit = await vulAanMetArtikelkandidaten(bestaand, {
    focus: { artikelen: ["150d"], wet: "pw" },
    fondsId: FONDS,
    scope: null,
    filters: FILTERS,
    maxKandidaten: 30,
    supabase: client,
  });
  assert.deepEqual(uit.map((c) => c.id), ["c-0001", "c-0002", "c-p395"], "alleen de exacte, door de RPC toegelaten passage komt erbij");
  const toegevoegd = uit[2];
  assert.equal(toegevoegd.artikelspoor, true);
  assert.equal(toegevoegd.structuur_label, P395.structuurLabel);

  // De opzoeking: alleen juridische documenttypen, via de documentrij.
  assert.deepEqual(log[0], { soort: "from", args: ["document_chunks"] });
  assert.ok(log.some((l) => l.soort === "in" && l.args[0] === "documenten.documenttype" &&
    JSON.stringify(l.args[1]) === JSON.stringify(["wetgeving", "wetsgeschiedenis"])));
  assert.ok(log.some((l) => l.soort === "or" && l.args[0] === artikelOpzoekfilter({ artikelen: ["150d"] })));

  // De toelating: dezelfde RPC-parameters als het hoofdspoor.
  const rpc = log.filter((l) => l.soort === "rpc");
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].args[0], "zoek_chunks");
  assert.deepEqual(rpc[0].args[1], {
    p_query: '"artikel 150d" OR "art 150d"',
    p_limit: 200,
    p_document_ids: [MVT_DOC],
    p_modus: "actueel",
    p_peildatum: "2026-09-29",
    p_bronsoort: ["fonds", "generiek"],
    p_fonds_id: FONDS,
  });
});

test("#500-A2 — negatief: wat de RPC niet teruggeeft, of wat de app-guard afwijst, komt er niet in", async () => {
  const focus: Artikelfocus = { artikelen: ["150d"], wet: null };
  const bestaand = [chunk("c-0001", MVT_DOC, "p.365")];
  const basis = { focus, fondsId: FONDS, filters: FILTERS, maxKandidaten: 30 };

  // (1) RPC laat de passage niet toe (ander fonds / status / modus / scope).
  const leeg = nepSupabase([OPZOEK_P395], () => []);
  assert.deepEqual((await vulAanMetArtikelkandidaten(bestaand, { ...basis, supabase: leeg.client })).map((c) => c.id), ["c-0001"]);

  // (2) Een niet-gepubliceerde generieke passage die toch terugkomt: app-guard.
  const concept = nepSupabase([OPZOEK_P395], () => [rpcRij("c-p395", MVT_DOC, P395.tekst, { documentstatus: "concept" })]);
  assert.deepEqual((await vulAanMetArtikelkandidaten(bestaand, { ...basis, supabase: concept.client })).map((c) => c.id), ["c-0001"]);

  // (3) Een fondsdocument van een ANDER fonds: app-guard (cross-tenant).
  const vreemd = nepSupabase([OPZOEK_P395], () => [
    rpcRij("c-p395", MVT_DOC, P395.tekst, { bibliotheek: "fonds", fonds_id: ANDER_FONDS }),
  ]);
  assert.deepEqual((await vulAanMetArtikelkandidaten(bestaand, { ...basis, supabase: vreemd.client })).map((c) => c.id), ["c-0001"]);

  // (4) Verlopen review op een generieke bron: app-guard (T10).
  const verlopen = nepSupabase([OPZOEK_P395], () => [rpcRij("c-p395", MVT_DOC, P395.tekst, { volgende_review: "2020-01-01" })]);
  assert.deepEqual((await vulAanMetArtikelkandidaten(bestaand, { ...basis, supabase: verlopen.client })).map((c) => c.id), ["c-0001"]);

  // (5) Alleen buurartikelen in de opzoeking: geen RPC-aanroep.
  const buren = nepSupabase([OPZOEK_P394], () => [rpcRij("c-p394", MVT_DOC, OPZOEK_P394.tekst)]);
  assert.deepEqual((await vulAanMetArtikelkandidaten(bestaand, { ...basis, supabase: buren.client })).map((c) => c.id), ["c-0001"]);
  assert.equal(buren.log.filter((l) => l.soort === "rpc").length, 0);

  // (6) Opzoekfout: fail-open, kandidaten ongewijzigd.
  const fout = nepSupabase({ fout: "boom" }, () => []);
  assert.deepEqual((await vulAanMetArtikelkandidaten(bestaand, { ...basis, supabase: fout.client })).map((c) => c.id), ["c-0001"]);

  // (7) Documentscope blijft de scope: de opzoeking filtert erop.
  const scoped = nepSupabase([], () => []);
  await vulAanMetArtikelkandidaten(bestaand, { ...basis, scope: [PW_DOC], supabase: scoped.client });
  assert.ok(scoped.log.some((l) => l.soort === "in" && l.args[0] === "document_id" && JSON.stringify(l.args[1]) === JSON.stringify([PW_DOC])));
});

test("#500-A3 — kandidatenpool: nieuwe exacte passages vervangen de zwakste niet-exacte staart", async () => {
  const bestaand = Array.from({ length: 30 }, (_, i) => chunk(`c-${String(i + 1).padStart(4, "0")}`, MVT_DOC, `p${i}`));
  // Kandidaat 30 is zelf exact (label), en blijft staan.
  bestaand[29].id = "c-p396";
  const { client } = nepSupabase([OPZOEK_P395, OPZOEK_P396], () => [rpcRij("c-p395", MVT_DOC, P395.tekst)]);
  const uit = await vulAanMetArtikelkandidaten(bestaand, {
    focus: { artikelen: ["150d"], wet: null },
    fondsId: FONDS,
    filters: FILTERS,
    maxKandidaten: 30,
    supabase: client,
  });
  assert.equal(uit.length, 30);
  assert.ok(uit.some((c) => c.id === "c-p396"), "een exacte bestaande kandidaat wordt niet verdrongen");
  assert.equal(uit.find((c) => c.id === "c-p396")?.structuur_label, P395.structuurLabel, "en krijgt zijn label mee");
  assert.ok(!uit.some((c) => c.id === "c-0029"), "de zwakste niet-exacte kandidaat maakt plaats");
  assert.equal(uit.at(-1)?.id, "c-p395");
});

/**
 * Een nep-PostgREST die de opzoeking ÉCHT uitvoert: het `or`-filter van
 * `artikelOpzoekfilter` (ilike én imatch), `in document_id`, de ordening op
 * (document_id, chunk_index) en de `limit`. Zo is zichtbaar of de exacte
 * passage de limiet haalt — iets wat een vooraf gefilterde nep niet toont.
 */
interface Tabelrij {
  id: string;
  document_id: string;
  chunk_index: number;
  tekst: string;
  structuur_label: string | null;
}
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
    const m = deel.match(/^([a-z_]+)\.(ilike|imatch)\.(?:"(.*)"|(.*))$/);
    assert.ok(m, `onbekend filterdeel: ${deel}`);
    const [, kolom, op, gequote, kaal] = m;
    const waarde = gequote ?? kaal;
    const re =
      op === "imatch"
        ? new RegExp(waarde, "i")
        : new RegExp(`^${waarde.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "is");
    return (r: Tabelrij) => re.test(String((r as unknown as Record<string, unknown>)[kolom] ?? ""));
  });
  return (r) => termen.some((t) => t(r));
}
function postgrestNep(tabel: Tabelrij[], rpcIds: (ids: string[]) => string[]) {
  let or: (r: Tabelrij) => boolean = () => true;
  let scope: string[] | null = null;
  let limiet = Infinity;
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.order = () => builder;
  builder.abortSignal = () => builder;
  builder.in = (k: string, v: string[]) => {
    if (k === "document_id") scope = v;
    return builder;
  };
  builder.or = (f: string) => {
    or = orPredicaat(f);
    return builder;
  };
  builder.limit = (n: number) => {
    limiet = n;
    return builder;
  };
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    const data = tabel
      .filter((r) => (!scope || scope.includes(r.document_id)) && or(r))
      .sort((a, b) => a.document_id.localeCompare(b.document_id) || a.chunk_index - b.chunk_index)
      .slice(0, limiet);
    return Promise.resolve({ data, error: null }).then(res, rej);
  };
  return {
    from: () => builder,
    rpc: (_fn: string, args: Record<string, unknown>) => {
      const r: Record<string, unknown> = {};
      r.abortSignal = () => r;
      const docs = args.p_document_ids as string[];
      r.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({
          data: tabel
            .filter((t) => docs.includes(t.document_id) && rpcIds([t.id]).length > 0)
            .map((t) => rpcRij(t.id, t.document_id, t.tekst)),
          error: null,
        }).then(res, rej);
      return r;
    },
  };
}

test("#500-A4 — de opzoeking is exact in de database: >50 buurlabels vóór de passage drukken haar niet uit de limiet", async () => {
  const buren15 = ["150", "150a", "150b", "150c", "150d", "150e", "151", "152", "153", "159", "1500", "15a"];
  const buren1 = ["10", "100", "11", "1a", "12", "19", "1000"];
  const tabel: Tabelrij[] = [];
  // 60 niet-exacte chunks (steeds dezelfde unit-labels) in chunk_index vóór de exacte passages.
  for (let i = 0; i < 60; i++) {
    const n = buren15[i % buren15.length];
    tabel.push({ id: `b15-${i}`, document_id: MVT_DOC, chunk_index: i,
      tekst: i % 3 === 0 ? `Artikel ${n} Pensioenwet\nkop` : "vervolgtekst", structuur_label: `Artikelsgewijze toelichting — Artikel ${n}` });
  }
  for (let i = 0; i < 60; i++) {
    const n = buren1[i % buren1.length];
    tabel.push({ id: `b1-${i}`, document_id: MVT_DOC, chunk_index: 100 + i,
      tekst: i % 3 === 0 ? `Art. ${n} Pensioenwet\nkop` : "vervolgtekst", structuur_label: `Artikelsgewijze toelichting — Artikel ${n}` });
  }
  tabel.push({ id: "exact-15", document_id: MVT_DOC, chunk_index: 500,
    tekst: "Artikel 15 Pensioenwet (Informatie)\nToelichting.", structuur_label: "Artikelsgewijze toelichting — Artikel 15" });
  tabel.push({ id: "exact-1", document_id: MVT_DOC, chunk_index: 600,
    tekst: "Artikel 1 Pensioenwet (Begripsbepalingen)\nToelichting.", structuur_label: "Artikelsgewijze toelichting — Artikel 1" });
  const client = postgrestNep(tabel, (ids) => ids);

  for (const [nummer, id] of [["15", "exact-15"], ["1", "exact-1"]] as const) {
    const uit = await vulAanMetArtikelkandidaten([], {
      focus: { artikelen: [nummer], wet: "pw" },
      fondsId: FONDS,
      filters: FILTERS,
      maxKandidaten: 30,
      supabase: client,
    });
    assert.deepEqual(uit.map((c) => c.id), [id], `artikel ${nummer} vindt precies zijn eigen passage`);
  }
  // En de filterstring zelf: geen prefix-ilike meer, wel een woordgrens na het nummer.
  const f = artikelOpzoekfilter({ artikelen: ["15"] });
  assert.ok(!/ilike/.test(f), f);
  const label = orPredicaat(f);
  const rij = (structuur_label: string, tekst = "x"): Tabelrij => ({ id: "r", document_id: "d", chunk_index: 0, tekst, structuur_label });
  assert.equal(label(rij("Artikelsgewijze toelichting — Artikel 15")), true);
  assert.equal(label(rij("Artikelsgewijze toelichting — Artikel 15, onderdeel A")), true);
  for (const buur of buren15) assert.equal(label(rij(`Artikelsgewijze toelichting — Artikel ${buur}`)), false, buur);
  assert.equal(label(rij("§3", "Art. 15 Pensioenwet")), true);
  assert.equal(label(rij("§3", "Art 150 Pensioenwet")), false);
  assert.equal(label(rij("§3", "Zoals artikel 15 bepaalt")), false);
});

// ── (E) EIND-TOT-EIND: orkestratie + Supabase-adapter ──────────────────────

const CTX: RetrievalContext = {
  fondsId: FONDS,
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds", "generiek", "notulen"] },
  correlationId: "corr-500",
  verzoekStartOp: new Date().toISOString(),
};
const CITAAT: CitaatOpdracht = {
  primaireDocumentIds: new Set<string>(),
  peildatum: "2026-09-29",
  hoofddocumentLabel: " [hoofddocument]",
  sentinel: "SENT",
};
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

/** 30 kandidaten zoals in productie: MvT-passages (o.a. p.365 art. 16) en fondsstukken, zónder p.395. */
function productiekandidaten(): DocumentChunk[] {
  const lijst: DocumentChunk[] = [
    chunk("c-p365", MVT_DOC, "Artikel 16 Pensioenwet\nDe informatieverplichting ... uniekp365"),
  ];
  for (let i = 0; i < 25; i++) lijst.push(chunk(`c-mvt-${i}`, MVT_DOC, `Algemeen deel over de bedoeling van de wetgever ${i} uniekmvt${i}`));
  for (let i = 0; i < 4; i++) {
    lijst.push(chunk(`c-fonds-${i}`, `f000000${i}-0000-4000-8000-000000000000`, `Fondsstuk ${i} uniekf${i}`, {
      bibliotheek: "fonds",
      fonds_id: FONDS,
      titel: `Bestuursstuk ${i}`,
      normgewicht: null,
      wettelijk_regime: null,
    }));
  }
  return lijst.map((c, i) => ({ ...c, rang: 1 - i / 100 }));
}

function maakAdapter(opties: { artikelspoor: boolean; aanroepen: RetrievalQuery[] }) {
  const { client, log } = nepSupabase([OPZOEK_P395, OPZOEK_P396, OPZOEK_P394], () => [
    rpcRij("c-p395", MVT_DOC, P395.tekst),
  ]);
  const vaste = { soort: "hash" as const, gecontroleerdOp: "2026-09-29T10:00:00.000Z" };
  const retrieval = maakSupabaseAdapter({ parentRetrieval: false } as Adaptervlaggen, {}, {
    zoek: async () => ({
      chunks: productiekandidaten(),
      meta: { methode: "hybride_rrf", opgehaald: 30, geselecteerd: 0, chunks: [] } as unknown as RetrievalMeta,
    }),
    leesVersies: async (chunks) =>
      new Map(chunks.map((c) => [c.id, { ...vaste, waarde: maakVolledigeVersieHash(c.document_id, `r1-${c.id}`, "c".repeat(64)) }])),
    verrijkNotulen: async (chunks) => chunks,
    verrijkDocumentmeta: async (chunks) => {
      for (const c of chunks) {
        if (c.document_id === MVT_DOC) {
          c.documenten.documenttype = "wetsgeschiedenis";
          c.documenten.wetsgeschiedenis_subtype = "memorie_van_toelichting";
        }
      }
      return chunks;
    },
    artikelkandidaten: (bestaand, o) =>
      opties.artikelspoor ? vulAanMetArtikelkandidaten(bestaand, { ...o, supabase: client }) : Promise.resolve(bestaand),
  });
  const adapter: RetrievalAdapter = {
    ...retrieval.adapter,
    zoek: async (ctx, q): Promise<AdapterUitkomst> => {
      opties.aanroepen.push(q);
      return retrieval.adapter.zoek(ctx, q);
    },
  };
  return { adapter, log };
}

test("#500-E1 — pilot nagebootst: de bedoelingsvraag selecteert de p.395-passage, die de RPC niet teruggaf", async () => {
  const aanroepen: RetrievalQuery[] = [];
  const { adapter, log } = maakAdapter({ artikelspoor: true, aanroepen });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter, sporen: [{ query: query(VRAAG_BEDOELING), grenzen: { ...GRENZEN, juridischeIntentie: BEDOELING } }] },
    CITAAT
  );
  assert.deepEqual(aanroepen[0].artikelfocus, { artikelen: ["150d"], wet: "pw" });
  const p395 = uit.geselecteerd.find((b) => b.passage.startsWith("Artikel 150d"));
  assert.ok(p395, "de exacte artikelsgewijze toelichting is geselecteerd");
  assert.equal(p395.weergave?.documenttype, "wetsgeschiedenis");
  assert.equal(p395.locator.pagina, 395);
  const eersteToelichting = uit.geselecteerd.find((b) => b.weergave?.documenttype === "wetsgeschiedenis");
  assert.equal(eersteToelichting, p395, "zij staat in de kop, vóór de p.365-passage over artikel 16");
  assert.deepEqual(uit.meta.selectie?.juridisch?.artikel, {
    verwijzingen: 1,
    wet_genoemd: true,
    exact: 1,
    geboost: 1,
    geboost_geselecteerd: 1,
    via_artikelspoor: 1,
  });
  assert.equal(log.filter((l) => l.soort === "rpc").length, 1);
  assert.ok(!JSON.stringify(uit.meta.selectie).includes("150d"), "geen artikelnummer in de audit");
  assert.ok(!JSON.stringify(uit.meta).toLowerCase().includes("artikelsgewijze"), "geen structuurlabel in de audit");
});

test("#500-E2 — gesloten poort: de adapter krijgt exact de oude query en het spoor draait niet", async () => {
  for (const [vraag, intentie] of [
    ["Wat is de dekkingsgraad?", ONBEKEND],
    ["Wat staat in artikel 5 van ons reglement?", bepaalJuridischeVraagintentie("Wat staat in artikel 5 van ons reglement?")],
    [VRAAG_BEDOELING, undefined],
  ] as const) {
    const aanroepen: RetrievalQuery[] = [];
    const { adapter, log } = maakAdapter({ artikelspoor: true, aanroepen });
    const q = query(vraag);
    const uit = await voerVolledigeRetrievalUit(
      CTX,
      { adapter, sporen: [{ query: q, grenzen: intentie ? { ...GRENZEN, juridischeIntentie: intentie } : GRENZEN }] },
      CITAAT
    );
    assert.equal(aanroepen[0], q, `${vraag}: dezelfde query-referentie`);
    assert.ok(!("artikelfocus" in aanroepen[0]));
    assert.equal(log.length, 0, `${vraag}: geen opzoeking`);
    assert.equal(uit.meta.selectie?.juridisch?.artikel, undefined);
  }
});

// ── (N) NEGATIEVE CONTROLE ──────────────────────────────────────────────────

test("#500-N1 — negatieve controle: zonder boost of zonder artikelspoor wordt de acceptatie rood", async () => {
  // (a) Boost uit (geen focus naar de selectie): de exacte passage aan de staart valt af.
  const exact = exacteMvt({ rang: 0.0001 });
  const zonderBoost = await selecteer(pilotKandidaten([exact]), BEDOELING, null);
  assert.ok(!zonderBoost.chunks.includes(exact), "S1 hoort zonder boost rood te worden");

  // (b) Normvraag zonder boost: het exacte wetsartikel aan de staart wordt verdrongen door art. 16.
  const wet150d = exacteWet({ rang: 0.0001 });
  const wetten = Array.from({ length: 12 }, (_, i) => bron("wet", "pw", { structuurLabel: `Artikel ${i + 1}` }));
  const norm = await selecteer([...wetten, wet150d], NORM, null);
  assert.ok(!norm.chunks.includes(wet150d), "S2 hoort zonder boost rood te worden");
  const normMet = await selecteer([...wetten, wet150d], NORM, focusVan(VRAAG_NORM));
  assert.equal(normMet.chunks[0], wet150d);

  // (c) Artikelspoor uit: de passage kwam nooit binnen, dus ook de boost redt haar niet.
  const aanroepen: RetrievalQuery[] = [];
  const { adapter } = maakAdapter({ artikelspoor: false, aanroepen });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter, sporen: [{ query: query(VRAAG_BEDOELING), grenzen: { ...GRENZEN, juridischeIntentie: BEDOELING } }] },
    CITAAT
  );
  assert.ok(!uit.geselecteerd.some((b) => b.passage.startsWith("Artikel 150d")), "E1 hoort zonder spoor rood te worden");
  assert.equal(uit.meta.selectie?.juridisch?.artikel?.exact, 0);
});
