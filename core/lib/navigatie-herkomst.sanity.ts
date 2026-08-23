// ============================================================================
//  Sanity-tests voor core/lib/navigatie-herkomst.ts (H-04).
//
//  Geen testframework; standalone met assert. Uitvoeren:
//    npx tsx core/lib/navigatie-herkomst.sanity.ts
//  `npm run sanity` pakt dit bestand automatisch op en draait mee in de
//  verplichte check "Security baseline (Sprint 1)".
//
//  WAT HIER HARD MOET STAAN
//  Deze functie is de enige plek waar wordt beslist of een auditrecord wordt
//  geschreven. Twee fouten zijn allebei duur en ze wijzen tegengesteld:
//
//    te streng  → een bestuurder op een oudere browser kan geen document meer
//                 openen, en het inzagelogboek krijgt gaten;
//    te soepel  → een aanvaller schrijft een inzage-gebeurtenis in het dossier
//                 van iemand anders, en dat spoor is bewijsmateriaal.
//
//  De tests hieronder pinnen daarom niet alleen de blokkade maar ook élke
//  doorlaat-tak MÉT zijn herkomstwaarde. Een herkomst die stilletjes verschuift
//  van "niet_verifieerbaar" naar "eigen_surface" is geen cosmetische wijziging:
//  dan beweert het auditspoor iets wat niet is vastgesteld.
// ============================================================================
import assert from "node:assert/strict";
import { beoordeelNavigatieHerkomst, crossSiteGeweigerd } from "./navigatie-herkomst";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

/** Minimale Request met (optioneel) de fetch-metadata-header. */
function verzoek(secFetchSite?: string): Request {
  return new Request("https://app.bestuurdersportaal.com/api/documents/x/bestand", {
    headers: secFetchSite === undefined ? {} : { "sec-fetch-site": secFetchSite },
  });
}

console.log("navigatie-herkomst (H-04) — sanity");

test("cross-site wordt geweigerd", () => {
  const o = beoordeelNavigatieHerkomst(verzoek("cross-site"));
  assert.equal(o.toegestaan, false);
  assert.equal(o.toegestaan === false && o.reden, "cross-site");
});

test("same-origin telt als eigen vlak", () => {
  const o = beoordeelNavigatieHerkomst(verzoek("same-origin"));
  assert.equal(o.toegestaan, true);
  assert.equal(o.toegestaan === true && o.herkomst, "eigen_surface");
});

test("same-site telt als eigen vlak (fondssubdomeinen)", () => {
  const o = beoordeelNavigatieHerkomst(verzoek("same-site"));
  assert.equal(o.toegestaan, true);
  assert.equal(o.toegestaan === true && o.herkomst, "eigen_surface");
});

test('"none" is de gebruiker zelf, geen aanvallerspagina', () => {
  const o = beoordeelNavigatieHerkomst(verzoek("none"));
  assert.equal(o.toegestaan, true);
  assert.equal(o.toegestaan === true && o.herkomst, "directe_navigatie");
});

test("ontbrekende header: doorlaten, maar gemarkeerd als niet verifieerbaar", () => {
  const o = beoordeelNavigatieHerkomst(verzoek());
  assert.equal(o.toegestaan, true, "fail-closed zou legitieme oudere browsers buitensluiten");
  assert.equal(o.toegestaan === true && o.herkomst, "niet_verifieerbaar");
});

test("onbekende toekomstige waarde valt in dezelfde tak als ontbrekend", () => {
  const o = beoordeelNavigatieHerkomst(verzoek("iets-nieuws-uit-de-spec"));
  assert.equal(o.toegestaan, true);
  assert.equal(
    o.toegestaan === true && o.herkomst,
    "niet_verifieerbaar",
    "een onbekende waarde mag NOOIT als eigen_surface gelden"
  );
});

test("hoofdletterongevoelig: headers zijn dat per definitie", () => {
  const req = new Request("https://app.bestuurdersportaal.com/x", {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(beoordeelNavigatieHerkomst(req).toegestaan, false);
});

test("de weigering is 403 met een leesbare boodschap, geen 401", () => {
  const res = crossSiteGeweigerd("test.route");
  assert.equal(res.status, 403, "401 zou suggereren dat er iets mis is met de sessie");
});

console.log(`\n${n} sanity-tests groen.`);
