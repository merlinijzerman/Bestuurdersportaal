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

if (process.argv[1] && fileURLToPath(new URL(import.meta.url)) === process.argv[1]) {
  const resultaat = census();
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
