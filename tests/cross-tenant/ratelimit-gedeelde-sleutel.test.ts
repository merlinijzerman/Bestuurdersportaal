// tests/cross-tenant/ratelimit-gedeelde-sleutel.test.ts
// -----------------------------------------------------------------------------
// #183a-commit-2 — de gedeelde-resource-regel voor rate limiting (besluit 0190).
//
// `fn_rate_limit_check` telt PER LIMIETSLEUTEL. Delen twee routes één sleutel
// (`controleerLimiet(supabase, LIMIETEN.backfill, …)`), dan tellen ze op dezelfde
// teller. Dragen ze dán verschillende `rateLimit`-declaraties — de één `"route-eigen"`
// (telt zelf), de ander een `LimietNaam` (de wrapper telt óók) — dan telt één request
// DUBBEL op die gedeelde teller, of valt een deel er stil buiten. De regel: alle
// declaraties die dezelfde limietsleutel delen dragen dezelfde `rateLimit`-waarde.
//
// VANDAAG loopt het gevaar nog niet — alle self-limiters staan op `"route-eigen"` —
// maar de poort staat er VÓÓR het gevaar ontstaat: zodra de W10-pas één van de drie
// `backfill`-routes een `LimietNaam` geeft en de andere twee niet, valt hij rood.
// Gemeten uit de bron (welke handler roept controleerLimiet met welke LIMIETEN-sleutel),
// niet uit een lijst die kan driften. Sluit aan via de *.test.ts-glob.
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, "..", "..");
const API_DIR = join(ROOT, "app", "api");

function routeBestanden(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) uit.push(...routeBestanden(pad));
    else if (naam === "route.ts") uit.push(pad);
  }
  return uit;
}

type Decl = { route: string; sleutel: string; rateLimit: string };

/** Per export-blok: welke LIMIETSLEUTEL roept de handler aan, en welke rateLimit
 *  declareert de spec? Blok = van `export const METHOD =` tot de volgende export/EOF. */
function declaraties(): Decl[] {
  const uit: Decl[] = [];
  for (const pad of routeBestanden(API_DIR)) {
    const rel = relative(ROOT, pad).split("\\").join("/").replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
    const bron = readFileSync(pad, "utf8");
    const marks = [...bron.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*withFondsRoute\(\{[^\n]*?rateLimit: "([^"]*)"/g)];
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const start = m.index!;
      const eind = i + 1 < marks.length ? marks[i + 1].index! : bron.length;
      const blok = bron.slice(start, eind);
      for (const km of blok.matchAll(/controleerLimiet\([^,]*,\s*LIMIETEN\.(\w+)/g)) {
        uit.push({ route: `${m[1]} ${rel}`, sleutel: km[1], rateLimit: m[2] });
      }
    }
  }
  return uit;
}

const decls = declaraties();

test("rate-limit — declaraties die één limietsleutel delen dragen dezelfde rateLimit-waarde", () => {
  const perSleutel = new Map<string, Decl[]>();
  for (const d of decls) (perSleutel.get(d.sleutel) ?? perSleutel.set(d.sleutel, []).get(d.sleutel)!).push(d);

  const conflicten: string[] = [];
  for (const [sleutel, groep] of perSleutel) {
    if (groep.length < 2) continue; // niet gedeeld → geen regel
    const waarden = new Set(groep.map((d) => d.rateLimit));
    if (waarden.size > 1) {
      conflicten.push(
        `LIMIETEN.${sleutel} gedeeld door ${groep.length} handlers met VERSCHILLENDE rateLimit-waarden:\n` +
          groep.map((d) => `    ${d.route} → ${d.rateLimit}`).join("\n")
      );
    }
  }
  assert.deepEqual(conflicten, [], `\n${conflicten.join("\n")}`);
});

test("rate-limit — meting vindt de bekende gedeelde sleutels (anti-stil-leeg)", () => {
  // Borgt dat de meting niet stilletjes 0 declaraties vindt (bv. na een signatuurwijziging
  // van controleerLimiet): backfill wordt door 3 handlers gedeeld, her_extract door 2.
  const tel = (s: string) => decls.filter((d) => d.sleutel === s).length;
  assert.equal(tel("backfill"), 3, `verwacht 3 backfill-handlers, kreeg ${tel("backfill")}`);
  assert.equal(tel("her_extract"), 2, `verwacht 2 her_extract-handlers, kreeg ${tel("her_extract")}`);
});
