// ============================================================================
//  Fase 5 — palette-triage: named Tailwind palette-classes -> tokenlaag.
// ----------------------------------------------------------------------------
//  De fase 0-4 codemod mapte alleen KALE HEX. Named palette-classes
//  (text-gray-500, bg-red-50, text-emerald-800, ...) bleven staan en zijn nooit
//  op de tokens gezet. Dit script doet dat rol-gebaseerd en REVIEWBAAR:
//
//   Neutrals (gray/slate/zinc/neutral/stone):
//     text  >=700 -> text-ink        | <700 -> text-muted
//     bg    <=100 -> bg-app-bg       | 200/300 -> bg-app-line
//     border<=200 -> border-line     | >=300 -> border-app-line-strong
//     divide/ring -> -line           | placeholder -> -muted
//
//   Semantiek err(red/rose) ok(emerald/green) warn(amber/yellow/orange):
//     text        -> text-{tok}-ink  (leesbaar op tint; AA-geverifieerd)
//     bg  <=100   -> bg-{tok}-tint    | >=400 -> bg-{tok} (volvlak)
//     border      -> border-{tok}/30  (zacht; bestaande opacity blijft)
//     ring        -> ring-{tok}/30    | fill/stroke -> -{tok}
//
//   Info (blue/indigo) -> accent:
//     text -> text-accent-ink | bg<=100 -> bg-accent-tint | bg>=400 -> bg-accent
//     border/ring -> accent/30
//
//  ONgemapt (bewust): purple/violet/fuchsia/pink/sky/cyan/teal/lime + exotische
//  shades. Die worden NIET aangeraakt en in een rapport gezet voor handmatige
//  triage — semantiek is daar te onzeker voor een blinde map.
//
//  Gebruik:  node scripts/palette-triage.mjs            (schrijft wijzigingen)
//            node scripts/palette-triage.mjs --dry      (alleen rapport)
// ============================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DRY = process.argv.includes("--dry");
// lib bevat className-configs (risico-config.ts, dossier.ts). De print-html
// templates (email.ts, *-html.ts) gebruiken LITERAL hex, geen palette-classes,
// en worden dus niet geraakt door de family-regex.
const ROOTS = ["app", "components", "lib"];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const NEUTRAL = new Set(["gray", "slate", "zinc", "neutral", "stone"]);
const SEM = { red: "err", rose: "err", emerald: "ok", green: "ok", amber: "warn", yellow: "warn", orange: "warn", purple: "phase", violet: "phase" };
const INFO = new Set(["blue", "indigo"]);
// Bewust ongemapt -> rapport, niet aanraken (chart-palet / geen tokenrol).
const REPORT_ONLY = new Set(["fuchsia", "pink", "sky", "cyan", "teal", "lime"]);

const ALL_FAMILIES = [...NEUTRAL, ...Object.keys(SEM), ...INFO, ...REPORT_ONLY].join("|");
// prefix - family - shade (/opacity)?
const CLASS_RE = new RegExp(
  `\\b(text|bg|border|ring|divide|from|to|via|fill|stroke|placeholder|caret|outline|decoration)-(${ALL_FAMILIES})-(\\d{2,3})(/\\d{1,3})?\\b`,
  "g"
);

function neutralTarget(prefix, shade) {
  const s = Number(shade);
  switch (prefix) {
    case "text": case "caret": case "decoration": case "placeholder":
      return `${prefix === "placeholder" ? "placeholder" : prefix}-${s >= 700 ? "ink" : "muted"}`;
    case "bg": case "from": case "to": case "via": case "fill":
      return `${prefix}-${s <= 100 ? "app-bg" : "app-line"}`;
    case "border": case "outline":
      return `${prefix}-${s <= 200 ? "line" : "app-line-strong"}`;
    case "divide": case "ring": case "stroke":
      return `${prefix}-line`;
    default: return null;
  }
}

function semTarget(prefix, tok, shade, opacity) {
  const s = Number(shade);
  switch (prefix) {
    case "text": case "caret": case "decoration":
      return `${prefix}-${tok}-ink`;
    case "bg": case "from": case "to": case "via":
      return `${prefix}-${s <= 300 ? `${tok}-tint` : tok}`;
    case "fill": case "stroke":
      return `${prefix}-${tok}`;
    case "border": case "outline": case "ring": case "divide":
      return `${prefix}-${tok}${opacity || "/30"}`;
    default: return null;
  }
}

function infoTarget(prefix, shade, opacity) {
  const s = Number(shade);
  switch (prefix) {
    case "text": case "caret": case "decoration":
      return `${prefix}-accent-ink`;
    case "bg": case "from": case "to": case "via":
      return `${prefix}-${s <= 300 ? "accent-tint" : "accent"}`;
    case "fill": case "stroke":
      return `${prefix}-accent`;
    case "border": case "outline": case "ring": case "divide":
      return `${prefix}-accent${opacity || "/30"}`;
    default: return null;
  }
}

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

const report = [];   // { file, cls, reason }
let filesChanged = 0, replacements = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    let changed = false;
    const next = src.replace(CLASS_RE, (m, prefix, family, shade, opacity = "") => {
      let target = null;
      if (NEUTRAL.has(family)) target = neutralTarget(prefix, shade);
      else if (SEM[family]) target = semTarget(prefix, SEM[family], shade, opacity);
      else if (INFO.has(family)) target = infoTarget(prefix, shade, opacity);
      else if (REPORT_ONLY.has(family)) { report.push({ file, cls: m, reason: "family niet gemapt (handmatig)" }); return m; }

      if (!target) { report.push({ file, cls: m, reason: `prefix "${prefix}" niet gemapt` }); return m; }
      // Neutral behoudt eventuele opacity; semantiek/info hebben die al verwerkt.
      if (NEUTRAL.has(family) && opacity) target += opacity;
      changed = true; replacements++;
      return target;
    });
    if (changed && !DRY) { writeFileSync(file, next); filesChanged++; }
    else if (changed) filesChanged++;
  }
}

console.log(`\n${DRY ? "[DRY] " : ""}palette-triage: ${replacements} vervangingen in ${filesChanged} bestanden.`);
if (report.length) {
  console.log(`\n── Handmatige triage nodig (${report.length}) ──`);
  const byFam = {};
  for (const r of report) {
    const fam = r.cls.match(/-(\w+)-\d/)?.[1] ?? "?";
    (byFam[fam] ||= new Set()).add(r.cls);
  }
  for (const [fam, set] of Object.entries(byFam).sort()) {
    console.log(`  ${fam.padEnd(10)} ${[...set].sort().join(", ")}`);
  }
} else {
  console.log("Geen ongemapte palette-classes.");
}
