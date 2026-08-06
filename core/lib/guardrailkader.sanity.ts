// ============================================================
//  Sanity-tests voor core/lib/guardrailkader.ts (T3, plateau A).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/guardrailkader.sanity.ts
//
//  Verifieert:
//   • de canonieke lijst G1..G23 is compleet, uniek en op volgorde;
//   • FR-20 / kernregel §7.2: geen compliance-relevante guardrail zit UITSLUITEND
//     in klasse M zonder aanvaard restrisico (schendtKernregel() is leeg);
//   • elke guardrail heeft per gedeclareerde klasse ten minste één toets;
//   • een M-leunende guardrail zonder H/D heeft een restrisico mét besluit;
//   • sha256-pin: de matrix is byte-identiek aan de gepinde snapshot. Kantelt de
//     hash, dan is de canonieke §7.3 gewijzigd — dat vergt een decisions/-entry
//     (§7.8). Bereken de nieuwe waarde bewust, neem hem niet over uit een foutmelding.
// ============================================================

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  GUARDRAILKADER,
  schendtKernregel,
  guardrailsMetModelgedrag,
  aftekenAard,
  type Guardrail,
  type Klasse,
} from "./guardrailkader";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("guardrailkader sanity-tests:");

// ── Compleetheid + volgorde ─────────────────────────────────────────────────
check("de matrix telt precies 23 guardrails, G1..G23 op volgorde", () => {
  const verwacht = Array.from({ length: 23 }, (_, i) => `G${i + 1}`);
  assert.deepEqual(GUARDRAILKADER.map((g) => g.id), verwacht);
});

check("guardrail-id's zijn uniek", () => {
  const ids = GUARDRAILKADER.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ── FR-20 / kernregel §7.2 ──────────────────────────────────────────────────
check("KERNREGEL §7.2: geen compliance-relevante guardrail uitsluitend in klasse M (FR-20)", () => {
  const schenders = schendtKernregel();
  assert.deepEqual(
    schenders.map((g) => g.id),
    [],
    `Guardrail(s) uitsluitend in klasse M zonder H/D-tegenhanger of aanvaard restrisico: ${schenders
      .map((g) => g.id)
      .join(", ")}`
  );
});

check("elk aanvaard restrisico draagt een besluit-referentie (§7.2)", () => {
  for (const g of GUARDRAILKADER) {
    if (g.restrisico) {
      assert.ok(g.restrisico.besluit.trim().length > 0, `${g.id}: restrisico zonder besluit`);
      assert.ok(g.restrisico.reden.trim().length > 0, `${g.id}: restrisico zonder reden`);
    }
  }
});

check("G19 is het enige geval dat UITSLUITEND op klasse M leunt, met aanvaard restrisico", () => {
  const alleenM = GUARDRAILKADER.filter(
    (g) => g.klassen.length === 1 && g.klassen[0] === "M"
  );
  assert.deepEqual(alleenM.map((g) => g.id), ["G19"]);
  assert.ok(alleenM[0].restrisico, "G19 zonder aanvaard restrisico — dan schendt hij de kernregel");
});

// ── Toetsdekking per klasse (herleidbaarheid) ───────────────────────────────
check("elke guardrail heeft per gedeclareerde klasse ten minste één toets", () => {
  for (const g of GUARDRAILKADER) {
    for (const k of g.klassen) {
      const heeft = g.toetsen.some((t) => t.klasse === k);
      assert.ok(heeft, `${g.id}: klasse ${k} zonder toets`);
    }
    for (const t of g.toetsen) {
      assert.ok(t.bewijs.trim().length > 0, `${g.id}: lege bewijs-verwijzing`);
    }
  }
});

check("H/D-toetsen zijn geautomatiseerd, M-toetsen lopen via een evalset", () => {
  for (const g of GUARDRAILKADER) {
    for (const t of g.toetsen) {
      const verwacht = t.klasse === "M" ? "evalset" : "geautomatiseerd";
      assert.equal(t.aard, verwacht, `${g.id}: klasse ${t.klasse} met aard ${t.aard}`);
    }
  }
});

check("aftekenAard() volgt de klasse: M-component ⇒ evalset, anders geautomatiseerd", () => {
  for (const g of GUARDRAILKADER) {
    const verwacht = g.klassen.includes("M") ? "evalset" : "geautomatiseerd";
    assert.equal(aftekenAard(g), verwacht, `${g.id}`);
  }
});

// ── Spotchecks op de verruiming (BB) en de nulgrens ─────────────────────────
check("G2 (concepttekst) is uitsluitend BB en H+D-geborgd", () => {
  const g2 = GUARDRAILKADER.find((g) => g.id === "G2")!;
  assert.equal(g2.rollen.BB, "ja");
  for (const r of ["B", "V", "Bh"] as const) assert.equal(g2.rollen[r], "nee");
  assert.deepEqual(g2.klassen, ["H", "D"]);
});

check("G13 (verplichte slotsectie) is een BB-taakguardrail in klasse D", () => {
  const g13 = GUARDRAILKADER.find((g) => g.id === "G13")!;
  assert.equal(g13.rollen.BB, "ja");
  assert.deepEqual(g13.klassen, ["D"]);
});

check("G23 (nulgrens) verwijst naar de regressiepoort en geldt niet voor BB", () => {
  const g23 = GUARDRAILKADER.find((g) => g.id === "G23")!;
  assert.equal(g23.rollen.BB, "nvt");
  assert.ok(g23.toetsen.some((t) => t.bewijs.includes("nulgrens-regressiepoort")));
  assert.ok(g23.toetsen.some((t) => t.bewijs.includes("generatie-kern.sanity")));
});

check("guardrailsMetModelgedrag() bevat exact de M-leunende guardrails", () => {
  const ids = guardrailsMetModelgedrag().map((g) => g.id);
  assert.deepEqual(ids, ["G1", "G3", "G4", "G8", "G18", "G19"]);
});

// ── sha256-pin: de canonieke matrix is bevroren ─────────────────────────────
// Stabiele serialisatie: alleen de betekenisdragende velden, in vaste veldvolgorde.
function serialiseer(g: Guardrail): string {
  const rollen = `${g.rollen.B}|${g.rollen.V}|${g.rollen.Bh}|${g.rollen.BB}`;
  const klassen = g.klassen.join("+");
  const toetsen = g.toetsen
    .map((t) => `${t.klasse}:${t.aard}:${t.bewijs}`)
    .join(";");
  const rest = g.restrisico ? `${g.restrisico.besluit}:${g.restrisico.reden}` : "-";
  return [
    g.id,
    g.omschrijving,
    rollen,
    klassen,
    g.waarAfgedwongen,
    g.complianceRelevant ? "cr" : "nc",
    g.besluit,
    toetsen,
    rest,
  ].join("§");
}

const MATRIX_SNAPSHOT = GUARDRAILKADER.map(serialiseer).join("\n");

// Bereken bij een BEWUSTE wijziging opnieuw en werk de pin bij (met decisions/-entry).
const PIN_MATRIX = "4a03039778db2a09101e843c1a7e0067de012eb24b6a295771d189342c2838f1";

check("de canonieke §7.3-matrix is byte-identiek aan de gepinde snapshot", () => {
  const actueel = sha(MATRIX_SNAPSHOT);
  assert.equal(
    actueel,
    PIN_MATRIX,
    `De guardrailmatrix §7.3 is gewijzigd. Verifieer dat dit BEWUST is + maak een decisions/-entry (§7.8), en zet de pin dan op:\n  ${actueel}`
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
