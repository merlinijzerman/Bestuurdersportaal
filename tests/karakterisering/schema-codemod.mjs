// ============================================================================
//  W9 — Codemod: `schema`-waarde in elke withFondsRoute-spec.
// ----------------------------------------------------------------------------
//  Voegt aan elke inline `withFondsRoute({...})`-spec één veld toe:
//    - body-lezend  → `schema: z.object({...}).passthrough()` (uit W8's generator,
//                     ééNregelig zodat de diff-classificatie hem als één toegevoegde
//                     regel herkent);
//    - geen body    → `schema: "geen-body"`.
//  En voegt `import { z } from "zod";` toe aan elk bestand dat een echt schema krijgt.
//
//  MECHANISCH, en verder niets: alleen het `schema`-veld en (waar nodig) de
//  zod-import wijzigen. De withMachineRoute-specs (named consts) doet dit script
//  NIET — die worden apart behandeld (§2/machine-route-wrapper). Zie TICKET-W9.
//
//  Gebruik:
//    node tests/karakterisering/schema-codemod.mjs --dry           # toon diff-plan, schrijf niets
//    node tests/karakterisering/schema-codemod.mjs --apply         # schrijf de wijzigingen
//    node tests/karakterisering/schema-codemod.mjs --apply --only=app/api/risicos/[id]/route.ts
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { genereerSchemas } from "./schema-genereer.mjs";
import { bouwInventaris } from "./schema-inventaris.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;

const schemas = genereerSchemas(); // Map<`METHOD bestand`, {bron, velden, guarded, handler}>

/** Bouwt een ééNregelige, VOLLEDIG LOSSE zod-literal. Geen typering: elk veld is
 *  `z.unknown().optional()`, object `.passthrough()`. De W9-handwerkverificatie (§6)
 *  toonde dat typeren op basis van `typeof`-guards strenger zou zijn dan de code
 *  (conditioneel gebruik, geen 400-op-type). Aanscherpen is werk ná fonds 1. */
function eenregelSchema(gen) {
  if (gen.velden.length === 0) return "z.object({}).passthrough()";
  const velden = gen.velden
    .map((v) => `${JSON.stringify(v)}: z.unknown().optional()`)
    .join(", ");
  return `z.object({ ${velden} }).passthrough()`;
}

// Inventaris → per gewrapte withFondsRoute-handler de spec-waarde.
const inv = bouwInventaris();
const fondsHandlers = inv.filter((h) => h.wrapper === "withFondsRoute");

// Groepeer per bestand.
const perBestand = new Map();
for (const h of fondsHandlers) {
  if (only && h.bestand !== only) continue;
  if (!perBestand.has(h.bestand)) perBestand.set(h.bestand, []);
  perBestand.get(h.bestand).push(h);
}

const METHODEN = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
let gewijzigd = 0;
let veldenToegevoegd = 0;

for (const [bestand, handlers] of perBestand) {
  let src = readFileSync(bestand, "utf8");
  const origineel = src;
  let heeftEchtSchema = false;

  for (const h of handlers) {
    const sleutel = `${h.methode} ${h.bestand}`;
    const gen = schemas.get(sleutel);
    const waarde = h.bodyLezend && gen ? eenregelSchema(gen) : '"geen-body"';
    if (h.bodyLezend) heeftEchtSchema = true;

    // Match de inline spec van precies deze methode: `export const METHOD = withFondsRoute({...spec...}`
    const specRe = new RegExp(
      `(export const ${h.methode}\\s*=\\s*withFondsRoute\\(\\s*\\{)([^}]*)(\\})`,
    );
    const m = specRe.exec(src);
    if (!m) {
      console.warn(`  ⚠ geen inline spec gevonden voor ${sleutel} — overslaan (named const?)`);
      continue;
    }
    if (/\bschema\s*:/.test(m[2])) {
      // al een schema — idempotent overslaan
      continue;
    }
    const binnen = m[2].trim().replace(/,\s*$/, "");
    const nieuweSpec = `${m[1]} ${binnen}, schema: ${waarde} ${m[3]}`;
    src = src.slice(0, m.index) + nieuweSpec + src.slice(m.index + m[0].length);
    veldenToegevoegd++;
  }

  // zod-import toevoegen als er een echt schema in kwam en hij nog niet importeert.
  if (heeftEchtSchema && !/from ["']zod["']/.test(src)) {
    // Na de laatste bestaande top-import-regel.
    const importRe = /^import .*;$/gm;
    let laatste = null;
    let mm;
    while ((mm = importRe.exec(src))) laatste = mm;
    if (laatste) {
      const pos = laatste.index + laatste[0].length;
      src = src.slice(0, pos) + `\nimport { z } from "zod";` + src.slice(pos);
    } else {
      src = `import { z } from "zod";\n` + src;
    }
  }

  if (src !== origineel) {
    gewijzigd++;
    if (apply) writeFileSync(bestand, src);
    else console.log(`  ~ ${bestand} (${handlers.length} handler(s))`);
  }
}

console.log(
  `\n${apply ? "TOEGEPAST" : "DRY-RUN"}: ${gewijzigd} bestand(en), ${veldenToegevoegd} schema-veld(en) toegevoegd (withFondsRoute inline specs).`,
);
