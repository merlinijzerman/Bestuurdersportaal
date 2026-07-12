// ============================================================================
//  Sanity-tests voor lib/classificatie.ts (Increment E).
//
//  Pint de risicovolle classificatielogica vast: de harde guards (FO §10),
//  de confidence-mapping (hoog/middel/laag/geen_match) en de open-instantie-
//  guard. Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/classificatie.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  classificeerDocument,
  herkenJaar,
  type KandidaatInstantie,
  type ClassificatieInvoer,
} from "./classificatie";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("classificatie sanity-tests:");

// ── Hulp-factories ──
function kandidaat(over: Partial<KandidaatInstantie> = {}): KandidaatInstantie {
  return {
    procesinstantie_id: "pi-1",
    procesmodel_id: "pm-1",
    procesmodel_naam: "Actuariële en bedrijfstechnische nota",
    synoniemen: ["ABTN", "abtn"],
    verwachte_documenttypen: ["beleid", "besluit"],
    status: "lopend",
    periode_jaar: 2026,
    ...over,
  };
}

function invoer(over: Partial<ClassificatieInvoer> = {}): ClassificatieInvoer {
  return {
    titel: "ABTN 2026",
    documenttype: "beleid",
    documentdatum: "2026-03-01",
    reedsGekoppeld: false,
    isNotulen: false,
    heeftAgendapunt: false,
    chunkTeksten: [],
    ...over,
  };
}

// ── Guard 1: expliciet gekoppeld → nooit voorstel (FO §10, AC 1) ──
test("expliciet gekoppeld document → geen_match, hangt nooit om", () => {
  const r = classificeerDocument(invoer({ reedsGekoppeld: true }), [kandidaat()]);
  assert.equal(r.confidence, "geen_match");
  assert.equal(r.procesinstantie_id, null);
});

// ── Guard 3: notulen zonder agendapunt → geen rechtstreeks voorstel ──
test("notulen zonder agendapunt → geen_match", () => {
  const r = classificeerDocument(
    invoer({ isNotulen: true, heeftAgendapunt: false, documenttype: "notulen" }),
    [kandidaat()]
  );
  assert.equal(r.confidence, "geen_match");
});

// ── hoog: titel(S1) + periode(S2) + type(S3) op één open instantie ──
test("eenduidige match op één open instantie → hoog (auto)", () => {
  const r = classificeerDocument(invoer(), [kandidaat()]);
  assert.equal(r.confidence, "hoog");
  assert.equal(r.procesinstantie_id, "pi-1");
  assert.equal(r.bron, "titel");
  assert.ok(r.signalen.includes("S1") && r.signalen.includes("S2"));
});

// ── Guard 2: periodematch maar instantie NIET open → max middel ──
test("periodematch op besloten instantie → nooit hoog, max middel", () => {
  const r = classificeerDocument(invoer(), [kandidaat({ status: "besloten" })]);
  assert.notEqual(r.confidence, "hoog");
  assert.equal(r.confidence, "middel");
});

test("afgeronde instantie telt niet als open → geen auto", () => {
  const r = classificeerDocument(invoer(), [kandidaat({ status: "afgerond" })]);
  assert.notEqual(r.confidence, "hoog");
});

// ── middel: één sterk signaal (alleen titel), geen tweede signaal ──
test("alleen titelmatch, geen periode/type → middel", () => {
  const r = classificeerDocument(
    invoer({ titel: "ABTN", documenttype: null, documentdatum: null }),
    [kandidaat({ periode_jaar: null, verwachte_documenttypen: [] })]
  );
  assert.equal(r.confidence, "middel");
  assert.equal(r.bron, "titel");
});

// ── laag: alleen zwak inhoudssignaal (S4), geen S1/S2 ──
test("alleen inhoudsmatch (S4) → laag, in review-queue (AC 3)", () => {
  const r = classificeerDocument(
    invoer({
      titel: "Vergaderstuk 14b",
      documenttype: null,
      documentdatum: null,
      chunkTeksten: ["... abtn ...", "... de abtn beschrijft ..."],
    }),
    [kandidaat({ periode_jaar: null, verwachte_documenttypen: [] })]
  );
  assert.equal(r.confidence, "laag");
  assert.equal(r.bron, "inhoud");
});

// ── laag: meerdere gelijkwaardige kandidaten → niet uniek leidend ──
test("twee gelijkwaardige kandidaten → laag (ambigu)", () => {
  const a = kandidaat({
    procesinstantie_id: "pi-a",
    procesmodel_naam: "Risicobeleid",
    synoniemen: ["risico"],
    periode_jaar: null,
    verwachte_documenttypen: [],
  });
  const b = kandidaat({
    procesinstantie_id: "pi-b",
    procesmodel_naam: "Risicobeleid",
    synoniemen: ["risico"],
    periode_jaar: null,
    verwachte_documenttypen: [],
  });
  const r = classificeerDocument(
    invoer({ titel: "Risico notitie", documenttype: null, documentdatum: null }),
    [a, b]
  );
  assert.equal(r.confidence, "laag");
});

// ── geen_match: geen enkel signaal ──
test("geen enkel signaal → geen_match", () => {
  const r = classificeerDocument(
    invoer({
      titel: "Willekeurig stuk",
      documenttype: "memo",
      documentdatum: "2030-01-01",
      chunkTeksten: ["niets relevants"],
    }),
    [kandidaat({ verwachte_documenttypen: ["beleid"], periode_jaar: 2026 })]
  );
  assert.equal(r.confidence, "geen_match");
});

test("lege kandidatenlijst → geen_match", () => {
  const r = classificeerDocument(invoer(), []);
  assert.equal(r.confidence, "geen_match");
});

// ── herkenJaar ──
test("herkenJaar vindt jaartal in titel en datum", () => {
  assert.equal(herkenJaar("ABTN 2026 definitief"), 2026);
  assert.equal(herkenJaar("2024-06-30"), 2024);
  assert.equal(herkenJaar("geen jaartal"), null);
  assert.equal(herkenJaar("1999"), null); // buiten 20xx-bereik
});

// ── Diacritics/casing robuust ──
test("hoofdletters/accenten storen de titelmatch niet", () => {
  const r = classificeerDocument(
    invoer({ titel: "ACTUARIËLE NOTA 2026" }),
    [kandidaat({ synoniemen: ["ABTN", "Actuariële nota"] })]
  );
  assert.ok(["hoog", "middel"].includes(r.confidence));
  assert.ok(r.signalen.includes("S1"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
