import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { census, REGISTER_PAD, contextCensus, lezingen, lezingenPerKlasse, klassenPerTabel, resolveerImport, LEZINGKLASSE, CONTEXT_REGISTER_PAD } from "../karakterisering/retrieval-census.mjs";

// #322 F4-T1 — de retrievalkern heeft vandaag een klein, bekend aantal directe
// aanroepers. Dit register bevriest ze vóór de verplaatsing achter het
// gemeenschappelijke contract (T2). Een nieuwe aanroeper, een nieuw symbool of
// een directe zoek-RPC buiten het register maakt de gate rood; een verdwenen
// aanroeper ook (stale entry), zodat het register nooit stil verwatert.
const register = JSON.parse(readFileSync(REGISTER_PAD, "utf8")) as { census: Record<string, unknown> };

test("F4-census — directe aanroepers van de retrievalkern zijn exact het bevroren register", () => {
  const nu = census();
  const verwacht = register.census;
  const nieuw = Object.keys(nu).filter((b) => !(b in verwacht));
  const verdwenen = Object.keys(verwacht).filter((b) => !(b in nu));
  assert.deepEqual(nieuw, [], `nieuwe directe aanroeper(s) buiten het register: ${nieuw.join(", ")} — motiveer en regenereer met node tests/karakterisering/retrieval-census.mjs --schrijf`);
  assert.deepEqual(verdwenen, [], `stale registerentry: ${verdwenen.join(", ")} — regenereer het register`);
  assert.deepEqual(nu, verwacht, "symbolen/RPC's/tabellen per aanroeper zijn gewijzigd — motiveer en regenereer het register");
});

test("F4-census — zoek-RPC's leven uitsluitend in rag.ts; directe document_chunks-lezers op het antwoordpad zijn bekend", () => {
  const nu = census();
  const directeRpc = Object.entries(nu).filter(([, e]) => (e as { rpcs: string[] }).rpcs.length > 0).map(([b]) => b);
  assert.deepEqual(directeRpc, [], `zoek-RPC buiten de kern: ${directeRpc.join(", ")}`);
  // Bevinding F4-T1 (geen aanname): de chatroute leest document_chunks ook
  // rechtstreeks, buiten rag.ts om. T2 brengt dat achter de adapter; tot die
  // tijd is dit de enige route op het antwoordpad met directe tabeltoegang.
  const antwoordpad = Object.entries(nu)
    .filter(([b, e]) => b.startsWith("app/api/") && (e as { tabellen: string[] }).tabellen.length > 0 && !/backfill|classificatie/.test(b))
    .map(([b]) => b).sort();
  assert.deepEqual(antwoordpad, ["app/api/chat/route.ts"]);
});

test("F4-census — de productie-ingangen van zoekRelevanteChunksMetMeta zijn bekend, en de chatroute hoort er niet meer bij", () => {
  const nu = census();
  const ingangen = Object.entries(nu)
    .filter(([, e]) => ((e as { modules: Record<string, string[]> }).modules.rag ?? []).includes("zoekRelevanteChunksMetMeta"))
    .map(([b]) => b).sort();
  // T2-1/PR-A: C1 loopt door het contract, dus `app/api/chat/route.ts` roept de
  // retrievalkern niet langer rechtstreeks aan — de adapter doet dat. Dit is de
  // krimp die T2-4 voor de hele census beoogt, hier alvast voor het antwoordpad.
  // C5 (zoeken) en C6 (vergelijk) volgen in T2-2; blijven die staan, dan is de
  // cutover onvolledig en hoort deze lijst rood te worden.
  assert.deepEqual(ingangen, [
    "app/api/zoeken/route.ts",
    "core/lib/retrieval/supabase-adapter.ts",
    "core/lib/vergelijk-productie.ts",
  ]);
});

// ── #348 §1 — het antwoordpadregister (reviewronde 3) ───────────────────────
//  Drie correcties op de vorige opzet, alle uit de review:
//   (a) de "transitieve" scan resolveerde relatieve specifiers verkeerd —
//       `./config-db-core` vanuit `core/lib/ai-gateway/config-db.ts` werd
//       `core/lib/config-db-core.ts`, en `../ai-poort` werd genegeerd;
//   (b) classificeren per TABEL was te grof: `profielen` doet op vijf plekken
//       drie verschillende dingen. Het gaat nu per LEZING (`bestand::tabel`),
//       en een lezing mag meerdere klassen dragen;
//   (c) `concepts` is geen evidence maar een begrippencatalogus.
const contextRegister = JSON.parse(readFileSync(CONTEXT_REGISTER_PAD, "utf8")) as {
  bereikte_bestanden: number;
  lezingen_per_klasse: Record<string, string[]>;
  klassen_per_tabel: Record<string, string[]>;
  contextbronnen: Record<string, { tabellen: string[] }>;
};

test("F4-context — het antwoordpadregister is exact bevroren", () => {
  const nu = contextCensus();
  assert.deepEqual(
    nu.bestanden, contextRegister.contextbronnen,
    "het antwoordpad leest andere tabellen dan bevroren — motiveer en regenereer met node tests/karakterisering/retrieval-census.mjs --schrijf"
  );
  assert.equal(nu.bereikte_bestanden, contextRegister.bereikte_bestanden,
    "de importgraaf vanaf de chatroute is van omvang veranderd — beoordeel of er een nieuw pad bij is gekomen");
});

// ── (a) de resolver: negatieve controle op geneste ./ en ../ ────────────────
test("F4-context — de importresolver volgt geneste ./ en ../ specifiers", () => {
  // Precies de drie gevallen die de vorige resolver misdeed of oversloeg.
  assert.equal(
    resolveerImport("core/lib/ai-gateway/config-db.ts", "./config-db-core"),
    "core/lib/ai-gateway/config-db-core.ts",
    "een ./-import moet relatief aan de map van de IMPORTERENDE file resolveren, niet aan core/lib"
  );
  assert.equal(
    resolveerImport("core/lib/ai-gateway/gateway-productie.ts", "../ai-poort"),
    "core/lib/ai-poort.ts",
    "een ../-import werd door de eerste versie volledig genegeerd"
  );
  assert.equal(
    resolveerImport("core/lib/ai-gateway/gateway.ts", "./adapters/types"),
    "core/lib/ai-gateway/adapters/types.ts",
    "een geneste ./-import over meerdere segmenten moet resolveren"
  );
  // Bare specifiers en niet-bestaande paden leveren null, niet een verzonnen pad.
  assert.equal(resolveerImport("core/lib/rag.ts", "next/server"), null);
  assert.equal(resolveerImport("core/lib/rag.ts", "./bestaat-echt-niet-xyz"), null);
  // De alias volgt tsconfig `{"@/*": ["./*"]}`.
  assert.equal(resolveerImport("app/api/chat/route.ts", "@/core/lib/rag"), "core/lib/rag.ts");
});

test("F4-context — de bestanden die alleen via ../ of een geneste ./ bereikbaar zijn, zitten in de graaf", () => {
  // `ai-poort.ts` is uitsluitend bereikbaar via `../ai-poort` vanuit
  // core/lib/ai-gateway/**. Zat de vorige scan ernaast, dan ontbrak dit hele
  // deel van de graaf zonder dat iets rood werd.
  const bereikt = contextCensus().bestanden;
  const alleBereikt = new Set(Object.keys(bereikt));
  // Het register bevat alleen LEZERS; voor de graafcontrole tellen we de omvang.
  assert.ok(contextCensus().bereikte_bestanden >= 110,
    `de graaf is kleiner dan verwacht (${contextCensus().bereikte_bestanden}) — resolveert de scanner nog wel?`);
  assert.ok(alleBereikt.has("core/lib/parent-context.ts"),
    "parent-context.ts leest document_chunks en moet in het register staan");
});

// ── (b) classificatie per lezing ───────────────────────────────────────────
test("F4-context — elke bereikte lezing is geclassificeerd", () => {
  const k = lezingenPerKlasse() as Record<string, string[]>;
  assert.deepEqual(
    k.onbekend, [],
    `bereikte lezing zonder klasse: ${k.onbekend.join(", ")} — deel haar in LEZINGKLASSE in ` +
      "(evidence / modelcontext / configuratie / audit; meerdere klassen mag). Dat is een ontwerpoordeel: laat het niet meeliften."
  );
});

test("F4-context — de klassenverdeling per lezing is hard gepind", () => {
  const k = lezingenPerKlasse() as Record<string, string[]>;
  assert.equal(lezingen().length, 46, "het aantal lezingen op het antwoordpad is gewijzigd");
  assert.equal(k.evidence.length, 8, `evidence: ${k.evidence.join(", ")}`);
  assert.equal(k.modelcontext.length, 26, `modelcontext: ${k.modelcontext.join(", ")}`);
  assert.equal(k.configuratie.length, 11, `configuratie: ${k.configuratie.join(", ")}`);
  assert.equal(k.audit.length, 3, `audit: ${k.audit.join(", ")}`);
  assert.equal(Object.keys(LEZINGKLASSE).length, 46, "LEZINGKLASSE bevat regels voor lezingen die het antwoordpad niet meer doet");
});

test("F4-context — één tabel kan meerdere hoedanigheden hebben", () => {
  const kt = klassenPerTabel() as Record<string, string[]>;
  // De bevinding uit de review: `profielen` is niet alleen configuratie.
  assert.deepEqual(kt.profielen, ["configuratie", "modelcontext"],
    "profielen levert zowel autorisatie/identiteit als modelcontext (naam, bestuurlijke rol, antwoordvoorkeur, detailniveau)");
  assert.deepEqual(kt.documenten, ["evidence", "modelcontext"]);
  assert.deepEqual(kt.governance_log_inhoud, ["audit", "modelcontext"]);
  // En per lezing is het onderscheid scherp:
  assert.deepEqual(LEZINGKLASSE["core/lib/capabilities.ts::profielen"].klassen, ["configuratie"]);
  assert.deepEqual(LEZINGKLASSE["core/lib/profielsturing.ts::profielen"].klassen, ["modelcontext"]);
  assert.deepEqual(LEZINGKLASSE["app/api/chat/route.ts::profielen"].klassen, ["modelcontext", "configuratie"]);
});

test("F4-context — configuratie en bronbeleid tellen niet als modelcontext", () => {
  const kt = klassenPerTabel() as Record<string, string[]>;
  for (const t of ["fonds_theming", "fonds_feature_flags", "bron_whitelist", "concepts"]) {
    assert.deepEqual(kt[t], ["configuratie"], `${t} moet uitsluitend configuratie zijn`);
  }
});

// ── (c) evidence: wat is werkelijk citeerbaar bewijs ────────────────────────
test("F4-context — evidence is documentgebonden bewijs, en drie van de vier lopen deels buiten de kern", () => {
  const k = lezingenPerKlasse() as Record<string, string[]>;
  const evidenceTabellen = [...new Set(k.evidence.map((s) => s.split("::")[1]))].sort();
  // `concepts` staat hier bewust NIET meer: dat is een begrippencatalogus
  // (id/key/label/type/status), geen documentgebonden bewijs.
  assert.deepEqual(evidenceTabellen, ["decision_objects", "document_chunks", "documenten", "semantic_units"]);
  const viaKern = k.evidence.filter((s) => s.startsWith("core/lib/rag.ts::") || s.startsWith("core/lib/retrieval/")).sort();
  assert.deepEqual(viaKern, [
    "core/lib/rag.ts::document_chunks",
    "core/lib/rag.ts::documenten",
    "core/lib/retrieval/supabase-versie.ts::document_chunks",
  ]);
  // De overige vijf evidencelezingen lopen buiten rag.ts om — gaplijst G-1a/G-8.
  const buitenKern = k.evidence.filter((s) => !viaKern.includes(s)).sort();
  assert.deepEqual(buitenKern, [
    "app/api/chat/route.ts::decision_objects",
    "app/api/chat/route.ts::document_chunks",
    "core/lib/besluitvorming-bron.ts::decision_objects",
    "core/lib/parent-context.ts::document_chunks",
    "core/lib/vergelijk-productie.ts::semantic_units",
  ]);
});
