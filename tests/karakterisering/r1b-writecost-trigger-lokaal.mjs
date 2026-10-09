// Strikt lokale R1b-kostenproef met echte chunkkolommen, btree/GIN-indexen,
// denormalisatie-trigger en de samengestelde bibliotheek-FK. Geen remote URL.
// De twee varianten leven uitsluitend in een uniek schema en worden verwijderd.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.argv[2];
const output = process.argv[3];
const equalParameters = process.argv.includes("--equal-parameters");
const dualWall = process.argv.includes("--dual-wall");
if (!url || !output || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("Gebruik: node r1b-writecost-trigger-lokaal.mjs <loopback-db-url> <uitvoer.json>");
}
const schema = `r1b_trigger_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const variants = dualWall ? ["full", "partial", "both"] : ["full", "partial"];
const db = new pg.Client({ connectionString: url });
const result = { schema, fixture: null, variants, equal_parameters: equalParameters || dualWall,
  dual_wall: dualWall,
  hnsw: equalParameters || dualWall ? { full: { m: 32, ef_construction: 256 }, partial: { m: 32, ef_construction: 256 } }
    : { full: { m: 16, ef_construction: 64 }, partial: { m: 32, ef_construction: 256 } },
  rounds: dualWall ? 5 : equalParameters ? 10 : 3,
  batch: dualWall || equalParameters ? 1000 : 500,
  runs: [], negative_control: null, cleanup: false };
const q = (s) => `"${s.replaceAll('"', '""')}"`;
const med = (a) => {
  const sorted = [...a].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const range = (a) => ({ min: Math.min(...a), median: med(a), max: Math.max(...a) });
const plan = async (sql) => {
  const r = (await db.query(`explain (analyze, buffers, wal, format json) ${sql}`)).rows[0]["QUERY PLAN"][0];
  return { ms: r["Execution Time"], hits: r.Plan["Shared Hit Blocks"] ?? 0,
    reads: r.Plan["Shared Read Blocks"] ?? 0, wal_bytes: r.Plan["WAL Bytes"] ?? 0 };
};
const plus = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));
let created = false;
await db.connect();
const sourceState = async () => (await db.query(`select
    (select count(*)::int from public.document_chunks) as chunks,
    (select md5(string_agg(id::text || '|' || document_id::text || '|' ||
      chunk_index::text || '|' || bibliotheek, E'\\n' order by id)) from public.document_chunks) as rows_md5,
    (select md5(string_agg(indexname || ':' || indexdef, E'\\n' order by indexname))
      from pg_indexes where schemaname='public' and tablename='document_chunks') as indexes_md5,
    (select md5(string_agg(pg_get_triggerdef(oid), E'\\n' order by tgname))
      from pg_trigger where tgrelid='public.document_chunks'::regclass and not tgisinternal) as triggers_md5,
    (select md5(string_agg(conname || ':' || pg_get_constraintdef(oid), E'\\n' order by conname))
      from pg_constraint where conrelid='public.document_chunks'::regclass) as constraints_md5,
    (select count(*)::int from pg_namespace where nspname like 'r1b_trigger_%') as scratch_schemas`)).rows[0];
try {
  result.source_before = await sourceState();
  if (result.source_before.scratch_schemas !== 0) throw new Error("Eerder R1b-testschema aanwezig; weigert nieuwe proef");
  const guard = (await db.query(`select
    current_database() = 'postgres' as db,
    to_regclass('pr0_fixture.vragen') is not null as fixture,
    (select count(*)::int from public.document_chunks) as chunks,
    (select count(*)::int from public.tenant_domains) as domains,
    to_regclass('public.idx_chunks_embedding') is not null as full,
    to_regclass('public.idx_chunks_embedding_generiek_r1b') is not null as partial`)).rows[0];
  if (!guard.db || !guard.fixture || guard.chunks !== 25471 || guard.domains !== 0 || !guard.full || !guard.partial) {
    throw new Error(`Geen verwachte lokale PR0-fixture: ${JSON.stringify(guard)}`);
  }
  result.fixture = guard;
  const cols = (await db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='document_chunks' and is_generated='NEVER'
    order by ordinal_position`)).rows.map((r) => r.column_name);
  const colList = cols.map(q).join(",");
  const selectCols = (src, round) => cols.map((c) => c === "id" ? "gen_random_uuid()"
    : c === "chunk_index" ? `${src}.chunk_index + ${1000000 + round * 10000}`
      : `${src}.${q(c)}`).join(",");
  const indexBytes = async (v) => {
    const names = (await db.query(`select indexname from pg_indexes where schemaname=$1 and tablename=$2
      and indexdef like '%USING hnsw%' order by indexname`, [schema, v])).rows.map((r) => r.indexname);
    const sizes = {};
    for (const name of names) sizes[name] = Number((await db.query("select pg_relation_size($1::regclass) bytes",
      [`${schema}.${name}`])).rows[0].bytes);
    return sizes;
  };
  await db.query(`create schema ${q(schema)}`);
  created = true;
  for (const v of variants) {
    const table = `${q(schema)}.${q(v)}`;
    await db.query(`create table ${table} (like public.document_chunks including all)`);
    // LIKE INCLUDING ALL kopieert beide HNSW-indexen. Bouw slechts de ene
    // gewenste index opnieuw ná de corpuscopy, zodat baseline-indexen vers zijn.
    const hnsw = (await db.query(`select indexname from pg_indexes where schemaname=$1 and tablename=$2
      and indexdef like '%USING hnsw%'`, [schema, v])).rows;
    if (hnsw.length !== 2) throw new Error(`${v}: verwacht twee gekopieerde HNSW-indexen, kreeg ${hnsw.length}`);
    for (const row of hnsw) await db.query(`drop index ${q(schema)}.${q(row.indexname)}`);
    await db.query(`insert into ${table} (${colList}) select ${colList} from public.document_chunks`);
    for (const kind of v === "both" ? ["full", "partial"] : [v]) {
      await db.query(`create index ${q(`${schema}_${v}_${kind}_hnsw`)} on ${table}
        using hnsw (embedding vector_cosine_ops)
        with (m=${result.hnsw[kind].m}, ef_construction=${result.hnsw[kind].ef_construction})
        ${kind === "partial" ? "where bibliotheek='generiek'" : ""}`);
    }
    const fks = (await db.query(`select conname,pg_get_constraintdef(oid) definition from pg_constraint
      where conrelid='public.document_chunks'::regclass and contype='f' order by conname`)).rows;
    for (const fk of fks) await db.query(`alter table ${table} add constraint
      ${q(`${schema}_${v}_${fk.conname}`.slice(0, 63))} ${fk.definition}`);
    await db.query(`create trigger trg_chunk_denorm_before_insert before insert on ${table}
      for each row execute function public.fn_chunk_denorm_before_insert()`);
    const n = Number((await db.query(`select count(*)::int n from ${table}`)).rows[0].n);
    if (n !== guard.chunks) throw new Error(`${v}: corpuscopy onvolledig: ${n}`);
    result[`index_${v}_before_bytes`] = dualWall ? await indexBytes(v)
      : Number((await db.query("select pg_relation_size($1::regclass) bytes",
        [`${schema}.${schema}_${v}_${v}_hnsw`])).rows[0].bytes);
  }

  // Negatieve controle: met trigger wordt een opzettelijk foute bibliotheek
  // hersteld; zonder trigger moet exact die inconsistentie zichtbaar worden.
  const table = `${q(schema)}.${q("full")}`;
  await db.query("begin");
  try {
    const doc = (await db.query(`select document_id, embedding, tekst from public.document_chunks
      where bibliotheek='generiek' and embedding is not null order by id limit 1`)).rows[0];
    if (!doc) throw new Error("Geen generieke bron voor negatieve controle");
    const args = [doc.document_id, doc.embedding, doc.tekst];
    const good = (await db.query(`insert into ${table}
      (id,document_id,chunk_index,tekst,embedding,bibliotheek)
      values(gen_random_uuid(),$1,2000000,$3,$2,'fonds') returning bibliotheek`, args)).rows[0].bibliotheek;
    if (good !== "generiek") throw new Error("Positieve triggercontrole herstelt bibliotheek niet");
    // Flush de uitgestelde FK-event vóór ALTER TABLE; anders weigert Postgres
    // de tijdelijke triggerwijziging terecht wegens pending trigger events.
    await db.query("set constraints all immediate");
    await db.query("savepoint negative");
    await db.query(`alter table ${table} disable trigger trg_chunk_denorm_before_insert`);
    await db.query("set constraints all deferred");
    const bad = (await db.query(`insert into ${table}
      (id,document_id,chunk_index,tekst,embedding,bibliotheek)
      values(gen_random_uuid(),$1,2000001,$3,$2,'fonds') returning bibliotheek`, args)).rows[0].bibliotheek;
    if (bad !== "fonds") throw new Error("Negatieve controle werd niet rood zonder trigger");
    await db.query("rollback to savepoint negative");
    result.negative_control = { trigger_on: good, trigger_off: bad, detected: true };
  } finally { await db.query("rollback"); }

  for (const library of dualWall ? ["generiek", "fonds"] : ["generiek"])
    for (const workload of ["insert", "replace"]) for (let round = 0; round < result.rounds; round++) {
    const offset = round % variants.length;
    const order = [...variants.slice(offset), ...variants.slice(0, offset)];
    for (const v of order) {
      const table = `${q(schema)}.${q(v)}`;
      const wallStart = performance.now();
      await db.query("begin");
      try {
        await db.query("set local statement_timeout='120s'");
        let metrics;
        if (workload === "insert") {
          metrics = await plan(`insert into ${table} (${colList})
            select ${selectCols("s", round)} from
            (select * from public.document_chunks where bibliotheek='${library}' and embedding is not null
              order by id limit ${result.batch}) s`);
        } else {
          await db.query(`create temporary table r1b_replace on commit drop as
            select * from ${table} where bibliotheek='${library}' and embedding is not null
            order by id limit ${result.batch}`);
          const deleted = await plan(`delete from ${table} where id in (select id from r1b_replace)`);
          const inserted = await plan(`insert into ${table} (${colList})
            select ${selectCols("s", round)} from r1b_replace s`);
          metrics = plus(deleted, inserted);
        }
        await db.query("commit");
        const wallMs = performance.now() - wallStart;
        result.runs.push({ library, workload, round: round + 1, variant: v, wall_ms: wallMs, ...metrics });
        process.stdout.write(`${library} ${workload} ${round + 1} ${v}: DML ${metrics.ms.toFixed(1)} ms, wall ${wallMs.toFixed(1)} ms\n`);
      } catch (e) { await db.query("rollback"); throw e; }
    }
    if (round === result.rounds - 1) {
      result[`index_after_${library}_${workload}_bytes`] = {};
      for (const v of variants) result[`index_after_${library}_${workload}_bytes`][v] = dualWall ? await indexBytes(v)
        : Number((await db.query("select pg_relation_size($1::regclass) bytes",
          [`${schema}.${schema}_${v}_${v}_hnsw`])).rows[0].bytes);
    }
  }
  result.final_rows = {};
  for (const v of variants) {
    const n = Number((await db.query(`select count(*)::int n from ${q(schema)}.${q(v)}`)).rows[0].n);
    result.final_rows[v] = n;
    const expected = guard.chunks + (dualWall ? 2 : 1) * result.rounds * result.batch;
    if (n !== expected) throw new Error(`Rijentelling ${v}: ${n}, verwacht ${expected}`);
  }
  result.summary = Object.fromEntries((dualWall ? ["generiek", "fonds"] : ["generiek"]).map((library) =>
    [library, Object.fromEntries(["insert", "replace"].map((w) => [w,
      Object.fromEntries(variants.map((v) => {
        const rows = result.runs.filter((r) => r.library === library && r.workload === w && r.variant === v);
        return [v, { dml_ms: range(rows.map((r) => r.ms)), wall_ms: range(rows.map((r) => r.wall_ms)),
          wal_bytes: range(rows.map((r) => r.wal_bytes)) }];
      }))]))]));
} finally {
  if (created) {
    await db.query(`drop schema ${q(schema)} cascade`);
    result.cleanup = (await db.query("select count(*)::int n from pg_namespace where nspname=$1", [schema])).rows[0].n === 0;
  }
  const after = (await db.query(`select (select count(*)::int from public.document_chunks) chunks,
    (select count(*)::int from public.tenant_domains) domains,
    to_regclass('public.idx_chunks_embedding') is not null as full,
    to_regclass('public.idx_chunks_embedding_generiek_r1b') is not null as partial`)).rows[0];
  result.source_after = after;
  result.source_fingerprint_after = await sourceState();
  result.source_unchanged = JSON.stringify(result.source_before) === JSON.stringify(result.source_fingerprint_after);
  await db.end();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
