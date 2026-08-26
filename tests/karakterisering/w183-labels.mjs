// ============================================================================
//  #183a-commit-2 — Gecureerde audit-`handeling`-labels.
// ----------------------------------------------------------------------------
//  Vervangt de VOORLOPIGE route-identiteit-labels (commit 1, padecho zoals
//  "procedures.id.afschrift.post") door semantische handeling-labels. Scheme:
//    • mechanische basis uit route-identiteit: <segmenten zonder [param]>.<verb>,
//      verb = POST→aanmaken · PATCH→wijzigen · PUT→vervangen · DELETE→verwijderen;
//    • GERICHT handwerk (OVERRIDES) voor de actie-geroute POSTs (sluiten, stemmen,
//      backfills, exports, rechten, …) waar de methode-verb redundant/onjuist is.
//  NIET uit capability, NIET kaal <resource>.<methode> (besluit "Optie 3").
//
//  De uitkomst is machineleesbaar bevroren in route-mechanismen? nee — in een EIGEN
//  register (audit-handelingen.expected.json) met een collisietoets en een drift-gate
//  (audit-handelingen.test.ts).
//
//  Gebruik:
//    node tests/karakterisering/w183-labels.mjs --dry     # toon plan + collisies
//    node tests/karakterisering/w183-labels.mjs --apply   # schrijf labels + register
// ============================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, "..", "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");

const VERB = { POST: "aanmaken", PATCH: "wijzigen", PUT: "vervangen", DELETE: "verwijderen" };

// ── GERICHT handwerk: de handeling-labels die niet mechanisch af te leiden zijn ──
// Sleutel = "METHOD <pad zonder app/api en /route.ts>". Bewust expliciet, per stuk
// leesbaar. De sensitieve categorieën (DELETE · export · bulk-backfill · rechten)
// staan hier allemaal, plus elke actie-geroute POST.
// Consistent met de mechanische basis: de RESOURCE houdt de padvorm (meervoud), de
// laatste component is de ACTIE. Overrides bestaan omdat de mechanische verb-suffix
// (`.aanmaken`) op een actie-geroute POST redundant/onjuist zou zijn.
const OVERRIDES = {
  // — stemmingen (bestuurlijke ketengebeurtenissen) —
  "POST stemmingen/[id]/stemmen": "stemmingen.stem-uitbrengen",
  "POST stemmingen/[id]/sluiten": "stemmingen.sluiten",
  "POST stemmingen/[id]/intrekken": "stemmingen.intrekken",
  // — agendapunten —
  "POST agendapunten/[id]/herstellen": "agendapunten.herstellen",
  // — classificatie —
  "POST classificatie/[id]/beoordeel": "classificatie.beoordelen",
  "POST classificatie/[id]/terugdraai": "classificatie.terugdraaien",
  "POST classificatie/backfill": "classificatie.bulk-herclassificeren",
  // — documenten: her-verwerking + bulk (kostendragend/pijplijn) —
  "POST documents/[id]/her-extract": "documents.her-extraheren",
  "POST documents/[id]/opnieuw-verwerken": "documents.opnieuw-verwerken",
  "POST documents/bulk-metadata": "documents.bulk-metadata-wijzigen",
  "POST documents/embeddings-backfill": "documents.bulk-embeddings-bijwerken",
  "POST documents/reindex-backfill": "documents.bulk-herindexeren",
  "POST documents/upload": "documents.uploaden",
  "PATCH documents/[id]/ai-markering": "documents.ai-markering-wijzigen",
  "PATCH documents/[id]/metadata": "documents.metadata-wijzigen",
  "POST documents/[id]/agendapunten": "documents.agendapunt-koppelen",
  "DELETE documents/[id]/agendapunten": "documents.agendapunt-ontkoppelen",
  "POST documents/[id]/procesinstanties": "documents.procesinstantie-koppelen",
  "DELETE documents/[id]/procesinstanties": "documents.procesinstantie-ontkoppelen",
  // — export (gegevens verlaten de tenant) —
  "POST ai/stuk-export": "ai.stuk-exporteren",
  // — rechten/rol (privilege) —
  "PATCH profiel": "profiel.eigen-wijzigen",
  "PUT organisatieprofiel": "organisatieprofiel.wijzigen",
  // — notulen —
  "POST notulen/[id]/segmenteer": "notulen.segmenteren",
  "POST notulen/segmenten/[id]/bevestig": "notulen.segmenten.bevestigen",
  // — vergaderingen —
  "POST vergaderingen/[id]/archief": "vergaderingen.archiveren",
  // — risico's —
  "POST risicos/[id]/sluiten": "risicos.sluiten",
  // — reflectie —
  "POST reflectie/transitie": "reflectie.transitie-uitvoeren",
  // — decisions status —
  "POST decisions/[id]/status": "decisions.status-wijzigen",
  // — procedures: acties op stappen/requirements —
  "POST procedures/[id]/requirements/uitsluiten": "procedures.requirements.uitsluiten",
  "POST procedures/[id]/stappen/[stapId]/heropenen": "procedures.stappen.heropenen",
  "POST procedures/[id]/stappen/[stapId]/agendapunt": "procedures.stappen.agendapunt-koppelen",
  "POST procedures/[id]/stappen/[stapId]/toelichting": "procedures.stappen.toelichten",
  // — chat/vergelijk (AI-gebruik, kostendragend) —
  "POST chat": "chat.gebruiken",
  "POST vergelijk": "vergelijk.uitvoeren",
};

// ── Mechanische basis ────────────────────────────────────────────────────────
function segmenten(rel) {
  return rel.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "")
    .split("/").filter((s) => !/^\[.*\]$/.test(s));
}
function mechanisch(method, rel) {
  return `${segmenten(rel).join(".")}.${VERB[method]}`;
}
function labelVoor(method, rel) {
  const pad = rel.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
  const sleutel = `${method} ${pad}`;
  return OVERRIDES[sleutel] ?? mechanisch(method, rel);
}

// ── Bestanden ────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith("route.ts")) out.push(p);
  }
  return out;
}

const register = {};
const collisies = {};
let gewijzigd = 0;
const plan = [];

for (const f of walk(join(ROOT, "app/api"))) {
  const rel = relative(ROOT, f);
  let src = readFileSync(f, "utf8");
  const origineel = src;
  // vervang elke voorlopige audit: { handeling: "<x>" } binnen een export-blok
  // [^\n] bindt aan ÉÉN regel: de spec is eenregelig, dus dit kan niet naar een
  // volgende export overlopen (GET-routes met audit:"geen" mogen niet matchen).
  const re = /(export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*withFondsRoute\(\{[^\n]*?audit: \{ handeling: ")([^"]*)(" \})/g;
  src = src.replace(re, (m, pre, method, _oud, post) => {
    const label = labelVoor(method, rel);
    const pad = rel.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
    const sleutel = `${method} ${pad}`;
    if (register[label]) (collisies[label] ??= [register[label]]).push(sleutel);
    register[label] = sleutel;
    plan.push(`  ${sleutel.padEnd(52)} → ${label}`);
    return `${pre}${label}${post}`;
  });
  if (src !== origineel) { gewijzigd++; if (apply) writeFileSync(f, src); }
}

plan.sort();
console.log(plan.join("\n"));
console.log(`\n${apply ? "TOEGEPAST" : "DRY-RUN"}: ${gewijzigd} bestand(en), ${Object.keys(register).length} unieke labels.`);
const botsingen = Object.entries(collisies);
if (botsingen.length) {
  console.error(`\n✗ ${botsingen.length} COLLISIE(S):`);
  for (const [label, routes] of botsingen) console.error(`   ${label}: ${routes.join(" , ")}`);
  process.exitCode = 1;
} else {
  console.error(`\n✓ geen collisies (${Object.keys(register).length} labels uniek)`);
}
if (apply) {
  const uit = {
    _doc: "#183a — autoritatief register van audit-handeling-labels per state-changing handler. " +
      "De gate (audit-handelingen.test.ts) faalt op (a) een label in de code dat hier niet staat, " +
      "(b) een collisie, (c) een register-entry zonder route. Wijzig een label = wijzig hier mét motivering.",
    _regel: "VORM (bevroren #183a): <resource-segmenten uit het pad, MEERVOUD zoals het pad>.<INFINITIEF-werkwoord>. " +
      "Meervoud volgt de bestaande label-/capability-conventie (procedures.afschrift.intrekken, documents.lifecycle.manage); " +
      "infinitief idem (de bestaande label-segmenten zijn infinitief). De betekenis van het handwerk zit in het WERKWOORD, " +
      "niet in enkelvoud maken van het zelfstandig naamwoord (documents.definitief-verwijderen, niet document.verwijderen). " +
      "Deze vorm is na de eerste handelingen_log-rijen niet meer om te draaien zonder de historie onvergelijkbaar te maken.",
    handelingen: Object.fromEntries(Object.entries(register).sort()),
  };
  writeFileSync(join(HIER, "..", "cross-tenant", "audit-handelingen.expected.json"), JSON.stringify(uit, null, 2) + "\n");
  console.error("register geschreven: tests/cross-tenant/audit-handelingen.expected.json");
}
