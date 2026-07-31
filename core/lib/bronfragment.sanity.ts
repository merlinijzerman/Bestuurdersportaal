// ============================================================================
//  Sanity-suite bij core/lib/bronfragment.ts
// ----------------------------------------------------------------------------
//  Draait mee in `npm run sanity` (glob op core/lib/*.sanity.ts) of los met
//  `npx tsx core/lib/bronfragment.sanity.ts`.
//
//  Waarom deze suite: het fragment is het citaat dat de bestuurder in de
//  hover-preview leest en dat in gesprekken.berichten én governance_log.bronnen
//  wordt bewaard. Een afkapregel die verschuift, verschuift dus het bewijsstuk.
// ============================================================================

import assert from "node:assert/strict";
import { bouwBronfragment, FRAGMENT_MAX } from "./bronfragment";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Korte tekst: ongewijzigd, en géén beletselteken ─────────────────────────
// Dit was de bevinding die de wijziging uitlokte: substring(0,150) + "..."
// plakte ook puntjes achter een chunk van veertig tekens.

test("korte tekst komt ongewijzigd terug, zonder beletselteken", () => {
  const t = "Het bestuur stelt de compensatieregeling vast.";
  assert.equal(bouwBronfragment(t), t);
});

test("tekst exact op de grens wordt niet afgekapt", () => {
  const t = "a".repeat(FRAGMENT_MAX);
  const uit = bouwBronfragment(t);
  assert.equal(uit, t);
  assert.ok(!uit.endsWith("…"));
});

test("lege en witruimte-tekst leveren een lege string", () => {
  assert.equal(bouwBronfragment(""), "");
  assert.equal(bouwBronfragment("   \n\t  "), "");
});

// ── Witruimte ───────────────────────────────────────────────────────────────

test("regeleindes en dubbele spaties worden genormaliseerd", () => {
  assert.equal(
    bouwBronfragment("Eerste regel.\n\n  Tweede   regel."),
    "Eerste regel. Tweede regel."
  );
});

// ── Zinsgrens ───────────────────────────────────────────────────────────────

test("kapt af op de laatste zinsgrens binnen de limiet", () => {
  const zin = "De commissie stelt vast dat de hoofdlijnen gereed zijn. ";
  const t = zin.repeat(10); // ruim over de limiet
  const uit = bouwBronfragment(t);
  assert.ok(uit.endsWith("gereed zijn. …"), `onverwacht einde: ${uit}`);
  assert.ok(uit.length <= FRAGMENT_MAX + 2);
});

// Governance-eis (review 31-07-2026): een zinsgrens is NIET hetzelfde als het
// einde van de brontekst. Zonder markering leest het citaat als compleet terwijl
// een voorbehoud of ontkenning in de volgende zin is weggevallen.
test("een citaat dat op een zinsgrens afkapt draagt tóch een afkapmarkering", () => {
  const eerste =
    "Het bestuur stelt de compensatieregeling per 1 januari 2027 vast, conform het " +
    "voorstel van de begeleidingscommissie en met inachtneming van het advies van de " +
    "actuaris over de gehanteerde parameters en de gevoeligheidsanalyse.";
  const tweede =
    " Deze regeling geldt uitdrukkelijk niet voor deelnemers die vóór 2020 zijn uitgetreden.";
  // Voorwaarden: de eerste zin haalt de zinsgrens-ondergrens en past binnen de
  // limiet, samen gaan ze eroverheen. Dan wint de zinsgrens-tak.
  assert.ok(eerste.length > FRAGMENT_MAX * 0.6 && eerste.length <= FRAGMENT_MAX);
  assert.ok((eerste + tweede).length > FRAGMENT_MAX);
  const uit = bouwBronfragment(eerste + tweede);
  assert.ok(uit.endsWith("…"), `geen afkapmarkering: ${uit}`);
  assert.ok(
    !uit.includes("niet voor deelnemers"),
    `de ontkennende zin hoort weggelaten te zijn: ${uit}`
  );
});

test("zinsgrens telt ook met sluitend aanhalingsteken", () => {
  const eerste =
    "Het verantwoordingsorgaan meldt dat het op basis van de nu voorliggende " +
    "onderbouwing geen positief advies kan afgeven en verzoekt om een " +
    "kwantitatieve uitwerking per cohort, inclusief de effecten per " +
    'leeftijdsgroep: "wij kunnen dit voorstel niet steunen."';
  // Voorwaarde van deze test: de eerste zin past binnen de limiet én haalt de
  // ondergrens, zodat de zinsgrens moet winnen van de woordgrens.
  assert.ok(eerste.length <= FRAGMENT_MAX && eerste.length > FRAGMENT_MAX * 0.6);
  // Vulling zónder leestekens, zodat de aanhalingsteken-zinsgrens de laatste
  // binnen het venster is.
  const uit = bouwBronfragment(`${eerste} ${"daarna volgt nog tekst ".repeat(8)}`);
  assert.ok(uit.endsWith('niet steunen." …'), `onverwacht einde: ${uit}`);
});

test("een te vroege zinsgrens verliest van de woordgrens", () => {
  // "Zie art. 3." eindigt al na ~11 tekens — ruim onder 60% van de limiet.
  const t = "Zie art. 3. " + "compensatie ".repeat(40);
  const uit = bouwBronfragment(t);
  assert.ok(uit.endsWith("…"), `verwachtte woordgrens-afkapping: ${uit}`);
  assert.ok(uit.length > FRAGMENT_MAX * 0.6);
});

// ── Woordgrens en beletselteken ─────────────────────────────────────────────

test("kapt af op woordgrens zonder half woord", () => {
  const t = "compensatieregeling ".repeat(40);
  const uit = bouwBronfragment(t);
  assert.ok(uit.endsWith("…"));
  const zonderPunt = uit.slice(0, -1);
  assert.ok(
    !zonderPunt.endsWith("compensatieregelin"),
    `half woord in: ${zonderPunt.slice(-30)}`
  );
  assert.ok(uit.length <= FRAGMENT_MAX + 1);
});

test("geen dubbele leestekens vóór het beletselteken", () => {
  const t = "een lange zin met veel komma's, ".repeat(20);
  const uit = bouwBronfragment(t);
  assert.ok(!/[,;:.]…$/.test(uit), `leesteken vóór het beletselteken: ${uit}`);
});

test("één lang woord zonder spaties wordt hard afgekapt", () => {
  const t = "x".repeat(FRAGMENT_MAX * 2);
  const uit = bouwBronfragment(t);
  assert.equal(uit.length, FRAGMENT_MAX + 1); // FRAGMENT_MAX tekens + het beletselteken
  assert.ok(uit.endsWith("…"));
});

// ── Determinisme ────────────────────────────────────────────────────────────

test("dezelfde invoer levert altijd dezelfde uitvoer", () => {
  const t = "De invaarmethodiek wordt in september vastgesteld. ".repeat(12);
  const a = bouwBronfragment(t);
  const b = bouwBronfragment(t);
  const c = bouwBronfragment(t);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("een eigen maximum wordt gerespecteerd", () => {
  const t = "woord ".repeat(100);
  assert.ok(bouwBronfragment(t, 50).length <= 51);
});

console.log(`\n${n} sanity-tests geslaagd.`);
