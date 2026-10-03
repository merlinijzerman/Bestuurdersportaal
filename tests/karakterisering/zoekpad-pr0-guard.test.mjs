// ============================================================================
//  PR 0 zoekpad-herontwerp — negatieve test van het LOKAAL-ALLEEN-guardblok in
//  supabase/checks/2026_10_03_pr0_zoekpad_{fixture,fixture_b_match,prototypes,
//  fixture_opruimen}.sql.
// ----------------------------------------------------------------------------
//  Bewijst, per bestand en via rechtstreeks `psql` (de weg die de JS-runner
//  omzeilt), dat het guardblok stopt VÓÓR de eerste wijzigende opdracht:
//    G1  met een tenant-host-rij in public.tenant_domains (host like
//        '%bestuurdersportaal.com') — ook mét -v pr0_lokaal_ok=ja;
//    G2  zonder de GUC pr0.lokaal_ok (geen -v), zonder tenant-rij;
//    G3  met request.jwt.claims gezet (PostgREST-sessie-indicatie), via -c
//        vóór -f in dezelfde sessie, mét -v pr0_lokaal_ok=ja.
//  Na elke weigering: exit ≠ 0, 'PR0-GUARD' op stderr, én geen spoor van een
//  mutatie: geen schema pr0_proto/pr0_fixture (fixture/prototypes), geen
//  fixturedocumenten/-fondsen, en voor _opruimen.sql blijft een vooraf
//  aangemaakt sentinelschema pr0_fixture bestaan (opruimen zou het droppen).
//  Een positieve controle (G0) toont dat dezelfde bestanden het guardblok WEL
//  passeren als alles klopt: de guard-DO slaagt en de eerste mutatie wordt
//  bereikt — gemeten op _opruimen.sql, dat zonder fixture niets te verwijderen
//  heeft en snel is.
//
//  Vereist een LOKALE DB (TEST_DATABASE_URL; alleen 127.0.0.1/localhost/
//  host.docker.internal) en `psql` op PATH; zonder DB wordt de test
//  overgeslagen (dit is lokaal onderzoek, geen CI-gate).
//    TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//      node --test tests/karakterisering/zoekpad-pr0-guard.test.mjs
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import pg from "pg";

const DB = process.env.TEST_DATABASE_URL ?? "";
const lokaal = DB && ["127.0.0.1", "localhost", "host.docker.internal"].includes(new URL(DB).hostname);
const BESTANDEN = [
  "supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql",
  "supabase/checks/2026_10_03_pr0_zoekpad_fixture_b_match.sql",
  "supabase/checks/2026_10_03_pr0_zoekpad_prototypes.sql",
  "supabase/checks/2026_10_03_pr0_zoekpad_fixture_opruimen.sql",
];
const HOST = "guardtest.bestuurdersportaal.com";
const FONDS = "00000000-0000-4000-a000-0000000000f0";

function psql(args) {
  const r = spawnSync("psql", [DB, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

async function metDb(fn) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function sporen(c) {
  const { rows } = await c.query(`
    select (select count(*) from pg_namespace where nspname in ('pr0_proto')) as proto,
           (select count(*) from pg_namespace where nspname in ('pr0_fixture')) as fixture,
           (select count(*) from public.documenten where id::text like '00000000-0000-4000-d000-%') as docs,
           (select count(*) from public.fondsen where id::text like '00000000-0000-4000-a000-%') as fondsen,
           (select count(*) from public.document_chunks where embedding_model like 'pr0-zoekpad%') as chunks`);
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

test("pr0-guard: elk bestand weigert fail-closed vóór de eerste mutatie", { skip: !lokaal && "geen lokale TEST_DATABASE_URL" }, async (t) => {
  const vooraf = await metDb(sporen);
  assert.deepEqual({ proto: vooraf.proto, docs: vooraf.docs, chunks: vooraf.chunks }, { proto: 0, docs: 0, chunks: 0 }, "testdatabase moet zonder pr0-fixture beginnen");

  // Sentinel voor _opruimen.sql: dat bestand zou pr0_fixture droppen.
  await metDb((c) => c.query("create schema if not exists pr0_fixture"));
  try {
    for (const bestand of BESTANDEN) {
      await t.test(`G2 ${bestand}: zonder GUC pr0.lokaal_ok`, async () => {
        const r = psql(["-f", bestand]);
        assert.notEqual(r.status, 0, "psql moet falen");
        assert.match(r.stderr, /PR0-GUARD: GUC pr0\.lokaal_ok/);
        const na = await metDb(sporen);
        assert.deepEqual(na, { ...vooraf, fixture: 1 }, "geen mutatie na weigering");
      });
      await t.test(`G3 ${bestand}: request.jwt.claims gezet`, async () => {
        const r = psql(["-v", "pr0_lokaal_ok=ja", "-c", "set request.jwt.claims = '{\"role\":\"authenticated\"}'", "-f", bestand]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /PR0-GUARD: request\.jwt\.claims/);
        assert.deepEqual(await metDb(sporen), { ...vooraf, fixture: 1 });
      });
    }

    // G1: tenant-host-rij (zoals Preview/Productie) — ook mét -v pr0_lokaal_ok=ja.
    await metDb(async (c) => {
      await c.query("insert into public.fondsen (id, naam, slug) values ($1, 'PR0 guardtest', 'pr0-guardtest') on conflict do nothing", [FONDS]);
      await c.query("insert into public.tenant_domains (host, fonds_id) values ($1, $2)", [HOST, FONDS]);
    });
    try {
      for (const bestand of BESTANDEN) {
        await t.test(`G1 ${bestand}: tenant-host in tenant_domains`, async () => {
          const r = psql(["-v", "pr0_lokaal_ok=ja", "-f", bestand]);
          assert.notEqual(r.status, 0, "psql moet falen");
          assert.match(r.stderr, /PR0-GUARD: tenant-host/);
          const na = await metDb(sporen);
          assert.deepEqual(na, { ...vooraf, fixture: 1, fondsen: vooraf.fondsen + 1 }, "geen mutatie na weigering");
        });
      }
    } finally {
      await metDb(async (c) => {
        await c.query("delete from public.tenant_domains where host = $1", [HOST]);
        await c.query("delete from public.fondsen where id = $1", [FONDS]);
      });
    }

    // G0 (positieve controle): met alles in orde passeert het guardblok en wordt
    // de eerste mutatie bereikt — _opruimen.sql dropt dan het sentinelschema.
    await t.test("G0 _opruimen.sql passeert de guard als alles klopt", async () => {
      const r = psql(["-v", "pr0_lokaal_ok=ja", "-f", BESTANDEN[3]]);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /PR0-GUARD/);
      assert.equal((await metDb(sporen)).fixture, 0, "sentinelschema is door het opruimbestand verwijderd");
    });
  } finally {
    await metDb((c) => c.query("drop schema if exists pr0_fixture cascade"));
  }
});
