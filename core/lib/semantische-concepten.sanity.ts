// ============================================================================
//  Sanity-tests voor de semantische-extractie-kern (T8).
// ----------------------------------------------------------------------------
//  Borgt de faalpatroon-werkstromen uit S1 programmatisch: normalisatie (percentage/
//  datum/bedrag/policy), bron-verankering (evidenceVerbatim), negatie-/polariteit-
//  guard (bindingNegated), ontdubbeling, catalogus-versie-determinisme en de flag-/
//  strategie-resolutie. Puur, geen DB/SDK.
//
//  Uitvoeren: npx tsx core/lib/semantische-concepten.sanity.ts  (of npm run sanity)
// ============================================================================

import assert from "node:assert/strict";
import {
  actieveConcepten,
  bindingNegated,
  bouwKandidaatUnits,
  catalogusVersie,
  evidenceVerbatim,
  normaliseerBedrag,
  normaliseerDatum,
  normaliseerPercentage,
  normaliseerPolicy,
  ontdubbel,
  parseConcept,
  resolveStrategie,
  type ActiefConcept,
  type ConceptRij,
  type EnumWaarde,
  type KandidaatUnit,
} from "./semantische-concepten";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Catalogus-fixtures ──────────────────────────────────────────────────────
const RIJ_BOVENGRENS: ConceptRij = {
  id: "c-boven",
  key: "solidariteitsreserve.bovengrens",
  label: "Bovengrens solidariteitsreserve",
  type: "percentage",
  status: "actief",
  normalization: { omschrijving: "De BOVENGRENS van de solidariteitsreserve." },
};
const RIJ_FRANCHISE: ConceptRij = {
  id: "c-franchise",
  key: "franchise",
  label: "Franchise",
  type: "amount",
  status: "actief",
  normalization: { omschrijving: "De franchise in euro's." },
};
const ENUMS_INVAAR: EnumWaarde[] = [
  { waarde: "standaard", trefwoorden: ["standaardmethode", "standaard methode", "value-based", "standaard"] },
  { waarde: "individueel", trefwoorden: ["individuele methode", "individuele methodiek", "individueel"] },
];
const RIJ_INVAAR: ConceptRij = {
  id: "c-invaar",
  key: "invaarmethodiek",
  label: "Invaarmethodiek",
  type: "policy_choice",
  status: "conditioneel",
  normalization: { omschrijving: "De gekozen invaarmethodiek.", enums: ENUMS_INVAAR },
};
const RIJ_TRANSITIE: ConceptRij = {
  id: "c-transitie",
  key: "transitiedatum",
  label: "Transitiedatum",
  type: "date",
  status: "uitgesteld",
  normalization: null,
};
const ALLE_RIJEN = [RIJ_BOVENGRENS, RIJ_FRANCHISE, RIJ_INVAAR, RIJ_TRANSITIE];

// ── Normalisatie ────────────────────────────────────────────────────────────
test("percentage: diverse notaties → fractie", () => {
  assert.equal(normaliseerPercentage("6,0%").value, 0.06);
  assert.equal(normaliseerPercentage("5,7%").value, 0.057);
  assert.equal(normaliseerPercentage("zes procent").value, 0.06);
  assert.equal(normaliseerPercentage("0,06").value, 0.06);
  assert.equal(normaliseerPercentage("geen getal").ok, false);
});

test("bedrag: duizendtal/spatie/komma + currency", () => {
  const a = normaliseerBedrag("€ 17.545");
  assert.equal(a.value, 17545);
  assert.equal(a.currency, "EUR");
  assert.equal(normaliseerBedrag("17 545 euro").value, 17545);
  assert.equal(normaliseerBedrag("1.234,56").value, 1234.56);
  assert.equal(normaliseerBedrag("501 miljoen").value, 501_000_000);
});

test("datum: NL-notaties → ISO", () => {
  assert.equal(normaliseerDatum("1 januari 2028").value, "2028-01-01");
  assert.equal(normaliseerDatum("01-01-2028").value, "2028-01-01");
  assert.equal(normaliseerDatum("2027-07-01").value, "2027-07-01");
  assert.equal(normaliseerDatum("ergens ooit").ok, false);
});

test("policy: eenduidig → enum, dubbel → ambigu", () => {
  assert.equal(normaliseerPolicy(ENUMS_INVAAR, "de standaardmethode", "…").value, "standaard");
  assert.equal(normaliseerPolicy(ENUMS_INVAAR, "individuele methode", "…").value, "individueel");
  // Beide woorden aanwezig in raw → ambigu → mislukt (geen valse binding).
  assert.equal(normaliseerPolicy(ENUMS_INVAAR, "standaardmethode vs individuele methode", "…").ok, false);
});

// ── Bron-verankering ────────────────────────────────────────────────────────
test("evidenceVerbatim: reflow-tolerant, mist afwezige zin", () => {
  const bron = "Artikel 3\nDe bovengrens bedraagt   6,0%\nvan het vermogen.";
  assert.equal(evidenceVerbatim("De bovengrens bedraagt 6,0%", bron), true);
  assert.equal(evidenceVerbatim("De ondergrens bedraagt 3,0%", bron), false);
});

// ── Negatie-/polariteitsguard ───────────────────────────────────────────────
test("bindingNegated: ontkende binding gedetecteerd", () => {
  assert.equal(
    bindingNegated("De individuele methode wordt niet toegepast.", ["individuele methode", "individueel"]),
    true
  );
  assert.equal(
    bindingNegated("De standaardmethode wordt gehanteerd.", ["standaardmethode", "standaard"]),
    false
  );
  // Twee deelzinnen: negatie geldt alleen de individuele, niet de standaard.
  const zin = "De standaardmethode wordt gehanteerd, de individuele methode niet.";
  assert.equal(bindingNegated(zin, ["standaardmethode", "standaard"]), false);
  assert.equal(bindingNegated(zin, ["individuele methode", "individueel"]), true);
  // Diskwalificatie ("als kritieke fout").
  assert.equal(bindingNegated("De waarde INDIVIDUEEL geldt als kritieke fout.", ["individueel"]), true);
});

// ── Catalogus-parsing + versie ──────────────────────────────────────────────
test("parseConcept: omschrijving + enums, fallback label", () => {
  const boven = parseConcept(RIJ_BOVENGRENS);
  assert.equal(boven.type, "percentage");
  assert.match(boven.omschrijving, /BOVENGRENS/);
  const invaar = parseConcept(RIJ_INVAAR);
  assert.equal(invaar.enums.length, 2);
  // Geen normalization → omschrijving valt terug op label.
  const kaal = parseConcept({ ...RIJ_TRANSITIE, normalization: null });
  assert.equal(kaal.omschrijving, "Transitiedatum");
});

test("actieveConcepten: 'uitgesteld' valt buiten (transitiedatum niet geëxtraheerd)", () => {
  const actief = actieveConcepten(ALLE_RIJEN);
  const keys = actief.map((c) => c.key).sort();
  assert.deepEqual(keys, ["franchise", "invaarmethodiek", "solidariteitsreserve.bovengrens"]);
  assert.equal(
    actief.some((c) => c.key === "transitiedatum"),
    false
  );
});

test("catalogusVersie: deterministisch, volgorde-onafhankelijk, statusgevoelig", () => {
  const v1 = catalogusVersie(ALLE_RIJEN);
  const v2 = catalogusVersie([...ALLE_RIJEN].reverse());
  assert.equal(v1, v2);
  assert.match(v1, /^cat-[0-9a-f]{16}$/);
  // Statusflip (transitiedatum actief) → andere versie.
  const gewijzigd = ALLE_RIJEN.map((r) =>
    r.key === "transitiedatum" ? { ...r, status: "actief" } : r
  );
  assert.notEqual(v1, catalogusVersie(gewijzigd));
});

// ── Kandidaatbouw + ontdubbeling ────────────────────────────────────────────
const BOVEN: ActiefConcept = parseConcept(RIJ_BOVENGRENS);
const INVAAR: ActiefConcept = parseConcept(RIJ_INVAAR);

test("bouwKandidaatUnits: percentage → value_num + '%', evidence_verified", () => {
  const chunk = {
    id: "chunk-1",
    tekst: "De bovengrens bedraagt 6,0% van het vermogen.",
    pagina: 37,
    paragraaf: "§3",
    structuur_label: "Artikel 3",
  };
  const units = bouwKandidaatUnits({
    concept: BOVEN,
    chunk,
    voorkomens: [{ value_raw: "6,0%", evidence: "De bovengrens bedraagt 6,0%", model_confidence: "hoog" }],
    documentStatus: "van_kracht",
  });
  assert.equal(units.length, 1);
  assert.equal(units[0].value_num, 0.06);
  assert.equal(units[0].value_unit, "%");
  assert.equal(units[0].page, 37);
  assert.equal(units[0].evidence_verified, true);
  assert.equal(units[0].document_status, "van_kracht");
  assert.equal(units[0].chunk_id, "chunk-1");
});

test("bouwKandidaatUnits: ontkende policy-binding wordt gedropt", () => {
  const chunk = {
    id: "chunk-2",
    tekst: "De individuele methode wordt niet toegepast; de standaardmethode geldt.",
    pagina: 4,
    paragraaf: null,
    structuur_label: null,
  };
  // Model bindt ten onrechte 'individueel' met een ontkennende evidence → guard dropt.
  const gedropt = bouwKandidaatUnits({
    concept: INVAAR,
    chunk,
    voorkomens: [
      { value_raw: "individuele methode", evidence: "De individuele methode wordt niet toegepast", model_confidence: "midden" },
    ],
    documentStatus: "van_kracht",
  });
  assert.equal(gedropt.length, 0);
  // De correcte binding op 'standaard' blijft.
  const behouden = bouwKandidaatUnits({
    concept: INVAAR,
    chunk,
    voorkomens: [{ value_raw: "standaardmethode", evidence: "de standaardmethode geldt", model_confidence: "hoog" }],
    documentStatus: "van_kracht",
  });
  assert.equal(behouden.length, 1);
  assert.equal(behouden[0].value_text, "standaard");
});

test("bouwKandidaatUnits: onnormaliseerbare waarde wordt gedropt", () => {
  const units = bouwKandidaatUnits({
    concept: BOVEN,
    chunk: { id: "c", tekst: "onzin", pagina: null, paragraaf: null, structuur_label: null },
    voorkomens: [{ value_raw: "geen getal hier", evidence: "onzin", model_confidence: "laag" }],
    documentStatus: null,
  });
  assert.equal(units.length, 0);
});

test("ontdubbel: zelfde waarde → één unit; verschillende waarden → apart", () => {
  const basis = (value_raw: string, evidence: string, verified: boolean): KandidaatUnit => ({
    concept_id: "c-boven",
    type: "percentage",
    chunk_id: "x",
    statement: evidence,
    value_raw,
    value_num: Number(value_raw.replace("%", "").replace(",", ".")) / 100,
    value_date: null,
    value_text: null,
    value_unit: "%",
    page: 1,
    section: null,
    evidence,
    evidence_verified: verified,
    confidence_signals: { model_confidence: verified ? "hoog" : "laag" },
    document_status: "van_kracht",
  });
  // Zelfde 6,0% uit twee formuleringen → één (de geverifieerde wint).
  const zelfde = ontdubbel([basis("6,0%", "bron A niet-verbatim", false), basis("6,0%", "bron B", true)]);
  assert.equal(zelfde.length, 1);
  assert.equal(zelfde[0].evidence_verified, true);
  // Twee verschillende waarden (conflict) → twee units.
  const verschillend = ontdubbel([basis("6,0%", "a", true), basis("5,5%", "b", true)]);
  assert.equal(verschillend.length, 2);
});

// ── Flag / strategie ────────────────────────────────────────────────────────
test("resolveStrategie: default + onbekend → lui", () => {
  assert.equal(resolveStrategie(undefined), "lui");
  assert.equal(resolveStrategie("lui"), "lui");
  assert.equal(resolveStrategie("type_scoped"), "type_scoped");
  assert.equal(resolveStrategie("beide"), "beide");
  assert.equal(resolveStrategie("gek"), "lui");
});

console.log(`\n${n} sanity-checks groen (semantische-concepten).`);
