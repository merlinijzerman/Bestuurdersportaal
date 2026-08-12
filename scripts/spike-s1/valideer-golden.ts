// ============================================================================
//  valideer-golden.ts — controleer golden_set.json op schema-fouten.
// ----------------------------------------------------------------------------
//  Draai:  ./node_modules/.bin/tsx scripts/spike-s1/valideer-golden.ts
//  Handig voor de domeinpersoon die labelt: vangt tikfouten (verkeerd concept,
//  type dat niet bij het concept past, datum niet-ISO, enum buiten de lijst,
//  ontbrekende velden) vóór het meten. Exit 1 bij fouten.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONCEPTEN, conceptDef } from "./concepts";

const HIER = dirname(fileURLToPath(import.meta.url));
const pad = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(HIER, "golden_set.json");

if (!existsSync(pad)) {
  console.error(`Bestand niet gevonden: ${pad}`);
  process.exit(1);
}

let data: unknown;
try {
  data = JSON.parse(readFileSync(pad, "utf8"));
} catch (e) {
  console.error(`Ongeldige JSON: ${(e as Error).message}`);
  process.exit(1);
}

const fouten: string[] = [];
const waarschuwingen: string[] = [];

if (!Array.isArray(data)) {
  console.error("Root moet een JSON-array zijn.");
  process.exit(1);
}

const geldigeConcepten = new Set(CONCEPTEN.map((c) => c.concept));

data.forEach((r, i) => {
  const p = `[${i}]`;
  if (typeof r !== "object" || r === null) {
    fouten.push(`${p} is geen object`);
    return;
  }
  const rec = r as Record<string, unknown>;

  for (const veld of ["document", "concept", "type", "value_normalized", "evidence"]) {
    if (!(veld in rec)) fouten.push(`${p} mist verplicht veld "${veld}"`);
  }
  if (!("page" in rec)) fouten.push(`${p} mist veld "page" (mag null zijn)`);

  const concept = rec.concept as string;
  const def = conceptDef(concept);
  if (!geldigeConcepten.has(concept)) {
    fouten.push(
      `${p} concept "${concept}" niet in de gesloten set (${[...geldigeConcepten].join(", ")})`
    );
    return;
  }
  if (def && rec.type !== def.type) {
    fouten.push(`${p} type "${rec.type}" past niet bij concept "${concept}" (verwacht ${def.type})`);
  }

  const v = rec.value_normalized;
  if (def) {
    if (def.type === "percentage" || def.type === "amount") {
      if (typeof v !== "number") fouten.push(`${p} value_normalized moet number zijn (${def.type})`);
    } else if (def.type === "date") {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        fouten.push(`${p} value_normalized moet ISO-datum (YYYY-MM-DD) zijn`);
    } else if (def.type === "policy_choice") {
      const toegestaan = (def.enums ?? []).map((e) => e.waarde);
      if (typeof v !== "string" || !toegestaan.includes(v))
        fouten.push(`${p} value_normalized "${String(v)}" niet in enum [${toegestaan.join(", ")}]`);
    }
    if (def.type === "amount" && rec.currency == null)
      waarschuwingen.push(`${p} amount zonder currency — voeg "currency": "EUR" toe`);
  }

  if (rec.page != null && typeof rec.page !== "number")
    fouten.push(`${p} page moet number of null zijn`);
  if (typeof rec.evidence !== "string" || (rec.evidence as string).trim().length < 3)
    fouten.push(`${p} evidence ontbreekt of is te kort`);
});

console.log(`Gecontroleerd: ${data.length} record(s) in ${pad}`);
if (waarschuwingen.length) {
  console.log(`\n${waarschuwingen.length} waarschuwing(en):`);
  for (const w of waarschuwingen) console.log(`  ⚠ ${w}`);
}
if (fouten.length) {
  console.error(`\n${fouten.length} FOUT(en):`);
  for (const f of fouten) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✓ Golden set is schema-geldig.");
