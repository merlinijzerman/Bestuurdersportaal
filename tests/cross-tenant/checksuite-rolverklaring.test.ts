// ============================================================================
//  ROL-1 — elke aangesloten checksuite verklaart als welke rol zij meet.
// ----------------------------------------------------------------------------
//  WAAROM DIT EEN GATE IS EN GEEN AFSPRAAK
//
//  Elke controle op deze database meet iets ANDERS afhankelijk van de rol die
//  verbindt, en beide kanten falen STIL:
//
//    • als `postgres` zie je alles — die rol heeft BYPASSRLS. "Geen lek
//      gevonden" betekent dan niets, want RLS stond nooit tussen jou en de
//      data;
//    • als beperkte rol zie je niets waar RLS weigert. Een suite die daar geen
//      rijen krijgt, meldt geen fout maar LEEGTE — en wie die leegte pint,
//      bevriest "er is hier niets" als de verwachte toestand.
//
//  Dat is geen theorie. Drie keer geraakt in augustus 2026, en elke keer zag
//  het er groen uit:
//
//    1. V2 (#78) — FORCE ROW LEVEL SECURITY bleek zinloos als tweede laag,
//       omdat de eigenaar `postgres` BYPASSRLS heeft en BYPASSRLS FORCE
//       overruleert.
//    2. #65 — `storage.buckets` heeft RLS AAN met NUL policies. De read-only
//       driftrol zag daar 0 buckets waar `postgres` er 4 zag. De momentopname
//       velt geen oordeel maar produceert regels, dus pinnen in die toestand
//       had bucketdrift permanent onzichtbaar gemaakt.
//    3. Dezelfde week, in een guard die ik zelf schreef: een telling zonder
//       rolwissel meet wat `postgres` ziet, en kon daardoor nooit afgaan —
//       precies wanneer je hem nodig hebt.
//
//  Vandaar de regel: schrijf op ALS WELKE ROL je meet, en waarom dat de juiste
//  rol is voor DÉZE vraag. Niet als stijlvoorschrift, maar omdat de rol de
//  betekenis van de uitkomst bepaalt.
//
//  WAT DEZE TEST WEL EN NIET DOET
//  Hij eist dat de verklaring ER IS, en dat zij een rol NOEMT. Of de gekozen
//  rol de juiste is voor de vraag, kan een grep niet beoordelen — dat blijft
//  mensenwerk bij review. De gate voorkomt alleen dat de vraag ONGESTELD blijft.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/checksuite-rolverklaring.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const wortel = join(hier, "..", "..");
const lees = (p: string) => readFileSync(join(wortel, p), "utf8");

/** De suites die daadwerkelijk in de gate draaien — uit het CI-script zelf, niet
 *  uit een tweede lijst die kan gaan afwijken. */
function aangeslotenSuites(): string[] {
  const script = lees(join("scripts", "cross-tenant-ci.sh"));
  const uitvoerregels = script
    .split("\n")
    .filter((r) => /^\s*psql .*-f "\$SQL_/.test(r));
  const variabelen = uitvoerregels
    .map((r) => r.match(/\$\{?(SQL_[A-Z0-9_]+)\}?/)?.[1])
    .filter((v): v is string => Boolean(v));
  const paden = new Set<string>();
  for (const v of variabelen) {
    const m = script.match(new RegExp(`^${v}="([^"]+)"`, "m"));
    if (m) paden.add(m[1]);
  }
  return [...paden].sort();
}

const ROL_REGEL = /^--\s*ROL:\s*(\S.*)$/m;
// De rolnamen die in deze database bestaan. Een verklaring die er geen enkele
// noemt, is geen verklaring maar een zin.
const ROLNAMEN = /\b(postgres|authenticated|anon|service_role|drift_lezer)\b/;

test("ROL-1 — het CI-script levert een niet-lege lijst aangesloten suites", () => {
  const suites = aangeslotenSuites();
  assert.ok(
    suites.length >= 20,
    `verwacht ≥20 aangesloten suites, kreeg ${suites.length}. Verandert de vorm ` +
      "van cross-tenant-ci.sh, pas dan aangeslotenSuites() aan — een lege lijst " +
      "zou deze hele gate stilzwijgend uitschakelen."
  );
});

for (const pad of aangeslotenSuites()) {
  test(`ROL-1 — ${pad} verklaart als welke rol zij meet`, () => {
    assert.ok(existsSync(join(wortel, pad)), `${pad} bestaat niet`);
    const bron = lees(pad);
    const m = bron.match(ROL_REGEL);
    assert.ok(
      m,
      `${pad} mist een '-- ROL:'-regel. Schrijf op als welke rol deze suite meet ` +
        "en waarom dat de juiste rol is voor de vraag die zij stelt."
    );
    assert.match(
      m![1],
      ROLNAMEN,
      `${pad}: de ROL-regel noemt geen bekende rolnaam (postgres, authenticated, ` +
        `anon, service_role). Gevonden: "${m![1].slice(0, 80)}"`
    );
  });
}
