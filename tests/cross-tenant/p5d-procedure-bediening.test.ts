import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("P5d — gedragstoets is verplicht in de cross-tenantketen", () => {
  const runner = read("scripts/cross-tenant-ci.sh");
  const check = read("supabase/checks/2026_08_31_p5d_procedure_beeindigen_gedrag.sql");

  assert.match(runner, /SQL_P5D_BEEINDIGEN="supabase\/checks\/2026_08_31_p5d_procedure_beeindigen_gedrag\.sql"/);
  assert.match(runner, /psql "\$DB_URL" -v ON_ERROR_STOP=1 -f "\$SQL_P5D_BEEINDIGEN"/);
  assert.match(check, /fn_procedure_heropenen\(uuid,text,text\)/);
  assert.match(check, /hervat_na_gewijzigde_omstandigheden/);
  assert.match(check, /vervallen_stappen/);
  assert.match(check, /rol_op_moment/);
});
