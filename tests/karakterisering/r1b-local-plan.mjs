// Lokaal planonderzoek van de generieke arm van de definitieve R1b-RPC.
// Vergelijkt de huidige ORDER BY met een indexvriendelijke variant, onder RLS.
import pg from "pg";

const url = process.argv[2];
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("uitsluitend een lokale wegwerpdatabase toegestaan");
const db = new pg.Client({ connectionString: url });
await db.connect();
const rpcOnly = process.argv.includes("--rpc-only");
const withoutFullIndex = process.argv.includes("--zonder-volledige-index");
let indexScansBefore = null;
try {
  const guard = (await db.query(`select
    (inet_server_addr() is null or inet_server_addr() <<= inet '127.0.0.0/8'
      or inet_server_addr() <<= inet '172.16.0.0/12'
      or inet_server_addr() <<= inet '10.0.0.0/8'
      or inet_server_addr() <<= inet '192.168.0.0/16') as local,
    exists(select 1 from public.tenant_domains where host like '%bestuurdersportaal.com') as tenant`)).rows[0];
  if (!guard.local || guard.tenant) throw new Error("geen lokale PR0-fixture");
  const vec = (await db.query("select embedding::text v from pr0_fixture.vragen where naam='vq1'")).rows[0].v;
  if (rpcOnly) indexScansBefore = Number((await db.query(`select idx_scan from pg_stat_user_indexes
    where indexrelname='idx_chunks_embedding_generiek_r1b'`)).rows[0].idx_scan);
  await db.query("begin");
  if (withoutFullIndex) {
    // De transactie herstelt de bestaande index vanzelf; uitsluitend lokaal.
    await db.query("drop index public.idx_chunks_embedding");
  }
  await db.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: "00000000-0000-4000-b000-00000000000a", role: "authenticated" })]);
  await db.query("set local role authenticated");
  const ids = (await db.query(`select coalesce(array_agg(id), '{}'::uuid[]) as docs,
    coalesce(array_agg(id) filter (where fonds_id='00000000-0000-4000-a000-00000000000a'), '{}'::uuid[]) as fonds_ok,
    coalesce(array_agg(id) filter (where volgende_review is null or volgende_review >= '2026-10-03'), '{}'::uuid[]) as review_ok
    from public.documenten where actief=true`)).rows[0];
  for (const s of ["enable_seqscan", "enable_bitmapscan", "enable_sort"]) await db.query(`set local ${s}=off`);
  await db.query("set local hnsw.ef_search=400");
  await db.query("set local hnsw.iterative_scan=off");
  const filter = `c.document_id=any($1::uuid[])
    and c.documentstatus is distinct from 'gearchiveerd'
    and c.documentstatus in ('vastgesteld','van_kracht')
    and coalesce(c.bronstatus,'actief')='actief'
    and (c.geldig_vanaf is null or c.geldig_vanaf <= '2026-10-03'::date)
    and (c.geldig_tot is null or c.geldig_tot >= '2026-10-03'::date)
    and c.bibliotheek=any(array['fonds','generiek']::text[])
    and (c.document_id=any($2::uuid[]) or c.bibliotheek='generiek')
    and (c.bibliotheek is distinct from 'generiek' or (
      c.documentstatus='van_kracht' and coalesce(c.bronstatus,'actief')='actief'
      and c.document_id=any($3::uuid[])))`;
  if (rpcOnly) {
    const result = await db.query(`select count(*)::int n from public.zoek_chunks_hybride_begrensd(
      'pensioen transitieplan', $1::public.vector(1024), 80, 40, 60,
      null, null, null, null, 'actueel', '2026-10-03'::date,
      array['fonds','generiek']::text[], '00000000-0000-4000-a000-00000000000a'::uuid)`, [vec]);
    console.log(JSON.stringify({ rpc_rows: result.rows[0].n }));
  } else for (const order of ["c.embedding <=> $4::public.vector, c.id", "c.embedding <=> $4::public.vector"]) {
    const sql = `explain (analyze,buffers,format json) select c.id, (c.embedding <=> $4::public.vector)::float8 as dist
      from public.document_chunks c where c.bibliotheek='generiek' and c.embedding is not null
        and ${filter} order by ${order} limit 40`;
    const plan = (await db.query(sql, [ids.docs, ids.fonds_ok, ids.review_ok, vec])).rows[0]["QUERY PLAN"][0];
    const nodes = [];
    const visit = (n, depth=0) => { nodes.push({ depth, type:n["Node Type"], index:n["Index Name"]??null,
      estimated:n["Plan Rows"], actual:n["Actual Rows"], buffers:(n["Shared Hit Blocks"]??0)+(n["Shared Read Blocks"]??0) });
      for(const x of n.Plans??[]) visit(x,depth+1); };
    visit(plan.Plan);
    console.log(JSON.stringify({ order, execution_ms:plan["Execution Time"], nodes }));
  }
} finally { await db.query("rollback").catch(()=>{}); await db.end(); }
if (rpcOnly) {
  const check = new pg.Client({ connectionString: url });
  await check.connect();
  try {
    const after = Number((await check.query(`select idx_scan from pg_stat_user_indexes
      where indexrelname='idx_chunks_embedding_generiek_r1b'`)).rows[0].idx_scan);
    console.log(JSON.stringify({ index_scans_before: indexScansBefore, index_scans_after: after,
      index_scans_delta: after - indexScansBefore }));
  } finally { await check.end(); }
}
