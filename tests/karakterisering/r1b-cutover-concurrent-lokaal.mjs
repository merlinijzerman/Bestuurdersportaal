// Alleen lokale PR0-wegwerpdatabase. Test een echte, niet-transactionele
// single-index-wissel en de zware herstelstap. Nooit op Preview/Productie.
//
// Gebruik: node tests/karakterisering/r1b-cutover-concurrent-lokaal.mjs <lokale-pg-url>
// Vereist de PR0-fixture en de lokale R1b-migratie met beide HNSW-indexen.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.argv[2];
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("R1b-cutover weigert: alleen een expliciete loopback-URL");
}
const db = new pg.Client({ connectionString: url });
const hash = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const actoren = [
  { naam: "A", gebruiker: "00000000-0000-4000-b000-00000000000a", fonds: "00000000-0000-4000-a000-00000000000a" },
  { naam: "B", gebruiker: "00000000-0000-4000-b000-00000000000b", fonds: "00000000-0000-4000-a000-00000000000b" },
];
const functies = ["zoek_chunks_hybride", "zoek_chunks_hybride_begrensd"];
const t4Bron = readFileSync(new URL("../../supabase/checks/2026_07_08_t4_retrieval_fondsdiscipline.sql", import.meta.url), "utf8");
const t4Markeringen = [/^\\set ON_ERROR_STOP on$/gm, /^begin;$/gm, /^rollback;$/gm];
if (t4Markeringen.some((patroon) => [...t4Bron.matchAll(patroon)].length !== 1)) {
  throw new Error("R1b-cutover weigert: T4-wrapper wijkt af");
}
const t4InBestaandeTransactie = t4Bron
  .replace(/^\\set ON_ERROR_STOP on$/m, "")
  .replace(/^begin;$/m, "")
  .replace(/^rollback;$/m, "");
const rollbackBron = readFileSync(new URL("../../supabase/rollbacks/2026_10_08_r1b_hybride_begrensd_ROLLBACK.sql", import.meta.url), "utf8");
const rollbackBlokken = [...rollbackBron.matchAll(/do \$\$[\s\S]*?end \$\$;/g)];
if (rollbackBlokken.length !== 2) {
  throw new Error("R1b-cutover weigert: rollback heeft niet de verwachte twee controleblokken");
}
const rollbackGuard = rollbackBlokken[0][0];

async function indexStand() {
  const { rows } = await db.query(`
    select c.relname, pg_get_indexdef(i.indexrelid) as definitie,
           i.indisvalid as geldig, i.indisready as gereed,
           pg_relation_size(i.indexrelid)::bigint as bytes
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where i.indrelid = 'public.document_chunks'::regclass
       and c.relname in ('idx_chunks_embedding', 'idx_chunks_embedding_generiek_r1b')
     order by c.relname`);
  return Object.fromEntries(rows.map((r) => [r.relname, r]));
}

async function proef(func, actor, vector) {
  await db.query("begin read only");
  try {
    await db.query("set local statement_timeout = '8s'");
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: actor.gebruiker, role: "authenticated" })]);
    await db.query("set local role authenticated");
    const { rows } = await db.query(`
      select id, fts_rang, vec_rang
        from public.${func}('pensioen transitieplan', $1::public.vector(1024),
          30, 40, 60, null, null, null, null, 'actueel',
          '2026-10-03'::date, array['fonds','generiek']::text[], $2::uuid)`,
      [vector, actor.fonds]);
    return { aantal: rows.length, hash: hash(rows) };
  } finally {
    await db.query("rollback");
  }
}

async function monsters(vectoren) {
  const uit = {};
  for (const actor of actoren) {
    for (const vector of vectoren) {
      for (const func of functies) {
        uit[`${actor.naam}/${vector.naam}/${func}`] =
          await proef(func, actor, vector.embedding);
      }
    }
  }
  return uit;
}

async function t4ZonderVolledigeIndex() {
  await db.query("begin");
  try {
    await db.query("set local statement_timeout = '30s'");
    await db.query(t4InBestaandeTransactie);
  } finally {
    await db.query("rollback");
  }
  await db.query("begin");
  let verwachtLek = false;
  try {
    await db.query("set local statement_timeout = '30s'");
    await db.query("alter table public.document_chunks disable row level security");
    await db.query("alter table public.documenten disable row level security");
    try {
      await db.query(t4InBestaandeTransactie);
    } catch (error) {
      if (!String(error?.message).includes("LEK T12: spoofed p_fonds_id => B surfacet B-content")) {
        throw error;
      }
      verwachtLek = true;
    }
  } finally {
    await db.query("rollback");
  }
  if (!verwachtLek) throw new Error("R1b-cutover: T4-negatieve controle werd niet rood");
}

function milliseconden(t0) {
  return Math.round(performance.now() - t0);
}

await db.connect();
let volledigeIndexMoetHersteld = false;
let vooraf;
let naDrop;
let naHerstel;
let samplesVoor;
let samplesZonder;
let dropMs;
let herstelMs;
let rollbackGuardRood = false;
try {
  const { rows: [guard] } = await db.query(`
    select inet_server_addr()::text as adres,
           to_regclass('pr0_fixture.vragen') is not null as fixture,
           (select count(*)::int from public.document_chunks) as chunks,
           (select count(*)::int from public.tenant_domains) as domeinen`);
  // De lokale Docker-bridge rapporteert op deze wegwerpstack 172.18.0.2;
  // de verbinding zelf moet daarnaast nog altijd via een loopback-URL lopen.
  if (!["127.0.0.1", "::1", "172.18.0.2/32"].includes(guard.adres)
      || !guard.fixture || guard.chunks !== 25471 || guard.domeinen !== 0) {
    throw new Error("R1b-cutover weigert: niet de verwachte lokale PR0-wegwerpdatabase");
  }
  vooraf = await indexStand();
  if (!vooraf.idx_chunks_embedding?.geldig || !vooraf.idx_chunks_embedding?.gereed
      || !vooraf.idx_chunks_embedding_generiek_r1b?.geldig
      || !vooraf.idx_chunks_embedding_generiek_r1b?.gereed) {
    throw new Error("R1b-cutover weigert: beide geldige HNSW-indexen vereist");
  }
  const { rows: vectoren } = await db.query(`
    select naam, embedding::text as embedding
      from pr0_fixture.vragen
     where naam in ('vq1', 'vq2')
     order by naam`);
  if (vectoren.length !== 2) throw new Error("R1b-cutover weigert: proefvectoren ontbreken");
  samplesVoor = await monsters(vectoren);

  // CONCURRENTLY kan niet in een transactieblok. Dit is uitsluitend veilig
  // omdat de lokale wegwerpdatabase vooraf expliciet is gecontroleerd.
  await db.query("set lock_timeout = '2s'");
  await db.query("set statement_timeout = '120s'");
  const tDrop = performance.now();
  await db.query("drop index concurrently public.idx_chunks_embedding");
  volledigeIndexMoetHersteld = true;
  dropMs = milliseconden(tDrop);
  naDrop = await indexStand();
  if (naDrop.idx_chunks_embedding
      || !naDrop.idx_chunks_embedding_generiek_r1b?.geldig) {
    throw new Error("R1b-cutover: de single-index-stand is ongeldig");
  }
  try {
    await db.query(rollbackGuard);
  } catch (error) {
    if (!String(error?.message).includes("volledige HNSW-index ontbreekt of is ongeldig; herstel die eerst")) throw error;
    rollbackGuardRood = true;
  }
  if (!rollbackGuardRood) throw new Error("R1b-cutover: rollbackguard liet verwijdering van de enige index toe");
  samplesZonder = await monsters(vectoren);
  for (const [sleutel, voor] of Object.entries(samplesVoor)) {
    if (!sleutel.endsWith("/zoek_chunks_hybride")) continue;
    const na = samplesZonder[sleutel];
    if (voor.hash !== na.hash || voor.aantal !== na.aantal) {
      throw new Error(`R1b-cutover: oude RPC wijzigde inhoudelijk bij ${sleutel}`);
    }
  }
  await t4ZonderVolledigeIndex();
} finally {
  if (volledigeIndexMoetHersteld) {
    // Herbouw vóór terugkeer; de oude index verwijderen is geen snelle
    // rollback. Bewaar de fout als de herbouw niet lukt.
    const tHerstel = performance.now();
    await db.query("set lock_timeout = '2s'");
    await db.query("set statement_timeout = '120s'");
    await db.query(vooraf.idx_chunks_embedding.definitie.replace(/^CREATE INDEX /i, "CREATE INDEX CONCURRENTLY "));
    herstelMs = milliseconden(tHerstel);
    naHerstel = await indexStand();
    if (!naHerstel.idx_chunks_embedding?.geldig
        || !naHerstel.idx_chunks_embedding?.gereed
        || naHerstel.idx_chunks_embedding.definitie !== vooraf.idx_chunks_embedding.definitie
        || !naHerstel.idx_chunks_embedding_generiek_r1b?.geldig) {
      throw new Error("R1b-cutover: volledige HNSW-index niet exact hersteld");
    }
    await db.query(rollbackGuard);
  }
  await db.end();
}

console.log(JSON.stringify({
  omgeving: "uitsluitend_lokale_pr0_fixture",
  chunks: 25471,
  drop_ms: dropMs,
  herstel_ms: herstelMs,
  bytes_voor: vooraf.idx_chunks_embedding.bytes,
  bytes_partieel: vooraf.idx_chunks_embedding_generiek_r1b.bytes,
  bytes_hersteld: naHerstel.idx_chunks_embedding.bytes,
  oude_rpc_pariteit: "4/4",
  t4_zonder_volledige_index: "groen; negatieve RLS-controle rood op T12",
  rollbackguard_zonder_volledige_index: rollbackGuardRood ? "weigert; na herstel toegestaan" : "niet getest",
  nieuwe_rpc_resultaatverschillen: Object.keys(samplesVoor)
    .filter((k) => k.endsWith("/zoek_chunks_hybride_begrensd"))
    .filter((k) => samplesVoor[k].hash !== samplesZonder[k].hash),
  index_na_afloop: Object.keys(naHerstel),
}, null, 2));
