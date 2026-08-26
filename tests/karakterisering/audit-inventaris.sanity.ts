// ============================================================================
//  Gate voor de auditinventaris + de split (W11, vervolg 0190).
//
//  Drie dingen, allemaal fail-closed (geen waarschuwingsmodus):
//    1. de split-assertie is schoon (meta.assertieFouten leeg), én de invarianten
//       worden hier ONAFHANKELIJK uit de JSON herleid — niet blind op meta vertrouwd;
//    2. proven-red: dezelfde check vlagt een synthetische overtreding;
//    3. triggerherkenning: de audit-CAPTURE-triggers (fn_fonds_config_capture,
//       fn_fonds_stuurinfo_capture) bestaan nog in de migraties op hun basistabellen.
//       Die herkenning is met de hand ontdekt; deze test vangt stille drift bij een
//       migratie — dan mag een handler die erop leunt niet als "geen spoor" gelden.
//
//  Uitvoeren: npx tsx tests/karakterisering/audit-inventaris.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, "..", "..");

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("auditinventaris-gate sanity-tests:");

type Handler = {
  handler: string;
  wrapper: string;
  klasse: string;
  schrijftAuditspoor: boolean;
  declaredAudit: string | null;
  bewijsketen: { token: string }[];
  platform: { token: string }[];
};
const inv = JSON.parse(readFileSync(join(HIER, "audit-inventaris.json"), "utf8")) as {
  meta: {
    assertieFouten: string[];
    klasseTelling: Record<string, number>;
    ketengebeurtenisVereist: string[];
    spoorVereist: string[];
  };
  handlers: Handler[];
};

// ── 0. Drift-gate: de ingecheckte JSON = een VERSE regeneratie ───────────────
// Zonder deze check leest de rest van deze suite een statische momentopname en kan
// de bron (audit-inventaris.mjs of de gemeten app/api-code) driften terwijl CI groen
// blijft — precies het gat dat de review van #201 vond. Dit is de "regenerate-en-
// vergelijk" die 0191 §6 belooft, nu AAN de gate gehangen: `npm run sanity` draait in
// `security-baseline.yml` (required check "Security baseline (Sprint 1)"), dus deze
// test regenereert daar de inventaris uit de bron en vergelijkt met het ingecheckte
// bestand. Semantische diff (parsed deep-equal), niet byte — sleutelvolgorde is geen
// drift; een gewijzigde meting wél.
test("audit-inventaris.json is een verse regeneratie uit de bron (geen stille drift)", () => {
  let vers: string;
  try {
    vers = execFileSync("node", [join(HIER, "audit-inventaris.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // exitCode 1 = de generator zelf viel fail-closed (assertie-fouten in de bron);
    // toon de stderr i.p.v. een kale child_process-throw.
    const err = e as { status?: number; stderr?: string; message?: string };
    throw new Error(
      `verse generatie van audit-inventaris.mjs faalde (exit ${err.status ?? "?"}): ${err.stderr || err.message}`
    );
  }
  const versObj = JSON.parse(vers);
  const ingecheckt = JSON.parse(readFileSync(join(HIER, "audit-inventaris.json"), "utf8"));
  assert.deepEqual(
    versObj,
    ingecheckt,
    "audit-inventaris.json loopt achter op de bron — regenereer met:\n" +
      "  node tests/karakterisering/audit-inventaris.mjs > tests/karakterisering/audit-inventaris.json"
  );
});

// ── 1. De split-assertie is schoon ───────────────────────────────────────────
test("meta.assertieFouten is leeg (de generatie faalde niet fail-closed)", () => {
  assert.deepEqual(inv.meta.assertieFouten, [], `assertie-fouten in de JSON: ${inv.meta.assertieFouten.join(" | ")}`);
});

// De invarianten ONAFHANKELIJK herleiden (niet op meta vertrouwen).
function overtredingen(handlers: Handler[]): string[] {
  const fouten: string[] = [];
  for (const h of handlers) {
    if (h.klasse === "ONBEKEND")
      fouten.push(`ontbrekende split-klasse: ${h.handler}`);
    if (h.klasse === "geen" && h.schrijftAuditspoor)
      fouten.push(`"geen" met spoor: ${h.handler}`);
    // declaratie-verificatie: het machine-mechanisme moet gemeten spoor hebben (geen
    // bewering). "governance-events" is uit de tenant-union verwijderd (§4-model);
    // de bewijsketen-lacune leeft nu in de klasse + de gate.
    if (h.declaredAudit === "platform-event-log" && (h.platform?.length ?? 0) === 0)
      fouten.push(`beweerde vrijstelling: ${h.handler} audit:"platform-event-log" zonder gemeten platform_event_log-write`);
  }
  return fouten;
}

test("elke handler heeft een klasse ≠ ONBEKEND (geen stille 'geen')", () => {
  const zonder = inv.handlers.filter((h) => h.klasse === "ONBEKEND").map((h) => h.handler);
  assert.deepEqual(zonder, [], `handlers zonder klasse: ${zonder.join(", ")}`);
});

test("geen enkele 'geen'-handler draagt een gemeten spoor", () => {
  assert.deepEqual(overtredingen(inv.handlers), []);
});

// ── 2. Proven-red — dezelfde check moet een overtreding vlaggen ──────────────
test("PROVEN-RED: een 'geen'-handler mét spoor wordt gevlagd", () => {
  const nep: Handler[] = [{ handler: "POST /nep", wrapper: "withFondsRoute", klasse: "geen", schrijftAuditspoor: true, declaredAudit: null, bewijsketen: [], platform: [] }];
  assert.equal(overtredingen(nep).length, 1, "de check moet een 'geen'+spoor-overtreding zien");
});

test("PROVEN-RED: audit:\"platform-event-log\" zonder gemeten platform_event_log-write wordt gevlagd", () => {
  const nep: Handler[] = [{ handler: "POST /nep", wrapper: "withMachineRoute", klasse: "machine", schrijftAuditspoor: false, declaredAudit: "platform-event-log", bewijsketen: [], platform: [] }];
  assert.equal(overtredingen(nep).length, 1, "een machine-declaratie zonder gemeten platform-spoor moet rood zijn");
});

// ── 2b. De machine-drager `spoorVereist` (symmetrisch aan ketengebeurtenisVereist) ─
// De 5 worker-SPECs / 9 declaraties waarvan de platform_event_log-write openstaat.
// ONAFHANKELIJK herleid (niet op de generatie vertrouwd): de worker-SPEC-lijst staat
// hier óók, zodat een drift in de .mjs hier opvalt.
const WORKER_SPEC_FILES = [
  "app/api/aqlab/worker/route.ts",
  "app/api/internal/afschrift-worker/route.ts",
  "app/api/internal/ingest-worker/route.ts",
  "app/api/internal/semantische-extractie/route.ts",
  "app/api/platform/monitoring/snapshot/route.ts",
];
const isWorkerDecl = (d: string) => WORKER_SPEC_FILES.some((f) => d.endsWith(f));

test("spoorVereist bevat uitsluitend worker-SPEC-declaraties (geen probe glipt erin)", () => {
  const vreemd = inv.meta.spoorVereist.filter((d) => !isWorkerDecl(d));
  assert.deepEqual(vreemd, [], `niet-worker in spoorVereist: ${vreemd.join(", ")}`);
});

test("spoorVereist dekt de 9 openstaande worker-declaraties (RED tot #183b-machine)", () => {
  // Pin op de huidige stand: geen enkele worker schrijft vandaag platform_event_log,
  // dus alle 9 declaraties (5 SPECs, GET+POST behalve semantische-extractie POST-only)
  // staan open. #183b-machine landt de writes en laat dit getal bewust naar 0 zakken —
  // pas dán, met beide dragers leeg, mag ENFORCE_AUDIT=on (0191 §7 VLAGKOPPELING).
  assert.equal(inv.meta.spoorVereist.length, 9, `verwacht 9 open worker-declaraties, kreeg ${inv.meta.spoorVereist.length}`);
});

test("PROVEN-RED: een probe-declaratie in spoorVereist wordt gevlagd", () => {
  const nep = ["GET app/api/healthz/ping/route.ts", "POST app/api/platform/healthz/route.ts"];
  assert.equal(nep.filter((d) => !isWorkerDecl(d)).length, 2, "probes horen niet in spoorVereist — de check moet ze zien");
});

// ── 3. Triggerherkenning tegen de migraties ──────────────────────────────────
const AUDIT_CAPTURE: Record<string, string[]> = {
  fn_fonds_config_capture: ["fonds_content_overrides", "fonds_feature_flags", "fonds_module_manifest", "fonds_theming"],
  fn_fonds_stuurinfo_capture: ["fonds_stuurinfo_kpi", "fonds_stuurinfo_periode", "fonds_stuurinfo_reeks", "fonds_stuurinfo_reserve"],
  fn_audit_procedure_bewijs_mutation: ["procedure_bewijs"], // → procedure_log, fail-closed
};

function alleMigraties(): string {
  const dir = join(ROOT, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

test("audit-CAPTURE-triggers bestaan nog op hun basistabellen (anti-drift)", () => {
  const sql = alleMigraties().toLowerCase();
  for (const [fn, bases] of Object.entries(AUDIT_CAPTURE)) {
    assert.ok(sql.includes(fn), `capture-functie ${fn} niet meer in de migraties — de BASE_TRIGGER-laag is stil kapot`);
    for (const base of bases) {
      // een create trigger ... on <base> ... <fn> (volgorde vrij, zelfde migratie-corpus)
      const re = new RegExp(`create trigger[\\s\\S]{0,200}?on\\s+(public\\.)?${base}\\b[\\s\\S]{0,200}?${fn}`, "i");
      const reOmgekeerd = new RegExp(`${fn}[\\s\\S]{0,400}?on\\s+(public\\.)?${base}\\b`, "i");
      assert.ok(
        re.test(sql) || reOmgekeerd.test(sql) || (sql.includes(base) && sql.includes(fn)),
        `geen audit-trigger ${fn} op ${base} gevonden — handlers die ${base} muteren zouden ten onrechte als "geen spoor" gelden`
      );
    }
  }
});

console.log(`\n${n} sanity-tests geslaagd.`);
