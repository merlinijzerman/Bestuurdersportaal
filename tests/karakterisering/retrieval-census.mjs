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
import { dirname, join, relative, sep } from "node:path";
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
 * Elke LEZING op het antwoordpad — `bestand::tabel` — met haar hoedanigheid.
 *
 * BEVINDING (review 3): classificeren per TABEL was te grof. `profielen` staat
 * op vijf plekken en doet daar drie verschillende dingen: `capabilities.ts`
 * leest `rol` (autorisatie), `profiel.ts` en `fonds-sessie.ts` lezen identiteit
 * en tenant, terwijl `profielsturing.ts` (`bestuurlijke_rol`,
 * `antwoordvoorkeur`, `detailniveau`) en `portaalcontext.ts` (`naam`) juist de
 * MODELCONTEXT vullen. Eén klasse per tabel maakte dat onzichtbaar. Een lezing
 * mag daarom meerdere klassen dragen — de chatroute leest `profielen` in één
 * query voor beide doelen.
 *
 * Tweede correctie: `concepts` is GEEN evidence. De lezing is
 * `id, key, label, type, status` — een begrippencatalogus die de interpretatie
 * van `semantic_units` stuurt, niet documentgebonden bewijs. `semantic_units`
 * (`document_id`, `page`, `evidence`) is dat wél.
 *
 * Handmatig vastgesteld en gereviewd: dit is een ontwerpoordeel, geen afleiding
 * uit de code. De gate faalt op elke bereikte lezing die hier ontbreekt.
 */
export const LEZINGKLASSE = {
  // ── app/api/chat/route.ts ─────────────────────────────────────────────────
  "app/api/chat/route.ts::profielen": { klassen: ["modelcontext", "configuratie"], doel: "naam gaat de prompt in; rol, fonds_id en primair_wettelijk_regime sturen autorisatie en de regime-demotie in de retrieval" },
  "app/api/chat/route.ts::governance_log": { klassen: ["audit"], doel: "vorige beurt terughalen voor reflectie en bronkeuze" },
  "app/api/chat/route.ts::governance_log_inhoud": { klassen: ["audit", "modelcontext"], doel: "de vraag van de vorige beurt; reconstrueert de gespreksdraad in de prompt" },
  "app/api/chat/route.ts::agendapunten": { klassen: ["modelcontext"], doel: "agendapuntblok (titel, toelichting als gelabelde seed)" },
  "app/api/chat/route.ts::risicos": { klassen: ["modelcontext"], doel: "risico- en risicomatrixblok" },
  "app/api/chat/route.ts::risico_log": { klassen: ["modelcontext"], doel: "verloop van één risico" },
  "app/api/chat/route.ts::risico_maatregelen": { klassen: ["modelcontext"], doel: "maatregelen bij één risico" },
  "app/api/chat/route.ts::procedures": { klassen: ["modelcontext"], doel: "procesblok (reikwijdte en fase)" },
  "app/api/chat/route.ts::procedure_stappen": { klassen: ["modelcontext"], doel: "fasering in het procesblok" },
  "app/api/chat/route.ts::procedure_requirements": { klassen: ["modelcontext"], doel: "vereisten in het procesblok" },
  "app/api/chat/route.ts::procedure_bewijs": { klassen: ["modelcontext"], doel: "bewijsstukken bij het dossier" },
  "app/api/chat/route.ts::decision_objects": { klassen: ["evidence"], doel: "besluitregistratie als formele bron náást document_chunks" },
  "app/api/chat/route.ts::documenten": { klassen: ["modelcontext"], doel: "documenttitels voor scope- en bronlabels" },
  "app/api/chat/route.ts::document_chunks": { klassen: ["evidence"], doel: "chunkpresentie per document, buiten rag.ts om (gap G-8)" },
  "app/api/chat/route.ts::voorbereidingen": { klassen: ["audit"], doel: "upsert van het bewaarde antwoordproduct" },

  // ── contextmodules ────────────────────────────────────────────────────────
  "core/lib/portaalcontext.ts::vergaderingen": { klassen: ["modelcontext"], doel: "vergaderingcontext (wat speelt er nu)" },
  "core/lib/portaalcontext.ts::agendapunten": { klassen: ["modelcontext"], doel: "agendacontext" },
  "core/lib/portaalcontext.ts::agendapunt_inbreng": { klassen: ["modelcontext"], doel: "inbreng per agendapunt" },
  "core/lib/portaalcontext.ts::documenten": { klassen: ["modelcontext"], doel: "gekoppelde stukken per agendapunt (aantallen/titels)" },
  "core/lib/portaalcontext.ts::procedure_stappen": { klassen: ["modelcontext"], doel: "lopende stappen met deadline" },
  "core/lib/portaalcontext.ts::procedure_eigenaars": { klassen: ["modelcontext"], doel: "eigenaarschap bij lopende stappen" },
  "core/lib/portaalcontext.ts::profielen": { klassen: ["modelcontext"], doel: "namen bij eigenaarschap en inbreng" },
  "core/lib/profielsturing.ts::profielen": { klassen: ["modelcontext"], doel: "bestuurlijke rol, antwoordvoorkeur en detailniveau sturen het antwoord" },
  "core/lib/profielsturing.ts::profiel_expertises": { klassen: ["modelcontext"], doel: "expertiseprofiel van de bestuurder" },
  "core/lib/profielsturing.ts::profiel_gremia": { klassen: ["modelcontext"], doel: "gremia van de bestuurder" },
  "core/lib/profielsturing.ts::profiel_focusgebieden": { klassen: ["modelcontext"], doel: "focusgebieden van de bestuurder" },
  "core/lib/profielsturing.ts::expertises": { klassen: ["modelcontext"], doel: "labels bij het expertiseprofiel" },
  "core/lib/profielsturing.ts::gremia": { klassen: ["modelcontext"], doel: "labels bij de gremia" },
  "core/lib/profielsturing.ts::kritische_focusgebieden": { klassen: ["modelcontext"], doel: "labels bij de focusgebieden" },
  "core/lib/organisatieprofiel.ts::organisatie_profielen": { klassen: ["modelcontext"], doel: "organisatie- en regimekaderblok" },

  // ── evidencebronnen buiten en binnen de kern ──────────────────────────────
  "core/lib/rag.ts::document_chunks": { klassen: ["evidence"], doel: "de retrievalkern zelf" },
  "core/lib/rag.ts::documenten": { klassen: ["evidence"], doel: "documentmetadata bij de chunks (status, geldigheid, normgewicht)" },
  "core/lib/parent-context.ts::document_chunks": { klassen: ["evidence"], doel: "parent-context rond een geselecteerde chunk — buiten rag.ts om (gap G-8)" },
  "core/lib/retrieval/supabase-versie.ts::document_chunks": { klassen: ["evidence"], doel: "#367 herleest de actuele document- en indexeringsversie vóór ranking" },
  "core/lib/besluitvorming-bron.ts::decision_objects": { klassen: ["evidence"], doel: "besluitregistratie als formele bron (gap G-1a)" },
  "core/lib/vergelijk-productie.ts::semantic_units": { klassen: ["evidence"], doel: "documentgebonden waarden met pagina en evidence (gap G-1a)" },

  // ── configuratie, autorisatie en bronbeleid — GEEN contextlaag ────────────
  "core/lib/vergelijk-productie.ts::concepts": { klassen: ["configuratie"], doel: "begrippencatalogus (id/key/label/type/status) die semantic_units interpreteert; geen documentgebonden bewijs" },
  "core/lib/capabilities.ts::profielen": { klassen: ["configuratie"], doel: "rol voor de capability-check" },
  "core/lib/fonds-sessie.ts::profielen": { klassen: ["configuratie"], doel: "fonds_id en rol voor de tenantbepaling" },
  "core/lib/profiel.ts::profielen": { klassen: ["configuratie"], doel: "identiteit van de actor" },
  "core/lib/fonds-config.ts::fonds_feature_flags": { klassen: ["configuratie"], doel: "retrievalvlaggen per fonds" },
  "core/lib/fonds-config.ts::fonds_config_log": { klassen: ["configuratie"], doel: "configuratiehistorie" },
  "core/lib/fonds-config.ts::fonds_content_overrides": { klassen: ["configuratie"], doel: "teksten per fonds" },
  "core/lib/fonds-config.ts::fonds_module_manifest": { klassen: ["configuratie"], doel: "welke modules aanstaan" },
  "core/lib/fonds-config.ts::fonds_theming": { klassen: ["configuratie"], doel: "huisstijltokens" },
  "core/lib/web-whitelist-data.ts::bron_whitelist": { klassen: ["configuratie"], doel: "bronbeleid van de webarm" },
};

export const KLASSEN = ["evidence", "modelcontext", "configuratie", "audit"];

// ── Moduleresolutie ─────────────────────────────────────────────────────────
//  BEVINDING (review 3): de eerste "transitieve" scan resolveerde relatieve
//  specifiers verkeerd. `./config-db-core` vanuit
//  `core/lib/ai-gateway/config-db.ts` werd `core/lib/config-db-core.ts` in
//  plaats van `core/lib/ai-gateway/config-db-core.ts`, en `../ai-poort` vanuit
//  `gateway-productie.ts` werd helemaal genegeerd. De graaf was dus niet
//  aantoonbaar volledig. Deze resolver doet het echte werk: alias, relatieve
//  paden vanaf de map van de IMPORTERENDE file, extensies en indexbestanden.
const CODE_EXTENSIES = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

/** Alle importspecifiers uit een bronbestand (import, export-from, dynamic). */
function specifiersVan(bron) {
  const uit = new Set();
  for (const m of bron.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+["']([^"']+)["']/g)) uit.add(m[1]);
  for (const m of bron.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) uit.add(m[1]);
  for (const m of bron.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) uit.add(m[1]);
  return [...uit];
}

/** Bestaat dit pad als codebestand, direct of als index? Geeft het repo-relatieve pad. */
function alsBestand(absPad) {
  for (const ext of ["", ...CODE_EXTENSIES]) {
    const kandidaat = absPad + ext;
    try { if (statSync(kandidaat).isFile()) return relative(ROOT, kandidaat).split(sep).join("/"); } catch { /* volgende */ }
  }
  for (const ext of CODE_EXTENSIES) {
    const kandidaat = join(absPad, `index${ext}`);
    try { if (statSync(kandidaat).isFile()) return relative(ROOT, kandidaat).split(sep).join("/"); } catch { /* volgende */ }
  }
  return null;
}

/**
 * Resolveert één specifier vanuit `vanRel` (repo-relatief bestand) naar een
 * repo-relatief codebestand, of `null` voor een package/asset dat buiten de
 * eigen codebase valt. `@/x` volgt de tsconfig-alias `{"@/*": ["./*"]}`.
 */
export function resolveerImport(vanRel, spec) {
  let abs;
  if (spec.startsWith("@/")) abs = join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) abs = join(ROOT, dirname(vanRel), spec);
  else return null; // bare specifier: node_modules of een ingebouwde module
  const rel = alsBestand(abs);
  if (!rel) return null;
  // Alleen code volgen; JSON-definities en assets dragen geen .from().
  return CODE_EXTENSIES.some((e) => rel.endsWith(e)) ? rel : null;
}

function importsVan(bron, vanRel) {
  const uit = new Set();
  for (const spec of specifiersVan(bron)) {
    const rel = resolveerImport(vanRel, spec);
    if (rel && !OVERSLAAN.test(`/${rel}`)) uit.add(rel);
  }
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
    for (const im of importsVan(bron, rel)) if (!gezien.has(im)) rij.push(im);
  }
  return {
    bereikte_bestanden: gezien.size,
    bestanden: Object.fromEntries(Object.entries(register).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Alle bereikte lezingen als `bestand::tabel`, gesorteerd. */
export function lezingen(cc = contextCensus()) {
  return Object.entries(cc.bestanden)
    .flatMap(([bestand, e]) => e.tabellen.map((t) => `${bestand}::${t}`))
    .sort();
}

/** Lezingen gegroepeerd per klasse. Een lezing kan in meerdere klassen vallen;
 *  `onbekend` bevat elke bereikte lezing zonder classificatie en moet leeg zijn. */
export function lezingenPerKlasse(cc = contextCensus()) {
  const uit = { evidence: [], modelcontext: [], configuratie: [], audit: [], onbekend: [] };
  for (const sleutel of lezingen(cc)) {
    const regel = LEZINGKLASSE[sleutel];
    if (!regel) { uit.onbekend.push(sleutel); continue; }
    for (const k of regel.klassen) uit[k].push(sleutel);
  }
  return uit;
}

/** Per tabel de VERZAMELING klassen waarin zij voorkomt — `profielen` heeft er meer dan één. */
export function klassenPerTabel(cc = contextCensus()) {
  const uit = {};
  for (const sleutel of lezingen(cc)) {
    const tabel = sleutel.split("::")[1];
    const regel = LEZINGKLASSE[sleutel];
    uit[tabel] = [...new Set([...(uit[tabel] ?? []), ...(regel ? regel.klassen : ["onbekend"])])].sort();
  }
  return Object.fromEntries(Object.entries(uit).sort(([a], [b]) => a.localeCompare(b)));
}

export const CONTEXT_REGISTER_PAD = join(ROOT, "tests", "cross-tenant", "retrieval-contextbronnen.expected.json");

if (process.argv[1] && fileURLToPath(new URL(import.meta.url)) === process.argv[1]) {
  const resultaat = census();
  const context = contextCensus();
  if (process.argv.includes("--schrijf")) {
    writeFileSync(CONTEXT_REGISTER_PAD, JSON.stringify({
      _doc: "#322/#348 F4-T1 — bevroren register van het ANTWOORDPAD: elke tabel die vanaf app/api/chat/route.ts TRANSITIEF over core/lib bereikbaar is, per bestand, plus de classificatie PER LEZING (bestand::tabel → een of meer van evidence / modelcontext / configuratie / audit, besluit 0213 R5). Een bereikte lezing zonder klasse maakt de gate rood. Padresolutie volgt de tsconfig-alias en echte relatieve paden, inclusief ../ en indexbestanden. Regenereren: node tests/karakterisering/retrieval-census.mjs --schrijf.",
      bereikte_bestanden: context.bereikte_bestanden,
      lezingen_per_klasse: lezingenPerKlasse(context),
      klassen_per_tabel: klassenPerTabel(context),
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
