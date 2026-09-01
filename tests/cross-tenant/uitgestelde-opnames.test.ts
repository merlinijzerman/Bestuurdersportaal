// tests/cross-tenant/uitgestelde-opnames.test.ts
// -----------------------------------------------------------------------------
// Bewaakt de lijst van routes waarvan de authz-matrix-opname is UITGESTELD tot de
// stack-run (besluit 0192, contractwaarde-regel). Een gat dat je moet onthouden is
// een tijdbom; deze test maakt het machineleesbaar:
//
//   • elke uitgestelde route bestaat echt als gewrapte handler (geen stale lijst);
//   • een uitgestelde route heeft GEEN scenario in scenarios.mjs — anders zou de
//     matrix een 403-cel tonen die nooit tegen een draaiende server is opgenomen,
//     en oogt hij compleet terwijl hij het niet is.
//
// De lijst moet leeg zijn vóór P6 (#171); dat is een release-blokkade, geen
// test-falen hier (de lijst is nu bewust niet leeg).
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scenarios } from "../../tests/karakterisering/scenarios.mjs";
import { gewrapteHandlers, handlerVoor } from "../../tests/karakterisering/authz-matrix.mjs";

const KARAK = join(dirname(fileURLToPath(import.meta.url)), "..", "karakterisering");
const registry = JSON.parse(readFileSync(join(KARAK, "uitgestelde-opnames.json"), "utf8"));
const handlers = gewrapteHandlers();
const uitgesteld: Array<{ method: string; route: string; capability: string }> = registry.uitgesteld ?? [];

test("UO-1 — elke uitgestelde route bestaat als gewrapte handler (geen stale lijst)", () => {
  for (const u of uitgesteld) {
    const bestaat = handlers.some(
      (h: { method: string; route: string }) => h.method === u.method && h.route === u.route
    );
    assert.ok(bestaat, `uitgestelde route ${u.method} ${u.route} is geen gewrapte handler (stale lijst?)`);
  }
});

test("UO-2 — een uitgestelde route heeft nog GEEN scenario (matrix oogt niet compleet)", () => {
  for (const u of uitgesteld) {
    for (const s of scenarios as Array<{ slug: string; method: string; path: string }>) {
      const h = handlerVoor(handlers, s.method, s.path);
      if (h && h.method === u.method && h.route === u.route) {
        assert.fail(
          `scenario ${s.slug} raakt de uitgestelde route ${u.method} ${u.route}: verwijder het scenario ` +
            "of neem de route op tegen een draaiende server en haal 'm van de uitstellijst."
        );
      }
    }
  }
});

console.log(`uitgestelde-opnames: ${uitgesteld.length} route(s) op de uitstellijst (leeg vóór P6/#171).`);
