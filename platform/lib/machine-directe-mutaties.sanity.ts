// ============================================================================
//  Driftdetector: MachineSpecV1.directeMutaties ↔ de code van de route.
//  (W5b PR 2 / #103 — de tweede grens per machineroute, deliverable 2.)
// ----------------------------------------------------------------------------
//  WAT DEZE GATE MEET. Per machineroute leest hij het routebestand als TEKST en
//  vergelijkt twee dingen:
//    • de GEDECLAREERDE lijst `directeMutaties: [...]` in de SPEC;
//    • de FEITELIJKE directe schrijf-primitieven in de handler
//      (`.delete(`, `.insert(`, `.update(`, `.upsert(`, `…storage….remove(`).
//  Wijken ze af, dan valt deze gate om. Voegt iemand later een `.delete()` toe
//  aan een worker-route zonder de SPEC bij te werken, dan wordt CI rood.
//
//  WAT DEZE GATE NIET MEET. Mutaties in aangeroepen `platform/lib`-functies. De
//  workers delegeren hun schrijfwerk; een route-surface-grep kijkt daar niet in.
//  Dat is de bewuste afbakening van `directeMutaties` (zie de typedef) en de
//  reden voor vervolgticket #172 (optie b: de wrapper levert een begrensde
//  client, zodat de grens over het hele call-pad geldt). Een gate die niet zegt
//  wat hij NIET meet, suggereert meer dekking dan hij heeft.
//
//  Puur fs + regex, geen import van de routebestanden: die trekken via
//  `withMachineRoute` → `cron-auth` het `server-only`-pad mee en zijn buiten
//  Next niet importeerbaar. Uitvoeren: npx tsx platform/lib/machine-directe-mutaties.sanity.ts
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import type { DirecteMutatie } from "./machine-route-wrapper";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = join(REPO, "app", "api");

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
console.log("machine-directe-mutaties driftdetector:");

function routeBestanden(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? routeBestanden(p) : e === "route.ts" ? [p] : [];
  });
}

/** Verwijdert regelcommentaar zodat een `.delete(` in een comment geen valse
 *  drift geeft. Blokcommentaar komt in deze routebestanden niet rond een op
 *  voor, en stringliteralen met deze tokens evenmin — bewust simpel gehouden. */
function zonderRegelcommentaar(src: string): string {
  return src
    .split("\n")
    .map((r) => {
      const i = r.indexOf("//");
      return i >= 0 ? r.slice(0, i) : r;
    })
    .join("\n");
}

/** De feitelijke directe schrijf-primitieven in de handlercode. */
function feitelijkeMutaties(src: string): Set<DirecteMutatie> {
  const code = zonderRegelcommentaar(src);
  const uit = new Set<DirecteMutatie>();
  if (/\.delete\s*\(/.test(code)) uit.add("delete");
  if (/\.insert\s*\(/.test(code)) uit.add("insert");
  if (/\.update\s*\(/.test(code)) uit.add("update");
  if (/\.upsert\s*\(/.test(code)) uit.add("upsert");
  // storage-remove: `storage.from(...).remove(` — herken de storage-context, niet
  // een willekeurige `.remove(` op een array o.i.d.
  if (/storage[\s\S]{0,80}?\.remove\s*\(/.test(code)) uit.add("storage-remove");
  return uit;
}

/** Leest de gedeclareerde `directeMutaties: [...]` uit de SPEC. Null = veld
 *  ontbreekt (dat is op zichzelf een fout: het veld is verplicht, geen default). */
function gedeclareerdeMutaties(src: string): Set<DirecteMutatie> | null {
  const m = /directeMutaties:\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  const waarden = [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1] as DirecteMutatie);
  return new Set(waarden);
}

const MACHINE_ROUTES = routeBestanden(API)
  .filter((f) => /withMachineRoute\s*\(/.test(readFileSync(f, "utf8")))
  .sort();

test("er zijn precies zeven machineroutes (vangt een stil toegevoegde route)", () => {
  assert.equal(MACHINE_ROUTES.length, 7, "aantal withMachineRoute-routes gewijzigd");
});

test("elke machineroute declareert directeMutaties (verplicht, geen default)", () => {
  for (const f of MACHINE_ROUTES) {
    const naam = relative(API, f);
    assert.notEqual(
      gedeclareerdeMutaties(readFileSync(f, "utf8")),
      null,
      `${naam} mist het verplichte veld directeMutaties`
    );
  }
});

test("gedeclareerde directeMutaties == feitelijke schrijfacties in de handler", () => {
  const afwijkingen: string[] = [];
  for (const f of MACHINE_ROUTES) {
    const src = readFileSync(f, "utf8");
    const naam = relative(API, f);
    const gedeclareerd = gedeclareerdeMutaties(src) ?? new Set<DirecteMutatie>();
    const feitelijk = feitelijkeMutaties(src);
    const gemist = [...feitelijk].filter((x) => !gedeclareerd.has(x));
    const teveel = [...gedeclareerd].filter((x) => !feitelijk.has(x));
    if (gemist.length || teveel.length) {
      afwijkingen.push(
        `${naam}: code doet {${[...feitelijk].sort().join(",")}}, ` +
          `SPEC declareert {${[...gedeclareerd].sort().join(",")}}` +
          (gemist.length ? ` — NIET gedeclareerd: ${gemist.join(",")}` : "") +
          (teveel.length ? ` — gedeclareerd maar niet gedaan: ${teveel.join(",")}` : "")
      );
    }
  }
  assert.deepEqual(
    afwijkingen,
    [],
    "directeMutaties wijkt af van de handlercode — werk de SPEC bij (en bedenk of " +
      "de nieuwe directe mutatie op een machineroute thuishoort)"
  );
});

console.log(`\nAlle ${n} directe-mutaties sanity-tests groen.`);
