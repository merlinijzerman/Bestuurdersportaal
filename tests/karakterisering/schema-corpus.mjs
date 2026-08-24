// ============================================================================
//  W8 — Corpus-extractor: per handler de harnas-bodies die zijn code ACCEPTEERT.
// ----------------------------------------------------------------------------
//  Het karakteriseringsharnas is groen (`npm run sanity`), dus elke body in een
//  scenario is per constructie een body die de huidige code van díé route
//  accepteert of afwijst zoals ze vandaag doet. Dit script haalt die bodies op en
//  groepeert ze per handler (routebestand + methode), zodat de differentiële
//  classifier (schema-niet-strenger.mjs) ze als bekend-goede invoer kan gebruiken.
//
//  KRITIEK (PLAN §2.4): corpusomvang is de verkeerde maat. Een schema is pas
//  aantoonbaar niet-strenger als zijn handler MEERDERE, verschillende bodies
//  krijgt. Dit script rapporteert daarom het aantal DISTINCTE bodies per handler
//  en markeert elke handler met 0 of 1 als `onderbedekt` — die lijst valt samen
//  met de niet-afleidbaar-lijst uit de inventaris en is de handwerkscope van W9.
//
//  Body-status: sommige scenario's sturen bewust een body die de code AFWIJST
//  (een 400/403/404-scenario). Voor "niet strenger" tellen alleen bodies die de
//  code ACCEPTEERT — d.w.z. scenario's met een 2xx/redirect-verwachting, of waar
//  de afwijzing NIET over de bodyvorm gaat. Dit script markeert per body de
//  verwachte status uit de snapshot zodat de classifier de accepterende kan
//  selecteren; het raadt niet.
//
//  Gebruik:
//    node tests/karakterisering/schema-corpus.mjs            # coverage-samenvatting
//    node tests/karakterisering/schema-corpus.mjs --json     # volledige corpus per handler
//    node tests/karakterisering/schema-corpus.mjs --out=<pad>
// ============================================================================
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, relative } from "node:path";
import { scenarios } from "./scenarios.mjs";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "app", "api");
const args = process.argv.slice(2);
const jsonUit = args.includes("--json");
const outArg = args.find((a) => a.startsWith("--out="));

// ── Routepatronen uit de app/api-boom ────────────────────────────────────────
// Elke route.ts → een patroon waarin [x]-segmenten wildcards zijn. Het meest
// SPECIFIEKE patroon (minste wildcards, langste pad) wint bij een match.
function routeBestanden(dir) {
  const uit = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) uit.push(...routeBestanden(pad));
    else if (naam === "route.ts") uit.push(pad);
  }
  return uit;
}

function patroonVoor(bestand) {
  // app/api/risicos/[id]/route.ts -> /api/risicos/[^/]+
  const rel = relative(API_DIR, bestand).replace(/\/route\.ts$/, "");
  const segs = rel.split("/");
  const wildcards = segs.filter((s) => s.startsWith("[")).length;
  const re = new RegExp(
    "^/api/" +
      segs
        .map((s) => (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("/") +
      "/?$"
  );
  return { bestand: relative(ROOT, bestand), re, wildcards, lengte: segs.length };
}

const patronen = routeBestanden(API_DIR).map(patroonVoor);

function resolveerHandler(path) {
  const kaal = path.split("?")[0].replace(/\/+$/, "") || "/";
  const kandidaten = patronen.filter((p) => p.re.test(kaal + "/") || p.re.test(kaal));
  if (kandidaten.length === 0) return null;
  // Meest specifiek: minste wildcards, dan langste pad.
  kandidaten.sort((a, b) => a.wildcards - b.wildcards || b.lengte - a.lengte);
  return kandidaten[0].bestand;
}

// ── Bodies per handler ────────────────────────────────────────────────────────
/** Bouwt de corpus: per handler (`METHOD bestand`) de distincte harnas-bodies.
 *  Herbruikbaar door de differentiële classifier zodat er geen tweede, driftende
 *  kopie van deze mapping ontstaat. */
export function bouwCorpus() {
  const perHandler = new Map();
  const onopgelost = [];

  for (const s of scenarios) {
    if (s.body === undefined) continue;
    const bestand = resolveerHandler(s.path);
    if (!bestand) {
      onopgelost.push(`${s.method} ${s.path}`);
      continue;
    }
    const sleutel = `${s.method} ${bestand}`;
    if (!perHandler.has(sleutel)) perHandler.set(sleutel, { handler: sleutel, bodies: [], slugs: [] });
    const rec = perHandler.get(sleutel);
    const serialized = JSON.stringify(s.body);
    if (!rec.bodies.some((b) => JSON.stringify(b) === serialized)) rec.bodies.push(s.body);
    rec.slugs.push(s.slug);
  }

  const handlers = [...perHandler.values()].map((h) => ({
    handler: h.handler,
    distincteBodies: h.bodies.length,
    scenarios: h.slugs.length,
    bodies: h.bodies,
  }));
  handlers.sort((a, b) => a.distincteBodies - b.distincteBodies || a.handler.localeCompare(b.handler));

  const onderbedekt = handlers.filter((h) => h.distincteBodies <= 1);
  return {
    totaalHandlersMetBody: handlers.length,
    onderbedekt: onderbedekt.map((h) => `${h.handler} (${h.distincteBodies})`),
    onopgelosteScenariopaden: [...new Set(onopgelost)],
    handlers,
  };
}

// CLI-uitvoer alleen bij DIRECT draaien, niet bij import (de classifier importeert bouwCorpus).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const corpus = bouwCorpus();
const onderbedekt = corpus.handlers.filter((h) => h.distincteBodies <= 1);
const handlers = corpus.handlers;

if (outArg) {
  writeFileSync(outArg.slice("--out=".length), JSON.stringify(corpus, null, 2));
  console.log(`Corpus geschreven (${handlers.length} handlers met body).`);
} else if (jsonUit) {
  console.log(JSON.stringify(corpus, null, 2));
} else {
  console.log(`Corpus-dekking — ${handlers.length} handlers ontvangen ≥1 body uit het harnas\n`);
  const verdeling = {};
  for (const h of handlers) verdeling[h.distincteBodies] = (verdeling[h.distincteBodies] ?? 0) + 1;
  console.log("  distincte-body-verdeling (aantal bodies → aantal handlers):");
  for (const n of Object.keys(verdeling).sort((a, b) => a - b)) {
    console.log(`    ${n} bod${n === "1" ? "y" : "ies"} → ${verdeling[n]} handler(s)`);
  }
  console.log(`\n  ONDERBEDEKT (0-1 distincte body → niet-geverifieerd, handwerk W9): ${onderbedekt.length}`);
  for (const h of onderbedekt) console.log(`    - ${h.handler}`);
  if (corpus.onopgelosteScenariopaden.length) {
    console.log(`\n  ⚠ onopgeloste scenariopaden (geen routematch): ${corpus.onopgelosteScenariopaden.length}`);
    for (const p of corpus.onopgelosteScenariopaden) console.log(`    - ${p}`);
  }
}
}
