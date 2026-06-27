// ============================================================
//  Sanity-tests voor lib/xlsx-segment.ts (Fase 1 xlsx-segmentatie).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/xlsx-segment.sanity.ts
//  Verifieert: kopregel-herhaling per blok, doelgrootte-respect,
//  rijbereik in paragraaf, cap-overschrijding en randgevallen.
// ============================================================

import assert from "node:assert/strict";
import { segmenteerTabblad } from "./xlsx-segment";
import {
  IngestCapError,
  MAX_XLSX_RIJEN_PER_TABBLAD,
  XLSX_DOELGROOTTE_CHARS,
} from "./ingest-caps";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("xlsx-segment sanity-tests:");

check("leeg tabblad levert geen segmenten", () => {
  assert.deepEqual(segmenteerTabblad("Leeg", []), []);
});

check("0-koloms tabblad (alleen lege rijen) levert geen segmenten", () => {
  assert.deepEqual(segmenteerTabblad("Leeg", [[], []]), []);
});

check("alleen kopregel (geen datarijen) levert geen segmenten", () => {
  // breedte > 0, maar geen datarij → geen blok → geen segment.
  assert.deepEqual(segmenteerTabblad("Kop", [["A", "B"]]), []);
});

check("elk segment herhaalt kop + kopregel + scheider", () => {
  const rijen: unknown[][] = [
    ["Naam", "Waarde"],
    ["alfa", "1"],
    ["beta", "2"],
  ];
  const segs = segmenteerTabblad("Data", rijen);
  assert.ok(segs.length >= 1);
  for (const s of segs) {
    assert.ok(s.tekst.includes("## Tabblad: Data"));
    assert.ok(s.tekst.includes("| Naam | Waarde |"));
    assert.ok(s.tekst.includes("| --- | --- |"));
    assert.equal(s.pagina, null);
  }
});

check("alle datarijen komen precies één keer voor", () => {
  const rijen: unknown[][] = [["K"], ["r1"], ["r2"], ["r3"], ["r4"]];
  const segs = segmenteerTabblad("T", rijen);
  const samen = segs.map((s) => s.tekst).join("\n");
  for (const r of ["r1", "r2", "r3", "r4"]) {
    const count = samen.split(`| ${r} |`).length - 1;
    assert.equal(count, 1, `rij ${r} hoort precies 1x voor te komen`);
  }
});

check("paragraaf bevat het rijbereik en is aaneengesloten", () => {
  // Veel kleine rijen forceren meerdere blokken.
  const rijen: unknown[][] = [["Kop"]];
  for (let i = 1; i <= 200; i++) rijen.push([`waarde-${i}`]);
  const segs = segmenteerTabblad("Data", rijen);
  assert.ok(segs.length > 1, "verwacht meerdere segmenten");

  // Eerste blok start bij rij 1.
  assert.ok(segs[0].paragraaf?.includes("rijen 1–"));
  // Bereiken sluiten aaneen en eindigen op de laatste datarij (200).
  let verwachtStart = 1;
  for (const s of segs) {
    const m = s.paragraaf?.match(/rijen (\d+)–(\d+)/);
    assert.ok(m, `paragraaf mist rijbereik: ${s.paragraaf}`);
    const start = Number(m![1]);
    const eind = Number(m![2]);
    assert.equal(start, verwachtStart, "blokken moeten aaneensluiten");
    assert.ok(eind >= start);
    verwachtStart = eind + 1;
  }
  assert.equal(verwachtStart - 1, 200, "laatste blok moet eindigen op rij 200");
});

check("blokken respecteren de doelgrootte (behalve een enkele grote rij)", () => {
  const rijen: unknown[][] = [["Kop"]];
  for (let i = 1; i <= 300; i++) rijen.push([`x`.repeat(40)]);
  const segs = segmenteerTabblad("Data", rijen);
  // Een blok met >1 rij mag de doelgrootte niet overschrijden.
  for (const s of segs) {
    const rijenInBlok = s.tekst.split("\n").filter((l) => l.startsWith("| x")).length;
    if (rijenInBlok > 1) {
      assert.ok(
        s.tekst.length <= XLSX_DOELGROOTTE_CHARS + 80, // marge voor voorvoegsel-afronding
        `blok te groot: ${s.tekst.length}`
      );
    }
  }
});

check("één enkele grote rij wordt altijd toegelaten (geen oneindige flush)", () => {
  const rijen: unknown[][] = [
    ["Kop"],
    ["y".repeat(XLSX_DOELGROOTTE_CHARS * 3)],
  ];
  const segs = segmenteerTabblad("Data", rijen);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].tekst.includes("y".repeat(XLSX_DOELGROOTTE_CHARS * 3)));
});

check("cap: precies op de grens mag, één datarij erboven gooit IngestCapError", () => {
  const opGrens: unknown[][] = [["Kop"]];
  for (let i = 0; i < MAX_XLSX_RIJEN_PER_TABBLAD; i++) opGrens.push([`r${i}`]);
  assert.doesNotThrow(() => segmenteerTabblad("OK", opGrens));

  const erboven: unknown[][] = [["Kop"]];
  for (let i = 0; i < MAX_XLSX_RIJEN_PER_TABBLAD + 1; i++) erboven.push([`r${i}`]);
  assert.throws(() => segmenteerTabblad("TeGroot", erboven), (e: unknown) => {
    assert.ok(e instanceof IngestCapError);
    assert.ok((e as IngestCapError).message.includes("TeGroot"));
    return true;
  });
});

check("ongelijke rijbreedtes worden tot de maximale breedte gevuld", () => {
  const rijen: unknown[][] = [
    ["A", "B", "C"],
    ["1"], // korter → moet aangevuld worden tot 3 cellen
  ];
  const segs = segmenteerTabblad("Breedte", rijen);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].tekst.includes("| 1 |  |  |"));
});

check("pipes en newlines in cellen worden ontsmet", () => {
  const rijen: unknown[][] = [["Kop"], ["a|b\nc"]];
  const segs = segmenteerTabblad("Ontsmet", rijen);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].tekst.includes("a\\|b c"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
