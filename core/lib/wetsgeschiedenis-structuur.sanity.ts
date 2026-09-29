// ============================================================
//  Sanity-tests voor lib/wetsgeschiedenis-structuur.ts — A-light foundation.
//
//  Geen testframework; standalone met assert. Synthetische fixtures (geen
//  echte Kamerstukken in Git).
//  Uitvoeren: npx tsx core/lib/wetsgeschiedenis-structuur.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  alsStructuurUnits,
  structureerParlementaireSegmenten,
  structureerParlementairStuk,
  type ParlementaireUnit,
} from "./wetsgeschiedenis-structuur";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const kort = (u: ParlementaireUnit[]) => u.map((x) => `${x.deel}|${x.type}|${x.label ?? "-"}`);

console.log("wetsgeschiedenis-structuur sanity-tests:");

const MVT = [
  "Wijziging van de Pensioenwet (synthetisch)",
  "",
  "MEMORIE VAN TOELICHTING",
  "",
  "I. ALGEMEEN",
  "",
  "1. Inleiding",
  "Dit wetsvoorstel regelt een fictieve wijziging. Zoals artikel 150d bepaalt, geldt een overgangsregime.",
  "",
  "2. Hoofdlijnen van het voorstel",
  "De regering kiest voor een eenvoudige aanpak.",
  "",
  "II. ARTIKELSGEWIJS",
  "",
  "Artikel I, onderdeel A",
  "Dit onderdeel wijzigt artikel 1 van de Pensioenwet.",
  "",
  "Onderdeel B",
  "Hier wordt een definitie ingevoegd.",
  "",
  "Artikel II",
  "Dit artikel regelt de inwerkingtreding.",
].join("\n");

check("MvT: algemeen deel, paragrafen en artikelsgewijze toelichting", () => {
  const u = structureerParlementairStuk(MVT, "memorie_van_toelichting");
  assert.deepEqual(kort(u), [
    "overig|tekst|-",
    "algemeen_deel|kop|Algemeen deel",
    "algemeen_deel|paragraaf|§1",
    "algemeen_deel|paragraaf|§2",
    "artikelsgewijze_toelichting|kop|Artikelsgewijze toelichting",
    "artikelsgewijze_toelichting|artikel|Artikel I, onderdeel A",
    "artikelsgewijze_toelichting|artikel|Artikel I, onderdeel B",
    "artikelsgewijze_toelichting|artikel|Artikel II",
  ]);
});

check("verwijzing midden in een zin splitst niet", () => {
  const u = structureerParlementairStuk(MVT, "memorie_van_toelichting");
  const par1 = u.find((x) => x.label === "§1");
  assert.ok(par1?.tekst.includes("Zoals artikel 150d bepaalt"));
  assert.equal(u.filter((x) => x.label?.includes("150d")).length, 0);
});

check("artikelregels in het algemeen deel openen geen artikel-unit", () => {
  const t = ["ALGEMEEN", "Artikel 150d", "wordt in dit deel alleen besproken."].join("\n");
  const u = structureerParlementairStuk(t, "memorie_van_toelichting");
  assert.deepEqual(kort(u), ["algemeen_deel|kop|Algemeen deel"]);
});

check("geen tekst verloren: alle niet-lege regels komen terug", () => {
  const u = structureerParlementairStuk(MVT, "nota_van_wijziging");
  const terug = u.map((x) => x.tekst).join("\n").split("\n").map((r) => r.trim()).filter(Boolean);
  const bron = MVT.split("\n").map((r) => r.trim()).filter(Boolean);
  assert.deepEqual(terug, bron);
});

const AMENDEMENT = [
  "AMENDEMENT VAN HET LID X (synthetisch)",
  "Voorgesteld 1 januari 2023",
  "",
  "De ondergetekende stelt het volgende amendement voor:",
  "",
  "I",
  "",
  "Artikel I, onderdeel C, wordt als volgt gewijzigd:",
  "In het voorgestelde artikel 150d wordt ‘vijf jaar’ vervangen door ‘zes jaar’.",
  "",
  "Toelichting",
  "",
  "Dit amendement verlengt de termijn om uitvoerders meer tijd te geven.",
].join("\n");

check("aangenomen amendement: wijziging en toelichting apart", () => {
  const u = structureerParlementairStuk(AMENDEMENT, "aangenomen_amendement");
  assert.deepEqual(kort(u), [
    "amendement_wijziging|tekst|-",
    "amendement_toelichting|kop|Amendement — toelichting",
  ]);
  const toel = u.find((x) => x.deel === "amendement_toelichting");
  assert.ok(toel?.tekst.includes("verlengt de termijn"));
  const wijz = u.find((x) => x.deel === "amendement_wijziging");
  assert.ok(wijz?.tekst.includes("‘zes jaar’"));
});

check("amendement: een eigen artikelkopregel wordt als artikel herkend", () => {
  const t = ["Artikel I, onderdeel C", "wordt als volgt gewijzigd", "", "Toelichting", "Reden."].join("\n");
  const u = structureerParlementairStuk(t, "aangenomen_amendement");
  assert.deepEqual(kort(u), [
    "amendement_wijziging|artikel|Artikel I, onderdeel C",
    "amendement_toelichting|kop|Amendement — toelichting",
  ]);
});

check("'Toelichting'-kop buiten een amendement is geen deelgrens", () => {
  const t = ["ALGEMEEN", "Toelichting", "Lopende tekst."].join("\n");
  const u = structureerParlementairStuk(t, "memorie_van_toelichting");
  assert.deepEqual(kort(u), ["algemeen_deel|kop|Algemeen deel"]);
});

check("nota van toelichting (AMvB): zelfde deelstructuur als een MvT", () => {
  const t = [
    "NOTA VAN TOELICHTING",
    "Algemeen",
    "Dit besluit werkt de wet uit.",
    "Artikelsgewijs",
    "Artikel 1",
    "Dit artikel bevat definities.",
  ].join("\n");
  const u = structureerParlementairStuk(t, "nota_van_toelichting");
  assert.deepEqual(kort(u), [
    "overig|tekst|-",
    "algemeen_deel|kop|Algemeen deel",
    "artikelsgewijze_toelichting|kop|Artikelsgewijze toelichting",
    "artikelsgewijze_toelichting|artikel|Artikel 1",
  ]);
});

check("niets herkend → één overig-unit (fallback op generieke chunking)", () => {
  const t = "Alleen lopende tekst zonder koppen.\nNog een regel.";
  const u = structureerParlementairStuk(t, null);
  assert.equal(u.length, 1);
  assert.equal(u[0].deel, "overig");
  assert.equal(u[0].type, "tekst");
});

check("lege tekst → één lege overig-unit, geen crash", () => {
  const u = structureerParlementairStuk("", null);
  assert.deepEqual(kort(u), ["overig|tekst|-"]);
});

check("deterministisch: tweemaal dezelfde invoer → identieke uitvoer", () => {
  assert.deepEqual(
    structureerParlementairStuk(MVT, "memorie_van_toelichting"),
    structureerParlementairStuk(MVT, "memorie_van_toelichting")
  );
});

check("alsStructuurUnits: deel in het label, bestaande StructuurType-waarden", () => {
  const s = alsStructuurUnits(structureerParlementairStuk(MVT, "memorie_van_toelichting"));
  const labels = s.map((x) => x.label);
  assert.ok(labels.includes("Artikelsgewijze toelichting — Artikel I, onderdeel B"));
  assert.ok(labels.includes("Algemeen deel — §2"));
  assert.ok(labels.includes("Algemeen deel"));
  assert.equal(labels[0], null); // voorwerk zonder deel
  for (const x of s) {
    assert.ok(["artikel", "paragraaf", "kop", "tekst"].includes(x.type), x.type);
  }
});

check("PDF-vervolgpagina behoudt artikelcontext en eigen paginanummer", () => {
  const segmenten = structureerParlementaireSegmenten(
    [
      {
        pagina: 12,
        paragraaf: null,
        tekst: [
          "II. ARTIKELSGEWIJS",
          "Artikel I, onderdeel A",
          "Deze toelichting begint op de eerste pagina van het onderdeel.",
        ].join("\n"),
      },
      {
        pagina: 13,
        paragraaf: null,
        tekst: [
          "De toelichting loopt op deze pagina door zonder herhaalde artikelkop.",
          "Onderdeel B",
          "Daarna begint het volgende onderdeel.",
        ].join("\n"),
      },
    ],
    "memorie_van_toelichting"
  );

  assert.equal(segmenten[0].pagina, 12);
  assert.equal(segmenten[1].pagina, 13);
  assert.equal(
    segmenten[1].units[0].label,
    "Artikelsgewijze toelichting — Artikel I, onderdeel A"
  );
  assert.match(segmenten[1].units[0].tekst, /loopt op deze pagina door/);
  assert.equal(
    segmenten[1].units[1].label,
    "Artikelsgewijze toelichting — Artikel I, onderdeel B"
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
