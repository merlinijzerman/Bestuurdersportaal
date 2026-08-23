// ============================================================================
//  VEN-2 — stemfunctie achter een modulevlag, uit voor élk fonds.
// ----------------------------------------------------------------------------
//  Besluit opdrachtgever 23-08-2026: stemmen is niet toegezegd aan fonds 1 en
//  hoort bestuurlijk separaat te worden ingevoerd. De functie is NIET verwijderd
//  — ze is een producent in de bewijsketen (stemverslag-bewijs, decision-dossier,
//  afschrift-manifest `bevat_stemgedrag`, dissent-FK) — maar staat uit en is niet
//  per fonds aan te zetten.
//
//  Wat deze suite vastlegt:
//    (1) De REGISTRY-combinatie klopt én werkt: defaultActief=false +
//        manifestBeheerbaar=false levert "overal uit", ook mét een manifestrij
//        die 'aan' zegt. Dit is de test die de valkuil afdekt: vóór VEN-2 maakte
//        beschikbareModuleKeys() élke niet-beheerbare key onvoorwaardelijk
//        beschikbaar, waardoor deze combinatie het TEGENOVERGESTELDE deed.
//    (2) NULGRENS: de kern-infrastructuur blijft zich niet laten uitzetten.
//    (3) De MAATREGEL is server-side: alle vier /api/stemmingen-routes roepen
//        weigerAlsModuleUit(..., "stemmingen") aan (bron-inspectie). De UI is
//        cosmetica; deze test is er zodat stap 4 nooit zonder stap 3 landt.
//    (4) De sleutel is NIET zelfservice-beheerbaar (niet in beheerbareModules).
//    (5) Sub-functie: geen eigen nav-item en geen eigen pad→module-mapping,
//        zodat de gedeelde href met `vergaderingen` niet botst.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/ven2-stemmen-modulevlag.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MODULE_REGISTRY,
  beheerbareModules,
  beschikbareModuleKeys,
  moduleVanPad,
} from "../../core/lib/module-registry";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

// ── (1) De vlag zelf ────────────────────────────────────────────────────────

test("VEN-2 — de registry zet 'stemmingen' uit en houdt hem uit het zelfservicescherm", () => {
  const def = MODULE_REGISTRY.stemmingen;
  assert.equal(def.defaultActief, false, "stemmen mag nergens default aan staan");
  assert.equal(
    def.manifestBeheerbaar,
    false,
    "aanzetten hoort een codewijziging te vergen, geen tenant-zelfservice"
  );
});

test("VEN-2 — zonder manifest is stemmen niet beschikbaar (geen migratie nodig)", () => {
  assert.equal(beschikbareModuleKeys(null).has("stemmingen"), false);
});

test("VEN-2 — een manifestrij 'aan' kan stemmen NIET alsnog openen", () => {
  // Precies de aanval die manifestBeheerbaar=false moet afdekken: een fonds
  // (of een foutieve seed) schrijft module_key='stemmingen', actief=true.
  const set = beschikbareModuleKeys(new Map([["stemmingen", true]]));
  assert.equal(set.has("stemmingen"), false, "het manifest mag deze key niet openen");
  assert.ok(set.has("vergaderingen"), "de dragende module blijft ongemoeid");
});

test("VEN-2 — nulgrens: kern-infrastructuur laat zich nog steeds niet uitzetten", () => {
  // Regressiewacht op de gewijzigde tak in beschikbareModuleKeys(): niet-
  // beheerbaar betekent nu "het manifest beslist niet", niet "altijd aan".
  const set = beschikbareModuleKeys(
    new Map([["beheer", false], ["home", false], ["governance", false], ["assurance", false]])
  );
  for (const k of ["beheer", "home", "governance", "assurance"] as const) {
    assert.ok(set.has(k), `kern-module ${k} mag zich niet laten uitzetten`);
  }
});

test("VEN-2 — stemmen staat niet in het tenant-zelfservicescherm", () => {
  assert.equal(
    beheerbareModules().some((m) => m.key === "stemmingen"),
    false,
    "een voorzitter mag deze module niet kunnen aanzetten"
  );
});

// ── (2) De maatregel: server-side, op alle vier de routes ───────────────────

const STEMROUTES = [
  "app/api/stemmingen/route.ts",
  "app/api/stemmingen/[id]/stemmen/route.ts",
  "app/api/stemmingen/[id]/sluiten/route.ts",
  "app/api/stemmingen/[id]/intrekken/route.ts",
];

test("VEN-2 — elke stemroute weigert server-side via weigerAlsModuleUit('stemmingen')", () => {
  for (const pad of STEMROUTES) {
    const src = lees(pad);
    assert.ok(
      src.includes('weigerAlsModuleUit(ctx.fondsId, "stemmingen")'),
      `${pad}: verwacht de server-side beschikbaarheidscheck op de eigen fondscontext`
    );
  }
});

test("VEN-2 — de guard staat vóór body-validatie en resource-lookups", () => {
  // Anders hangt de weigering af van een geldige body of een bestaand record en
  // levert een directe API-call een 400/404 in plaats van het bedoelde 403.
  for (const pad of STEMROUTES) {
    const src = lees(pad);
    const guard = src.indexOf("weigerAlsModuleUit(");
    assert.ok(guard > -1, `${pad}: guard ontbreekt`);
    const eersteLees = src.indexOf(".from(");
    if (eersteLees > -1) {
      assert.ok(guard < eersteLees, `${pad}: guard moet vóór de eerste DB-lees staan`);
    }
    const body = src.indexOf("req.json()");
    if (body > -1) {
      assert.ok(guard < body, `${pad}: guard moet vóór de body-validatie staan`);
    }
  }
});

test("VEN-2 — de UI-verberging is cosmetica bovenop de server-guard, niet in plaats daarvan", () => {
  const pagina = lees("app/(dashboard)/vergaderingen/[id]/page.tsx");
  assert.ok(
    pagina.includes('moduleBeschikbaar(v.fonds_id, "stemmingen")'),
    "de pagina hoort de beschikbaarheid server-side te bepalen"
  );
  const kaart = lees("app/(dashboard)/vergaderingen/_components/AgendapuntKaart.tsx");
  assert.ok(
    kaart.includes("stemmenBeschikbaar &&"),
    "het stemblok hoort achter de beschikbaarheidsvlag te staan"
  );
});

// ── (3) Sub-functie, geen navigatie-item ────────────────────────────────────

test("VEN-2 — stemmen is een sub-functie: niet navigeerbaar, geen eigen pad-mapping", () => {
  assert.equal(MODULE_REGISTRY.stemmingen.navigeerbaar, false);
  // De href valt samen met die van `vergaderingen`; de mapping moet ondubbelzinnig
  // de dragende module teruggeven.
  assert.equal(moduleVanPad("/vergaderingen"), "vergaderingen");
  assert.equal(moduleVanPad("/vergaderingen/abc"), "vergaderingen");
});

test("VEN-2 — de sidebar toont sub-functies nooit als eigen menu-item", () => {
  const sidebar = lees("core/components/Sidebar.tsx");
  assert.ok(
    sidebar.includes("m.navigeerbaar !== false"),
    "nav-filter moet niet-navigeerbare modules uitsluiten, ook als ze ooit AAN gaan"
  );
});

// ── (4) Niets verwijderd — de bewijsketen blijft intact ─────────────────────

test("VEN-2 — de bewijsketen is ongemoeid: dit ticket is een schakelaar, geen sloop", () => {
  assert.ok(
    lees("app/api/stemmingen/[id]/sluiten/route.ts").includes("procedure_bewijs"),
    "het stemverslag-bewijs hoort te blijven bestaan"
  );
  assert.ok(
    lees("core/lib/afschrift-manifest.ts").includes("bevat_stemgedrag"),
    "de openbaarmakingsmarkering op het afschrift-manifest hoort ongewijzigd te blijven"
  );
});
