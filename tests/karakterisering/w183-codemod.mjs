// ============================================================================
//  #183a — Codemod: `hostGuard` + `rateLimit` + `audit` verplicht op elke spec.
// ----------------------------------------------------------------------------
//  Vult de drie laatste RouteSpec-velden op alle 124 declaraties (112 fonds inline +
//  12 machine via 7 named SPEC-consts), BYTE-IDENTIEK (de enforce-vlaggen staan uit
//  en elke bevriezingswaarde is een wrapper-no-op). Elke waarde is GEMETEN, niet
//  gekozen:
//
//    hostGuard (fonds)  `true`→`"afdwingen"`, `"route-eigen"` blijft, weglating→`"geen"`.
//    rateLimit (fonds)  handler roept `controleerLimiet` zelf → `"route-eigen"`; anders
//                       `"nog-niet-beoordeeld"` (W7-TE_BEPALEN-patroon, W10-werklijst).
//    rateLimit (machine) `"geen"` (typegrens: geen sessie/auth.uid()).
//    audit (fonds)      GET of klasse "geen" in de bevroren inventaris → `"geen"`; elke
//                       andere state-changing handler → `{ handeling: <route-identiteit> }`
//                       (VOORLOPIG label; #183a-commit-2 cureert + registreert).
//    audit (machine)    `"geen"` (bevriezing; #183b-machine flipt de 5 worker-SPECs).
//
//  MECHANISCH en verder niets. Modelleert op W9's schema-codemod.mjs.
//
//  Gebruik:
//    node tests/karakterisering/w183-codemod.mjs --dry     # toon plan, schrijf niets
//    node tests/karakterisering/w183-codemod.mjs --apply   # schrijf de wijzigingen
//    node tests/karakterisering/w183-codemod.mjs --apply --only=app/api/stemmingen/route.ts
// ============================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, "..", "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;
if (!apply && !args.includes("--dry")) {
  console.error("Gebruik: w183-codemod.mjs --dry | --apply [--only=<pad>]");
  process.exit(2);
}

// ── Bevroren inventaris: per state-changing handler de klasse ─────────────────
const inv = JSON.parse(readFileSync(join(HIER, "audit-inventaris.json"), "utf8"));
const klassePerHandler = new Map(inv.handlers.map((h) => [h.handler, h.klasse]));

// ── Bestanden ────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith("route.ts")) out.push(p);
  }
  return out;
}
const routeFiles = walk(join(ROOT, "app/api"));

// ── Route-identiteit → voorlopig audit-label ─────────────────────────────────
// Deterministisch uit het pad (NIET uit capability, NIET kaal <resource>.<methode>):
// segmenten na app/api/, dynamische [param] → param, methode achteraan. Uniek per
// declaratie by construction. #183a-commit-2 vervangt dit door gecureerde labels.
function voorlopigLabel(method, rel) {
  const pad = rel.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
  const segs = pad.split("/").map((s) => s.replace(/^\[(\.\.\.)?(.+)\]$/, "$2"));
  return `${segs.join(".")}.${method.toLowerCase()}`;
}

// ── controleerLimiet-adopters: per declaratie, roept de handler het ZELF aan? ──
// Per export-blok gemeten (van `export const METHOD =` tot de volgende export/EOF).
function handlerRoeptControleerLimiet(code, startIdx) {
  const na = code.slice(startIdx + 10);
  const volgende = na.search(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=/);
  const blok = volgende === -1 ? na : na.slice(0, volgende);
  return /\bcontroleerLimiet\s*\(/.test(blok);
}

let bestandenGewijzigd = 0;
const plan = [];

for (const f of routeFiles) {
  const rel = relative(ROOT, f);
  if (only && rel !== only) continue;
  let src = readFileSync(f, "utf8");
  const origineel = src;
  const regels = [];

  // ── A. Fonds inline specs: export const METHOD = withFondsRoute({ ...spec... }, ...
  const fondsRe = /export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*withFondsRoute\(\s*\{/g;
  let m;
  const fondsMatches = [];
  while ((m = fondsRe.exec(src))) fondsMatches.push({ method: m[1], braceIdx: fondsRe.lastIndex - 1, exportIdx: m.index });
  // achteraan-naar-voren verwerken zodat indices geldig blijven
  for (const fm of fondsMatches.reverse()) {
    const method = fm.method;
    // vind het matchende sluit-accolade van dit spec-object
    let d = 1, i = fm.braceIdx + 1;
    for (; i < src.length && d > 0; i++) { if (src[i] === "{") d++; else if (src[i] === "}") d--; }
    const specStart = fm.braceIdx + 1, specEnd = i - 1; // inhoud tussen { }
    const specBinnen = src.slice(specStart, specEnd);
    const key = `${method} ${rel}`;

    // hostGuard: bestaande waarde converteren of "geen" toevoegen
    let hostGuardVal;
    const hgM = specBinnen.match(/hostGuard:\s*(true|false|"route-eigen")/);
    if (hgM) hostGuardVal = hgM[1] === "true" ? '"afdwingen"' : hgM[1] === "false" ? '"geen"' : '"route-eigen"';
    else hostGuardVal = '"geen"';

    // rateLimit
    const zelfLimiet = handlerRoeptControleerLimiet(src, fm.exportIdx);
    const rateLimitVal = zelfLimiet ? '"route-eigen"' : '"nog-niet-beoordeeld"';

    // audit
    let auditVal;
    if (method === "GET") auditVal = '"geen"';
    else {
      const klasse = klassePerHandler.get(key);
      auditVal = klasse === "geen" ? '"geen"' : `{ handeling: "${voorlopigLabel(method, rel)}" }`;
    }

    // herbouw de spec-inhoud: verwijder een bestaande hostGuard, en zet de drie
    // velden vooraan (canonieke plek), rest ongewijzigd.
    let binnen = specBinnen.replace(/\s*hostGuard:\s*(true|false|"route-eigen")\s*,?/, "");
    binnen = binnen.replace(/^\s*,/, "").trim().replace(/,\s*$/, "");
    const nieuw = `{ hostGuard: ${hostGuardVal}, rateLimit: ${rateLimitVal}, audit: ${auditVal}, ${binnen} }`;
    src = src.slice(0, fm.braceIdx) + nieuw + src.slice(specEnd + 1);
    regels.push(`  ${key.padEnd(60)} hostGuard=${hostGuardVal} rateLimit=${rateLimitVal} audit=${auditVal}`);
  }

  // ── B. Machine named SPEC-const: const SPEC = { ... } as const;
  const specM = src.match(/const SPEC\s*=\s*\{/);
  if (specM && /withMachineRoute\(/.test(src)) {
    const braceIdx = specM.index + specM[0].length - 1;
    let d = 1, i = braceIdx + 1;
    for (; i < src.length && d > 0; i++) { if (src[i] === "{") d++; else if (src[i] === "}") d--; }
    const specBinnen = src.slice(braceIdx + 1, i - 1).trim().replace(/,\s*$/, "");
    // methoden die deze SPEC exporteren
    const methodes = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*withMachineRoute/g)].map((x) => x[1]);
    // PREPEND (niet append): `schema:` moet het LAATSTE veld blijven, want de W8-
    // schema-extractor (schema-uit-code.mjs) leest de schema-literal tot het einde van
    // het object. Een veld ná `schema: z.object({...})` breekt die evaluatie.
    const nieuw = `{ rateLimit: "geen", audit: "geen", ${specBinnen} }`;
    src = src.slice(0, braceIdx) + nieuw + src.slice(i - 1 + 1);
    for (const mm of methodes) regels.push(`  ${(mm + " " + rel).padEnd(60)} [machine] rateLimit="geen" audit="geen"`);
  }

  if (src !== origineel) {
    bestandenGewijzigd++;
    plan.push(`\n${rel}`);
    plan.push(...regels.reverse());
    if (apply) writeFileSync(f, src);
  }
}

console.log(plan.join("\n"));
const totaalDecl = plan.filter((r) => /hostGuard=|\[machine\]/.test(r)).length;
console.log(`\n${apply ? "TOEGEPAST" : "DRY-RUN"}: ${bestandenGewijzigd} bestand(en), ${totaalDecl} declaratie(s) gevuld.`);
