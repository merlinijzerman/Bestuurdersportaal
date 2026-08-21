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
];

// Verwijderingen die het recept voorschrijft (de preamble die de wrapper overneemt).
const TOEGESTAAN_VERWIJDERD = [
  /^import \{ createServerSupabase \} from "@\/core\/lib\/supabase-server";$/,
  /^import \{ beoordeelRouteHostToegang \} from "@\/core\/lib\/tenant-route-guard";$/,
  /^export async function (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s*\(.*\)\s*\{$/,
  /^const supabase = await createServerSupabase\(\);$/,
  // getUser — één regel of gesplitst.
  /supabase\.auth\.getUser\(\)/,
  /^const \{$/,
  /^data: \{ user \},?$/,
  // 401-tak — één regel of gesplitst.
  /error: "Niet ingelogd"/,
  /^if \(!user\)\s*\{?$/,
  // Eigen profiel-select (subset ≤4 kolommen) die haalProfiel vervangt.
  /^const \{ data: profiel \} = await supabase\b/,
  /\.from\("profielen"\)/,
  /^const fondsId = profiel\?\.fonds_id/,
  /^const \w+ = profiel\?\.(rol|naam|fonds_id)/,
  // Host-guard-blok.
  /beoordeelRouteHostToegang/,
  /\bhostOordeel\b/,
  /\bsessieFondsId\b/,
  /error: "Dit webadres hoort niet bij uw fonds\."/,
];

// Structurele sluiters van verwijderde blokken (dragen geen semantiek).
const STRUCTUUR = [/^\}\)?;?$/, /^\)\;?$/, /^\{$/];

// Verwijderde commentaarregels: het weghalen van preamble-commentaar verandert
// geen gedrag. Toegevoegd commentaar wordt NIET gesanctioneerd (dat is initiatief).
const isCommentaar = (l) => l.startsWith("//");

// Toegestane token-substituties in body-regels.
function substitueer(regel) {
  return regel.replace(/\buser\.id\b/g, "ctx.gebruikerId");
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
