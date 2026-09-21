import assert from "node:assert/strict";
import test from "node:test";
import { bevestigApp365Doel } from "./app365-provisioning-doel.mjs";
import { voerApp365SqlUit } from "./app365-provisioning.mjs";

const previewUrl = "postgresql://postgres:geheim@db.swviwoytzvaqypieqgji.supabase.co:5432/postgres";
const productieUrl = "postgresql://postgres:geheim@db.aebwiufuegsiwhwpdrfb.supabase.co:5432/postgres";

test("proven-red: Previewbevestiging met Production-URL stopt vóór psql", () => {
  let calls = 0;
  assert.throws(() => voerApp365SqlUit({ omgeving: "preview", actie: "provision", databaseUrl: productieUrl, mutatieAkkoord: "428-fase2-preview", spawn() { calls++; return { status: 0 }; } }), /hoort niet bij 'preview'/);
  assert.equal(calls, 0);
});

test("proven-red: Productionbevestiging met Preview-URL stopt vóór psql", () => {
  let calls = 0;
  assert.throws(() => voerApp365SqlUit({ omgeving: "production", actie: "provision", databaseUrl: previewUrl, mutatieAkkoord: "428-fase3-productie", spawn() { calls++; return { status: 0 }; } }), /hoort niet bij 'production'/);
  assert.equal(calls, 0);
});

test("proven-red: mutatie zonder afzonderlijk faseakkoord stopt vóór psql", () => {
  let calls = 0;
  assert.throws(() => voerApp365SqlUit({ omgeving: "preview", actie: "rollback", databaseUrl: previewUrl, mutatieAkkoord: "", spawn() { calls++; return { status: 0 }; } }), /afzonderlijk mutatieakkoord/);
  assert.equal(calls, 0);
});

test("read-only check vereist juiste doelbevestiging maar geen mutatieakkoord", () => {
  assert.deepEqual(bevestigApp365Doel({ omgeving: "preview", actie: "check", databaseUrl: previewUrl }), {
    omgeving: "preview", projectRef: "swviwoytzvaqypieqgji", actie: "check",
  });
});
