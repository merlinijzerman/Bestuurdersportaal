// ============================================================================
//  Sanity-suite bij core/lib/bronsamenvatting.ts
// ----------------------------------------------------------------------------
//  Draait mee in `npm run sanity`, of los met
//  `npx tsx core/lib/bronsamenvatting.sanity.ts`.
// ============================================================================

import assert from "node:assert/strict";
import { samenvattingDocumentnamen, pillLabelVoor } from "./bronsamenvatting";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("lege lijst levert een lege string", () => {
  assert.equal(samenvattingDocumentnamen([]), "");
});

test("alleen lege of witruimte-titels leveren een lege string", () => {
  assert.equal(samenvattingDocumentnamen(["", "   ", "\n"]), "");
});

test("één titel komt kaal terug", () => {
  assert.equal(samenvattingDocumentnamen(["Transitieplan 2026"]), "Transitieplan 2026");
});

test("drie titels worden met een punt gescheiden", () => {
  assert.equal(
    samenvattingDocumentnamen(["A", "B", "C"]),
    "A · B · C"
  );
});

// Dit is de reden dat de functie bestaat: één document levert meerdere chunks en
// dus meerdere bronnen. Zonder ontdubbeling suggereert de balk meer stukken dan er zijn.
test("herhaalde titels worden ontdubbeld, volgorde blijft", () => {
  assert.equal(
    samenvattingDocumentnamen(["Notulen", "Beleid", "Notulen", "Beleid", "Advies"]),
    "Notulen · Beleid · Advies"
  );
});

test("meer dan het maximum levert een telling van de rest", () => {
  assert.equal(
    samenvattingDocumentnamen(["A", "B", "C", "D", "E"]),
    "A · B · C · +2 meer"
  );
});

test("de resttelling telt UNIEKE titels, niet bronnen", () => {
  // Zes bronnen, vier unieke documenten → drie getoond, één rest.
  assert.equal(
    samenvattingDocumentnamen(["A", "A", "B", "C", "D", "D"]),
    "A · B · C · +1 meer"
  );
});

test("exact het maximum levert geen resttelling", () => {
  assert.equal(samenvattingDocumentnamen(["A", "B", "C"], 3), "A · B · C");
});

test("een eigen maximum wordt gerespecteerd", () => {
  assert.equal(samenvattingDocumentnamen(["A", "B", "C"], 1), "A · +2 meer");
});

test("maxAantal 0 of lager valt terug op alleen een telling", () => {
  assert.equal(samenvattingDocumentnamen(["A", "B"], 0), "+2 meer");
});

test("titels worden getrimd vóór het ontdubbelen", () => {
  assert.equal(samenvattingDocumentnamen(["Notulen", "  Notulen  ", "Beleid"]), "Notulen · Beleid");
});

test("dezelfde invoer levert altijd dezelfde uitvoer", () => {
  const t = ["Notulen 11-07", "Transitieplan", "Notulen 11-07", "VO-reactie", "Planning"];
  assert.equal(samenvattingDocumentnamen(t), samenvattingDocumentnamen(t));
});

// ── Het label op de [Bron N]-pill ───────────────────────────────────────────

test("documenttype + datum is de voorkeursvorm", () => {
  assert.equal(
    pillLabelVoor({ titel: "Notulen bestuursvergadering 11 juli 2026", documenttypeLabel: "Notulen", documentdatum: "2026-07-11" }),
    "Notulen 11-07"
  );
});

test("zonder datum blijft het documenttype over", () => {
  assert.equal(pillLabelVoor({ titel: "Iets", documenttypeLabel: "Beleid", documentdatum: null }), "Beleid");
});

// De realiteit van vandaag: documenttype is nog niet gebackfilld.
test("zonder documenttype valt het label terug op de titel", () => {
  assert.equal(pillLabelVoor({ titel: "Transitieplan 2026", documentdatum: "2026-07-02" }), "Transitieplan 2026");
});

test("een lange titel wordt afgekapt met een beletselteken", () => {
  const uit = pillLabelVoor({ titel: "Besluit uitvoering Pensioenwet en Wet verplichte beroepspensioenregeling" });
  assert.ok(uit.endsWith("…"), uit);
  assert.ok(uit.length <= 33, `te lang: ${uit.length}`);
});

test("zonder titel en zonder type blijft het label leeg — de pill toont dan alleen het nummer", () => {
  assert.equal(pillLabelVoor({}), "");
  assert.equal(pillLabelVoor({ titel: "   " }), "");
});

test("een onvolledige datum wordt genegeerd, niet half getoond", () => {
  assert.equal(pillLabelVoor({ documenttypeLabel: "Advies", documentdatum: "2026" }), "Advies");
});

console.log(`\n${n} sanity-tests geslaagd.`);
