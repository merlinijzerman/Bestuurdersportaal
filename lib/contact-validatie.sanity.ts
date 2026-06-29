// ============================================================
//  Sanity-tests voor de contactformulier-validatie (W2a).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/contact-validatie.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  valideerContact,
  VELD_MAX,
  TYPE_VERZOEK_OPTIES,
  type ContactInvoer,
} from "./contact-validatie";

const geldig: ContactInvoer = {
  naam: "Jan Bestuurder",
  organisatie: "Stichting Pensioenfonds Horizon",
  rol: "Voorzitter",
  email: "jan@example.com",
  telefoon: "",
  type_verzoek: "demo",
  bericht: "Graag een demo inplannen.",
};

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("contact-validatie sanity-tests:");

test("volledige geldige invoer wordt geaccepteerd en genormaliseerd", () => {
  const r = valideerContact(geldig);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.schoon.naam, "Jan Bestuurder");
    assert.equal(r.schoon.telefoon, null); // lege telefoon → null
    assert.equal(r.schoon.type_verzoek, "demo");
  }
});

test("witruimte wordt getrimd; spaties-only telt als leeg", () => {
  const r = valideerContact({ ...geldig, naam: "   ", email: "  a@b.co " });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.naam);
  const r2 = valideerContact({ ...geldig, email: "  a@b.co " });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.schoon.email, "a@b.co");
});

test("ontbrekende verplichte velden geven per-veld een fout", () => {
  const r = valideerContact({});
  assert.equal(r.ok, false);
  if (!r.ok) {
    for (const veld of ["naam", "organisatie", "rol", "email", "type", "bericht"] as const) {
      assert.ok(r.fouten[veld], `verwacht fout voor ${veld}`);
    }
    assert.equal(r.fouten.telefoon, undefined); // telefoon optioneel
  }
});

test("ongeldig e-mailformaat wordt geweigerd", () => {
  for (const slecht of ["geenapenstaart", "a@b", "a b@c.nl", "@c.nl", "a@.nl"]) {
    const r = valideerContact({ ...geldig, email: slecht });
    assert.equal(r.ok, false, `${slecht} hoort ongeldig`);
  }
});

test("alle type_verzoek-enumwaarden zijn geldig; vreemde waarde niet", () => {
  for (const t of TYPE_VERZOEK_OPTIES) {
    assert.equal(valideerContact({ ...geldig, type_verzoek: t }).ok, true);
  }
  const r = valideerContact({ ...geldig, type_verzoek: "spam" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.type);
});

test("te lange velden worden geweigerd (lengtegrenzen)", () => {
  const lang = "x".repeat(VELD_MAX.bericht + 1);
  const r = valideerContact({ ...geldig, bericht: lang });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.bericht);

  const langeNaam = "y".repeat(VELD_MAX.naam + 1);
  assert.equal(valideerContact({ ...geldig, naam: langeNaam }).ok, false);
});

test("niet-string invoer (injectiepoging) wordt veilig als leeg behandeld", () => {
  const r = valideerContact({
    ...geldig,
    naam: { toString: () => "x" } as unknown,
    email: ["a@b.co"] as unknown,
  });
  assert.equal(r.ok, false); // objecten/arrays → leeg → verplicht-fout
});

console.log(`\n${n} sanity-tests geslaagd.`);
