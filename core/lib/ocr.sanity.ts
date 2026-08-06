// ============================================================
//  Sanity-tests voor lib/ocr.ts — de OCR-drempel.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/ocr.sanity.ts
//
//  WAAROM DEZE SUITE (besluit 0134): `heeftOcrNodig` is sinds 06-08-2026 óók
//  het criterium van de upload-route. Daarvoor gold daar "< 100 betekenisvolle
//  tekens in het HELE document" — een drempel die een scan van 120 pagina's met
//  150 tekens losse tekst gewoon doorliet en als praktisch leeg document
//  indexeerde, zónder signaal. De per-pagina-drempel vangt dat wél. Die
//  gedragsgrens is te belangrijk om alleen in commentaar te bestaan.
//
//  Alleen de PURE beslislaag wordt hier getest; de netwerkstap (Mistral OCR)
//  niet — die hoort in een integratietest, niet in een sanity-suite.
// ============================================================

import assert from "node:assert/strict";
import {
  heeftOcrNodig,
  magOcrDraaien,
  OCR_ENGINE_LABEL,
  OCR_MODEL,
  OCR_PROVIDER,
} from "./ocr";
import type { ExtractieResultaat } from "./document-extractie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Bouwt een extractieresultaat met `tekens` betekenisvolle tekens, verdeeld over
// `paginas` segmenten. De inhoud doet er niet toe — alleen de telling.
function resultaat(tekens: number, paginas: number | null): ExtractieResultaat {
  const tekst = "a".repeat(tekens);
  const aantalSegmenten = paginas && paginas > 0 ? paginas : 1;
  return {
    tekst,
    aantalPaginas: paginas,
    segmenten: Array.from({ length: aantalSegmenten }, (_, i) => ({
      pagina: i + 1,
      paragraaf: null,
      tekst: "",
    })),
  };
}

console.log("ocr sanity-tests:");

check("alleen PDF komt in aanmerking voor OCR", () => {
  const leeg = resultaat(0, 3);
  assert.equal(heeftOcrNodig(leeg, "pdf"), true);
  // DOCX/XLSX hebben per definitie een tekstlaag; een lege uitkomst betekent
  // daar "geen inhoud", niet "scan". OCR zou daar niets toevoegen.
  assert.equal(heeftOcrNodig(leeg, "docx"), false);
  assert.equal(heeftOcrNodig(leeg, "xlsx"), false);
});

check("zonder segmenten is OCR altijd nodig (PDF)", () => {
  const geenSegmenten: ExtractieResultaat = {
    tekst: "",
    aantalPaginas: 10,
    segmenten: [],
  };
  assert.equal(heeftOcrNodig(geenSegmenten, "pdf"), true);
});

check("drempel is 50 tekens PER PAGINA, niet over het hele document", () => {
  // Precies op de drempel (50/pagina) → geen OCR; één tekentje minder wél.
  assert.equal(heeftOcrNodig(resultaat(500, 10), "pdf"), false);
  assert.equal(heeftOcrNodig(resultaat(499, 10), "pdf"), true);
});

check("REGRESSIEPIN: dunne tekstlaag over veel pagina's wordt herkend", () => {
  // Dit is het geval dat de oude upload-drempel ("< 100 tekens totaal") liet
  // passeren: 150 tekens verspreid over 120 pagina's = 1,25 teken/pagina.
  // Zou dit ooit weer `false` opleveren, dan is het stille faalpad terug.
  assert.equal(heeftOcrNodig(resultaat(150, 120), "pdf"), true);
});

check("een normaal tekstdocument vraagt géén OCR", () => {
  assert.equal(heeftOcrNodig(resultaat(40_000, 22), "pdf"), false);
});

check("onbekend paginaaantal wordt als één pagina gerekend", () => {
  // Fail-safe: zonder paginatelling niet delen door nul en niet onterecht OCR
  // aanzetten op een kort maar leesbaar document.
  assert.equal(heeftOcrNodig(resultaat(80, null), "pdf"), false);
  assert.equal(heeftOcrNodig(resultaat(10, null), "pdf"), true);
});

check("witruimte telt niet mee als tekst", () => {
  // Een 'lege' scan levert vaak alleen newlines/spaties op. 2.000 spaties over
  // 10 pagina's mag niet als een gevulde tekstlaag gelden.
  const alleenWitruimte: ExtractieResultaat = {
    tekst: " \n".repeat(1000),
    aantalPaginas: 10,
    segmenten: [{ pagina: 1, paragraaf: null, tekst: " " }],
  };
  assert.equal(heeftOcrNodig(alleenWitruimte, "pdf"), true);
});

// ── Paginagrens (besluit 0134) ────────────────────────────────────────────

check("paginagrens: op de grens mag, één erboven niet", () => {
  assert.equal(magOcrDraaien(40, 40), true);
  assert.equal(magOcrDraaien(41, 40), false);
  assert.equal(magOcrDraaien(1, 40), true);
});

check("zonder grens draait OCR altijd (bulk-/scriptpad ongewijzigd)", () => {
  // Dit borgt de claim uit 0134 dat bestaande aanroepers (generiek-pipeline,
  // reindex) hun gedrag behouden nu de signatuur een derde argument kreeg.
  assert.equal(magOcrDraaien(5000, undefined), true);
  assert.equal(magOcrDraaien(null, undefined), true);
});

check("onbekend paginaaantal blokkeert de OCR-stap niet", () => {
  // Fail-safe: niet weigeren op een gegeven dat we niet hebben; de
  // AbortController-timeout en maxDuration blijven de vangrail.
  assert.equal(magOcrDraaien(null, 40), true);
  assert.equal(magOcrDraaien(undefined, 40), true);
});

check("engine-label is stabiel (landt in documenten.ocr_engine, audit)", () => {
  assert.equal(OCR_PROVIDER, "mistral");
  assert.equal(OCR_MODEL, "mistral-ocr-latest");
  assert.equal(OCR_ENGINE_LABEL, `${OCR_PROVIDER}:${OCR_MODEL}`);
});

console.log(`\n${n} sanity-tests geslaagd.`);
