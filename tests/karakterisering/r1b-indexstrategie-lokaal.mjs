// Strikt lokale vergelijkingsproef voor R1b: volledige HNSW, beide, partiële HNSW.
// Schrijft uitsluitend in een unieke tijdelijke schema op een PR0-wegwerpfixture.
// Geen rollback van HNSW-writes: elke variant krijgt eigen tabel en COMMITs.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.argv[2];
const output = process.argv[3];
if (!url || !output) throw new Error("Gebruik: node r1b-indexstrategie-lokaal.mjs <lokale-db-url> <uitvoer.json>");
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("Alleen loopback-DB toegestaan");
const schema = `r1b_bench_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const db = new pg.Client({ connectionString: url });
const configs = ["volledig", "dubbel", "partieel"];
const indexen = {
  volledig: ["full"],
  dubbel: ["full", "partial"],
  partieel: ["partial"],
};
const rounds = 5;
const batch = 1000;
const source = `select embedding from public.document_chunks
  where bibliotheek = 'generiek' and embedding is not null order by id limit ${batch}`;
const plan = async (sql) => {
  const t = (await db.query(`explain (analyze, buffers, wal, format json) ${sql}`)).rows[0]["QUERY PLAN"][0];
  return {
    ms: t["Execution Time"],
    hits: t.Plan["Shared Hit Blocks"] ?? 0,
    reads: t.Plan["Shared Read Blocks"] ?? 0,
    dirtied: t.Plan["Shared Dirtied Blocks"] ?? 0,
    wal_bytes: t.Plan["WAL Bytes"] ?? 0,
  };
};
const sum = (a, b) => Object.fromEntries(["ms", "hits", "reads", "dirtied", "wal_bytes"].map((k) => [k, (a[k] ?? 0) + (b[k] ?? 0)]));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const result = { purpose: "R1b local HNSW write-cost comparison", schema, rounds, batch, builds: {}, runs: [], cleanup: false };
let created = false;
try {
  await db.connect();
  const marker = await db.query(`select to_regclass('pr0_fixture.vragen') is not null as fixture,
    (select count(*)::int from public.document_chunks) as chunks,
    (select count(*)::int from public.tenant_domains) as tenant_domains`);
  if (!marker.rows[0].fixture || marker.rows[0].chunks < 25000 || marker.rows[0].tenant_domains !== 0) {
    throw new Error("Geen schone lokale PR0-fixture: proef weigert");
  }
  result.fixture_chunks = marker.rows[0].chunks;
  await db.query(`create schema ${schema}`);
  created = true;
  for (const c of configs) {
    await db.query(`create table ${schema}.${c} as
      select id, bibliotheek, embedding from public.document_chunks where embedding is not null order by id`);
    await db.query(`alter table ${schema}.${c} add primary key (id)`);
    result.builds[c] = {};
    for (const kind of indexen[c]) {
      const name = `${schema}_${c}_${kind}`;
      const started = performance.now();
      if (kind === "full") {
        await db.query(`create index ${name} on ${schema}.${c} using hnsw (embedding vector_cosine_ops)
          with (m = 16, ef_construction = 64)`);
      } else {
        await db.query(`create index ${name} on ${schema}.${c} using hnsw (embedding vector_cosine_ops)
          with (m = 32, ef_construction = 256) where bibliotheek = 'generiek'`);
      }
      const bytes = Number((await db.query("select pg_relation_size($1::regclass) as bytes", [`${schema}.${name}`])).rows[0].bytes);
      result.builds[c][kind] = { ms: Math.round(performance.now() - started), bytes };
    }
  }
  for (const workload of ["invoegen", "vervangen"]) {
    for (let round = 1; round <= rounds; round++) {
      const order = [...configs.slice((round - 1) % 3), ...configs.slice(0, (round - 1) % 3)];
      for (const c of order) {
        await db.query("begin");
        try {
          await db.query("set local statement_timeout = '120s'");
          let metrics;
          if (workload === "invoegen") {
            metrics = await plan(`insert into ${schema}.${c} (id,bibliotheek,embedding)
              select gen_random_uuid(), 'generiek', embedding from (${source}) s`);
          } else {
            await db.query(`create temporary table r1b_replacement on commit drop as
              select id, embedding from ${schema}.${c} where bibliotheek='generiek' order by id limit ${batch}`);
            const deleted = await plan(`delete from ${schema}.${c} where id in (select id from r1b_replacement)`);
            const inserted = await plan(`insert into ${schema}.${c} (id,bibliotheek,embedding)
              select gen_random_uuid(), 'generiek', embedding from r1b_replacement`);
            metrics = sum(deleted, inserted);
          }
          await db.query("commit");
          result.runs.push({ workload, round, config: c, ...metrics });
          process.stdout.write(`${workload} ${round} ${c}: ${metrics.ms.toFixed(1)} ms\n`);
        } catch (e) {
          await db.query("rollback");
          throw e;
        }
      }
    }
  }
  result.final_rows = {};
  for (const c of configs) {
    const n = Number((await db.query(`select count(*)::int as n from ${schema}.${c}`)).rows[0].n);
    result.final_rows[c] = n;
    if (n !== result.fixture_chunks + rounds * batch) {
      throw new Error(`Rijentelling ${c}: ${n} in plaats van ${result.fixture_chunks + rounds * batch}`);
    }
  }
  result.summary = Object.fromEntries(["invoegen", "vervangen"].map((w) => [w, Object.fromEntries(configs.map((c) => {
    const rows = result.runs.filter((r) => r.workload === w && r.config === c);
    return [c, { median_ms: median(rows.map((r) => r.ms)), median_wal_bytes: median(rows.map((r) => r.wal_bytes)), first_ms: rows[0].ms }];
  }))]));
} finally {
  if (created) {
    const tables = (await db.query("select tablename from pg_tables where schemaname=$1 order by 1", [schema])).rows.map((r) => r.tablename);
    if (tables.every((c) => configs.includes(c))) {
      await db.query(`drop schema ${schema} cascade`);
      result.cleanup = true;
    } else {
      result.cleanup_error = `Onverwachte tabellen in ${schema}: ${tables.join(",")}`;
    }
  }
  await db.end();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
