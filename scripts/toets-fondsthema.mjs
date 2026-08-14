// ============================================================================
//  Toets per-fonds theming-overrides tegen de basis-tokenlaag (app/globals.css).
//
//  Aanleiding: bij de paletwissel naar D1 "Bestuursblauw" (accent terug naar
//  navy) verschuift de basis waarop elke fonds-override landt. Een fondsaccent
//  dat naast violet werkte, kan naast navy wegvallen — of erger: samenvallen
//  met een SEMANTISCHE kleur, waardoor "merk" en "risico" hetzelfde gaan lijken.
//  Contrast alleen vangt dat niet: twee kleuren kunnen dezelfde luminantie
//  hebben en toch prima verschillen, of andersom. Daarom toetst dit script
//  twee dingen naast elkaar:
//
//    1. LEESBAARHEID — WCAG-contrast (1.4.3 tekst, 1.4.11 UI-componenten).
//    2. VERWARRING   — perceptuele afstand (CIELAB ΔE) tot de semantische
//                      tokens, óók onder gesimuleerde kleurenblindheid.
//
//  De echte fondswaarden staan in Supabase (public.fonds_theming.tokens, jsonb),
//  niet in deze repo. Dit script leest daarom uit een JSON-bestand of stdin:
//
//    node scripts/toets-fondsthema.mjs                 # actuele demo-migraties
//    node scripts/toets-fondsthema.mjs themas.json     # eigen export
//    psql ... -c "copy (select ...) to stdout" | node scripts/toets-fondsthema.mjs -
//
//  Verwacht formaat: { "<fondsnaam>": { "accent-rgb": "r g b", ... }, ... }
//  Exit 1 zodra één fonds een harde eis niet haalt.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── rekenkern ───────────────────────────────────────────────────────────────
const lin = (k) => { const c = k / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminantie = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a, b) {
  const la = luminantie(a), lb = luminantie(b);
  const [hoog, laag] = la >= lb ? [la, lb] : [lb, la];
  return (hoog + 0.05) / (laag + 0.05);
}
const r2 = (x) => Math.round(x * 100) / 100;

// CIELAB via sRGB→XYZ (D65). Voor ΔE76 — grof genoeg voor een verwarringsdrempel.
function lab([r, g, b]) {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// Kleurenblindheid-simulatie (Viénot/Brettel, LMS-projectie).
const RGB2LMS = [[0.31399022, 0.63951294, 0.04649755], [0.15537241, 0.75789446, 0.08670142], [0.01775239, 0.10944209, 0.87256922]];
const LMS2RGB = [[5.47221206, -4.6419601, 0.16963708], [-1.1252419, 2.29317094, -0.1678952], [0.02980165, -0.19318073, 1.16364789]];
const PROJ = {
  protanopie: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deuteranopie: [[1, 0, 0], [0.9513092, 0, 0.04264534], [0, 0, 1]],
};
const mul = (M, v) => M.map((rij) => rij.reduce((s, k, i) => s + k * v[i], 0));
function simuleer(rgb, soort) {
  const uit = mul(LMS2RGB, mul(PROJ[soort], mul(RGB2LMS, rgb.map(lin))));
  return uit.map((l) => {
    const c = Math.min(1, Math.max(0, l));
    return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  });
}

// ── basis-tokenlaag inlezen ─────────────────────────────────────────────────
const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
function basis(naam) {
  const m = CSS.match(new RegExp(`--${naam}-rgb:\\s*(\\d{1,3})\\s+(\\d{1,3})\\s+(\\d{1,3})\\s*;`));
  if (!m) throw new Error(`token --${naam}-rgb niet gevonden in app/globals.css`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const parse = (s) => s.trim().split(/\s+/).map(Number);

// ── themabronnen ────────────────────────────────────────────────────────────
function uitDemoSeed() {
  const tokens = {};
  // Bouw dezelfde eindtoestand op als Supabase: de seed, gevolgd door de
  // latere Meridiaan-correcties in migratievolgorde. Alleen de seed lezen gaf
  // een vals-negatieve contrastmelding voor inmiddels gecorrigeerde navtekst.
  const migraties = [
    "2026_07_09_t8_demo_fonds_seed.sql",
    "2026_07_28_huisstijl_t1_meridiaan_nav_text.sql",
    "2026_07_28_meridiaan_nav_line.sql",
  ];
  for (const bestand of migraties) {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", bestand), "utf8");
    for (const [, k, v] of sql.matchAll(/'([a-z-]+-rgb)',\s*'([\d ]+)'/g)) tokens[k] = v;
  }
  return Object.keys(tokens).length ? { "Meridiaan (actuele demo-migraties)": tokens } : {};
}
const arg = process.argv[2];
const themas = !arg
  ? uitDemoSeed()
  : JSON.parse(arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8"));

// ── de toets ────────────────────────────────────────────────────────────────
const WIT = [255, 255, 255];
const SEMANTISCH = ["ok", "err", "warn", "phase"];
const VERWARRINGSDREMPEL = 25; // ΔE76; daaronder gaan twee vlakken op chipformaat op elkaar lijken

let fouten = 0, waarschuwingen = 0;
for (const [naam, ruw] of Object.entries(themas)) {
  console.log(`\n── ${naam} ──`);
  const tok = (k) => (ruw[`${k}-rgb`] ? parse(ruw[`${k}-rgb`]) : basis(k));
  const eigen = (k) => Boolean(ruw[`${k}-rgb`]);

  const accent = tok("accent");
  const controles = [
    ["accent als link (op --app-surface)", contrast(accent, basis("app-surface")), 4.5, "1.4.3"],
    ["wit op accent (primaire knop)", contrast(WIT, accent), 4.5, "1.4.3"],
    ["accent-ink op accent-tint (badge)", contrast(tok("accent-ink"), tok("accent-tint")), 4.5, "1.4.3"],
    ["nav-text op nav (inactief menu-item)", contrast(tok("nav-text"), tok("nav")), 4.5, "1.4.3"],
    ["nav-text-active op nav (actief item)", contrast(tok("nav-text-active"), tok("nav")), 4.5, "1.4.3"],
    ["nav-accent op nav (actieve rand)", contrast(tok("nav-accent"), tok("nav")), 3, "1.4.11"],
  ];
  for (const [wat, gemeten, eis, regel] of controles) {
    const ok = gemeten >= eis;
    if (!ok) fouten++;
    console.log(`  ${ok ? "✓" : "✗"} ${wat.padEnd(42)} ${r2(gemeten).toFixed(2).padStart(6)}:1  (eis ${eis}, WCAG ${regel})`);
  }

  for (const fam of SEMANTISCH) {
    const doel = basis(fam);
    const normaal = deltaE(accent, doel);
    const cvd = Math.min(...Object.keys(PROJ).map((s) => deltaE(simuleer(accent, s), simuleer(doel, s))));
    const ok = Math.min(normaal, cvd) >= VERWARRINGSDREMPEL;
    if (!ok) waarschuwingen++;
    console.log(`  ${ok ? "✓" : "!"} accent vs --${fam.padEnd(5)} (verwarring)        ΔE ${r2(normaal).toFixed(1).padStart(5)} normaal · ${r2(cvd).toFixed(1).padStart(5)} kleurenblind  (drempel ${VERWARRINGSDREMPEL})`);
  }

  const zonderNavTekst = tok("nav") !== basis("nav") && !eigen("nav-text") && !eigen("nav-text-active");
  if (eigen("nav") && !eigen("nav-text") && !eigen("nav-text-active")) {
    console.log(`  ! dit fonds overschrijft --nav maar NIET --nav-text/--nav-text-active — de navtekst valt terug op de basis`);
  }
}

console.log(`\n${fouten} harde overtreding(en), ${waarschuwingen} verwarringswaarschuwing(en).`);
process.exit(fouten > 0 ? 1 : 0);
