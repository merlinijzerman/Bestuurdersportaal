// ============================================================================
//  W3 — Diff-classificatie voor de `withFondsRoute`-codemod.
// ----------------------------------------------------------------------------
//  Het hart van W3/W4. Het karakteriseringsharnas bewijst dat het GEDRAG niet
//  verandert (byte-identiek); dit script bewijst dat de DIFF mechanisch is —
//  dat elke gewijzigde regel een door `route-wrapper.md` gesanctioneerde
//  transformatie is en niets anders. In W4 is dit het enige wat een PR van 80
//  bestanden reviewbaar maakt: `conform` = geen mens hoeft de regels te lezen;
//  `afwijkend` = precies díe regels verdienen een mens.
//
//  Contract: een bestand is `conform` als, ná het wegstrepen van
//    (1) de gesanctioneerde preamble-verwijderingen (auth/profiel/host-guard),
//    (2) de gesanctioneerde wrapper-toevoegingen (import + signatuur + aliassen),
//    (3) toegestane token-substituties in body-regels (user.id → ctx.gebruikerId),
//    (4) verplaatste (identieke) regels,
//  er GEEN gewijzigde, inhoud-dragende regel overblijft. Blijft er iets over,
//  dan is het `afwijkend` en worden precies die regels gerapporteerd.
//
//  Bewust NIET semantisch: het script leest tekst, geen AST. Het mag een
//  legitieme mechanische vorm die het (nog) niet kent als `afwijkend` markeren —
//  dat is een veilige faalrichting (false positive → mens kijkt), nooit een
//  false negative die een inhoudelijke wijziging doorlaat.
//
//  Gebruik:
//    node tests/karakterisering/classificeer-diff.mjs                # HEAD..worktree
//    node tests/karakterisering/classificeer-diff.mjs --base=<ref>   # <ref>..worktree
//    node tests/karakterisering/classificeer-diff.mjs --range=A..B   # A..B
//    node tests/karakterisering/classificeer-diff.mjs --json         # machineleesbaar
//  Exit 0 als alle gewijzigde routebestanden `conform` zijn, anders 1.
// ============================================================================
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const jsonUit = args.includes("--json");
const baseArg = args.find((a) => a.startsWith("--base="));
const rangeArg = args.find((a) => a.startsWith("--range="));
const diffSpec = rangeArg
  ? rangeArg.slice("--range=".length)
  : (baseArg ? baseArg.slice("--base=".length) : "HEAD");

// ── De gesanctioneerde transformaties (uit core/lib/route-wrapper.md) ─────────

const trim = (s) => s.replace(/\s+/g, " ").trim();

// Toevoegingen die de wrapper introduceert.
const TOEGESTAAN_TOEGEVOEGD = [
  /^import \{ withFondsRoute \} from "@\/core\/lib\/route-wrapper";$/,
  // W9-codemod: de zod-import die een schema-literal nodig heeft.
  /^import \{ z \} from "zod";$/,
  // Signatuur: export const METHOD = withFondsRoute(<spec>, async (ctx[, req[, params]]) => {
  /^export const (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS) = withFondsRoute\(.*, async \(ctx.*\) => \{$/,
  /^const supabase = ctx\.supabase;$/,
  // Lokale alias die body-churn nul houdt: const X = ctx.(fondsId|rol|naam|gebruikerId);
  /^const \w+ = ctx\.(fondsId|rol|naam|gebruikerId);$/,
  // [id]-route: params is bij de wrapper al ge-awaite -> cast i.p.v. await.
  /^const \{ [\w,:\s]+ \} = params as \{[^}]*\};$/,
];

// Verwijderingen die het recept voorschrijft (de preamble die de wrapper overneemt).
const TOEGESTAAN_VERWIJDERD = [
  /^import \{ createServerSupabase \} from "@\/core\/lib\/supabase-server";$/,
  /^import \{ beoordeelRouteHostToegang \} from "@\/core\/lib\/tenant-route-guard";$/,
  // Oude handler-signatuur — één regel of gesplitst over meerdere regels:
  //   export async function GET(          _req: NextRequest,
  //   { params }: { params: Promise<{ id: string }> }          ) {
  /^export async function (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s*\(/,
  // BESLUIT (W5, #101): ook de kale `Request`. `aqlab/assurance/audit/[exportId]`
  // typeerde zijn eerste parameter als `_req: Request` in plaats van
  // `_req: NextRequest` — dezelfde gesanctioneerde verwijdering van een oude
  // handler-signatuur, maar het patroon kende alleen de Next-variant en liet de
  // regel als onverklaard achter. Dit verbreedt WELKE typenaam telt, niet WELKE
  // regels: het blijft één parameterdeclaratie in een signatuur.
  /^_?\w+: (NextRequest|Request),?$/,
  /^\{ params \}: \{ params: Promise<\{[^}]*\}> \},?$/,
  /^const supabase = await createServerSupabase\(\);$/,
  // getUser — één regel of gesplitst.
  /supabase\.auth\.getUser\(\)/,
  /^const \{$/,
  /^data: \{ user \},?$/,
  // 401-tak — één regel of gesplitst.
  /error: "Niet ingelogd"/,
  /^if \(!user\)\s*\{?$/,
  // [id]-route: de oude await-params-vorm.
  /^const \{ [\w,:\s]+ \} = await params;$/,
  // Eigen profiel-select (subset ≤4 kolommen) die haalProfiel vervangt — één
  // regel of als method-chain over meerdere regels. De fragmenten zijn strak
  // begrensd: alleen profielkolommen, alleen de id=user-filter, alleen de
  // single-terminator. Een échte query-verwijdering matcht hier niet.
  /^const \{ data: \w+ \} = await supabase\b/,
  /\.from\("profielen"\)/,
  /^\.select\("(id|naam|rol|fonds_id)(,\s*(id|naam|rol|fonds_id))*"\)$/,
  /^\.eq\("id",\s*user\.id\)$/,
  /^\.(maybeSingle|single)\(\);?$/,
  /^const fondsId = profiel\??\.fonds_id/,
  /^const \w+ = profiel\??\.(rol|naam|fonds_id)/,
  // Host-guard-blok — call-opener, argument-regels en de 403-return, één regel
  // of gesplitst. De opener/terminator/status dragen geen tekst; de body-tekst
  // ("Dit webadres…") is de poort die een afwijkende 403 alsnog zou markeren.
  /beoordeelRouteHostToegang/,
  /\bhostOordeel\b/,
  /\bsessieFondsId\b/,
  /^gebruikerId: (user\.id|ctx\.gebruikerId),?$/,
  /^label: "[\w.\-]+",?$/,
  /error: "Dit webadres hoort niet bij uw fonds\."/,
  // Gesplitste NextResponse.json(...)-return van een gesanctioneerde fout: de
  // opener, de status-regel en de sluiter. De error-regel wordt apart getoetst.
  /^return NextResponse\.json\($/,
  /^\{ status: (401|403) \},?$/,
];

// Structurele haakjes zonder semantiek (bv. de `) {` van een gesplitste
// signatuur, de wrapper-sluiter `});`, losse blok-braces).
const STRUCTUUR = [/^\}\)?;?$/, /^\)\;?$/, /^\)\s*\{$/, /^\{$/];

// Verwijderde commentaarregels: het weghalen van preamble-commentaar verandert
// geen gedrag. Toegevoegd commentaar wordt NIET gesanctioneerd (dat is initiatief).
const isCommentaar = (l) => l.startsWith("//");

// Toegestane token-substituties in body-regels: de vier haalProfiel-velden en
// het gebruiker-id. Meer niet — een andere tekstwijziging blijft afwijkend.
//
// BESLUIT (W4): de optional chain is OPTIONEEL in het patroon. W3 kende alleen
// `profiel?.X`, maar veel schrijfroutes doen eerst een expliciete
// `if (!profiel?.fonds_id) -> 400` en gebruiken daarna `profiel.fonds_id`. Dat is
// dezelfde substitutie, niet een andere. Het verbreedt wat automatisch wordt
// weggestreept, maar niet WELKE velden: de whitelist blijft exact de vier
// haalProfiel-kolommen. De controle uit §5 blijft daarmee intact — zet je
// `ctx.fondsId` waar `ctx.gebruikerId` hoort, dan substitueert de verwijderde
// regel naar iets anders dan de toegevoegde en blijft het `afwijkend`.
const CTX_VELD = { rol: "ctx.rol", naam: "ctx.naam", fonds_id: "ctx.fondsId" };

// BESLUIT (W4): welke variabele het eigen profiel draagt, wordt UIT DE DIFF
// afgeleid — niet uit een namenlijst. In de 78 schrijfroutes heet hij `profiel`
// (71×), maar ook `eigenProfiel`, `eigen` en `actorProfiel`. Beslissend is het
// filter: alleen een select met `.eq("id", user.id)` beschrijft het eigen profiel.
// `stemgerProfiel` in stemmingen/[id]/stemmen filtert op de VOLMACHTGEVER en
// blijft daardoor buiten schot — precies zoals het hoort, want die rol door
// `ctx.rol` vervangen zou een echte gedragswijziging zijn.
function eigenProfielVariabelen(verwijderd) {
  const opEigenId = verwijderd.some((l) => /^\.eq\("id",\s*user\.id\)$/.test(l));
  if (!opEigenId) return [];
  const vars = [];
  for (const l of verwijderd) {
    const m = l.match(/^const \{ data: (\w+) \} = await supabase\b/);
    if (m) vars.push(m[1]);
  }
  return vars;
}

function substitueer(regel, eigenVars = []) {
  // `user.email` -> `ctx.email`: de wrapper geeft het sessieveld door dat de oude
  // preambule via `user` in scope had. Verankerd in toetsWrapperFundament (f).
  let r = regel
    .replace(/\buser\.id\b/g, "ctx.gebruikerId")
    .replace(/\buser\.email\b/g, "ctx.email");
  for (const v of eigenVars) {
    // `(profiel as { rol?: string } | null)?.rol` -> `ctx.rol`
    r = r.replace(
      new RegExp(`\\(\\s*${v} as [^()]*\\)\\s*\\??\\.(rol|naam|fonds_id)\\b`, "g"),
      (_m, veld) => CTX_VELD[veld]
    );
    r = r.replace(
      new RegExp(`\\b${v}\\??\\.(rol|naam|fonds_id)\\b`, "g"),
      (_m, veld) => CTX_VELD[veld]
    );
  }
  return r;
}

/** De W6-codemod: `capability: "TE_BEPALEN"` als EERSTE veld in de spec-literal
 *  van een `withFondsRoute`-signatuur. Eén vorm, mechanisch, en verder niets.
 *
 *  Geeft de VERWACHTE toegevoegde regel terug voor een verwijderde regel, of
 *  null als deze regel geen wrapper-signatuur is. Het paar sluit alleen als het
 *  resultaat EXACT de toegevoegde regel is — dus verandert de codemod op
 *  dezelfde regel ook maar één ander teken (een handlerparameter, een
 *  hostGuard-waarde, een label), dan blijft de verwijderde regel onverklaard en
 *  is het bestand `afwijkend`. Dat is strenger dan een verwijderpatroon: dat zou
 *  élke gewijzigde signatuurregel wegstrepen.
 *
 *  BEWUST NIET in TOEGESTAAN_TOEGEVOEGD afgedwongen dat de spec een
 *  `capability` DRAAGT: dat zou de W3/W4-ranges met terugwerkende kracht
 *  afwijkend maken, terwijl die diffs correct waren voor hun eigen recept. De
 *  "geen enkele route zonder declaratie"-eis hangt aan het TYPE (RouteSpecV1)
 *  en straks aan de CI-regel van W13, niet aan deze tekstclassificatie. */
const W6_CAPABILITY = 'capability: "TE_BEPALEN"';
const W6_SIGNATUUR =
  /^(export const (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withFondsRoute\()\{([^{}]*)\}(,.*)$/;

function w6SpecUitbreiding(regel) {
  const m = W6_SIGNATUUR.exec(regel);
  if (!m) return null;
  const binnen = m[2].trim();
  const inhoud = binnen ? `${W6_CAPABILITY}, ${binnen}` : W6_CAPABILITY;
  return `${m[1]}{ ${inhoud} }${m[3]}`;
}

/** De W9-codemod: `, schema: <zod-literal>` als extra veld in de spec-literal van
 *  een with(Fonds|Machine)Route-signatuur. De literal bevat zelf accolades
 *  (`z.object({...})`), dus bakenen we het spec-object af met accolade-diepte en
 *  strippen we het schema-veld eruit. Geeft de regel terug ZONDER het schema-veld;
 *  is dat exact de verwijderde regel, dan is het paar gesanctioneerd — en verandert
 *  de codemod op dezelfde regel ook maar één ander teken, dan sluit het paar niet. */
function w9StripSchema(regel) {
  const pos = regel.indexOf(", schema:");
  if (pos < 0) return null;
  // Scan vanaf de waarde naar rechts tot de accolade die op diepte 0 het
  // spec-object sluit; braces IN de zod-literal (z.object({...})) tellen mee.
  let diepte = 0;
  let sluit = -1;
  for (let i = pos + 2; i < regel.length; i++) {
    if (regel[i] === "{") diepte++;
    else if (regel[i] === "}") {
      if (diepte === 0) { sluit = i; break; }
      diepte--;
    }
  }
  if (sluit < 0) return null;
  // Verwijder ", schema: <waarde>" en behoud de spec-sluiter (incl. de spatie ervóór
  // die de codemod schrijft), zodat het resultaat exact de oude spec-regel is.
  const voorSluiter = regel[sluit - 1] === " " ? sluit - 1 : sluit;
  return regel.slice(0, pos) + regel.slice(voorSluiter);
}

/** #183a — de drieveld-uitbreiding (hostGuard woord-union + rateLimit + audit).
 *  Anders dan W9 is dit NIET puur additief: de codemod zet drie velden vooraan in het
 *  spec-object ÉN verplaatst/converteert een bestaande hostGuard (boolean → woord). Een
 *  string-strip zou dat niet betrouwbaar terugdraaien, dus vergelijken we VELDVERZAMELINGEN:
 *  een paar (verwijderd→toegevoegd) is gesanctioneerd als — met identieke prefix/suffix —
 *  de enige NIEUWE sleutels {hostGuard?, rateLimit, audit} zijn, geen sleutel verdwijnt,
 *  en elke gedeelde sleutel zijn waarde houdt (behalve hostGuard: true→"afdwingen",
 *  false→"geen"). Dit meet de VORM van de transformatie, niet de gekozen waarden — die
 *  horen bij de codemod-meting en de W13-gate, precies zoals de kop van dit bestand eist. */
function splitTopVelden(binnen) {
  const uit = [];
  let d = 0, start = 0, str = null;
  for (let i = 0; i < binnen.length; i++) {
    const c = binnen[i];
    if (str) { if (c === str && binnen[i - 1] !== "\\") str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{" || c === "[" || c === "(") d++;
    else if (c === "}" || c === "]" || c === ")") d--;
    else if (c === "," && d === 0) { uit.push(binnen.slice(start, i)); start = i + 1; }
  }
  if (start < binnen.length) uit.push(binnen.slice(start));
  return uit.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** "<prefix>{ <velden> }<suffix>" → {prefix, velden:Map, suffix} of null. Vindt het
 *  EERSTE object-literal via accolade-diepte (nesting in z.object({...})/audit:{...}
 *  telt mee); string-bewust. */
function parseSpecRegel(regel) {
  const open = regel.indexOf("{");
  if (open < 0) return null;
  let d = 0, sluit = -1, str = null;
  for (let i = open; i < regel.length; i++) {
    const c = regel[i];
    if (str) { if (c === str && regel[i - 1] !== "\\") str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) { sluit = i; break; } }
  }
  if (sluit < 0) return null;
  const velden = new Map();
  for (const veld of splitTopVelden(regel.slice(open + 1, sluit).trim())) {
    const dp = veld.indexOf(":");
    if (dp < 0) return null; // shorthand/spread → onbekende vorm, val terug op "afwijkend"
    velden.set(veld.slice(0, dp).trim(), veld.slice(dp + 1).trim());
  }
  return { prefix: regel.slice(0, open), velden, suffix: regel.slice(sluit + 1) };
}

function w183Paar(remLine, addLine) {
  const a = parseSpecRegel(remLine), b = parseSpecRegel(addLine);
  if (!a || !b) return false;
  if (a.prefix !== b.prefix || a.suffix !== b.suffix) return false;
  const nieuw = [...b.velden.keys()].filter((k) => !a.velden.has(k));
  if (!nieuw.includes("rateLimit") || !nieuw.includes("audit")) return false;
  for (const k of nieuw) if (k !== "rateLimit" && k !== "audit" && k !== "hostGuard") return false;
  for (const k of a.velden.keys()) if (!b.velden.has(k)) return false; // geen sleutel verdwenen
  for (const [k, v] of a.velden) {
    if (k === "hostGuard") {
      const nw = b.velden.get(k);
      if (!((v === "true" && nw === '"afdwingen"') || (v === "false" && nw === '"geen"') || nw === v)) return false;
    } else if (b.velden.get(k) !== v) return false;
  }
  return true;
}

const matcht = (regels, regel) => regels.some((re) => re.test(regel));

// ── Diff parsen ──────────────────────────────────────────────────────────────

function haalDiff(spec) {
  const uit = execFileSync(
    "git",
    ["diff", "--no-color", "--unified=0", spec, "--", "app/api/**/route.ts", "*/app/api/**/route.ts"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return uit;
}

function parseerPerBestand(diffTekst) {
  const bestanden = new Map();
  let huidig = null;
  for (const regel of diffTekst.split("\n")) {
    const m = regel.match(/^\+\+\+ b\/(.+)$/);
    if (regel.startsWith("diff --git")) {
      const gm = regel.match(/^diff --git a\/(.+?) b\/(.+)$/);
      huidig = gm ? gm[2] : null;
      if (huidig) bestanden.set(huidig, { verwijderd: [], toegevoegd: [] });
      continue;
    }
    if (!huidig) continue;
    if (regel.startsWith("+++") || regel.startsWith("---") || regel.startsWith("@@")) continue;
    if (regel.startsWith("+")) bestanden.get(huidig).toegevoegd.push(regel.slice(1));
    else if (regel.startsWith("-")) bestanden.get(huidig).verwijderd.push(regel.slice(1));
  }
  return bestanden;
}

// ── Classificatie per bestand ────────────────────────────────────────────────

function classificeer({ verwijderd, toegevoegd }) {
  let rem = verwijderd.map(trim).filter((l) => l.length > 0);
  let add = toegevoegd.map(trim).filter((l) => l.length > 0);

  const eigenVars = eigenProfielVariabelen(rem);

  // De cast-vorm van de alias — `const rol = (profiel as { rol?: string } | null)?.rol;`
  // — wordt vervangen door `const rol = ctx.rol;`, en die toevoeging valt al onder
  // TOEGESTAAN_TOEGEVOEGD. De verwijdering moet dus apart worden weggestreept, maar
  // ALLEEN voor variabelen die in deze diff aantoonbaar het eigen profiel droegen.
  // Een blanket-patroon zou `(stemgerProfiel as …)?.rol -> ctx.rol` stilzwijgend
  // accepteren, en dat is een echte gedragswijziging.
  const castAlias =
    eigenVars.length > 0
      ? new RegExp(
          `^const \\w+ = \\(\\s*(?:${eigenVars.join("|")}) as [^()]*\\)\\s*\\??\\.(?:rol|naam|fonds_id);?$`
        )
      : null;

  // VOLGORDE (W4): eerst PAREN sluiten, dan pas losse regels wegstrepen.
  //
  //  Andersom eet een verwijderpatroon soms de linkerhelft op van een paar dat
  //  het niet bedoelde. `.eq("id", user.id)` staat in de verwijderlijst omdat het
  //  bij de profielen-select hoort die verdwijnt — maar in `/api/profiel` BLIJFT
  //  die select (tien kolommen, handwerk) en verandert alleen het token. De
  //  verwijderde regel werd dan weggestreept en de toegevoegde bleef als
  //  onverklaard achter. Idem voor `gebruikerId:` in de classificatie-routes, waar
  //  het geen host-guard-argument is maar een gewone parameter.
  //
  //  Paren sluiten is strenger, niet losser: een paar valt alleen weg als de
  //  verwijderde regel NA substitutie exact de toegevoegde regel is. Een verkeerd
  //  veld (`ctx.fondsId` waar `ctx.gebruikerId` hoort) sluit dus geen paar.

  // 1. Token-substitutie: een verwijderde body-regel die na substitutie exact een
  //    toegevoegde regel is, is een gesanctioneerde wijziging.
  for (let i = rem.length - 1; i >= 0; i--) {
    const s = substitueer(rem[i], eigenVars);
    const j = add.indexOf(s);
    if (j >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }
  // 1b. W6 — de spec-uitbreiding met de capability-declaratie. Ook een PAAR, om
  //     dezelfde reden als hierboven: alleen als de verwijderde signatuurregel
  //     ná de codemod-transformatie exact de toegevoegde regel is, sluit hij.
  for (let i = rem.length - 1; i >= 0; i--) {
    const verwacht = w6SpecUitbreiding(rem[i]);
    if (verwacht === null) continue;
    const j = add.indexOf(verwacht);
    if (j >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }
  // 1c. W9 — de spec-uitbreiding met het schema-veld. Voor elke TOEGEVOEGDE regel:
  //     strip het schema-veld; is het resultaat exact een VERWIJDERDE regel, dan is
  //     het paar gesanctioneerd. Zelfde strengheid als 1b — een ander gewijzigd
  //     teken op de regel laat het paar niet sluiten.
  for (let j = add.length - 1; j >= 0; j--) {
    const zonder = w9StripSchema(add[j]);
    if (zonder === null) continue;
    const i = rem.indexOf(zonder);
    if (i >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }
  // 1d. #183a — de drieveld-uitbreiding. Voor elke TOEGEVOEGDE spec-regel: zoek een
  //     VERWIJDERDE regel waarmee hij een gesanctioneerd paar vormt (veldverzameling,
  //     w183Paar). Zelfde strengheid als 1b/1c: één ander gewijzigd veld en het paar
  //     sluit niet — die regel blijft onverklaard en het bestand wordt "afwijkend".
  for (let j = add.length - 1; j >= 0; j--) {
    const i = rem.findIndex((r) => w183Paar(r, add[j]));
    if (i >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }
  // 2. Verplaatste (identieke) regels wegstrepen.
  for (let i = rem.length - 1; i >= 0; i--) {
    const j = add.indexOf(rem[i]);
    if (j >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }
  // 3. Gesanctioneerde verwijderingen wegstrepen (preamble + structuur + comment).
  rem = rem.filter(
    (l) =>
      !(
        matcht(TOEGESTAAN_VERWIJDERD, l) ||
        matcht(STRUCTUUR, l) ||
        isCommentaar(l) ||
        (castAlias && castAlias.test(l))
      )
  );
  // 4. Gesanctioneerde toevoegingen wegstrepen (import + signatuur + aliassen +
  //    de wrapper-sluiter `});` en andere structurele haakjes — geen semantiek).
  add = add.filter((l) => !(matcht(TOEGESTAAN_TOEGEVOEGD, l) || matcht(STRUCTUUR, l)));

  const conform = rem.length === 0 && add.length === 0;
  return {
    classificatie: conform ? "conform" : "afwijkend",
    onverklaard_verwijderd: rem,
    onverklaard_toegevoegd: add,
  };
}

// ── Uitvoer ──────────────────────────────────────────────────────────────────

function main() {
  const diffTekst = haalDiff(diffSpec);
  const bestanden = parseerPerBestand(diffTekst);
  const resultaten = [];
  for (const [pad, hunks] of bestanden) {
    resultaten.push({ bestand: pad, ...classificeer(hunks) });
  }

  const afwijkend = resultaten.filter((r) => r.classificatie === "afwijkend");

  if (jsonUit) {
    console.log(JSON.stringify({ diffSpec, resultaten }, null, 2));
  } else {
    console.log(`Diff-classificatie (${diffSpec}) — ${resultaten.length} gewijzigd routebestand(en)\n`);
    if (resultaten.length === 0) console.log("  (geen gewijzigde app/api/**/route.ts-bestanden)");
    for (const r of resultaten) {
      const merk = r.classificatie === "conform" ? "✓ conform " : "✗ AFWIJKEND";
      console.log(`  ${merk}  ${r.bestand}`);
      for (const l of r.onverklaard_verwijderd) console.log(`        - ${l}`);
      for (const l of r.onverklaard_toegevoegd) console.log(`        + ${l}`);
    }
    console.log(
      `\n${resultaten.length - afwijkend.length} conform, ${afwijkend.length} afwijkend.`
    );
  }
  process.exit(afwijkend.length > 0 ? 1 : 0);
}

main();
