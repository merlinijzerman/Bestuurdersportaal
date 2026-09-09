import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { census, REGISTER_PAD, contextCensus, tabellenPerKlasse, TABELKLASSE, CONTEXT_REGISTER_PAD } from "../karakterisering/retrieval-census.mjs";

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

test("F4-census — de vier productie-ingangen van zoekRelevanteChunksMetMeta zijn bekend", () => {
  const nu = census();
  const ingangen = Object.entries(nu)
    .filter(([, e]) => ((e as { modules: Record<string, string[]> }).modules.rag ?? []).includes("zoekRelevanteChunksMetMeta"))
    .map(([b]) => b).sort();
  assert.deepEqual(ingangen, ["app/api/chat/route.ts", "app/api/zoeken/route.ts", "core/lib/vergelijk-productie.ts"]);
});

// ── #348 §1 — het antwoordpadregister (reviewronde 2) ───────────────────────
//  Twee correcties op de eerste opzet. (a) De scan is TRANSITIEF: de directe
//  variant miste `fonds-sessie.ts`, `profiel.ts` en — het meest sprekend —
//  `parent-context.ts`, dat `document_chunks` rechtstreeks leest. (b) De eerdere
//  claim "31 contexttabellen" klopte niet: daarin zaten configuratie,
//  autorisatie en bronbeleid. Elke bereikte tabel draagt nu een expliciete
//  klasse, en een ONBEKENDE tabel maakt de gate rood.
const contextRegister = JSON.parse(readFileSync(CONTEXT_REGISTER_PAD, "utf8")) as {
  bereikte_bestanden: number;
  klassen: Record<string, string[]>;
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

test("F4-context — elke bereikte tabel is geclassificeerd", () => {
  const k = tabellenPerKlasse() as Record<string, string[]>;
  assert.deepEqual(
    k.onbekend, [],
    `bereikte tabel zonder klasse: ${k.onbekend.join(", ")} — deel haar in TABELKLASSE in (evidence / modelcontext / configuratie / audit). ` +
      "Dat is een ontwerpoordeel: laat het niet meeliften."
  );
});

test("F4-context — de klassenverdeling is hard gepind", () => {
  const k = tabellenPerKlasse() as Record<string, string[]>;
  // Deze vier getallen zijn de kern van besluit 0213 (R5): wat citeerbaar wordt,
  // wat een eigen contextcontract krijgt, en wat expliciet géén contextlaag is.
  // Verschuift er één zonder besluit, dan is de grens stil verlegd.
  assert.equal(k.evidence.length, 5, `evidence: ${k.evidence.join(", ")}`);
  assert.equal(k.modelcontext.length, 18, `modelcontext: ${k.modelcontext.join(", ")}`);
  assert.equal(k.configuratie.length, 7, `configuratie: ${k.configuratie.join(", ")}`);
  assert.equal(k.audit.length, 3, `audit: ${k.audit.join(", ")}`);
  assert.equal(Object.keys(TABELKLASSE).length, 33, "TABELKLASSE bevat regels voor tabellen die het antwoordpad niet meer bereikt");
});

test("F4-context — configuratie en autorisatie tellen niet als modelcontext", () => {
  const k = tabellenPerKlasse() as Record<string, string[]>;
  // De bewuste correctie uit de review: deze vier stonden in de eerste ronde in
  // het getal "31 contexttabellen" en horen daar niet.
  for (const t of ["fonds_theming", "fonds_feature_flags", "profielen", "bron_whitelist"]) {
    assert.equal(TABELKLASSE[t as keyof typeof TABELKLASSE], "configuratie", `${t} moet configuratie zijn, geen modelcontext`);
    assert.ok(!k.modelcontext.includes(t));
  }
});

test("F4-context — alleen de evidenceklasse loopt via de retrievalkern", () => {
  const viaKern = contextRegister.contextbronnen["core/lib/rag.ts"]?.tabellen ?? [];
  assert.deepEqual([...viaKern].sort(), ["document_chunks", "documenten"]);
  // De overige drie evidencebronnen (decision_objects, semantic_units, concepts)
  // zijn vandaag NIET citeerbaar of versiebaar; besluit 0213 R5 brengt ze in T2
  // achter het contract. Dat is gaplijst G-1.
  const k = tabellenPerKlasse() as Record<string, string[]>;
  const evidenceBuitenKern = k.evidence.filter((t) => !viaKern.includes(t));
  assert.deepEqual(evidenceBuitenKern, ["concepts", "decision_objects", "semantic_units"]);
});
