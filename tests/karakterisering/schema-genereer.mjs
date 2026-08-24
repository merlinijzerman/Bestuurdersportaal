// ============================================================================
//  W8 — Schemagenerator: conceptschema per body-lezende handler.
// ----------------------------------------------------------------------------
//  Leest de inventaris (schema-inventaris.mjs) en leidt er MECHANISCH een zod-
//  schema uit af. De leidende regel (PLAN §1, ticket §3): GEEN aanscherping
//  voorbij wat de code vandaag controleert.
//
//    - Elk veld is `.optional()`. Requiredness uit regex afleiden is onbetrouwbaar,
//      en "verplicht" is een STRENGERE claim dan de code doet zolang niet bewezen
//      is dat de handler op afwezigheid 400t. Dat bewijs is W9-handwerk.
//    - Een veld krijgt een primitief type ALLEEN als er een `typeof veld === "T"`-
//      guard op staat: dan wijst de code niet-T al af, dus `z.string()/number()/
//      boolean()` is niet strenger. Zonder guard: `z.unknown()`.
//    - `typeof x === "string"` wijst óók `null` af (`typeof null === "object"`),
//      dus `.optional()` en NIET `.nullable()` — dat spiegelt de code (mutatie-
//      klasse 2). Geen guard → `z.unknown()` accepteert `null` net als de code.
//    - Het object is `.passthrough()`: onbekende velden toegestaan, zoals de code
//      ze negeert (mutatieklasse 1). Zod 4 `z.object()` is standaard al non-strict
//      op onbekende sleutels; `.passthrough()` maakt dat expliciet en robuust.
//    - Het TOPTYPE is bewust `z.unknown().pipe(...)` NIET afgedwongen als object:
//      veel handlers doen `body.x` op een niet-object zonder te crashen (dan is x
//      undefined), dus een object EISEN kan strenger zijn dan de code. Daarom
//      `z.union([z.object(...).passthrough(), z.unknown()])`? Nee — dat is
//      betekenisloos. We kiezen het object als concept en laten de differentiële
//      classifier bewijzen dat geen corpus-body erdoor valt; waar dat wél gebeurt,
//      is de handler onderbedekt/handwerk (W9), niet het schema te streng.
//
//  Dit is een CONCEPT. De echte, strengere schema's zijn W9-handwerk, per handler,
//  met de differentiële classifier als grendel.
// ============================================================================
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { bouwInventaris } from "./schema-inventaris.mjs";

const PRIMITIEF = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
};

/** Eén conceptschema uit één inventaris-handler. Retourneert het runtime zod-object
 *  plus een leesbare bronstring (voor de step-3-dump die W9 als startpunt neemt). */
export function genereerSchema(h) {
  if (!h.bodyLezend) return { schema: null, bron: '"geen-body"', velden: [] };

  // Guard-map: veld -> primitieftype, alleen bij een `typeof veld === "T"`-guard.
  // FILTER op h.velden: de typeof-detectie vangt óók bare `typeof localVar` (bv.
  // een lusvariabele `s`/`a` of `nieuweWaarde`), en dat is GEEN body-veldguard.
  // Zonder deze filter zou een lokale variabele een schemaveld ten onrechte
  // typeren — de enige plek waar de generator te streng zou kunnen worden.
  const veldSet = new Set(h.velden);
  const guard = {};
  for (const t of h.typeofChecks || []) {
    if (t.op === "===" && PRIMITIEF[t.type] && veldSet.has(t.veld)) guard[t.veld] = t.type;
  }

  const vorm = {};
  const bronVelden = [];
  for (const veld of h.velden) {
    if (guard[veld]) {
      vorm[veld] = PRIMITIEF[guard[veld]]().optional();
      bronVelden.push(`  ${JSON.stringify(veld)}: z.${guard[veld]}().optional(),`);
    } else {
      vorm[veld] = z.unknown().optional();
      bronVelden.push(`  ${JSON.stringify(veld)}: z.unknown().optional(),`);
    }
  }

  const schema = z.object(vorm).passthrough();
  const bron =
    h.velden.length === 0
      ? "z.object({}).passthrough()  // 0 velden afgeleid — handwerk W9"
      : `z.object({\n${bronVelden.join("\n")}\n}).passthrough()`;
  return { schema, bron, velden: h.velden, guarded: Object.keys(guard) };
}

/** Map<`METHOD bestand`, {schema, bron, ...}> voor alle body-lezende handlers. */
export function genereerSchemas() {
  const inv = bouwInventaris();
  const map = new Map();
  for (const h of inv) {
    if (!h.bodyLezend) continue;
    const sleutel = `${h.methode} ${h.bestand}`;
    map.set(sleutel, { ...genereerSchema(h), handler: h });
  }
  return map;
}

// ── CLI: dump de conceptschema's als leesbare bron (step-3-artefact) ──────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map = genereerSchemas();
  console.log(`// Conceptschema's — ${map.size} body-lezende handlers (W8, mechanisch, niet-strenger)\n`);
  for (const [sleutel, { bron, guarded }] of [...map.entries()].sort()) {
    console.log(`// ${sleutel}${guarded?.length ? `   (getypeerd: ${guarded.join(", ")})` : ""}`);
    console.log(`${bron}\n`);
  }
}
