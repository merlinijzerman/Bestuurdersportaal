// ============================================================================
//  Sanity-tests voor platform/lib/ai-begrenzing-invoer.ts (besluit 0180).
//
//  Pint de invoerregels van de beheeracties: een verplichte reden is echt
//  verplicht, een quotum is een geheel getal binnen realistische grenzen, en een
//  tijdelijk modelvenster is heel, loopt vooruit en draagt een motivering.
//
//  Deze laag is de VRIENDELIJKE voorcheck; de database toetst hetzelfde nog een
//  keer via CHECK-constraints en de RPC's. Dat de twee dezelfde grenzen kennen
//  is precies wat hier wordt vastgelegd.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx platform/lib/ai-begrenzing-invoer.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  MAX_QUOTUM,
  MIN_REDEN,
  isQuotumSleutel,
  isSchakelaar,
  valideerAllowlist,
  valideerQuotum,
  valideerReden,
} from "./ai-begrenzing-invoer";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Sleutels ────────────────────────────────────────────────────────────────

test("Alleen de vier bekende schakelaars worden geaccepteerd", () => {
  for (const s of ["globaal", "anthropic", "mistral", "openai"]) {
    assert.equal(isSchakelaar(s), true, s);
  }
  assert.equal(isSchakelaar("alles"), false);
  assert.equal(isSchakelaar(""), false);
});

test("Alleen de vier bekende quotumsleutels worden geaccepteerd", () => {
  assert.equal(isQuotumSleutel("gebruiker_maand"), true);
  assert.equal(isQuotumSleutel("ocr_fonds_maand"), true);
  assert.equal(isQuotumSleutel("onbeperkt"), false);
});

// ── Reden ───────────────────────────────────────────────────────────────────

test("Een lege of te korte reden wordt geweigerd", () => {
  assert.equal(valideerReden("", "een stop").ok, false);
  assert.equal(valideerReden("   ", "een stop").ok, false);
  assert.equal(valideerReden("te kort", "een stop").ok, false);
  assert.equal(valideerReden(null, "een stop").ok, false);
});

test("Een reden op de grens van 10 tekens mag", () => {
  const r = valideerReden("1234567890", "een stop");
  assert.equal(r.ok, true);
  assert.equal(MIN_REDEN, 10);
});

test("Witruimte telt niet mee als inhoud", () => {
  // Anders zou "          " een geldige auditreden zijn.
  assert.equal(valideerReden("     " + "abc" + "     ", "een stop").ok, false);
});

test("Een geldige reden komt getrimd terug", () => {
  const r = valideerReden("  Kosten liepen op.  ", "een stop");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.waarde, "Kosten liepen op.");
});

// ── Quotum ──────────────────────────────────────────────────────────────────

test("Nul is een geldig quotum en betekent dicht", () => {
  const r = valideerQuotum("0");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.waarde, 0);
});

test("Een negatief quotum wordt geweigerd", () => {
  assert.equal(valideerQuotum("-1").ok, false);
});

test("Een gebroken getal wordt geweigerd", () => {
  // Een half AI-actiequotum bestaat niet.
  assert.equal(valideerQuotum("1.5").ok, false);
  assert.equal(valideerQuotum("1,5").ok, false);
});

test("Een komma als decimaalteken op een geheel getal mag", () => {
  const r = valideerQuotum("150,0");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.waarde, 150);
});

test("Een lege waarde en onzin worden geweigerd", () => {
  assert.equal(valideerQuotum("").ok, false);
  assert.equal(valideerQuotum("veel").ok, false);
  assert.equal(valideerQuotum(null).ok, false);
});

test("De bovengrens vangt een misplaatste nul af", () => {
  assert.equal(valideerQuotum(String(MAX_QUOTUM)).ok, true);
  assert.equal(valideerQuotum(String(MAX_QUOTUM + 1)).ok, false);
});

// ── Allowlist ───────────────────────────────────────────────────────────────

const basis = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  actief: true,
  vensterStart: null,
  vensterEind: null,
  reden: null,
};

test("Een model zonder venster heeft geen reden nodig", () => {
  const r = valideerAllowlist(basis);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.waarde.vensterStart, null);
});

test("Een onbekende provider wordt geweigerd", () => {
  assert.equal(valideerAllowlist({ ...basis, provider: "cohere" }).ok, false);
});

test("Een leeg model-id wordt geweigerd", () => {
  assert.equal(valideerAllowlist({ ...basis, model: "  " }).ok, false);
});

test("Een half venster wordt geweigerd", () => {
  assert.equal(
    valideerAllowlist({ ...basis, vensterStart: "2026-08-15T10:00", vensterEind: null }).ok,
    false
  );
  assert.equal(
    valideerAllowlist({ ...basis, vensterStart: null, vensterEind: "2026-08-15T14:00" }).ok,
    false
  );
});

test("Een venster dat achteruit loopt wordt geweigerd", () => {
  assert.equal(
    valideerAllowlist({
      ...basis,
      vensterStart: "2026-08-15T14:00",
      vensterEind: "2026-08-15T10:00",
      reden: "Intern AQLab-testvenster augustus.",
    }).ok,
    false
  );
});

test("Een venster van nul lengte wordt geweigerd", () => {
  assert.equal(
    valideerAllowlist({
      ...basis,
      vensterStart: "2026-08-15T10:00",
      vensterEind: "2026-08-15T10:00",
      reden: "Intern AQLab-testvenster augustus.",
    }).ok,
    false
  );
});

test("Een tijdelijk venster ZONDER reden wordt geweigerd", () => {
  // Een tijdelijke uitzondering zonder motivering is niet auditbaar.
  assert.equal(
    valideerAllowlist({
      ...basis,
      model: "mistral-large-latest",
      provider: "mistral",
      vensterStart: "2026-08-15T10:00",
      vensterEind: "2026-08-15T14:00",
      reden: null,
    }).ok,
    false
  );
});

test("Een compleet, gemotiveerd AQLab-venster wordt geaccepteerd", () => {
  const r = valideerAllowlist({
    ...basis,
    provider: "mistral",
    model: "mistral-large-latest",
    vensterStart: "2026-08-15T10:00",
    vensterEind: "2026-08-15T14:00",
    reden: "Intern AQLab-testvenster, synthetische data.",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.waarde.model, "mistral-large-latest");
    assert.ok(r.waarde.reden && r.waarde.reden.length >= MIN_REDEN);
  }
});

console.log(`\n${n} ai-begrenzing-invoer sanity-tests geslaagd.`);
