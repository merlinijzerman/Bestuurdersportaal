// tests/cross-tenant/audit-handelingen.test.ts
// -----------------------------------------------------------------------------
// #183a-commit-2 — het audit-`handeling`-label per state-changing handler bewaken.
//
// Elke `withFondsRoute`-handler met een `audit: { handeling: "…" }` schrijft dat label
// straks (ENFORCE_AUDIT=on) als semantische handeling naar `handelingen_log`. Het label
// moet dus (a) uniek zijn — twee handlers met hetzelfde label maken de log dubbelzinnig,
// (b) niet stilletjes driften — een hernoeming is een bewuste keuze, geen bijvangst.
// Daarom een autoritatief register (audit-handelingen.expected.json) met drie gates:
//
//   1. gedekt   — elk label in de code staat in het register, gekoppeld aan DEZELFDE route;
//   2. uniek    — geen label wordt door twee routes gedragen (collisie);
//   3. niet-stale — elke register-entry bestaat nog in de code met dat label.
//
// Sluit automatisch aan in de required Cross-tenant-gate via de *.test.ts-glob
// (scripts/cross-tenant-ci.sh). Wijzig een label = wijzig het register mét motivering;
// regenereer met: node tests/karakterisering/w183-labels.mjs --apply.
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, "..", "..");
const API_DIR = join(ROOT, "app", "api");

const register = JSON.parse(
  readFileSync(join(hier, "audit-handelingen.expected.json"), "utf8")
) as { handelingen: Record<string, string> };

function routeBestanden(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) uit.push(...routeBestanden(pad));
    else if (naam === "route.ts") uit.push(pad);
  }
  return uit;
}

/** Alle gemeten `audit: { handeling }`-declaraties uit de code: label → routesleutel(s). */
function handelingenUitCode(): Map<string, string[]> {
  const uit = new Map<string, string[]>();
  for (const pad of routeBestanden(API_DIR)) {
    const rel = relative(ROOT, pad).split("\\").join("/").replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
    const bron = readFileSync(pad, "utf8");
    // RouteSpecs mogen geformatteerd zijn over meerdere regels. Splits eerst
    // per HTTP-export; anders zou een GET de audit van een latere POST lezen.
    const exports = [...bron.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*withFondsRoute\(/g)];
    for (let i = 0; i < exports.length; i++) {
      const start = exports[i];
      const einde = exports[i + 1]?.index ?? bron.length;
      const fragment = bron.slice(start.index, einde);
      const audit = /audit:\s*\{\s*handeling:\s*"([^"]*)"\s*\}/.exec(fragment);
      if (!audit) continue;
      const sleutel = `${start[1]} ${rel}`;
      (uit.get(audit[1]) ?? uit.set(audit[1], []).get(audit[1])!).push(sleutel);
    }
  }
  return uit;
}

const codeLabels = handelingenUitCode();

// ── 1. Elk label in de code staat in het register, gekoppeld aan dezelfde route ──
test("audit-handelingen — elk code-label staat in het register (geen ongeregistreerde/gedrifte handeling)", () => {
  const fouten: string[] = [];
  for (const [label, routes] of codeLabels) {
    const verwacht = register.handelingen[label];
    if (!verwacht) { fouten.push(`onbekend label "${label}" (routes: ${routes.join(", ")}) — voeg toe aan het register`); continue; }
    for (const r of routes) if (r !== verwacht) fouten.push(`label "${label}" staat op ${r}, register verwacht ${verwacht}`);
  }
  assert.deepEqual(fouten, [], `\n${fouten.join("\n")}`);
});

// ── 2. Geen collisie: geen label wordt door twee routes gedragen ─────────────────
test("audit-handelingen — geen collisie (elk label is uniek over de handlers)", () => {
  const dubbel = [...codeLabels.entries()].filter(([, r]) => r.length > 1).map(([l, r]) => `${l}: ${r.join(" , ")}`);
  assert.deepEqual(dubbel, [], `\n${dubbel.join("\n")}`);
});

// ── 3. Niet-stale: elke register-entry bestaat nog in de code met dat label ───────
test("audit-handelingen — geen stale register-entry (elke entry bestaat nog in de code)", () => {
  const codeSleutels = new Set([...codeLabels.entries()].flatMap(([l, rs]) => rs.map((r) => `${l}|${r}`)));
  const stale = Object.entries(register.handelingen)
    .filter(([label, route]) => !codeSleutels.has(`${label}|${route}`))
    .map(([label, route]) => `${label} → ${route}`);
  assert.deepEqual(stale, [], `\nstale register-entries (route weg of label gewijzigd):\n${stale.join("\n")}`);
});
