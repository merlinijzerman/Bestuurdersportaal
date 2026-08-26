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
  meta: { assertieFouten: string[]; klasseTelling: Record<string, number> };
  handlers: Handler[];
};

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
    // declaratie-verificatie: named-mechanism moet gemeten spoor hebben (geen bewering)
    if (h.declaredAudit === "governance-events" && (h.bewijsketen?.length ?? 0) === 0)
      fouten.push(`beweerde vrijstelling: ${h.handler} audit:"governance-events" zonder gemeten governance_events-write`);
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

test("PROVEN-RED: audit:\"governance-events\" zonder gemeten governance_events-write wordt gevlagd", () => {
  const nep: Handler[] = [{ handler: "POST /nep", wrapper: "withFondsRoute", klasse: "bestuurlijk-gap", schrijftAuditspoor: false, declaredAudit: "governance-events", bewijsketen: [], platform: [] }];
  assert.equal(overtredingen(nep).length, 1, "een zelfverklaarde vrijstelling zonder gemeten spoor moet rood zijn");
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
