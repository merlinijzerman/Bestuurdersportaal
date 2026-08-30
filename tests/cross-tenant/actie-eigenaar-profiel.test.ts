// Actie-eigenaren zijn profielrelaties, geen vrije tekst. Deze bron-test bewaakt
// de twee verdedigingslagen: de route accepteert uitsluitend een fonds-lid uit
// `vw_fondsleden`, en de migratie borgt dezelfde fondsgrens voor directe SQL.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const maakRoute = lees("app", "api", "decisions", "[id]", "actions", "route.ts");
const wijzigRoute = lees("app", "api", "decisions", "[id]", "actions", "[aid]", "route.ts");
const migratie = lees("supabase", "migrations", "2026_08_30_actie_eigenaar_profiel.sql");

test("actie-eigenaar: POST valideert eigenaar via fonds-gescopete profielview", () => {
  assert.match(maakRoute, /eigenaar_id/);
  assert.match(maakRoute, /from\("vw_fondsleden"\)/);
  assert.match(maakRoute, /Eigenaar heeft geen profiel binnen dit fonds/);
  assert.match(maakRoute, /eigenaar_id:\s*eigenaar\?\.id/);
});

test("actie-eigenaar: PATCH valideert herverdeling via fonds-gescopete profielview", () => {
  assert.match(wijzigRoute, /eigenaar_id/);
  assert.match(wijzigRoute, /from\("vw_fondsleden"\)/);
  assert.match(wijzigRoute, /Eigenaar heeft geen profiel binnen dit fonds/);
  assert.match(wijzigRoute, /wijzigingen\.eigenaar_naam/);
});

test("actie-eigenaar: database borgt profiel-FK, fondsgrens en geen nieuwe vrije tekst", () => {
  assert.match(migratie, /eigenaar_id uuid\s+references public\.profielen\(id\) on delete set null/);
  assert.match(migratie, /join public\.profielen p[\s\S]*?p\.fonds_id = d\.fonds_id/);
  assert.match(migratie, /actie-eigenaar moet een profiel zijn/);
  assert.match(migratie, /actie-eigenaarnaam volgt uitsluitend uit het profiel/);
  assert.match(migratie, /create trigger trg_guard_decision_action_eigenaar/);
});
