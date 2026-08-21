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
  /^_?\w+: NextRequest,?$/,
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
  /^const \{ data: profiel \} = await supabase\b/,
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
function substitueer(regel) {
  return regel
    .replace(/\buser\.id\b/g, "ctx.gebruikerId")
    .replace(/\bprofiel\??\.rol\b/g, "ctx.rol")
    .replace(/\bprofiel\??\.naam\b/g, "ctx.naam")
    .replace(/\bprofiel\??\.fonds_id\b/g, "ctx.fondsId");
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

  // 1. Gesanctioneerde verwijderingen wegstrepen (preamble + structuur + comment).
  rem = rem.filter(
    (l) => !(matcht(TOEGESTAAN_VERWIJDERD, l) || matcht(STRUCTUUR, l) || isCommentaar(l))
  );
  // 2. Gesanctioneerde toevoegingen wegstrepen (import + signatuur + aliassen +
  //    de wrapper-sluiter `});` en andere structurele haakjes — geen semantiek).
  add = add.filter((l) => !(matcht(TOEGESTAAN_TOEGEVOEGD, l) || matcht(STRUCTUUR, l)));

  // 3. Token-substitutie: een verwijderde body-regel die na substitutie exact
  //    een toegevoegde regel is, is een gesanctioneerde wijziging.
  for (let i = rem.length - 1; i >= 0; i--) {
    const s = substitueer(rem[i]);
    const j = add.indexOf(s);
    if (j >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }
  // 4. Verplaatste (identieke) regels wegstrepen.
  for (let i = rem.length - 1; i >= 0; i--) {
    const j = add.indexOf(rem[i]);
    if (j >= 0) {
      rem.splice(i, 1);
      add.splice(j, 1);
    }
  }

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
