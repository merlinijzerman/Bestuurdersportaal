// ============================================================================
// W11 auditinventaris — machineleesbaar, gemeten op origin/preview (b18a549).
// Bepaalt per state-changing handler of hij vandaag ZELF een auditregel schrijft,
// via welk trail-token (tabel of RPC), en of dat een BEWIJSKETEN-write is (die
// `audit: "route-eigen"` afdwingt) dan wel een domein-/platformspoor.
//
// Aanpak: (1) resolveer welke lib-functies (core/lib, platform/lib) een trail
// schrijven — fixpoint over de call-graph; (2) scan elk handler-methodeblok op
// directe trail-tokens én aanroepen van die writer-functies.
//
// GEEN codewijziging. Leest uitsluitend de worktree van origin/preview.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Standaard = repo-root (dit bestand leeft in tests/karakterisering/). Draai
// `node tests/karakterisering/audit-inventaris.mjs [json]` vanaf de repo-root,
// of geef een expliciete root mee (bv. een preview-worktree).
const ROOT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Trail-taxonomie ─────────────────────────────────────────────────────────
// bewijsketen  = besluit/audit/afschrift-dossier; dubbele registratie = SCHADE.
// domein       = domeinhistorie-log; telt als "auditspoor" in de brede rapportzin.
// platform     = platform_event_log (machine/operator-spoor).
// geen-audit   = metering / applicatiefouten; GEEN auditspoor.
const TABEL_TRAIL = {
  governance_events: "bewijsketen",
  governance_log: "bewijsketen",
  governance_log_inhoud: "bewijsketen",
  procedure_log: "domein",
  document_metadata_log: "domein",
  risico_log: "domein",
  agendapunt_log: "domein",
  vergadering_log: "domein",
  fonds_config_log: "domein",
  bron_whitelist_log: "domein",
  fonds_stuurinfo_log: "domein",
  catalogus_log: "domein",
  aqlab_log: "domein",
  platform_event_log: "platform",
  ai_verbruik_log: "geen-audit",
  app_errors: "geen-audit",
};
const RPC_TRAIL = {
  schrijf_ai_interactie: "bewijsketen",
  fn_schrijf_vergelijking: "domein",
  fn_schrijf_semantische_extractie: "domein",
  log_word_export: "domein",
  aqlab_log_download: "domein",
  aqlab_add_run_cost: "domein",
  aqlab_assurance_meetwaarden: "domein",
  aqlab_audit_export_bron: "domein",
  aqlab_claim_run_jobs: "domein",
  fn_app_error_log: "geen-audit",
};

// Directe write-detectie in een stuk broncode → lijst {token, trail, soort}.
// Venster 240 tekens: `.from("x_log")` en de `.insert(` staan vaak over meerdere
// regels geketend (bv. afschrift/concept). 80 tekens miste die; 240 vangt ze
// zonder tot de volgende .from() door te lopen.
function directeWrites(code) {
  const hits = [];
  for (const [tabel, trail] of Object.entries(TABEL_TRAIL)) {
    const re = new RegExp(`\\.from\\(\\s*["'\\\`]${tabel}["'\\\`]\\s*\\)[\\s\\S]{0,240}?\\.(insert|upsert|update|delete)\\b`, "g");
    if (re.test(code)) hits.push({ token: tabel, trail, soort: "tabel" });
  }
  for (const [rpc, trail] of Object.entries(RPC_TRAIL)) {
    const re = new RegExp(`\\.rpc\\(\\s*["'\\\`]${rpc}["'\\\`]`, "g");
    if (re.test(code)) hits.push({ token: rpc, trail, soort: "rpc" });
  }
  return hits;
}

// DI-grens: schrijvers die via een geïnjecteerde deps-parameter lopen en dus
// niet als `naam(` in het handlerblok verschijnen. Handmatig vastgesteld bij de
// validatie; elk met bronregel. Roept een handler zo'n functie aan, dan erft hij
// de trail. (Zie summary: fn_schrijf_vergelijking zit in vergelijk-productie.ts
// achter productieDeps, doorgegeven aan voerVergelijkingUit.)
const DI_WRITERS = {
  voerVergelijkingUit: [{ token: "fn_schrijf_vergelijking", trail: "domein", soort: "di" }],
};

// ── Bestanden verzamelen ────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".sanity.ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const libDirs = [join(ROOT, "core/lib"), join(ROOT, "platform/lib")];
const libFiles = libDirs.flatMap((d) => { try { return walk(d); } catch { return []; } });

// Exported functies + hun body (naïef: van declaratie tot volgende top-level `export `).
function exportFns(code) {
  const fns = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
  let m;
  const marks = [];
  while ((m = re.exec(code))) marks.push({ name: m[1] || m[2], start: m.index });
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : code.length;
    fns.push({ name: marks[i].name, body: code.slice(start, end) });
  }
  return fns;
}

// ── Stap 1: writer-functies resolveren (fixpoint over call-graph) ────────────
// writerFn: naam -> lijst {token, trail, soort}. Eerst directe writes, dan
// transitief: roept fn A een reeds-bekende writer B aan, dan erft A B's trails.
const fnBodies = new Map();  // name -> body
for (const f of libFiles) {
  const code = readFileSync(f, "utf8");
  for (const { name, body } of exportFns(code)) {
    // Bij dubbele namen: langste body wint (voorkomt lege stubs).
    if (!fnBodies.has(name) || body.length > fnBodies.get(name).length) fnBodies.set(name, body);
  }
}
const writerFn = new Map();
for (const [name, body] of fnBodies) {
  const w = directeWrites(body);
  if (w.length) writerFn.set(name, dedup(w));
}
// Bekende helper-mappings expliciet borgen (voor het geval body-scan ze mist).
const HELPER_HINT = {
  logCatalogus: [{ token: "catalogus_log", trail: "domein", soort: "helper" }],
  logClassificatieKoppeling: [{ token: "document_metadata_log", trail: "domein", soort: "helper" }],
  logAttempt: [{ token: "platform_event_log", trail: "platform", soort: "helper" }],
  logSecurity: [{ token: "platform_event_log", trail: "platform", soort: "helper" }],
  logResultGegarandeerd: [{ token: "platform_event_log", trail: "platform", soort: "helper" }],
};
for (const [n, w] of Object.entries(HELPER_HINT)) {
  writerFn.set(n, dedup([...(writerFn.get(n) || []), ...w]));
}
// Fixpoint: transitieve writers.
let veranderd = true;
while (veranderd) {
  veranderd = false;
  for (const [name, body] of fnBodies) {
    const huidig = writerFn.get(name) || [];
    let extra = [...huidig];
    for (const [wname, wtrails] of writerFn) {
      if (wname === name) continue;
      if (new RegExp(`\\b${wname}\\s*\\(`).test(body)) extra.push(...wtrails.map((t) => ({ ...t, soort: "transitief" })));
    }
    const d = dedup(extra);
    if (d.length !== huidig.length) { writerFn.set(name, d); veranderd = true; }
  }
}

function dedup(arr) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = x.token + "|" + x.trail; if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// ── Stap 2: handlers verzamelen en per methodeblok analyseren ────────────────
const apiFiles = walk(join(ROOT, "app/api"));
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const inventaris = [];

for (const f of apiFiles) {
  const code = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  // methodeblokken: elke `export const METHOD = with(Fonds|Machine)Route(` tot de volgende `export const `.
  const re = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*(withFondsRoute|withMachineRoute)\b/g;
  const marks = [];
  let m;
  while ((m = re.exec(code))) marks.push({ method: m[1], wrapper: m[2], start: m.index });
  for (let i = 0; i < marks.length; i++) {
    const { method, wrapper, start } = marks[i];
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) continue; // alleen state-changing
    // blok-einde = volgende export const METHOD (welke methode dan ook) of EOF
    const nextExport = code.slice(start + 10).search(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=/);
    const end = nextExport === -1 ? code.length : start + 10 + nextExport;
    const blok = code.slice(start, end);

    const direct = directeWrites(blok);
    const viaFn = [];
    for (const [wname, wtrails] of writerFn) {
      if (new RegExp(`\\b${wname}\\s*\\(`).test(blok)) {
        for (const t of wtrails) viaFn.push({ ...t, via: wname });
      }
    }
    for (const [wname, wtrails] of Object.entries(DI_WRITERS)) {
      if (new RegExp(`\\b${wname}\\s*\\(`).test(blok)) {
        for (const t of wtrails) viaFn.push({ ...t, via: wname });
      }
    }
    const alle = dedup([...direct.map((d) => ({ ...d, via: "direct" })), ...viaFn]);
    const bewijsketen = alle.filter((x) => x.trail === "bewijsketen");
    const domein = alle.filter((x) => x.trail === "domein");
    const platform = alle.filter((x) => x.trail === "platform");
    inventaris.push({
      handler: `${method} ${rel}`,
      wrapper,
      schrijftAuditspoor: bewijsketen.length + domein.length + platform.length > 0,
      routeEigenKandidaat: bewijsketen.length > 0, // schrijft ZELF een bewijsketen-regel → audit:"route-eigen"
      bewijsketen: bewijsketen.map(kort),
      domein: domein.map(kort),
      platform: platform.map(kort),
    });
  }
}

function kort(x) { return { token: x.token, via: x.via, soort: x.soort }; }

// ── Samenvatting + uitvoer ───────────────────────────────────────────────────
const n = inventaris.length;
const metBewijsketen = inventaris.filter((h) => h.routeEigenKandidaat).length;
const metEnigSpoor = inventaris.filter((h) => h.schrijftAuditspoor).length;
const zonderSpoor = n - metEnigSpoor;
console.error(`writer-functies geresolveerd: ${writerFn.size}`);
console.error(`state-changing handlers: ${n}`);
console.error(`  met bewijsketen-write (route-eigen kandidaat): ${metBewijsketen}`);
console.error(`  met enig auditspoor (bewijsketen|domein|platform): ${metEnigSpoor}`);
console.error(`  zonder enig auditspoor: ${zonderSpoor}`);
console.log(JSON.stringify({
  meta: { basis: "origin/preview b18a549", aantalHandlers: n, writerFuncties: writerFn.size,
          metBewijsketen, metEnigSpoor, zonderSpoor,
          afgezochtePatronen: { tabellen: Object.keys(TABEL_TRAIL), rpcs: Object.keys(RPC_TRAIL) } },
  handlers: inventaris,
}, null, 2));
