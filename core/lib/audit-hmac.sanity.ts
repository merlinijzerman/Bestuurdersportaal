// ============================================================================
//  core/lib/audit-hmac.sanity.ts — plateau A / A-7, acceptatiecriterium AC-13.
// ----------------------------------------------------------------------------
//  Pint de CANONIEKE VORM van het integriteitszegel vast op een bevroren
//  uitkomst. Kantelt een van deze waarden, dan is `canoniekeInvoer()` gewijzigd
//  en zijn alle bestaande zegels in `governance_log.inhoud_hmac` onverifieerbaar
//  geworden. Dat mag — maar dan bewust, met een verhoogde HMAC_SCHEMA_VERSIE en
//  een decision-record, niet als onopgemerkt neveneffect.
//
//  Zelfde patroon als core/lib/generatie-kern.sanity.ts: bereken een nieuwe
//  bevroren waarde zelf, neem hem niet over uit de foutmelding.
//
//  Uitvoeren: npx tsx core/lib/audit-hmac.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  HMAC_SCHEMA_VERSIE,
  canoniekeInvoer,
  berekenInhoudHmac,
  verifieerInhoudHmac,
  bouwInhoudZegel,
  hmacSleutel,
} from "./audit-hmac";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

/** Vaste testsleutel — nadrukkelijk niet de productiesleutel. */
const SLEUTEL = "sanity-sleutel-niet-voor-productie";

const VRAAG = "Wat is de beleidsdekkingsgraad?";
const ANTWOORD = "Die bedroeg 118,4%.";

console.log("audit-hmac sanity-tests:");

// ── 1. Canonieke vorm ───────────────────────────────────────────────────────

test("canonieke vorm is bevroren: volgorde, geen witruimte, schemaversie", () => {
  assert.equal(
    canoniekeInvoer(VRAAG, ANTWOORD),
    '{"schema_version":1,"question":"Wat is de beleidsdekkingsgraad?","answer":"Die bedroeg 118,4%."}'
  );
  assert.equal(HMAC_SCHEMA_VERSIE, 1);
});

test("een leeg antwoord wordt de lege string, niet null", () => {
  assert.equal(
    canoniekeInvoer(VRAAG, null),
    '{"schema_version":1,"question":"Wat is de beleidsdekkingsgraad?","answer":""}'
  );
  assert.equal(canoniekeInvoer(VRAAG, null), canoniekeInvoer(VRAAG, ""));
});

// ── 2. Bevroren zegels ──────────────────────────────────────────────────────

test("zegel over vraag + antwoord is bevroren", () => {
  assert.equal(
    berekenInhoudHmac(VRAAG, ANTWOORD, SLEUTEL),
    "f5e141e8d5f327f175ddac4dfe1b821faedc9945a0543a07562addb67558405e"
  );
});

test("zegel over vraag zonder antwoord is bevroren (terugvraagtak)", () => {
  // De terugvraagtak (besluit 0092) logt een vraag zonder modelantwoord.
  assert.equal(
    berekenInhoudHmac(VRAAG, null, SLEUTEL),
    "f7b287eab754b7dec37e4aeb1d7bcf0e3737cfc4988b14eeefdb947446b7ef79"
  );
});

// ── 3. NFC-normalisatie ─────────────────────────────────────────────────────

test("visueel identieke tekst met andere Unicode-samenstelling geeft één zegel", () => {
  const nfc = "Café résultaat".normalize("NFC");
  const nfd = "Café résultaat".normalize("NFD");
  // Voorwaarde voor de test zelf: de twee vormen verschillen echt op byteniveau.
  assert.notEqual(nfc, nfd);

  assert.equal(
    berekenInhoudHmac(nfd, "één".normalize("NFD"), SLEUTEL),
    berekenInhoudHmac(nfc, "één".normalize("NFC"), SLEUTEL)
  );
  assert.equal(
    berekenInhoudHmac(nfc, "één".normalize("NFC"), SLEUTEL),
    "78fb63502e4e145865cb322b9650643ee4933b983b0aeae5812c47b848c63095"
  );
});

// ── 4. Gedrag ───────────────────────────────────────────────────────────────

test("een andere sleutel geeft een ander zegel", () => {
  assert.notEqual(
    berekenInhoudHmac(VRAAG, ANTWOORD, SLEUTEL),
    berekenInhoudHmac(VRAAG, ANTWOORD, SLEUTEL + "x")
  );
});

test("één teken verschil in het antwoord kantelt het zegel", () => {
  assert.notEqual(
    berekenInhoudHmac(VRAAG, ANTWOORD, SLEUTEL),
    berekenInhoudHmac(VRAAG, "Die bedroeg 118,5%.", SLEUTEL)
  );
});

test("vraag en antwoord zijn niet verwisselbaar", () => {
  assert.notEqual(
    berekenInhoudHmac("a", "b", SLEUTEL),
    berekenInhoudHmac("b", "a", SLEUTEL)
  );
});

test("verifieer accepteert de juiste tekst en verwerpt de gewijzigde", () => {
  const zegel = berekenInhoudHmac(VRAAG, ANTWOORD, SLEUTEL);
  assert.equal(verifieerInhoudHmac(VRAAG, ANTWOORD, SLEUTEL, zegel), true);
  assert.equal(verifieerInhoudHmac(VRAAG, "iets anders", SLEUTEL, zegel), false);
  assert.equal(verifieerInhoudHmac("iets anders", ANTWOORD, SLEUTEL, zegel), false);
});

// ── 5. Sleutelconfiguratie ──────────────────────────────────────────────────

test("zonder geconfigureerde sleutel wordt er geen zegel gezet", () => {
  const bewaard = process.env.AUDIT_HMAC_SLEUTEL;
  delete process.env.AUDIT_HMAC_SLEUTEL;
  try {
    assert.equal(hmacSleutel(), null);
    assert.equal(bouwInhoudZegel(VRAAG, ANTWOORD), null);
  } finally {
    if (bewaard !== undefined) process.env.AUDIT_HMAC_SLEUTEL = bewaard;
  }
});

test("met sleutel levert bouwInhoudZegel de drie kolommen", () => {
  const bewaardS = process.env.AUDIT_HMAC_SLEUTEL;
  const bewaardV = process.env.AUDIT_HMAC_SLEUTEL_VERSIE;
  process.env.AUDIT_HMAC_SLEUTEL = SLEUTEL;
  process.env.AUDIT_HMAC_SLEUTEL_VERSIE = "3";
  try {
    assert.deepEqual(bouwInhoudZegel(VRAAG, ANTWOORD), {
      inhoud_hmac: "f5e141e8d5f327f175ddac4dfe1b821faedc9945a0543a07562addb67558405e",
      hmac_schema_versie: 1,
      hmac_sleutel_versie: 3,
    });
  } finally {
    if (bewaardS !== undefined) process.env.AUDIT_HMAC_SLEUTEL = bewaardS;
    else delete process.env.AUDIT_HMAC_SLEUTEL;
    if (bewaardV !== undefined) process.env.AUDIT_HMAC_SLEUTEL_VERSIE = bewaardV;
    else delete process.env.AUDIT_HMAC_SLEUTEL_VERSIE;
  }
});

test("een onleesbare sleutelversie valt terug op 1 in plaats van NaN", () => {
  const bewaardS = process.env.AUDIT_HMAC_SLEUTEL;
  const bewaardV = process.env.AUDIT_HMAC_SLEUTEL_VERSIE;
  process.env.AUDIT_HMAC_SLEUTEL = SLEUTEL;
  process.env.AUDIT_HMAC_SLEUTEL_VERSIE = "niet-een-getal";
  try {
    assert.equal(hmacSleutel()?.versie, 1);
  } finally {
    if (bewaardS !== undefined) process.env.AUDIT_HMAC_SLEUTEL = bewaardS;
    else delete process.env.AUDIT_HMAC_SLEUTEL;
    if (bewaardV !== undefined) process.env.AUDIT_HMAC_SLEUTEL_VERSIE = bewaardV;
    else delete process.env.AUDIT_HMAC_SLEUTEL_VERSIE;
  }
});

console.log(`\n${n} sanity-tests geslaagd (audit-hmac).`);
