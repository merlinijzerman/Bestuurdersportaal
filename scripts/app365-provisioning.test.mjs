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

test("Production-demoprovisioning met Preview-URL stopt vóór psql", () => {
  let calls = 0;
  assert.throws(() => voerApp365SqlUit({
    omgeving: "production",
    actie: "demo-provision",
    databaseUrl: previewUrl,
    mutatieAkkoord: "428-fase3-productie",
    spawn() { calls++; return { status: 0 }; },
  }), /hoort niet bij 'production'/);
  assert.equal(calls, 0);
});

test("demo-check is read-only en selecteert het omgevingsspecifieke bestand", () => {
  let aanroep;
  const doel = voerApp365SqlUit({
    omgeving: "production",
    actie: "demo-check",
    databaseUrl: productieUrl,
    spawn(command, args) { aanroep = { command, args }; return { status: 0 }; },
  });
  assert.equal(doel.omgeving, "production");
  assert.equal(aanroep.command, "psql");
  assert.match(aanroep.args.at(-1), /seeds\/production\/2026_09_27_428_app365_production_demo_CHECK\.sql$/);
});

test("demo-rollback vereist het afzonderlijke Production-akkoord", () => {
  let calls = 0;
  assert.throws(() => voerApp365SqlUit({
    omgeving: "production",
    actie: "demo-rollback",
    databaseUrl: productieUrl,
    mutatieAkkoord: "",
    spawn() { calls++; return { status: 0 }; },
  }), /afzonderlijk mutatieakkoord/);
  assert.equal(calls, 0);
});
