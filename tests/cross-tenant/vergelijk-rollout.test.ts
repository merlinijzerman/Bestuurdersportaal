import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { vergelijkmodusVoorFondsAan, VERGELIJK_FONDS_FLAG } from "../../core/lib/vergelijk-rollout";

const pgb = "11111111-1111-4111-8111-111111111111";
const anderFonds = "22222222-2222-4222-8222-222222222222";

async function metVlaggen(globaal: string | undefined, fonds: string | undefined, fn: () => Promise<void>): Promise<void> {
  const vorige = process.env.VERGELIJKMODUS;
  const vorigFonds = process.env.VERGELIJK_FONDS_ID;
  if (globaal === undefined) delete process.env.VERGELIJKMODUS;
  else process.env.VERGELIJKMODUS = globaal;
  if (fonds === undefined) delete process.env.VERGELIJK_FONDS_ID;
  else process.env.VERGELIJK_FONDS_ID = fonds;
  try { await fn(); }
  finally {
    if (vorige === undefined) delete process.env.VERGELIJKMODUS;
    else process.env.VERGELIJKMODUS = vorige;
    if (vorigFonds === undefined) delete process.env.VERGELIJK_FONDS_ID;
    else process.env.VERGELIJK_FONDS_ID = vorigFonds;
  }
}

test("vergelijking blijft uit zonder globale schakelaar en leest de DB niet", async () => {
  await metVlaggen(undefined, pgb, async () => {
    let lezingen = 0;
    assert.equal(await vergelijkmodusVoorFondsAan(pgb, async () => { lezingen++; return true; }), false);
    assert.equal(lezingen, 0);
  });
});

test("vergelijking vereist server-side fonds én exact JSON-boolean true", async () => {
  await metVlaggen("on", pgb, async () => {
    let lezingen = 0;
    assert.equal(await vergelijkmodusVoorFondsAan(null, async () => { lezingen++; return true; }), false);
    assert.equal(lezingen, 0);
    for (const waarde of [undefined, null, false, "true", "on", 1, { actief: true }]) {
      assert.equal(await vergelijkmodusVoorFondsAan(pgb, async () => waarde), false);
    }
    assert.equal(await vergelijkmodusVoorFondsAan(pgb, async () => true), true);
  });
});

test("zonder env-fondsbinding blijft vergelijking uit; ander fonds kan zichzelf niet activeren", async () => {
  await metVlaggen("on", undefined, async () => {
    assert.equal(await vergelijkmodusVoorFondsAan(pgb, async () => true), false);
  });
  await metVlaggen("on", pgb, async () => {
    let lezingen = 0;
    const lees = async () => { lezingen++; return true; };
    assert.equal(await vergelijkmodusVoorFondsAan(pgb, lees), true);
    assert.equal(await vergelijkmodusVoorFondsAan(anderFonds, lees), false);
    assert.equal(lezingen, 1, "ander fonds mag zelfs geen opt-in laten toetsen");
  });
});

test("een leesfout of uitzondering opent de fondsgrens niet", async () => {
  await metVlaggen("on", pgb, async () => {
    assert.equal(await vergelijkmodusVoorFondsAan(pgb, async () => { throw new Error("DB down"); }), false);
  });
});

test("beide productie-ingangen gebruiken dezelfde fondsgrens", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const api = readFileSync(join(root, "app/api/vergelijk/route.ts"), "utf8");
  const chat = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
  assert.match(api, /await vergelijkmodusVoorFondsAan\(ctx\.fondsId\)/);
  assert.match(chat, /await vergelijkmodusVoorFondsAan\(fondsId\)/);
  assert.equal(VERGELIJK_FONDS_FLAG, "vergelijkmodus");
});

test("de positieve karakterisering opent beide fondsgebonden testpoorten", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflow = readFileSync(join(root, ".github/workflows/karakterisering.yml"), "utf8");
  const scenarios = readFileSync(join(root, "tests/karakterisering/scenarios.mjs"), "utf8");
  assert.match(workflow, /VERGELIJK_FONDS_ID: "00000000-0000-4000-8000-000000000001"/);
  assert.match(scenarios, /flag_key: "vergelijkmodus", waarde: true/);
  assert.match(scenarios, /onConflict: "fonds_id,flag_key", ignoreDuplicates: true/);
});
