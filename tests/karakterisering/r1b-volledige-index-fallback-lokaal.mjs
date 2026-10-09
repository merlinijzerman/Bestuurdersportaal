// Strikt lokale proef: blijft het bestaande RPC-resultaat gelijk wanneer de
// volledige HNSW-index binnen één transactie tijdelijk ontbreekt? Verschil in
// de nieuwe RPC wordt afzonderlijk gerapporteerd: de planner kan dan juist de
// partiële index kiezen en betere kandidaten teruggeven.
// De transactie eindigt ALTIJD met ROLLBACK; geen remote host toegestaan.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.argv[2];
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Alleen de lokale PR0-wegwerpdatabase is toegestaan");
}
const db = new pg.Client({ connectionString: url });
const funcs = ["zoek_chunks_hybride", "zoek_chunks_hybride_begrensd"];
const actors = [
  { user: "00000000-0000-4000-b000-00000000000a", fonds: "00000000-0000-4000-a000-00000000000a" },
  { user: "00000000-0000-4000-b000-00000000000b", fonds: "00000000-0000-4000-a000-00000000000b" },
];
const hash = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const t4Bron = readFileSync(new URL("../../supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql", import.meta.url), "utf8");
const t4Markeringen = [/^\\set ON_ERROR_STOP on$/gm, /^begin;$/gm, /^rollback;$/gm];
if (t4Markeringen.some((patroon) => [...t4Bron.matchAll(patroon)].length !== 1)) {
  throw new Error("T4-wrapper verwacht precies één psql-instelling, BEGIN en ROLLBACK");
}
const t4InBestaandeTransactie = t4Bron
  .replace(/^\\set ON_ERROR_STOP on$/m, "")
  .replace(/^begin;$/m, "")
  .replace(/^rollback;$/m, "");
const call = async (func, actor, vector) => {
  await db.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: actor.user, role: "authenticated" })]);
  await db.query("set local role authenticated");
  try {
    const t0 = performance.now();
    const rows = (await db.query(`select id, fts_rang, vec_rang from public.${func}(
      'pensioen transitieplan', $1::public.vector(1024), 30, 40, 60,
      null, null, null, null, 'actueel', '2026-10-03'::date,
      array['fonds','generiek']::text[], $2::uuid)`, [vector, actor.fonds])).rows;
    return { count: rows.length, hash: hash(rows), ms: Math.round(performance.now() - t0) };
  } finally {
    await db.query("set local role none");
  }
};
await db.connect();
let removed = false;
try {
  const guard = (await db.query(`select
    to_regclass('pr0_fixture.vragen') is not null as fixture,
    to_regclass('public.idx_chunks_embedding') is not null as full_index,
    to_regclass('public.idx_chunks_embedding_generiek_r1b') is not null as partial_index,
    (select count(*)::int from public.document_chunks) as chunks,
    (select count(*)::int from public.tenant_domains) as domains`)).rows[0];
  if (!guard.fixture || !guard.full_index || !guard.partial_index || guard.chunks < 25000 || guard.domains !== 0) {
    throw new Error("Niet de verwachte lokale PR0-fixture met beide HNSW-indexen");
  }
  const vectors = (await db.query("select naam, embedding::text as value from pr0_fixture.vragen where naam in ('vq1','vq2') order by naam")).rows;
  if (vectors.length !== 2) throw new Error("Proefvectoren ontbreken");
  await db.query("begin");
  await db.query("set local statement_timeout = '30s'");
  const samples = [];
  for (const actor of actors) for (const vector of vectors) for (const func of funcs) {
    samples.push({ actor: actor.fonds, vector: vector.naam, func,
      before: await call(func, actor, vector.value) });
  }
  await db.query("drop index public.idx_chunks_embedding");
  removed = true;
  if ((await db.query("select to_regclass('public.idx_chunks_embedding') is null as afwezig")).rows[0].afwezig !== true) {
    throw new Error("De volledige index is niet afwezig tijdens de regressiepoort");
  }
  for (const s of samples) {
    const actor = actors.find((a) => a.fonds === s.actor);
    const vector = vectors.find((v) => v.naam === s.vector);
    s.after = await call(s.func, actor, vector.value);
    s.equal = s.before.hash === s.after.hash && s.before.count === s.after.count;
  }
  const oudGelijk = samples.filter((s) => s.func === "zoek_chunks_hybride").every((s) => s.equal);
  const nieuwGelijk = samples.filter((s) => s.func === "zoek_chunks_hybride_begrensd").every((s) => s.equal);
  // De bestaande T4-matrix seedt en toetst zichzelf. Alleen de eigen
  // BEGIN/ROLLBACK-regels vervallen: de buitenste transactie houdt de volledige
  // HNSW-index afwezig tijdens T11–T14 en herstelt hem daarna atomair.
  await db.query("savepoint t4_clean");
  await db.query(t4InBestaandeTransactie);
  await db.query("rollback to savepoint t4_clean");

  // Negatieve controle: maak de RLS-grens in dezelfde lokale rollbacktransactie
  // bewust kapot. T12 moet dan precies het gespoofte B-fondslek aanwijzen.
  await db.query("alter table public.document_chunks disable row level security");
  await db.query("alter table public.documenten disable row level security");
  let negatieveControleRood = false;
  try {
    await db.query(t4InBestaandeTransactie);
  } catch (error) {
    if (!String(error?.message).includes("LEK T12: spoofed p_fonds_id => B surfacet B-content")) {
      throw error;
    }
    negatieveControleRood = true;
  }
  if (!negatieveControleRood) throw new Error("T4-negatieve controle bleef groen zonder RLS");
  console.log(JSON.stringify({ sample_count: samples.length,
    oud_gelijk: oudGelijk, nieuw_gelijk: nieuwGelijk,
    t4_zonder_volledige_index: "groen",
    t4_zonder_rls: "rood op T12, zoals vereist", samples }, null, 2));
  if (!oudGelijk) process.exitCode = 1;
} finally {
  if (removed) await db.query("rollback");
  else await db.query("rollback").catch(() => {});
  const restored = (await db.query("select to_regclass('public.idx_chunks_embedding') is not null as ok")).rows[0].ok;
  await db.end();
  if (!restored) throw new Error("De volledige index is na ROLLBACK niet hersteld");
}
