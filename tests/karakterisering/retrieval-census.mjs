// ============================================================================
//  #322 F4-T1 — Census van de retrievalkern: wie roept vandaag wat aan?
// ----------------------------------------------------------------------------
//  Scant de productiecode (app/, core/, platform/, fondsen/) op
//    • imports uit core/lib/rag (welke symbolen per bestand),
//    • imports uit de aangrenzende retrievalmodules (rerank, rag-select, bronset,
//      bronfragment, web-retrieval, query-reformulatie, weeg-bronsoort,
//      bron-afbakening, parent-context, embeddings),
//    • directe zoek-RPC's (`rpc("zoek_chunks…")`) en directe leestoegang tot
//      `document_chunks`.
//  Het resultaat is een deterministisch register (retrieval-census.expected.json)
//  dat de gate (tests/cross-tenant/retrieval-census.test.ts) bevriest: een nieuwe
//  directe aanroeper of een nieuw symbool buiten het register maakt de gate rood.
//  In T2 krimpt dit register tot de goedgekeurde adapter-/orkestratielaag.
//
//  Gebruik:  node tests/karakterisering/retrieval-census.mjs            # toon
//            node tests/karakterisering/retrieval-census.mjs --schrijf  # register bijwerken
// ============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HIER, "..", "..");
export const REGISTER_PAD = join(ROOT, "tests", "cross-tenant", "retrieval-census.expected.json");

const MAPPEN = ["app", "core", "platform", "fondsen"];
const MODULES = [
  "rag", "rerank", "rag-select", "bronset", "bronfragment", "web-retrieval", "query-reformulatie",
  "weeg-bronsoort", "bron-afbakening", "parent-context", "embeddings", "fts-terugval", "jargon-expansie",
];
const OVERSLAAN = /(\.test\.tsx?|\.sanity\.tsx?|\.d\.ts)$|\/(tests|__snapshots__|node_modules)\//;

function* loop(map) {
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam);
    const st = statSync(pad);
    if (st.isDirectory()) { if (naam !== "node_modules") yield* loop(pad); }
    else if (/\.(ts|tsx|mjs)$/.test(naam)) yield pad;
  }
}

function moduleVanImport(spec) {
  const m = spec.match(/^(?:@\/core\/lib\/|\.\.?\/(?:core\/lib\/|lib\/)?|\.\/)([a-z0-9-]+)$/);
  return m && MODULES.includes(m[1]) ? m[1] : null;
}

export function census() {
  const register = {};
  for (const map of MAPPEN) {
    let bestanden;
    try { bestanden = [...loop(join(ROOT, map))]; } catch { continue; }
    for (const pad of bestanden) {
      const rel = relative(ROOT, pad);
      if (OVERSLAAN.test(`/${rel}`)) continue;
      // De retrievalmodules zelf zijn de kern, niet een aanroeper.
      if (MODULES.some((m) => rel === `core/lib/${m}.ts`)) continue;
      const bron = readFileSync(pad, "utf8");
      const entry = { modules: {}, rpcs: [], tabellen: [] };
      for (const m of bron.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
        const mod = moduleVanImport(m[2]);
        if (!mod) continue;
        const symbolen = m[1].split(",").map((x) => x.replace(/^\s*type\s+/, "").split(" as ")[0].trim()).filter(Boolean);
        entry.modules[mod] = [...new Set([...(entry.modules[mod] ?? []), ...symbolen])].sort();
      }
      for (const m of bron.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+"([^"]+)"/g)) {
        const mod = moduleVanImport(m[1]);
        if (mod) entry.modules[mod] = ["*"];
      }
      for (const m of bron.matchAll(/rpc\(\s*"(zoek_chunks[a-z_]*)"/g)) entry.rpcs.push(m[1]);
      if (/from\(\s*"document_chunks"\s*\)/.test(bron)) entry.tabellen.push("document_chunks");
      entry.rpcs = [...new Set(entry.rpcs)].sort();
      if (Object.keys(entry.modules).length || entry.rpcs.length || entry.tabellen.length) register[rel] = entry;
    }
  }
  return Object.fromEntries(Object.entries(register).sort(([a], [b]) => a.localeCompare(b)));
}

// ============================================================================
//  Tweede register — het ANTWOORDPAD: welke tabellen bereiken de chatroute, en
//  in welke hoedanigheid? (#348 §1, reviewronde 2)
// ----------------------------------------------------------------------------
//  De census hierboven telt aanroepers van de retrievalkern. Dat is niet de hele
//  waarheid: het antwoordpad leest ook gestructureerde DB-inhoud die `rag.ts`
//  nooit ziet. Twee correcties op de eerste opzet, uit de review:
//
//   1. DE SCAN IS TRANSITIEF. De eerste versie volgde alleen de DIRECTE imports
//      van de chatroute; een tabellezing in een transitief geïmporteerde helper
//      bleef onzichtbaar. De sluiting hieronder loopt de hele importgraaf af
//      (vandaag 100+ bestanden). Gemeten resultaat: dezelfde 33 tabellen — de
//      telling klopte dus, maar toevallig. Nu is ze ook gegarandeerd.
//
//   2. "31 CONTEXTTABELLEN" WAS EEN VERKEERDE CLASSIFICATIE. In dat getal zaten
//      configuratie, autorisatie en bronbeleid (`fonds_theming`, featureflags,
//      capabilities, de web-whitelist). Dat is geen modelcontext. Elke bereikte
//      tabel krijgt daarom een expliciete klasse; een ONBEKENDE tabel maakt de
//      gate rood, zodat classificeren een gereviewde handeling is en niet iets
//      wat stilzwijgend meelift.
//
//  De vier klassen (besluit 0213, R5):
//    evidence      — citeerbaar én versiebaar; hoort achter het retrievalcontract
//    modelcontext  — gestructureerde context die de prompt in gaat, niet
//                    citeerbaar; krijgt in T2 een eigen typed contextcontract
//    configuratie  — autorisatie, feature-/fondsconfig, bronbeleid; raakt de
//                    prompt niet als inhoud en is GEEN contextlaag
//    audit         — auditspoor en persistentie van het antwoord zelf
// ============================================================================
export const ANTWOORDPAD_INGANG = join(ROOT, "app", "api", "chat", "route.ts");

/**
 * Elke tabel die het antwoordpad bereikt, met haar hoedanigheid. Handmatig
 * vastgesteld en gereviewd — dit is een ontwerpoordeel, geen afleiding uit de
 * code. De gate faalt op elke bereikte tabel die hier ontbreekt.
 */
export const TABELKLASSE = {
  // ── evidence: citeerbaar en versiebaar (achter het retrievalcontract) ──────
  document_chunks: "evidence",
  documenten: "evidence",
  decision_objects: "evidence",   // besluitregistratie — "formele bron náást document_chunks"
  semantic_units: "evidence",     // vergelijkpad: passages uit documenten
  concepts: "evidence",           // vergelijkpad: geëxtraheerde begrippen

  // ── modelcontext: gaat de prompt in, niet citeerbaar ──────────────────────
  agendapunten: "modelcontext",
  agendapunt_inbreng: "modelcontext",
  vergaderingen: "modelcontext",
  procedures: "modelcontext",
  procedure_stappen: "modelcontext",
  procedure_requirements: "modelcontext",
  procedure_bewijs: "modelcontext",
  procedure_eigenaars: "modelcontext",
  risicos: "modelcontext",
  risico_log: "modelcontext",
  risico_maatregelen: "modelcontext",
  organisatie_profielen: "modelcontext",
  expertises: "modelcontext",
  gremia: "modelcontext",
  kritische_focusgebieden: "modelcontext",
  profiel_expertises: "modelcontext",
  profiel_focusgebieden: "modelcontext",
  profiel_gremia: "modelcontext",

  // ── configuratie/autorisatie/bronbeleid: GEEN contextlaag ─────────────────
  profielen: "configuratie",          // identiteit, rol, fonds, wettelijk regime
  fonds_feature_flags: "configuratie",
  fonds_config_log: "configuratie",
  fonds_content_overrides: "configuratie",
  fonds_module_manifest: "configuratie",
  fonds_theming: "configuratie",
  bron_whitelist: "configuratie",     // bronbeleid van de webarm

  // ── audit en persistentie van het antwoord ────────────────────────────────
  governance_log: "audit",
  governance_log_inhoud: "audit",
  voorbereidingen: "audit",           // upsert van het bewaarde product
};

function importsVan(bron) {
  const uit = new Set();
  for (const m of bron.matchAll(/from\s+"@\/core\/lib\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)"/g)) uit.add(`core/lib/${m[1]}.ts`);
  for (const m of bron.matchAll(/from\s+"\.\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)"/g)) uit.add(`core/lib/${m[1]}.ts`);
  return [...uit];
}

function tabellenIn(bron) {
  return [...new Set([...bron.matchAll(/\.from\(\s*"([a-z0-9_]+)"\s*\)/g)].map((m) => m[1]))].sort();
}

/**
 * Transitieve sluiting vanaf de chatroute over `core/lib`. Levert per bereikt
 * bestand de tabellen die het rechtstreeks leest of schrijft, plus de omvang van
 * de graaf — zodat zichtbaar is hoe breed de claim van dit register reikt.
 */
export function contextCensus() {
  const gezien = new Set();
  const rij = ["app/api/chat/route.ts"];
  const register = {};
  while (rij.length) {
    const rel = rij.shift();
    if (gezien.has(rel)) continue;
    gezien.add(rel);
    let bron;
    try { bron = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    const tabellen = tabellenIn(bron);
    if (tabellen.length) register[rel] = { tabellen };
    for (const im of importsVan(bron)) if (!gezien.has(im)) rij.push(im);
  }
  return {
    bereikte_bestanden: gezien.size,
    bestanden: Object.fromEntries(Object.entries(register).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Alle bereikte tabellen, gegroepeerd per klasse. `onbekend` moet leeg zijn. */
export function tabellenPerKlasse(cc = contextCensus()) {
  const alle = [...new Set(Object.values(cc.bestanden).flatMap((e) => e.tabellen))].sort();
  const uit = { evidence: [], modelcontext: [], configuratie: [], audit: [], onbekend: [] };
  for (const t of alle) uit[TABELKLASSE[t] ?? "onbekend"].push(t);
  return uit;
}

export const CONTEXT_REGISTER_PAD = join(ROOT, "tests", "cross-tenant", "retrieval-contextbronnen.expected.json");

if (process.argv[1] && fileURLToPath(new URL(import.meta.url)) === process.argv[1]) {
  const resultaat = census();
  const context = contextCensus();
  if (process.argv.includes("--schrijf")) {
    writeFileSync(CONTEXT_REGISTER_PAD, JSON.stringify({
      _doc: "#322/#348 F4-T1 — bevroren register van het ANTWOORDPAD: elke tabel die vanaf app/api/chat/route.ts TRANSITIEF over core/lib bereikbaar is, per bestand, plus de classificatie per tabel (evidence / modelcontext / configuratie / audit, besluit 0213 R5). Een bereikte tabel zonder klasse maakt de gate rood. Regenereren: node tests/karakterisering/retrieval-census.mjs --schrijf.",
      bereikte_bestanden: context.bereikte_bestanden,
      klassen: tabellenPerKlasse(context),
      contextbronnen: context.bestanden,
    }, null, 2) + "\n");
    console.log(`contextregister geschreven: ${Object.keys(context.bestanden).length} lezende bestanden uit ${context.bereikte_bestanden} bereikte`);
  }
  if (process.argv.includes("--schrijf")) {
    writeFileSync(REGISTER_PAD, JSON.stringify({
      _doc: "#322 F4-T1 — bevroren census van directe aanroepers van de retrievalkern (rag.ts en aangrenzende modules, zoek-RPC's, document_chunks). Regenereren: node tests/karakterisering/retrieval-census.mjs --schrijf. Elke toename is een bewuste, gereviewde handeling; in T2 krimpt dit register tot de adapter-/orkestratielaag.",
      census: resultaat,
    }, null, 2) + "\n");
    console.log(`register geschreven: ${Object.keys(resultaat).length} bestanden`);
  } else {
    console.log(JSON.stringify(resultaat, null, 2));
  }
}
