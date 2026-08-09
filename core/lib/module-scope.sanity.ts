// ============================================================================
//  Sanity-tests voor lib/module-scope.ts (AI-modulecontext, besluit 0151).
//  Pure parsing + opmaak; geen DB.
//  Uitvoeren: npx tsx core/lib/module-scope.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  parseModuleScope,
  beschrijfLogRegel,
  bouwRisicomatrixBlok,
  bouwRisicoBlok,
  bouwProcesBlok,
  type RisicoRij,
  type RisicoLogRij,
  type DecisionRij,
} from "./module-scope";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("module-scope sanity-tests:");

// ── parseModuleScope ────────────────────────────────────────────────────────

test("parse: risicomatrix zonder id", () => {
  assert.deepEqual(parseModuleScope({ soort: "risicomatrix" }), { soort: "risicomatrix" });
});

test("parse: proces met id", () => {
  assert.deepEqual(parseModuleScope({ soort: "proces", procedure_id: " p1 " }), {
    soort: "proces",
    procedure_id: "p1",
  });
});

test("parse: risico met id", () => {
  assert.deepEqual(parseModuleScope({ soort: "risico", risico_id: "r1" }), {
    soort: "risico",
    risico_id: "r1",
  });
});

test("parse: proces zonder id → null (geen scope, geen stille aanname)", () => {
  assert.equal(parseModuleScope({ soort: "proces" }), null);
  assert.equal(parseModuleScope({ soort: "proces", procedure_id: "" }), null);
});

test("parse: onbekende soort / rommel → null", () => {
  assert.equal(parseModuleScope({ soort: "onzin" }), null);
  assert.equal(parseModuleScope(null), null);
  assert.equal(parseModuleScope("proces"), null);
  assert.equal(parseModuleScope({ soort: "risico", risico_id: 42 }), null);
});

// Criterium 10 — tegenvoorbeeld: GEEN scope → geen modulecontext. Zonder een
// module_scope in de body is er geen scope-soort en dus geen contextblok; de
// route valt terug op zijn ongewijzigde gedrag (intent-heuristiek intact).
test("tegenvoorbeeld: geen module_scope → null (geen modulecontext)", () => {
  assert.equal(parseModuleScope(undefined), null);
  assert.equal(parseModuleScope({}), null);
});

// ── beschrijfLogRegel (drie event-vormen, besluit 0151 §0) ──────────────────

const baseLog = (over: Partial<RisicoLogRij>): RisicoLogRij => ({
  risico_id: "r1",
  risico_titel: "Renterisico",
  event_type: "risico_gewijzigd",
  payload: {},
  actor_naam: "Anna de Vries",
  tijdstip: "2026-03-12T10:00:00.000Z",
  ...over,
});

test("log: risico_gewijzigd met weegveld-diff → weegregel + motivering", () => {
  const r = beschrijfLogRegel(
    baseLog({
      payload: {
        diff: { niveau: { oud: "middel", nieuw: "hoog" } },
        motivering: "Stresstest −100bp",
        raakt_weging: true,
      },
    })
  );
  assert.ok(r);
  assert.equal(r!.isWeging, true);
  assert.ok(r!.tekst.includes("niveau middel→hoog"));
  assert.ok(r!.tekst.includes("Motivering: Stresstest −100bp"));
  assert.ok(r!.tekst.includes("«Renterisico»"));
});

test("log: risico_gewijzigd zonder weegveld (alleen titel) → null", () => {
  const r = beschrijfLogRegel(
    baseLog({ payload: { diff: { titel: { oud: "A", nieuw: "B" } } } })
  );
  assert.equal(r, null);
});

test("log: legacy niveau_gewijzigd {van,naar,motivering}", () => {
  const r = beschrijfLogRegel(
    baseLog({
      event_type: "niveau_gewijzigd",
      payload: { van: "middel", naar: "hoog", motivering: "Krappe financieringsgraad" },
    })
  );
  assert.ok(r);
  assert.equal(r!.isWeging, true);
  assert.ok(r!.tekst.includes("niveau middel→hoog"));
  assert.ok(r!.tekst.includes("Krappe financieringsgraad"));
});

test("log: risico_gesloten → sluitregel, geen weging", () => {
  const r = beschrijfLogRegel(
    baseLog({ event_type: "risico_gesloten", payload: { motivering: "Opgelost" } })
  );
  assert.ok(r);
  assert.equal(r!.isWeging, false);
  assert.ok(r!.tekst.includes("gesloten"));
  assert.ok(r!.tekst.includes("Opgelost"));
});

test("log: ontbrekende motivering → expliciet '(geen opgegeven)', geen verzonnen reden", () => {
  const r = beschrijfLogRegel(
    baseLog({ payload: { diff: { kans: { oud: 3, nieuw: 4 } } } })
  );
  assert.ok(r);
  assert.ok(r!.tekst.includes("Motivering: (geen opgegeven)"));
});

test("log: irrelevant event (risico_aangemaakt) → null", () => {
  assert.equal(beschrijfLogRegel(baseLog({ event_type: "risico_aangemaakt" })), null);
});

// ── bouwRisicomatrixBlok ────────────────────────────────────────────────────

const risico = (over: Partial<RisicoRij>): RisicoRij => ({
  id: "r1",
  categorie: "financieel_actuarieel",
  titel: "Renterisico dekkingsgraad",
  toelichting: "Bij −100bp krappe financieringsgraad",
  kans: 4,
  impact: 4,
  niveau: "hoog",
  type_risico: "structureel",
  status: "actief",
  eigenaar_naam: "Anna de Vries",
  volgende_beoordeling: "2026-09-30",
  gesloten_op: null,
  sluit_motivering: null,
  ...over,
});

test("matrix: leeg fonds → expliciet 'geen risico's', geen weigering, instructie meereist", () => {
  const blok = bouwRisicomatrixBlok([], []);
  assert.ok(blok.includes("geen risico's geregistreerd"));
  assert.ok(blok.includes("RISICOMATRIX VAN HET FONDS"));
  assert.ok(blok.includes("geen vastgesteld besluit"));
  assert.ok(blok.includes("de weging is aan het bestuur"));
});

test("matrix: actief + gesloten per thema + wegingsgeschiedenis begrensd", () => {
  const blok = bouwRisicomatrixBlok(
    [
      risico({}),
      risico({
        id: "r2",
        titel: "Voorzitter-vacature",
        categorie: "governance_organisatie",
        status: "gesloten",
        niveau: "middel",
        gesloten_op: "2026-02-05",
        sluit_motivering: "Nieuwe voorzitter aangetreden",
      }),
    ],
    [
      {
        risico_id: "r1",
        risico_titel: "Renterisico dekkingsgraad",
        event_type: "risico_gewijzigd",
        payload: { diff: { niveau: { oud: "middel", nieuw: "hoog" } }, motivering: "Stresstest" },
        actor_naam: "Anna de Vries",
        tijdstip: "2026-03-12T10:00:00.000Z",
      },
    ]
  );
  assert.ok(blok.includes("THEMA «Financieel & actuarieel»"));
  assert.ok(blok.includes("«Renterisico dekkingsgraad»"));
  assert.ok(blok.includes("niveau Hoog"));
  assert.ok(blok.includes("[GESLOTEN] «Voorzitter-vacature»"));
  assert.ok(blok.includes("Nieuwe voorzitter aangetreden"));
  assert.ok(blok.includes("WEGINGSGESCHIEDENIS"));
  assert.ok(blok.includes("niveau middel→hoog"));
  assert.ok(!/\[Bron \d+\]/.test(blok));
});

test("matrix: N-begrenzing kapt de wegingsgeschiedenis af", () => {
  const logs: RisicoLogRij[] = Array.from({ length: 30 }, (_, i) => ({
    risico_id: "r1",
    risico_titel: "Renterisico",
    event_type: "risico_gewijzigd",
    payload: { diff: { kans: { oud: 3, nieuw: 4 } }, motivering: `m${i}` },
    actor_naam: null,
    tijdstip: "2026-03-12T10:00:00.000Z",
  }));
  const blok = bouwRisicomatrixBlok([risico({})], logs, 5);
  const treffers = (blok.match(/kans 3→4/g) || []).length;
  assert.equal(treffers, 5);
  assert.ok(blok.includes("de 5 recentste"));
});

// ── bouwRisicoBlok (verdieping) ─────────────────────────────────────────────

test("risico: volledige historie + maatregelen + weging-nuance", () => {
  const blok = bouwRisicoBlok(
    risico({}),
    [
      {
        risico_id: "r1",
        risico_titel: "Renterisico dekkingsgraad",
        event_type: "risico_gewijzigd",
        payload: { diff: { niveau: { oud: "middel", nieuw: "hoog" } }, motivering: "Stresstest" },
        actor_naam: "Anna de Vries",
        tijdstip: "2026-03-12T10:00:00.000Z",
      },
    ],
    [{ beschrijving: "Rentehedge 60%", status: "genomen", verantwoordelijke: "BAC" }]
  );
  assert.ok(blok.includes("RISICO «Renterisico dekkingsgraad» — VERDIEPING"));
  assert.ok(blok.includes("VOLLEDIGE WEGINGSGESCHIEDENIS"));
  assert.ok(blok.includes("BEHEERMAATREGELEN"));
  assert.ok(blok.includes("Rentehedge 60%"));
  assert.ok(blok.includes("de weging is aan het bestuur"));
});

// ── bouwProcesBlok ──────────────────────────────────────────────────────────

const decision: DecisionRij = {
  besluitvraag: "Verhogen we de rentehedge van 60% naar 70%?",
  aanleiding: "Stresstest −100bp toont krappe financieringsgraad.",
  scope: "Rentehedge-beleid; raakt beleggingsmandaat en ALM.",
  governance_orgaan: "Beleggingsadviescommissie",
  complexiteit: "complex",
  risiconiveau: "hoog",
  mandaatgevoelig: false,
  toezichtgevoelig: true,
  beleidsafwijking: false,
  ai_risicoklasse: "middel",
  status: "in_onderbouwing",
};

test("proces: besluitvraag + classificatie + stap + stukken als [Bron N]-set", () => {
  const blok = bouwProcesBlok({
    procedure: {
      id: "p1",
      titel: "Verhoging hedge-ratio naar 70%",
      status: "lopend",
      template_code: "beleidswijziging_beleggingsbeleid",
      beschrijving: null,
    },
    decision,
    huidigeStap: { volgorde: 2, naam: "Onderbouwing opstellen", beschrijving: null, status: "actief" },
    requirements: [
      { label: "ALM-analyse beschikbaar", requirement_type: "document", verplicht: true, blokkerend: true },
    ],
    bewijs: [{ document_id: "d1", titel: "ALM-studie 2026", documenttype: "analyse" }],
    heeftBronnen: true,
  });
  assert.ok(blok.includes("PROCES «Verhoging hedge-ratio naar 70%»"));
  assert.ok(blok.includes("Verhogen we de rentehedge"));
  assert.ok(blok.includes("complexiteit complex, risiconiveau hoog, toezichtgevoelig"));
  assert.ok(blok.includes("Huidige stap: «Onderbouwing opstellen» (actief)"));
  assert.ok(blok.includes("Wat deze stap vraagt"));
  assert.ok(blok.includes("ALM-analyse beschikbaar (blokkerend)"));
  assert.ok(blok.includes("«ALM-studie 2026» (analyse)"));
  assert.ok(blok.includes("[Bron N]"));
});

test("proces: zonder gekoppelde stukken → expliciete bronbasis-melding, geen bibliotheek-terugval", () => {
  const blok = bouwProcesBlok({
    procedure: { id: "p1", titel: "Kaderproces", status: "lopend", template_code: null, beschrijving: "Los kader" },
    decision: null,
    huidigeStap: null,
    requirements: [],
    bewijs: [],
    heeftBronnen: false,
  });
  assert.ok(blok.includes("geen doorzoekbare stukken gekoppeld"));
  assert.ok(blok.includes("doorzoek niet de hele bibliotheek"));
  assert.ok(blok.includes("Omschrijving: Los kader"));
  // De "Gekoppelde stukken … [Bron N] doorzoekbaar"-kop hoort weg te zijn; de
  // instructie zelf noemt [Bron N] wél (dat is de gedragsregel, geen stuklijst).
  assert.ok(!blok.includes("doorzoekbaar):"));
});

// ── Meereizende instructies vastgepind (na de ai-governance-review) ─────────
// De human-in-the-loop-instructies reizen in het CONTEXTBLOK (user-prompt), niet
// in de sha256-gepinde systeemprompt. Deze asserts borgen dat de kernzinnen niet
// stil verzwakken bij een toekomstige edit — zonder die zinnen mag deze suite niet
// groen worden.
test("pin: RISICO_INSTRUCTIE draagt alle human-in-the-loop-kernzinnen", () => {
  const blok = bouwRisicomatrixBlok([risico({})], []);
  // signaleren, nooit besluit/opdracht
  assert.ok(blok.includes("draag nooit een besluit of opdracht op"));
  // weging = spiegelen, niet zelf wegen als besluit
  assert.ok(blok.includes("de weging is aan het bestuur"));
  assert.ok(blok.includes("draag nooit een eigen weging op als"));
  // geen schijnzekerheid: grens + ontbrekende motivering
  assert.ok(blok.includes("opgetreden incidenten die"));
  assert.ok(blok.includes("in plaats van er een te veronderstellen"));
  // tegenspraak: benoem beide, kies niet stilzwijgend
  assert.ok(blok.includes("benoem dan beide en kies niet stilzwijgend"));
});

test("pin: PROCES_INSTRUCTIE draagt de human-in-the-loop- en bron-kernzinnen", () => {
  const blok = bouwProcesBlok({
    procedure: { id: "p1", titel: "P", status: "lopend", template_code: null, beschrijving: null },
    decision: null,
    huidigeStap: null,
    requirements: [],
    bewijs: [],
    heeftBronnen: false,
  });
  assert.ok(blok.includes("draag nooit een besluit of opdracht op"));
  assert.ok(blok.includes("uitsluitend op de genummerde bronnen [Bron N]"));
  assert.ok(blok.includes("benoem dan beide en kies niet stilzwijgend"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
