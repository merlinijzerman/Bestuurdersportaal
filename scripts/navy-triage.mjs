// Fase-2 codemod: rol-gebaseerde vervanging van de navy-hexfamilie (#0F2744 e.d.)
// door semantische tokens. Sluit Sidebar.tsx uit (handmatige lichte herschrijving).
//
// Mapping-beslissingen (reviewbaar):
//  - text-[#0F2744](/N)        -> text-ink(/N)         (navy = body/heading ink)
//  - bg-[#0F2744](/N)          -> bg-accent(/N)        (donker navy vlak = brand-blauw)
//  - from-[#0F2744]            -> from-accent
//  - {hover,to,via,from,bg}-[lichter-navy] -> *-accent-ink  (hover-darken/gradient-eind)
//  - border-[#0F2744]/N        -> border-line          (structurele hairline; opacity weg)
//  - border-[#0F2744] (vol)    -> border-accent        (nadruk)
//
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync(
  `grep -rIlE '#0[fF]2744|#1[aA]3[0-9a-fA-F]{3}|#163[0-9a-fA-F]{3}|#0a1c30' app components lib`,
  { encoding: "utf8" }
)
  .trim()
  .split("\n")
  .filter((f) => f && !f.endsWith("Sidebar.tsx"));

const P = String.raw`(hover:|focus:|group-hover:|active:|focus-visible:)?`; // optionele variant-prefix
// lichter-navy hover/gradient familie -> accent-ink
const INK_HEX = `(?:1a3858|1a3a5e|1A3A5C|1a3a5c|163556|1a3658|163457|0a1c30|1A3A5E)`;

const rules = [
  // TEXT
  [new RegExp(`\\b${P}text-\\[#0F2744\\](/\\d+)?`, "gi"), (m, p = "", o = "") => `${p}text-ink${o}`],
  // BORDER — opacity-varianten -> line (opacity valt weg)
  [new RegExp(`\\b${P}border-\\[#0F2744\\]/\\d+`, "gi"), (m, p = "") => `${p}border-line`],
  // BORDER — volle sterkte -> accent
  [new RegExp(`\\b${P}border-\\[#0F2744\\](?!/)`, "gi"), (m, p = "") => `${p}border-accent`],
  // BACKGROUND / GRADIENT donker navy -> accent
  [new RegExp(`\\b${P}(bg|from|to|via)-\\[#0F2744\\](/\\d+)?`, "gi"), (m, p = "", g, o = "") => `${p}${g}-accent${o}`],
  // Lichter-navy familie (hover-darken / gradient-eind) -> accent-ink
  [new RegExp(`\\b${P}(bg|from|to|via)-\\[#${INK_HEX}\\](/\\d+)?`, "gi"), (m, p = "", g, o = "") => `${p}${g}-accent-ink${o}`],
];

let totalFiles = 0;
let totalRepl = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  let fileRepl = 0;
  for (const [re, fn] of rules) {
    src = src.replace(re, (...args) => {
      fileRepl++;
      return fn(...args);
    });
  }
  if (src !== before) {
    writeFileSync(file, src);
    totalFiles++;
    totalRepl += fileRepl;
    console.log(`${fileRepl.toString().padStart(4)}  ${file}`);
  }
}
console.log(`\n${totalRepl} vervangingen in ${totalFiles} bestanden.`);
