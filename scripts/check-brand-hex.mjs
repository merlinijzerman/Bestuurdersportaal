// Fase 4 — borging tegen terugval op hardcoded merkkleuren.
//
// Dit project heeft (nog) geen ESLint-setup, dus deze guard draait standalone
// via `npm run lint:colors` (of in CI / een pre-commit hook). Hij faalt (exit 1)
// zodra iemand:
//   1) een legacy merk-hex terugzet (navy #0F2744 / #1A3A5C, gold #C9A84C / #E8D090), of
//   2) een arbitrary-hex Tailwind-colorclass in JSX gebruikt (bijv. text-[#234E70]).
//
// Grijstinten en overige losse hex in geëxporteerde print-CSS (lib/*-html.ts)
// blijven toegestaan — die vallen buiten de tokenlaag en zijn bewust literal.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// T9 fase 2 (besluit 0052): components/ + lib/ zijn opgesplitst naar
// core/ (+ core/lib, core/components) en platform/ (+ platform/lib). Scan die
// lagen expliciet — anders scant deze gate stil niets meer (false green).
const ROOTS = ["app", "core", "platform", "fondsen"];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

// 1) Verboden legacy merk-hex (case-insensitief).
const LEGACY_HEX = /#(0f2744|1a3a5c|c9a84c|e8d090)\b/i;

// 2) Arbitrary-hex kleurutility in className: text-[#...], bg-[#...], border-[#...], enz.
const ARBITRARY_HEX_CLASS =
  /\b(?:text|bg|border|from|to|via|ring|fill|stroke|divide|shadow|outline|decoration|caret|accent)-\[#[0-9a-fA-F]{3,8}\]/;

// 3) Named Tailwind palette-classes voor families die naar de tokenlaag zijn
//    gemigreerd (fase 5). Terugval hierop faalt. purple/violet -> phase-token.
//    Bewust NIET geblokkeerd: cyan/sky/teal (chart-palet, buiten scope).
//    \b vangt ook de variant-prefix (hover:/md: etc.).
const MIGRATED_PALETTE_CLASS =
  /\b(?:text|bg|border|ring|divide|from|to|via|fill|stroke|placeholder|caret|outline|decoration)-(?:gray|slate|zinc|neutral|stone|red|rose|emerald|green|amber|yellow|orange|blue|indigo|purple|violet)-\d{2,3}\b/;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (LEGACY_HEX.test(line)) {
        violations.push({ file, line: i + 1, kind: "legacy-merk-hex", text: line.trim() });
      }
      if (ARBITRARY_HEX_CLASS.test(line)) {
        violations.push({ file, line: i + 1, kind: "arbitrary-hex-class", text: line.trim() });
      }
      if (MIGRATED_PALETTE_CLASS.test(line)) {
        violations.push({ file, line: i + 1, kind: "palette-class", text: line.trim() });
      }
    });
  }
}

if (violations.length === 0) {
  console.log("✓ Geen hardcoded merkkleuren gevonden — tokenlaag is de enige bron van waarheid.");
  process.exit(0);
}

console.error(`✗ ${violations.length} kleur-overtreding(en) gevonden. Gebruik semantische tokens (text-ink, bg-accent, border-line, …):\n`);
for (const v of violations) {
  console.error(`  [${v.kind}] ${v.file}:${v.line}\n    ${v.text}`);
}
process.exit(1);
