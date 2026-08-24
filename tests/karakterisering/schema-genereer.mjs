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

  // AANSCHERP-KANDIDATEN, GEEN TYPERING. De W9-handwerkverificatie (§6) toonde dat
  // een `typeof veld === "T"`-guard in deze codebase bijna altijd CONDITIONEEL
  // GEBRUIK is (`typeof x === "T" && ...` → veld genegeerd bij verkeerd type), niet
  // 400-op-type. Een veld daarom `z.T()` typeren zou STRENGER zijn dan de code:
  // onder ENFORCE_SCHEMA=on zou een body die de code vandaag accepteert (en het veld
  // negeert) een 400 krijgen. Dat is precies de stille over-strengheid die §8/§11
  // verbieden. De generator TYPEERT dus niets; elk veld is `z.unknown().optional()`.
  // De guard-detectie blijft, maar alleen als LIJST van aanscherp-kandidaten voor
  // ná fonds 1 (met observe-data en een eigen besluit) — nooit als typering.
  const veldSet = new Set(h.velden);
  const kandidaten = [];
  for (const t of h.typeofChecks || []) {
    if (t.op === "===" && PRIMITIEF[t.type] && veldSet.has(t.veld) && !kandidaten.includes(t.veld)) {
      kandidaten.push(t.veld);
    }
  }

  const bronVelden = h.velden.map((veld) => `  ${JSON.stringify(veld)}: z.unknown().optional(),`);
  const vorm = Object.fromEntries(h.velden.map((veld) => [veld, z.unknown().optional()]));

  const schema = z.object(vorm).passthrough();
  const bron =
    h.velden.length === 0
      ? "z.object({}).passthrough()"
      : `z.object({\n${bronVelden.join("\n")}\n}).passthrough()`;
  // guarded blijft leeg: geen enkel veld is getypeerd, dus de classifier heeft geen
  // guarded-uitzondering nodig. `aanscherpKandidaten` is puur informatief.
  return { schema, bron, velden: h.velden, guarded: [], aanscherpKandidaten: kandidaten };
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
