// ============================================================================
//  W8 — Schema-inventaris: wat elke handler vandaag met de body doet.
// ----------------------------------------------------------------------------
//  Het EERSTE product van W8 (zie 05 Security en compliance/PLAN-W8-W9). Dit
//  script leest — puur mechanisch, geen AST — per handler af:
//    - wrapper (withFondsRoute / withMachineRoute), methode, capability, host-guard;
//    - of de handler een body LEEST (req.json() / request.json());
//    - welke body-velden hij aanraakt (destructuring, .field, ["field"]);
//    - welke typeof-/cast-controles op die velden staan;
//    - of de body-lezing een SLIKKER is (.catch(() => ({})) / null).
//
//  DIT IS EEN CONCEPT, GEEN WAARHEID. Regex ziet geen impliciete validatie
//  (een `.eq()` die op een onbestaande waarde nul rijen geeft is een controle
//  die hier niet verschijnt) en kan een veld missen dat via een tussenvariabele
//  loopt. Elke handler waar het script twijfelt, komt op de `nietAfleidbaar`-
//  lijst — dat IS de handwerkscope van W9, niet een fout. De differentiële
//  classifier (schema-niet-strenger.mjs) is het vangnet, niet dit script.
//
//  Gebruik:
//    node tests/karakterisering/schema-inventaris.mjs            # tabel + samenvatting
//    node tests/karakterisering/schema-inventaris.mjs --json     # volledige inventaris
//    node tests/karakterisering/schema-inventaris.mjs --out=<pad> # schrijf JSON naar bestand
// ============================================================================
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "app", "api");

const args = process.argv.slice(2);
const jsonUit = args.includes("--json");
const outArg = args.find((a) => a.startsWith("--out="));

// ── Alle route.ts-bestanden onder app/api ────────────────────────────────────
function routeBestanden(dir) {
  const uit = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    const st = statSync(pad);
    if (st.isDirectory()) uit.push(...routeBestanden(pad));
    else if (naam === "route.ts") uit.push(pad);
  }
  return uit;
}

const METHODEN = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
// Drie exportvormen tellen als handler-declaratie:
//   export const METHOD = withFondsRoute(...          (gewrapt, inline of named-fn)
//   export const METHOD = withMachineRoute(...         (idem, platformkant)
//   export async function METHOD(...                   (ONGEWRAPT — legacy restcategorie)
// De ongewrapte vorm hoort erbij zodat de inventaris COMPLEET is en die routes
// expliciet als "GEEN"-wrapper markeert i.p.v. ze stil weg te laten.
const HANDLER_RE = new RegExp(
  `export (?:const (${METHODEN})\\s*=\\s*(withFondsRoute|withMachineRoute)\\s*\\(` +
    `|async function (${METHODEN})\\s*\\()`,
  "g"
);

/** Resolveert de body van een handler die als NAAM (identifier) aan de wrapper is
 *  meegegeven — `withMachineRoute(SPEC, draai)` — i.p.v. inline `async (ctx) => {`.
 *  Zoekt `async function NAAM(` of `const NAAM = async` en geeft de brace-gebalanceerde
 *  body terug. Zonder dit mist de span-detectie de body-lezing van semantische-extractie. */
function resolveerNamedFn(src, naam) {
  const re = new RegExp(`(?:async function ${naam}\\s*\\(|const ${naam}\\s*=\\s*async)`);
  const m = re.exec(src);
  if (!m) return "";
  let i = src.indexOf("{", m.index);
  if (i < 0) return "";
  let diepte = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") diepte++;
    else if (src[j] === "}") { diepte--; if (diepte === 0) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}

// Body-lezing: req.json() / request.json(), met of zonder .catch(...).
const BODY_LEES_RE = /\b(req|request)\.json\s*\(\)/;
const SLIKKER_RE = /\.json\s*\(\)\s*\.catch\s*\(\s*\(\)\s*=>\s*(\(\{\}\)|\{\}|null)\s*\)/;

// Veld-detectie binnen de handler-body.
// 1) destructuring: const { a, b, c } = body   /   = (body as ...)  / = await req.json()
const DESTRUCT_RE = /const\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:\(?\s*(?:body|req\.json\(\)|request\.json\(\))|body)\b/g;
// 2) directe toegang: body.field / body?.field / body!.field
const DOT_RE = /\bbody\s*[?!]?\.\s*([A-Za-z_$][\w$]*)/g;
// 3) index: body["field"] / body['field']
const IDX_RE = /\bbody\s*[?!]?\[\s*["']([^"']+)["']\s*\]/g;
// typeof-controle: typeof body.field === "string" / typeof field === "..."
const TYPEOF_RE = /typeof\s+(?:body\s*[?!]?\.\s*)?([A-Za-z_$][\w$]*)\s*(===|!==)\s*["']([a-z]+)["']/g;
// cast: body.field as TYPE  (grof; alleen als hint)
const CAST_RE = /\bbody\s*[?!]?\.\s*([A-Za-z_$][\w$]*)\s+as\s+([^;,)\n]+)/g;

// Spec-literal (éénregelig): { capability: "x", hostGuard: true, label: "y" }
function leesSpec(tekst) {
  const cap = tekst.match(/capability:\s*["']([^"']+)["']/);
  const host = tekst.match(/hostGuard:\s*(true|false|"route-eigen")/);
  const label = tekst.match(/label:\s*["']([^"']+)["']/);
  return {
    capability: cap ? cap[1] : null,
    hostGuard: host ? host[1].replace(/"/g, "") : null,
    label: label ? label[1] : null,
  };
}

function velden(body) {
  const set = new Set();
  const typeofChecks = [];
  const casts = [];
  let m;
  for (const re of [DESTRUCT_RE, DOT_RE, IDX_RE]) re.lastIndex = 0;
  while ((m = DESTRUCT_RE.exec(body))) {
    for (const stuk of m[1].split(",")) {
      const naam = stuk.split(":")[0].split("=")[0].replace(/\./g, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(naam)) set.add(naam);
    }
  }
  while ((m = DOT_RE.exec(body))) set.add(m[1]);
  while ((m = IDX_RE.exec(body))) set.add(m[1]);
  TYPEOF_RE.lastIndex = 0;
  while ((m = TYPEOF_RE.exec(body))) typeofChecks.push({ veld: m[1], op: m[2], type: m[3] });
  CAST_RE.lastIndex = 0;
  while ((m = CAST_RE.exec(body))) casts.push({ veld: m[1], type: m[2].trim() });
  return { velden: [...set].sort(), typeofChecks, casts };
}

// ── Inventaris opbouwen ───────────────────────────────────────────────────────
/** Bouwt de volledige handler-inventaris. Herbruikbaar door de schema-generator
 *  (schema-genereer.mjs) zodat die niet een tweede, driftende parser bevat. */
export function bouwInventaris() {
  const handlers = [];
  for (const pad of routeBestanden(API_DIR).sort()) {
    const src = readFileSync(pad, "utf8");
    const rel = relative(ROOT, pad);
  // Splits het bestand op handler-markers zodat elke handler zijn eigen span heeft.
  const markers = [];
  HANDLER_RE.lastIndex = 0;
  let mm;
  while ((mm = HANDLER_RE.exec(src))) {
    // Groep 1+2 = `export const METHOD = withXRoute(`; groep 3 = `export async function METHOD(`.
    const methode = mm[1] ?? mm[3];
    const wrapper = mm[2] ?? "GEEN";
    markers.push({ index: mm.index, methode, wrapper, specStart: HANDLER_RE.lastIndex });
  }
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const eind = i + 1 < markers.length ? markers[i + 1].index : src.length;
    const span = src.slice(start, eind);
    // Spec = van specStart tot de eerste `, async` of `, (ctx` op de eerste regel.
    const specTekst = src.slice(markers[i].specStart, markers[i].specStart + 400).split(/,\s*async|,\s*\(/)[0];
    const spec = leesSpec(specTekst);
    // Named-fn: `withXRoute(SPEC, draai)` — de body zit in `draai`, niet in de span.
    // Herken een identifier als 2e argument en resolveer diens body erbij.
    const tweedeArg = specTekst.match(/,\s*([A-Za-z_$][\w$]*)\s*\)?\s*;?\s*$/);
    const namedBody = tweedeArg ? resolveerNamedFn(src, tweedeArg[1]) : "";
    const effBody = span + "\n" + namedBody;
    const bodyLezend = BODY_LEES_RE.test(effBody);
    const slikker = SLIKKER_RE.test(effBody);
    const veldInfo = bodyLezend ? velden(effBody) : { velden: [], typeofChecks: [], casts: [] };
    handlers.push({
      bestand: rel,
      methode: markers[i].methode,
      wrapper: markers[i].wrapper,
      capability: spec.capability,
      hostGuard: spec.hostGuard,
      label: spec.label,
      bodyLezend,
      slikker,
      ...veldInfo,
    });
  }
  }
  return handlers;
}

// ── Samenvatting + CLI-uitvoer (alleen bij DIRECT draaien, niet bij import) ────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const handlers = bouwInventaris();
const totaal = handlers.length;
const fonds = handlers.filter((h) => h.wrapper === "withFondsRoute");
const machine = handlers.filter((h) => h.wrapper === "withMachineRoute");
const ongewrapt = handlers.filter((h) => h.wrapper === "GEEN");
const gewrapt = handlers.filter((h) => h.wrapper !== "GEEN");
const bodyLezend = handlers.filter((h) => h.bodyLezend);
const slikkers = handlers.filter((h) => h.slikker);
// Gewrapte body-lezende handlers = die een `schema` op RouteSpec/MachineSpec KUNNEN dragen.
const gewraptBodyLezend = bodyLezend.filter((h) => h.wrapper !== "GEEN");
// Ongewrapte body-lezende routes = kunnen GEEN schema op de spec dragen; scope-beslissing
// (wrappen eerst, of gedeclareerde uitzondering op de W13-lijst). Zie PLAN §2.
const ongewraptBodyLezend = bodyLezend.filter((h) => h.wrapper === "GEEN");
// Niet-afleidbaar (concept): body-lezend maar 0 velden gevonden (loopt via
// tussenvariabele of impliciet). De echte niet-strenger-toets is de differentiële classifier.
const nietAfleidbaar = gewraptBodyLezend.filter((h) => h.velden.length === 0);

const inventaris = {
  gemetenOp: "feat/w8-schemagenerator",
  totaalHandlers: totaal,
  gewrapt: gewrapt.length,
  withFondsRoute: fonds.length,
  withMachineRoute: machine.length,
  ongewrapt: ongewrapt.length,
  bodyLezend: bodyLezend.length,
  gewraptBodyLezend: gewraptBodyLezend.length,
  geenBodyGewrapt: gewrapt.length - gewraptBodyLezend.length,
  slikkers: slikkers.length,
  ongewraptBodyLezend: ongewraptBodyLezend.map((h) => `${h.methode} ${h.bestand}`),
  nietAfleidbaar: nietAfleidbaar.map((h) => `${h.methode} ${h.bestand}`),
  handlers,
};

if (outArg) {
  const pad = outArg.slice("--out=".length);
  writeFileSync(pad, JSON.stringify(inventaris, null, 2));
  console.log(`Inventaris geschreven naar ${pad} (${totaal} handlers).`);
} else if (jsonUit) {
  console.log(JSON.stringify(inventaris, null, 2));
} else {
  console.log(`Schema-inventaris — ${totaal} handlers\n`);
  console.log(`  gewrapt totaal    : ${gewrapt.length}  (withFondsRoute ${fonds.length} + withMachineRoute ${machine.length})`);
  console.log(`  ongewrapt (GEEN)  : ${ongewrapt.length}`);
  console.log(`  body-lezend totaal: ${bodyLezend.length}`);
  console.log(`   ├─ gewrapt       : ${gewraptBodyLezend.length}  → krijgen een schema op de spec`);
  console.log(`   └─ ongewrapt     : ${ongewraptBodyLezend.length}  → GEEN spec; scope-beslissing`);
  console.log(`  "geen-body" gewrapt: ${gewrapt.length - gewraptBodyLezend.length}`);
  console.log(`  slikkers          : ${slikkers.length}`);
  console.log(`  niet-afleidbaar   : ${nietAfleidbaar.length}`);
  console.log(`\nOngewrapte body-lezende routes (kunnen GEEN schema op de spec dragen → beslissing):`);
  for (const h of inventaris.ongewraptBodyLezend) console.log(`  - ${h}`);
  console.log(`\nNiet-afleidbaar (gewrapt, body-lezend, 0 velden gevonden → handwerk W9):`);
  for (const h of nietAfleidbaar) console.log(`  - ${h.methode} ${h.bestand}`);
}
}
