// ============================================================================
// W11 auditinventaris — machineleesbaar, gemeten op origin/preview.
// Bepaalt per state-changing handler of hij vandaag ZELF een auditspoor schrijft,
// via welk trail-token (tabel of RPC), en welke TRAIL dat is:
//   bewijsketen | domein | platform | geen-audit.
//
// v2 (fix/w11-inventaris-diepte): ROBUUSTE transitieve tracing. v1 miste diepe
// ketens (bv. `stuurinformatie/beheer` → fonds_stuurinfo_log, `instellingen` →
// fonds_config_log) doordat het alleen GEËXPORTEERDE functies indexeerde met een
// naïeve "tot de volgende export"-body. v2 indexeert ÁLLE functies (ook lokale
// helpers) met balanced-brace bodies, bouwt een call-graph en propageert de
// write-tokens via fixpoint. Dat is de "meet, geen bewering"-eis toegepast op de
// inventaris zelf.
//
// GEEN codewijziging aan app/api. Draai vanaf de repo-root:
//   node tests/karakterisering/audit-inventaris.mjs > tests/karakterisering/audit-inventaris.json
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Trail-taxonomie ─────────────────────────────────────────────────────────
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

// DB-TRIGGER-laag: base-tabellen waarvan een mutatie via een audit-CAPTURE-trigger
// een append-only trail-regel schrijft — ONZICHTBAAR voor code-tracing. Afgeleid
// uit de migraties (fn_fonds_config_capture / fn_fonds_stuurinfo_capture,
// 2026_07_09_t8b_config_audit_trigger.sql · 2026_07_17_t14_stuurinfo_invoer_audit.sql).
// Zonder deze laag zou de inventaris "geen spoor" BEWEREN waar de DB er wél één borgt.
const BASE_TRIGGER = {
  fonds_content_overrides: { log: "fonds_config_log", trail: "domein" },
  fonds_feature_flags: { log: "fonds_config_log", trail: "domein" },
  fonds_module_manifest: { log: "fonds_config_log", trail: "domein" },
  fonds_theming: { log: "fonds_config_log", trail: "domein" },
  fonds_stuurinfo_kpi: { log: "fonds_stuurinfo_log", trail: "domein" },
  fonds_stuurinfo_periode: { log: "fonds_stuurinfo_log", trail: "domein" },
  fonds_stuurinfo_reeks: { log: "fonds_stuurinfo_log", trail: "domein" },
  fonds_stuurinfo_reserve: { log: "fonds_stuurinfo_log", trail: "domein" },
};

// ── De SPLIT (besluit W11 / vervolg 0190) — klasse per handler ZONDER gemeten spoor.
// Alleen no-spoor handlers staan hier: hun spoor bestaat vandaag NIET en de klasse
// bepaalt waar het hoort. Handlers MÉT gemeten spoor krijgen hun klasse uit de
// meting (bewijsketen/domein/platform), niet uit deze lijst.
//   bestuurlijk-gap  → hoort in governance_events (permanent); write ontbreekt nog,
//                      #183 voegt hem route-eigen toe, dán pas audit:"governance-events".
//   operationeel     → handelingen_log (wrapper, 90 dagen), audit: AuditSpec{…}.
//   geen             → aantoonbaar geen spoor nodig, per stuk gemotiveerd.
// De machine-handlers staan er NIET in: zij zijn "machine" (platform_event_log,
// typegrens op MachineSpecV1).
const SPLIT_KLASSE = {
  // A. bestuurlijk feit → governance_events (permanent) — 15
  "POST app/api/agendapunten/route.ts": "bestuurlijk-gap",
  "POST app/api/inbreng/route.ts": "bestuurlijk-gap",
  "DELETE app/api/inbreng/[id]/route.ts": "bestuurlijk-gap",
  "POST app/api/notulen/segmenten/[id]/bevestig/route.ts": "bestuurlijk-gap",
  "DELETE app/api/notulen/segmenten/[id]/route.ts": "bestuurlijk-gap",
  "PUT app/api/organisatieprofiel/route.ts": "bestuurlijk-gap",
  "POST app/api/procedures/[id]/bewijs/route.ts": "bestuurlijk-gap",
  "PATCH app/api/procedures/[id]/bewijs/[bewijsId]/route.ts": "bestuurlijk-gap",
  "DELETE app/api/procedures/[id]/bewijs/[bewijsId]/route.ts": "bestuurlijk-gap",
  "POST app/api/stemmingen/route.ts": "bestuurlijk-gap",
  "POST app/api/stemmingen/[id]/stemmen/route.ts": "bestuurlijk-gap",
  "POST app/api/stemmingen/[id]/sluiten/route.ts": "bestuurlijk-gap",
  "POST app/api/stemmingen/[id]/intrekken/route.ts": "bestuurlijk-gap",
  "POST app/api/vergaderingen/route.ts": "bestuurlijk-gap",
  "PATCH app/api/documents/[id]/route.ts": "bestuurlijk-gap", // status is RAG-bepalend, 0128 B-2
  // B. operationele handeling → handelingen_log — 8
  "PATCH app/api/documents/[id]/ai-markering/route.ts": "operationeel",
  "POST app/api/documents/[id]/her-extract/route.ts": "operationeel", // gebonden aan pijplijngedrag; zie 0191
  "POST app/api/documents/[id]/opnieuw-verwerken/route.ts": "operationeel", // idem
  "POST app/api/documents/embeddings-backfill/route.ts": "operationeel",
  "POST app/api/documents/reindex-backfill/route.ts": "operationeel",
  "DELETE app/api/gesprekken/[id]/route.ts": "operationeel",
  "POST app/api/reflectie/transitie/route.ts": "operationeel",
  "PATCH app/api/profiel/route.ts": "operationeel", // fonds_id/rol-tabel (C-01), goedkope verzekering
  // C. geen spoor nodig — 7
  "PATCH app/api/agendapunten/[id]/voorbereiding/notities/route.ts": "geen", // privé-voorbereiding, §5.3
  "POST app/api/agendapunten/[id]/voorbereiding/route.ts": "geen",
  "PATCH app/api/notificaties/[id]/lezen/route.ts": "geen",
  "POST app/api/notificaties/alles-lezen/route.ts": "geen",
  "POST app/api/procedures/[id]/afschrift/concept/route.ts": "geen", // AI-concept, geen state-change
  "POST app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts": "geen",
  "POST app/api/stuurinformatie/beheer/upload/route.ts": "geen", // parse-only preview
};

function directeWrites(code) {
  const hits = [];
  for (const [tabel, trail] of Object.entries(TABEL_TRAIL)) {
    const re = new RegExp(`\\.from\\(\\s*["'\\\`]${tabel}["'\\\`]\\s*\\)[\\s\\S]{0,240}?\\.(insert|upsert|update|delete)\\b`);
    if (re.test(code)) hits.push({ token: tabel, trail, soort: "tabel" });
  }
  for (const [rpc, trail] of Object.entries(RPC_TRAIL)) {
    if (new RegExp(`\\.rpc\\(\\s*["'\\\`]${rpc}["'\\\`]`).test(code)) hits.push({ token: rpc, trail, soort: "rpc" });
  }
  for (const [basis, { log, trail }] of Object.entries(BASE_TRIGGER)) {
    const re = new RegExp(`\\.from\\(\\s*["'\\\`]${basis}["'\\\`]\\s*\\)[\\s\\S]{0,240}?\\.(insert|upsert|update|delete)\\b`);
    if (re.test(code)) hits.push({ token: log, trail, soort: "trigger", basis });
  }
  return hits;
}

// ── Bestanden ───────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".sanity.ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

// ── Balanced-brace functie-extractie (alle vormen, ook lokale helpers) ───────
// Detecteert `function NAAM(`, `const NAAM = (...) =>{`, `NAAM = async (...) =>{`.
// Vanaf de body-`{` telt hij haakjes tot de sluiting. Geeft {naam, body}.
const JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "await", "function", "typeof",
  "new", "delete", "void", "in", "of", "do", "else", "case", "try", "throw", "const",
  "let", "var", "async", "yield", "super", "this", "class",
]);

// ── String/comment/template-bewuste delimiter-matching ───────────────────────
// Naïef haakjes tellen telt óók `{`/`}` in strings, template-literals en comments
// (fonds-config.ts draagt theming-CSS met letterlijke braces). Dat kapte
// functiebodies vroegtijdig af. Deze matchers slaan die contexten over.
function skipString(code, i) { // i op de quote
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === "\\") { j++; continue; }
    if (code[j] === q) return j;
  }
  return code.length - 1;
}
function skipTemplate(code, i) { // i op de backtick; `${…}` is CODE (recursie)
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === "\\") { j++; continue; }
    if (code[j] === "`") return j;
    if (code[j] === "$" && code[j + 1] === "{") {
      const end = matchDelim(code, j + 1, "{", "}");
      if (end === -1) return code.length - 1;
      j = end;
    }
  }
  return code.length - 1;
}
function matchDelim(code, i, open, close) { // i op `open`; bewust van strings/comments/templates
  let d = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === "/" && code[j + 1] === "/") { const nl = code.indexOf("\n", j); if (nl === -1) return -1; j = nl; continue; }
    if (c === "/" && code[j + 1] === "*") { const e = code.indexOf("*/", j + 2); if (e === -1) return -1; j = e + 1; continue; }
    if (c === '"' || c === "'") { j = skipString(code, j); continue; }
    if (c === "`") { j = skipTemplate(code, j); continue; }
    if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return j; }
  }
  return -1;
}

// Vindt het body-`{` na de params-`)` op `from`, en slaat de RETURN-TYPE-annotatie
// over — die kan zelf `{...}` bevatten: `): Promise<{…}> {` (in `<>`) of
// `): { ok } {` (kaal object-type). Anders landde de body op de verkeerde brace.
function findBodyBrace(code, from) {
  let angle = 0;
  for (let j = from; j < code.length; j++) {
    const c = code[j];
    if (c === "/" && code[j + 1] === "/") { const nl = code.indexOf("\n", j); if (nl === -1) return -1; j = nl; continue; }
    if (c === "/" && code[j + 1] === "*") { const e = code.indexOf("*/", j + 2); if (e === -1) return -1; j = e + 1; continue; }
    if (c === '"' || c === "'") { j = skipString(code, j); continue; }
    if (c === "`") { j = skipTemplate(code, j); continue; }
    if (c === "<") angle++;
    else if (c === ">") { if (angle > 0) angle--; }
    else if (c === ";") return -1; // overload/decl zonder body
    else if (c === "{" && angle === 0) {
      const cend = matchDelim(code, j, "{", "}");
      if (cend === -1) return j;
      let k = cend + 1;
      while (k < code.length && /\s/.test(code[k])) k++;
      if (code[k] === "{") { j = k - 1; continue; } // dit was een return-type-object; door naar de body
      return j;
    }
  }
  return -1;
}

function extractFunctions(code) {
  const fns = [];
  // 1. function-declaraties: `[export] [async] function NAAM<...>(` — params kunnen
  //    over vele regels lopen (bv. logClassificatieKoppeling, 15 regels). Balanceer
  //    de params-parens, vind dán het body-`{` na de (evt.) return-type-annotatie.
  const reFn = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>{;]*>)?\s*\(/g;
  let m;
  while ((m = reFn.exec(code))) {
    const naam = m[1];
    const ps = reFn.lastIndex - 1;            // op de `(`
    const pe = matchDelim(code, ps, "(", ")"); // matchende `)`
    if (pe === -1) continue;
    const bodyStart = findBodyBrace(code, pe + 1); // slaat de return-type over
    if (bodyStart === -1) continue;
    const be = matchDelim(code, bodyStart, "{", "}");
    if (be === -1) continue;
    fns.push({ naam, body: code.slice(bodyStart, be + 1) });
  }
  // 2. const/let/var arrow (én object-property arrow) met block-body:
  //    `NAAM = [async] (...) => {`  of  `NAAM: [async] (...) => {`
  const reArrow = /(?:(?:const|let|var)\s+|[,{]\s*)([A-Za-z0-9_]+)\s*[:=]\s*(?:async\s*)?\(/g;
  while ((m = reArrow.exec(code))) {
    const naam = m[1];
    const ps = reArrow.lastIndex - 1;          // op de `(`
    const pe = matchDelim(code, ps, "(", ")");
    if (pe === -1) continue;
    const na = code.slice(pe + 1).match(/^\s*(?::\s*[^={;]+)?=>\s*\{/); // arrow met block
    if (!na) continue;
    const bodyStart = code.indexOf("{", pe + 1 + na[0].length - 1);
    if (bodyStart === -1) continue;
    const be = matchDelim(code, bodyStart, "{", "}");
    if (be === -1) continue;
    fns.push({ naam, body: code.slice(bodyStart, be + 1) });
  }
  return fns;
}

function calledNames(body) {
  const out = new Set();
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    const naam = m[1];
    if (!JS_KEYWORDS.has(naam)) out.add(naam);
  }
  return out;
}

// ── Stap 1: writer-functies resolveren (call-graph fixpoint over ALLE fns) ────
const libDirs = [join(ROOT, "core/lib"), join(ROOT, "platform/lib")];
const libFiles = libDirs.flatMap((d) => walk(d));

const fnDirect = new Map(); // naam -> write-hits (directe)
const fnCalls = new Map();  // naam -> Set(aangeroepen namen)
for (const f of libFiles) {
  const code = readFileSync(f, "utf8");
  for (const { naam, body } of extractFunctions(code)) {
    const d = directeWrites(body);
    const prev = fnDirect.get(naam) || [];
    // bij dubbele namen: samenvoegen (veilig — false positive is beter dan een gemiste write)
    fnDirect.set(naam, dedup([...prev, ...d]));
    const c = fnCalls.get(naam) || new Set();
    for (const x of calledNames(body)) c.add(x);
    fnCalls.set(naam, c);
  }
}

// fixpoint: writes propageren langs de call-graph
const fnWrites = new Map();
for (const [naam, d] of fnDirect) fnWrites.set(naam, dedup(d.map((t) => ({ ...t }))));
let veranderd = true, rondes = 0;
while (veranderd && rondes < 50) {
  veranderd = false; rondes++;
  for (const [naam, calls] of fnCalls) {
    const huidig = fnWrites.get(naam) || [];
    let extra = [...huidig];
    for (const callee of calls) {
      const w = fnWrites.get(callee);
      if (w && w.length) extra.push(...w.map((t) => ({ ...t, soort: "transitief" })));
    }
    const d = dedup(extra);
    if (d.length !== huidig.length) { fnWrites.set(naam, d); veranderd = true; }
  }
}

function dedup(arr) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = x.token + "|" + x.trail; if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// ── Stap 2: handlers analyseren ──────────────────────────────────────────────
const apiFiles = walk(join(ROOT, "app/api"));
const inventaris = [];

for (const f of apiFiles) {
  const code = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  const re = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*(withFondsRoute|withMachineRoute)\b/g;
  const marks = [];
  let m;
  while ((m = re.exec(code))) marks.push({ method: m[1], wrapper: m[2], start: m.index });
  for (let i = 0; i < marks.length; i++) {
    const { method, wrapper, start } = marks[i];
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) continue;
    const nextExport = code.slice(start + 10).search(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=/);
    const end = nextExport === -1 ? code.length : start + 10 + nextExport;
    const blok = code.slice(start, end);

    const direct = directeWrites(blok).map((d) => ({ ...d, via: "direct" }));
    const viaFn = [];
    for (const [naam, w] of fnWrites) {
      if (w.length && new RegExp(`\\b${naam}\\s*\\(`).test(blok)) {
        for (const t of w) viaFn.push({ ...t, via: naam });
      }
    }
    const alle = dedupVia([...direct, ...viaFn]);
    const bewijsketen = alle.filter((x) => x.trail === "bewijsketen");
    const domein = alle.filter((x) => x.trail === "domein");
    const platform = alle.filter((x) => x.trail === "platform");
    const heeftSpoor = bewijsketen.length + domein.length + platform.length > 0;
    const key = `${method} ${rel}`;
    // Gedeclareerde audit-waarde (W11): parse hem uit het RouteSpec-object in het blok.
    // Nog géén route declareert `audit:` — dit is voorbereid op #183, zodat de
    // assertie fail-closed is vanaf de dag dat de eerste declaratie landt.
    const auditM = blok.match(/\baudit:\s*("governance-events"|"platform-event-log"|"geen"|\{)/);
    const declaredAudit = auditM ? (auditM[1] === "{" ? "spec" : auditM[1].replace(/"/g, "")) : null;
    // klasse: gemeten spoor wint; anders machine (typegrens) of de gedeclareerde split.
    let klasse;
    if (bewijsketen.length) klasse = "bewijsketen";
    else if (domein.length) klasse = "domein";
    else if (platform.length) klasse = "platform";
    else if (wrapper === "withMachineRoute") klasse = "machine"; // platform_event_log via typegrens
    else klasse = SPLIT_KLASSE[key] || "ONBEKEND"; // no-spoor tenant → uit de split
    inventaris.push({
      handler: key,
      wrapper,
      schrijftAuditspoor: heeftSpoor,
      klasse,
      declaredAudit,
      routeEigenKandidaat: bewijsketen.length > 0,
      bewijsketen: bewijsketen.map(kort),
      domein: domein.map(kort),
      platform: platform.map(kort),
    });
  }
}

// ── Fail-closed assertie: de split moet compleet én consistent zijn ──────────
// Draait ALTIJD (geen waarschuwingsmodus). Bij een schending → process.exitCode 1,
// zodat een regeneratie/CI-run faalt. De triggerlaag zit in de meting, dus een
// handler die door fn_fonds_config/stuurinfo_capture wordt gedekt komt hier als
// "domein" binnen en wordt NIET als "geen spoor" afgekeurd.
const assertieFouten = [];
for (const h of inventaris) {
  if (h.klasse === "ONBEKEND")
    assertieFouten.push(`ontbrekende split-klasse: ${h.handler} — no-spoor tenant-handler zonder SPLIT_KLASSE-entry (geen stille "geen")`);
  if (SPLIT_KLASSE[h.handler] && h.schrijftAuditspoor)
    assertieFouten.push(`stale split-klasse: ${h.handler} heeft nu een GEMETEN spoor (${[...h.bewijsketen, ...h.domein, ...h.platform].map((t) => t.token).join(", ")}) — herclassificeer, verwijder de SPLIT_KLASSE-entry`);
  if (h.klasse === "geen" && h.schrijftAuditspoor)
    assertieFouten.push(`"geen" met spoor: ${h.handler}`);

  // DECLARATIE-VERIFICATIE (0191 §6): een waarde die zegt "ik heb elders een spoor"
  // is GEMETEN, niet beweerd. Fail-closed vanaf de eerste declaratie (#183).
  if (h.declaredAudit === "governance-events" && h.bewijsketen.length === 0)
    assertieFouten.push(`beweerde vrijstelling: ${h.handler} declareert audit:"governance-events" maar schrijft NIET aantoonbaar naar governance_events (voeg de route-eigen write toe, of herclassificeer)`);
  if (h.declaredAudit === "platform-event-log" && h.platform.length === 0)
    assertieFouten.push(`beweerde vrijstelling: ${h.handler} declareert audit:"platform-event-log" maar schrijft NIET aantoonbaar naar platform_event_log`);
}

function dedupVia(arr) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = x.token + "|" + x.trail; if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
function kort(x) { const o = { token: x.token, via: x.via, soort: x.soort }; if (x.basis) o.basis = x.basis; return o; }

// ── Samenvatting + uitvoer ───────────────────────────────────────────────────
const n = inventaris.length;
const metBewijsketen = inventaris.filter((h) => h.routeEigenKandidaat).length;
const metEnigSpoor = inventaris.filter((h) => h.schrijftAuditspoor).length;
const zonderSpoor = n - metEnigSpoor;
console.error(`lib-functies geïndexeerd: ${fnCalls.size} | writers (na fixpoint, ${rondes} rondes): ${[...fnWrites.values()].filter((w) => w.length).length}`);
console.error(`state-changing handlers: ${n}`);
console.error(`  met bewijsketen-write: ${metBewijsketen}`);
console.error(`  met enig auditspoor: ${metEnigSpoor}`);
console.error(`  zonder enig auditspoor: ${zonderSpoor}`);
const klasseTelling = {};
for (const h of inventaris) klasseTelling[h.klasse] = (klasseTelling[h.klasse] || 0) + 1;
console.error(`  klasse: ${JSON.stringify(klasseTelling)}`);
if (assertieFouten.length) {
  console.error(`\n✗ ${assertieFouten.length} ASSERTIE-FOUT(EN) — fail-closed:`);
  for (const f of assertieFouten) console.error(`   - ${f}`);
  process.exitCode = 1;
} else {
  console.error(`✓ split-assertie schoon (${n} handlers geklasseerd)`);
}
console.log(JSON.stringify({
  meta: {
    basis: "origin/preview", tracing: "v2-callgraph-fixpoint", aantalHandlers: n,
    metBewijsketen, metEnigSpoor, zonderSpoor, klasseTelling,
    assertieFouten,
    afgezochtePatronen: { tabellen: Object.keys(TABEL_TRAIL), rpcs: Object.keys(RPC_TRAIL) },
    triggerLaag: Object.fromEntries(Object.entries(BASE_TRIGGER).map(([b, v]) => [b, v.log])),
  },
  handlers: inventaris,
}, null, 2));
