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
  assert.equal(r2(opSurface), 3.69);
  assert.equal(r2(opZebra), 3.5);
});

test("--app-line-strong haalt de 3:1 NIET — de reden dat er een tweede token is", () => {
  // Bevriest de aanleiding. Kantelt dit ooit, dan is --app-line-control mogelijk
  // overbodig geworden en moet besluit 0097 opnieuw tegen het licht.
  const opSurface = contrast(lineStrong, surface);
  assert.ok(opSurface < 3, `verwacht < 3:1, gemeten ${r2(opSurface)}:1`);
  assert.equal(r2(opSurface), 1.53);
});

test("tekst op --mark haalt >= 4,5:1 (WCAG 1.4.3, bodytekst)", () => {
  const c = contrast(ink, mark);
  assert.ok(c >= 4.5, `--ink op --mark: ${r2(c)}:1`);
  assert.equal(r2(c), 13.14);
});

// ── Leesbaarheid van de tokenlaag als geheel ─────────────────────────────────
//  Toegevoegd bij de paletwissel naar D1 "Bestuursblauw" (accent terug naar
//  navy). Bewust ZONDER bevroren exacte waarden: dit zijn ondergrenzen, geen
//  aanleidingen. Een latere kleurbijstelling mag de marge veranderen, niet de
//  afspraak. De exacte waarden hierboven zijn wél bevroren, omdat die een
//  concrete aanleiding vastleggen.

const appBg = token("app-bg");
const accent = token("accent");
const muted = token("muted");
const wit: [number, number, number] = [255, 255, 255];

test("bodytekst en secundaire tekst halen AA op beide dragende vlakken", () => {
  for (const [naam, kleur] of [["--ink", ink], ["--muted", muted]] as const) {
    for (const [vlakNaam, vlak] of [["--app-surface", surface], ["--app-bg", appBg]] as const) {
      const c = contrast(kleur, vlak);
      assert.ok(c >= 4.5, `${naam} op ${vlakNaam}: ${r2(c)}:1 (< 4,5)`);
    }
  }
});

test("het accent is leesbaar als link én als knopvlak", () => {
  const alsLink = contrast(accent, surface);
  const alsKnop = contrast(wit, accent);
  assert.ok(alsLink >= 4.5, `--accent op --app-surface: ${r2(alsLink)}:1`);
  assert.ok(alsKnop >= 4.5, `wit op --accent: ${r2(alsKnop)}:1`);
});

test("elke -ink haalt AA op de bijbehorende -tint", () => {
  for (const familie of ["accent", "ok", "err", "warn", "phase"]) {
    const c = contrast(token(`${familie}-ink`), token(`${familie}-tint`));
    assert.ok(c >= 4.5, `--${familie}-ink op --${familie}-tint: ${r2(c)}:1 (< 4,5)`);
  }
});

test("--accent en --phase zijn NIET op luminantie te scheiden — kleur mag nooit de enige drager zijn", () => {
  // Bevriest de reden achter de afspraak uit besluit 0097 op deze twee tokens.
  // --phase markeert "oordeelsvorming"/"in_evaluatie"/dissent en staat regelmatig
  // náást een accent-badge. Het verschil zit volledig in kleurtoon: perceptueel
  // ruim (CIELAB ΔE 45,9 volvlak, 30,8 op de -ink; ook onder deuteranopie/
  // protanopie > 20), maar in luminantie vrijwel nihil. Een gebruiker die de
  // kleur niet ziet, ziet dus geen verschil. Vandaar: altijd een label of icoon
  // naast de kleur. Kantelt dit ooit boven de 3, dan is die eis mogelijk te
  // versoepelen en hoort deze test opnieuw tegen het licht.
  const c = contrast(accent, token("phase"));
  assert.ok(c < 3, `verwacht < 3:1, gemeten ${r2(c)}:1`);
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

// ── Tranche 2C: de bronvermeldings-pill ─────────────────────────────────────
// Vastgepind om dezelfde reden als de tokens hierboven: een ratio die eenmalig
// in een rapport klopt, is een half jaar later stil onjuist. Deze combinaties
// staan in lopende tekst en zijn dus normale tekst (eis 4,5:1), niet large text.

test("pill in rust: --warn-ink op --warn-tint haalt 4,5:1", () => {
  const c = contrast(token("warn-ink"), token("warn-tint"));
  assert.ok(c >= 4.5, `--warn-ink op --warn-tint: ${r2(c)}:1`);
  assert.equal(r2(c), 7.16);
});

test("pill bij hover/highlight: --warn-ink op --mark haalt 4,5:1", () => {
  // Bewust een DEKKEND token en geen alpha: /ai rendert op --app-bg en de
  // agendapuntchat op wit, dus een doorschijnend vlak geeft per surface een
  // andere uitkomst. Met --mark is de ratio op beide surfaces gelijk.
  const c = contrast(token("warn-ink"), token("mark"));
  assert.ok(c >= 4.5, `--warn-ink op --mark: ${r2(c)}:1`);
  assert.equal(r2(c), 6.42);
});

test("nummerbolletje: wit op --warn-ink haalt 4,5:1", () => {
  // Wit op --warn haalde in de violette set 3,99:1 en zakte daarmee door de eis
  // heen; vandaar --warn-ink. In de D1-set haalt wit op --warn 5,93:1 en zou het
  // op zichzelf voldoen, maar we houden --warn-ink aan: het bolletje hoort bij de
  // pill-tekst en moet daar dezelfde toon mee delen.
  const c = contrast([255, 255, 255], token("warn-ink"));
  assert.ok(c >= 4.5, `wit op --warn-ink: ${r2(c)}:1`);
  assert.equal(r2(c), 7.71);
});

test("pill-rand haalt 3:1 op BEIDE ondergronden (WCAG 1.4.11)", () => {
  const opWit = contrast(token("app-line-control"), token("app-surface"));
  const opAppBg = contrast(token("app-line-control"), token("app-bg"));
  assert.ok(opWit >= 3, `--app-line-control op --app-surface: ${r2(opWit)}:1`);
  assert.ok(opAppBg >= 3, `--app-line-control op --app-bg: ${r2(opAppBg)}:1`);
});

test("vraagbubbel: --ink op --app-surface haalt 4,5:1", () => {
  const c = contrast(token("ink"), token("app-surface"));
  assert.ok(c >= 4.5, `--ink op --app-surface: ${r2(c)}:1`);
});

console.log(`\n${n} sanity-tests geslaagd.`);
