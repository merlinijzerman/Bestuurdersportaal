// ============================================================
//  Sanity-tests voor het wijzigen van een risico (besluit 0141).
//
//  Wat hier bevroren wordt:
//   • Redenplicht geldt op kans/impact/niveau/niveau_handmatig en NERGENS
//     anders. Een titel corrigeren mag zonder motivering; zou dat kantelen,
//     dan levert dat lege redenen op die het auditspoor vervuilen.
//   • `niveau` wordt server-side AFGELEID uit kans × impact tenzij
//     `niveau_handmatig` aanstaat — nooit blind van de client overgenomen.
//   • Een wijziging zonder feitelijk verschil is geen wijziging (geen lege
//     auditregels).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/risico-wijziging.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  WEEGVELDEN,
  bouwRisicoWijziging,
  isWeegveld,
  type RisicoHuidig,
} from "./risico-wijziging";
import { leidNiveauAf } from "./risico-config";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("risico-wijziging sanity-tests:");

/** Een bestaand risico: kans 3 × impact 4 = 7 → middel. */
function risico(over: Partial<RisicoHuidig> = {}): RisicoHuidig {
  return {
    titel: "Renterisico",
    toelichting: "Blootstelling aan rentebewegingen.",
    categorie: "financieel_actuarieel",
    kans: 3,
    impact: 4,
    niveau: "middel",
    niveau_handmatig: false,
    type_risico: "structureel",
    eigenaar_naam: "A. de Vries",
    volgende_beoordeling: "2026-12-01",
    ...over,
  };
}

// ── Redenplicht ─────────────────────────────────────────────────────────────

test("de weegvelden zijn precies kans, impact, niveau en niveau_handmatig", () => {
  assert.deepEqual([...WEEGVELDEN].sort(), [
    "impact",
    "kans",
    "niveau",
    "niveau_handmatig",
  ]);
});

test("titel wijzigen mag ZONDER motivering", () => {
  const r = bouwRisicoWijziging(risico(), { titel: "Renterisico (herzien)" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.gewijzigdeVelden, ["titel"]);
    assert.equal(r.raaktWeging, false);
    assert.equal(r.reden, null);
  }
});

test("toelichting, eigenaar, type, categorie en datum vragen geen motivering", () => {
  const r = bouwRisicoWijziging(risico(), {
    toelichting: "Anders geformuleerd.",
    eigenaar_naam: "B. Jansen",
    type_risico: "tijdelijk",
    categorie: "governance_organisatie",
    volgende_beoordeling: "2027-01-01",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.raaktWeging, false);
});

test("kans wijzigen ZONDER motivering wordt geweigerd", () => {
  const r = bouwRisicoWijziging(risico(), { kans: 5 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.foutcode, "reden_verplicht");
    assert.match(r.melding, /kans/i);
    assert.match(r.melding, /heatmap/i);
  }
});

test("kans wijzigen MET motivering slaagt en markeert de weging", () => {
  const r = bouwRisicoWijziging(risico(), {
    kans: 5,
    reden: "Renteschok Q3 waargenomen; kans herijkt in ALM-studie.",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.raaktWeging, true);
    assert.equal(r.reden, "Renteschok Q3 waargenomen; kans herijkt in ALM-studie.");
  }
});

test("een lege of witruimte-motivering telt niet als motivering", () => {
  for (const reden of ["", "   ", undefined]) {
    const r = bouwRisicoWijziging(risico(), { impact: 5, reden });
    assert.equal(r.ok, false, `reden ${JSON.stringify(reden)} zou moeten falen`);
  }
});

test("niveau_handmatig omzetten telt als weging — het ontkoppelt van kans × impact", () => {
  const r = bouwRisicoWijziging(risico(), { niveau_handmatig: true, niveau: "hoog" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "reden_verplicht");
});

// ── Niveau-afleiding ────────────────────────────────────────────────────────

test("niveau volgt kans × impact zolang niveau_handmatig uitstaat", () => {
  const r = bouwRisicoWijziging(risico(), { kans: 5, impact: 5, reden: "herijkt" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.update.niveau, "hoog");
    assert.equal(r.update.niveau, leidNiveauAf(5, 5));
  }
});

test("een door de client meegestuurd niveau wordt GENEGEERD zonder niveau_handmatig", () => {
  // Regressiepin: anders kan een client het niveau loskoppelen van de heatmap
  // zonder dat iemand daar bewust voor kiest.
  const r = bouwRisicoWijziging(risico(), { kans: 1, impact: 1, niveau: "hoog", reden: "x" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.update.niveau, "laag");
});

test("met niveau_handmatig telt het aangeleverde niveau wél", () => {
  const r = bouwRisicoWijziging(risico(), {
    niveau_handmatig: true,
    niveau: "hoog",
    reden: "Bestuur weegt reputatie-effect zwaarder dan de formule.",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.update.niveau, "hoog");
});

test("niveau wordt bijgewerkt als kans verandert, ook zonder dat niveau is meegestuurd", () => {
  const r = bouwRisicoWijziging(risico({ kans: 1, impact: 1, niveau: "laag" }), {
    kans: 5,
    impact: 5,
    reden: "herijkt",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual([...r.gewijzigdeVelden].sort(), ["impact", "kans", "niveau"]);
});

// ── Validatie ───────────────────────────────────────────────────────────────

test("kans of impact buiten 1–5 wordt geweigerd", () => {
  for (const invoer of [{ kans: 0 }, { kans: 6 }, { impact: 0 }, { impact: 6 }]) {
    const r = bouwRisicoWijziging(risico(), { ...invoer, reden: "x" });
    assert.equal(r.ok, false);
  }
});

test("een niet-geheel getal wordt geweigerd", () => {
  const r = bouwRisicoWijziging(risico(), { kans: 3.5, reden: "x" });
  assert.equal(r.ok, false);
});

test("een lege titel wordt geweigerd", () => {
  const r = bouwRisicoWijziging(risico(), { titel: "   " });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "titel_leeg");
});

test("een onbekende categorie of type wordt geweigerd", () => {
  assert.equal(bouwRisicoWijziging(risico(), { categorie: "verzonnen" }).ok, false);
  assert.equal(bouwRisicoWijziging(risico(), { type_risico: "verzonnen" }).ok, false);
});

test("een ongeldige datum wordt geweigerd, leegmaken mag wel", () => {
  assert.equal(bouwRisicoWijziging(risico(), { volgende_beoordeling: "01-12-2026" }).ok, false);
  const leeg = bouwRisicoWijziging(risico(), { volgende_beoordeling: "" });
  assert.equal(leeg.ok, true);
  if (leeg.ok) assert.equal(leeg.update.volgende_beoordeling, null);
});

// ── Geen schijnwijziging ────────────────────────────────────────────────────

test("dezelfde waarden opsturen levert GEEN wijziging op", () => {
  const h = risico();
  const r = bouwRisicoWijziging(h, {
    titel: h.titel,
    kans: h.kans,
    impact: h.impact,
    categorie: h.categorie,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "geen_wijziging");
});

test("witruimte rond een ongewijzigde titel telt niet als wijziging", () => {
  const r = bouwRisicoWijziging(risico(), { titel: "  Renterisico  " });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "geen_wijziging");
});

test("de diff draagt oude én nieuwe waarde, voor het logboek", () => {
  const r = bouwRisicoWijziging(risico(), { kans: 5, reden: "herijkt" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.diff.kans, { oud: 3, nieuw: 5 });
    assert.deepEqual(r.diff.niveau, { oud: "middel", nieuw: "hoog" });
  }
});

test("isWeegveld is consistent met WEEGVELDEN", () => {
  assert.equal(isWeegveld("kans"), true);
  assert.equal(isWeegveld("titel"), false);
});

console.log(`\n${n} sanity-tests geslaagd.\n`);
