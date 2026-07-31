// ============================================================
//  Sanity-tests voor de contrastafspraken in de tokenlaag.
//
//  Aanleiding (besluit 0097): --app-line-strong (210 214 230) haalt 1,45:1 op
//  wit en voldoet daarmee NIET aan WCAG 1.4.11 (>= 3:1 voor de rand van een
//  bedieningselement). Daarvoor is --app-line-control toegevoegd. Zo'n cijfer
//  is eenmalig in een rapport gauw juist en een half jaar later stil onjuist:
//  iemand stelt een token bij en niets merkt het. Deze suite rekent de ratio's
//  na op de WAARDEN IN app/globals.css, zodat de afspraak bewaakt blijft in
//  plaats van gedocumenteerd.
//
//  Berekening volgens WCAG 2.x: relatieve luminantie met de sRGB-lineari-
//  satie, contrast = (L1 + 0,05) / (L2 + 0,05).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/kleurcontrast.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("kleurcontrast sanity-tests:");

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Leest een `--naam-rgb: r g b;`-triple uit de tokenlaag. */
function token(naam: string): [number, number, number] {
  const m = CSS.match(new RegExp(`--${naam}-rgb:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})\\s*;`));
  assert.ok(m, `token --${naam}-rgb niet gevonden in app/globals.css`);
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

/** Relatieve luminantie volgens WCAG 2.x. */
function luminantie([r, g, b]: [number, number, number]): number {
  const lin = (kanaal: number) => {
    const c = kanaal / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminantie(a);
  const lb = luminantie(b);
  const [hoog, laag] = la >= lb ? [la, lb] : [lb, la];
  return (hoog + 0.05) / (laag + 0.05);
}

/** Afgerond op twee decimalen, zodat de meldingen leesbaar blijven. */
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ── IJking van de rekenkern op bekende waarden ───────────────────────────────

test("de contrastfunctie klopt op bekende ijkpunten", () => {
  assert.equal(r2(contrast([0, 0, 0], [255, 255, 255])), 21); // zwart op wit
  assert.equal(r2(contrast([255, 255, 255], [255, 255, 255])), 1); // wit op wit
  // #767676 op wit is het klassieke AA-grensgeval voor bodytekst.
  assert.ok(contrast([118, 118, 118], [255, 255, 255]) >= 4.5);
});

// ── De afspraak uit besluit 0097 ─────────────────────────────────────────────

const surface = token("app-surface");
const zebra = token("app-zebra");
const control = token("app-line-control");
const lineStrong = token("app-line-strong");
const mark = token("mark");
const ink = token("ink");

test("--app-line-control haalt >= 3:1 op --app-surface EN op --app-zebra (WCAG 1.4.11)", () => {
  const opSurface = contrast(control, surface);
  const opZebra = contrast(control, zebra);
  assert.ok(opSurface >= 3, `op --app-surface: ${r2(opSurface)}:1`);
  assert.ok(opZebra >= 3, `op --app-zebra: ${r2(opZebra)}:1`);
  assert.equal(r2(opSurface), 3.32);
  assert.equal(r2(opZebra), 3.15);
});

test("--app-line-strong haalt de 3:1 NIET — de reden dat er een tweede token is", () => {
  // Bevriest de aanleiding. Kantelt dit ooit, dan is --app-line-control mogelijk
  // overbodig geworden en moet besluit 0097 opnieuw tegen het licht.
  const opSurface = contrast(lineStrong, surface);
  assert.ok(opSurface < 3, `verwacht < 3:1, gemeten ${r2(opSurface)}:1`);
  assert.equal(r2(opSurface), 1.45);
});

test("tekst op --mark haalt >= 4,5:1 (WCAG 1.4.3, bodytekst)", () => {
  const c = contrast(ink, mark);
  assert.ok(c >= 4.5, `--ink op --mark: ${r2(c)}:1`);
  assert.equal(r2(c), 14.28);
});

test("de twee nieuwe tokens staan NIET in de per-fonds theming-allowlist", () => {
  // --mark en --app-line-control zijn toegankelijkheidsafspraken, geen merkkeuze.
  // Een fonds dat ze zou mogen overschrijven, kan het contrast stukmaken.
  const core = readFileSync(join(process.cwd(), "core", "lib", "fonds-config-core.ts"), "utf8");
  const blok = core.match(/THEMABARE_TOKENS\s*=\s*\{([\s\S]*?)\}/);
  assert.ok(blok, "THEMABARE_TOKENS niet gevonden");
  assert.ok(!blok![1].includes("mark"), "--mark hoort niet themabaar te zijn");
  assert.ok(!blok![1].includes("line-control"), "--app-line-control hoort niet themabaar te zijn");
});

test("de tokens zijn ook in tailwind.config.ts ontsloten", () => {
  const tw = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
  assert.ok(tw.includes("var(--mark-rgb)"), "mark ontbreekt in tailwind.config.ts");
  assert.ok(
    tw.includes("var(--app-line-control-rgb)"),
    "app.line-control ontbreekt in tailwind.config.ts",
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
