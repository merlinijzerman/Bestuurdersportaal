// Alleen lokale PR0-wegwerpdatabase. Test het FAALPAD van de R1b-indexwissel:
// een afgebroken CREATE INDEX CONCURRENTLY laat een ONGELDIGE index achter.
// Bewijst dat (1) de rollbackgrendel dan weigert, (2) het psql-herstelscript
// de ongeldige index opruimt en de volledige index concurrent en exact
// herbouwt, terwijl schrijfacties doorgaan, (3) het herstel idempotent is en
// (4) de migratie een achtergebleven ongeldige partiële index weigert.
// Nooit op Preview/Productie.
//
// Gebruik (vanuit de repo-root; `psql` in PATH, autocommit):
//   node tests/karakterisering/r1b-herstel-faalpad-lokaal.mjs <lokale-pg-url>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import pg from "pg";

const url = process.argv[2];
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("R1b-herstelproef weigert: alleen een expliciete loopback-URL");
}
const VOLLEDIG = "idx_chunks_embedding";
const PARTIEEL = "idx_chunks_embedding_generiek_r1b";
const VOLLEDIG_DEF = "CREATE INDEX idx_chunks_embedding ON public.document_chunks USING hnsw (embedding vector_cosine_ops)";
const HERSTEL = "scripts/ops/r1b/h-volledige-index-herstel.psql";

const db = new pg.Client({ connectionString: url });
const schrijver = new pg.Client({ connectionString: url });
const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ms = (t0) => Math.round(performance.now() - t0);

const rollbackBron = readFileSync(new URL("../../supabase/rollbacks/2026_10_08_r1b_hybride_begrensd_ROLLBACK.sql", import.meta.url), "utf8");
const rollbackBlokken = [...rollbackBron.matchAll(/do \$\$[\s\S]*?end \$\$;/g)];
if (rollbackBlokken.length !== 2) throw new Error("R1b-herstelproef weigert: rollback heeft niet twee controleblokken");
const rollbackGuard = rollbackBlokken[0][0];
const migratieBron = readFileSync(new URL("../../supabase/migrations/2026_10_08_r1b_hybride_begrensd.sql", import.meta.url), "utf8");
const migratieBlokken = [...migratieBron.matchAll(/do \$\$[\s\S]*?end \$\$;/g)];
const migratieVoorGuard = migratieBlokken[0]?.[0];
const migratieNaGuard = migratieBlokken[1]?.[0];
// P2 bouwt zelf niets meer: het create-statement komt uit het P1-ops-script.
const p1Bron = readFileSync(new URL("../../scripts/ops/r1b/p1-partiele-index-concurrent.psql", import.meta.url), "utf8");
const partieelCreate = p1Bron.match(/create index concurrently idx_chunks_embedding_generiek_r1b[\s\S]*?;/)?.[0];
if (!migratieVoorGuard?.includes("ongeldig") || !migratieNaGuard || !partieelCreate) {
  throw new Error("R1b-herstelproef weigert: migratiegrendels of partiële create niet gevonden");
}
const indexcheck = readFileSync(new URL("../../supabase/checks/2026_10_09_r1b_indexstand_readonly.sql", import.meta.url), "utf8");

async function indexStand() {
  const { rows } = await db.query(`
    select c.relname, pg_get_indexdef(i.indexrelid) as definitie,
           (i.indisvalid and i.indisready) as geldig, pg_relation_size(i.indexrelid)::bigint as bytes
      from pg_index i join pg_class c on c.oid = i.indexrelid
     where i.indrelid = 'public.document_chunks'::regclass and c.relname in ($1, $2)`, [VOLLEDIG, PARTIEEL]);
  return Object.fromEntries(rows.map((r) => [r.relname, r]));
}
async function verwachtFout(sql, fragment) {
  try {
    await db.query(sql);
  } catch (e) {
    if (String(e?.message).includes(fragment)) return String(e.message);
    throw e;
  }
  throw new Error(`R1b-herstelproef: verwachtte een weigering met '${fragment}'`);
}
async function oudeRpcMonster() {
  // De proefvector als postgres lezen: authenticated heeft geen rechten op pr0_fixture.
  const { rows: [v] } = await db.query("select embedding::text as e from pr0_fixture.vragen where naam = 'vq1'");
  await db.query("begin read only");
  try {
    await db.query("set local statement_timeout = '8s'");
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: "00000000-0000-4000-b000-00000000000a", role: "authenticated" })]);
    await db.query("set local role authenticated");
    const { rows } = await db.query(`
      select id, fts_rang, vec_rang from public.zoek_chunks_hybride('pensioen transitieplan',
        $1::public.vector(1024), 30, 40, 60, null, null, null, null,
        'actueel', '2026-10-03'::date, array['fonds','generiek']::text[], '00000000-0000-4000-a000-00000000000a'::uuid)`, [v.e]);
    return { aantal: rows.length, hash: hash(rows) };
  } finally {
    await db.query("rollback");
  }
}
function psqlHerstel(args = ["-v", "doelomgeving=lokaal", "-v", "fase=H", "-f", HERSTEL]) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const p = spawn("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let uit = "";
    p.stdout.on("data", (d) => { uit += d; });
    p.stderr.on("data", (d) => { uit += d; });
    p.on("close", (code) => (code === 0 ? resolve({ ms: ms(t0), uit }) : reject(new Error(`herstelscript exit ${code}: ${uit}`))));
  });
}
// Schrijfprobe: elke 300 ms een generieke chunk invoegen en terugdraaien, met
// lock_timeout 1 s. Bewijst dat CONCURRENTLY schrijvers niet blokkeert.
function schrijfprobe() {
  const metingen = [];
  let fouten = 0;
  let stop = false;
  const lus = (async () => {
    while (!stop) {
      const t0 = performance.now();
      try {
        await schrijver.query("begin");
        await schrijver.query("set local lock_timeout = '1s'");
        await schrijver.query(`
          insert into public.document_chunks (document_id, tekst, chunk_index, embedding)
          select document_id, tekst, 900000 + (random() * 99999)::int, embedding
            from public.document_chunks where bibliotheek = 'generiek' and embedding is not null limit 1`);
        await schrijver.query("rollback");
        metingen.push(ms(t0));
      } catch (e) {
        fouten++;
        await schrijver.query("rollback").catch(() => {});
        if (fouten === 1) metingen.push(`fout:${e.code}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  })();
  let actief = true;
  lus.finally(() => { actief = false; });
  return {
    get actief() { return actief; },
    stop: async () => {
      stop = true;
      await lus;
      const n = metingen.filter((x) => typeof x === "number");
      return { n: n.length, max_ms: Math.max(0, ...n), fouten, eerste: metingen.find((x) => typeof x === "string") ?? null };
    },
  };
}

/**
 * Voert `werk` uit terwijl de schrijfprobe loopt. De probe stopt ALTIJD (eigen
 * finally), ook als `werk` faalt; de oorspronkelijke fout van `werk` blijft de
 * fout die doorgaat (een fout bij het stoppen wordt alleen gelogd).
 */
async function metSchrijfprobe(werk, bijProbe = () => {}) {
  const probe = schrijfprobe();
  bijProbe(probe);
  let schrijf = null;
  try {
    const resultaat = await werk();
    return { resultaat, get schrijf() { return schrijf; } };
  } finally {
    try {
      schrijf = await probe.stop();
    } catch (e) {
      console.error("schrijfprobe stoppen faalde (oorspronkelijke fout blijft leidend):", e?.message);
    }
  }
}

await db.connect();
await schrijver.connect();
const verslag = {};
let vooraf;
let vangnetNodig = false;
try {
  const { rows: [g] } = await db.query(`
    select inet_server_addr()::text as adres, to_regclass('pr0_fixture.vragen') is not null as fixture,
           (select count(*)::int from public.document_chunks) as chunks,
           (select count(*)::int from public.tenant_domains) as domeinen`);
  if (!["127.0.0.1", "::1", "172.18.0.2/32"].includes(g.adres) || !g.fixture || g.chunks !== 25471 || g.domeinen !== 0) {
    throw new Error("R1b-herstelproef weigert: niet de verwachte lokale PR0-wegwerpdatabase");
  }
  vooraf = await indexStand();
  if (!vooraf[VOLLEDIG]?.geldig || !vooraf[PARTIEEL]?.geldig || vooraf[VOLLEDIG].definitie !== VOLLEDIG_DEF) {
    throw new Error("R1b-herstelproef weigert: beide geldige HNSW-indexen met de gepinde definitie vereist");
  }
  const monsterVooraf = await oudeRpcMonster();
  await db.query("set lock_timeout = '2s'");

  // 1. Cutover: volledige index weg (buiten transactie).
  vangnetNodig = true;
  let t0 = performance.now();
  await db.query(`drop index concurrently public.${VOLLEDIG}`);
  verslag.cutover_drop_ms = ms(t0);

  // 2. Mislukte herbouw: te korte statement_timeout ⇒ 57014 ⇒ ONGELDIGE index blijft staan.
  await db.query("set statement_timeout = '300ms'");
  const fout = await verwachtFout(`create index concurrently ${VOLLEDIG} on public.document_chunks using hnsw (embedding vector_cosine_ops)`, "statement timeout");
  await db.query("set statement_timeout = 0");
  const naFaal = await indexStand();
  if (!naFaal[VOLLEDIG] || naFaal[VOLLEDIG].geldig) throw new Error("R1b-herstelproef: verwachtte een ONGELDIGE volledige index na de afgebroken bouw");
  verslag.faal = { fout: fout.slice(0, 60), volledig_bestaat: true, volledig_geldig: false, partieel_geldig: naFaal[PARTIEEL]?.geldig };

  // 3. Grendels in de ongeldige stand.
  const { rows: [oud] } = await db.query(`select to_regclass('public.${VOLLEDIG}') is not null as oude_grendel_laat_door`);
  if (!oud.oude_grendel_laat_door) throw new Error("R1b-herstelproef: negatieve controle mislukt");
  await verwachtFout(rollbackGuard, "volledige HNSW-index ontbreekt of is ongeldig; herstel die eerst");
  const { rows: [chk] } = await db.query(indexcheck);
  if (chk.volledig_geldig !== false || Number(chk.ongeldige_indexen) !== 1 || chk.minstens_een_hnsw_geldig !== true) {
    throw new Error(`R1b-herstelproef: read-only check toont onverwachte stand ${JSON.stringify(chk)}`);
  }
  verslag.grendels_ongeldige_stand = {
    oude_bestaanscontrole: "zou rollback toelaten (negatieve controle)",
    nieuwe_rollbackgrendel: "weigert",
    readonly_check: { volledig_geldig: chk.volledig_geldig, ongeldige_indexen: Number(chk.ongeldige_indexen), minstens_een_hnsw_geldig: chk.minstens_een_hnsw_geldig },
  };

  // 4a. Negatief pad: het herstelcommando faalt terwijl de probe loopt. De
  //     probe moet dan gestopt zijn en de oorspronkelijke psql-fout doorkomen.
  let negatieveProbe;
  let negatieveFout;
  try {
    await metSchrijfprobe(() => psqlHerstel(["-c", "select 1/0 as bewust_falend_herstel"]), (p) => { negatieveProbe = p; });
  } catch (e) {
    negatieveFout = e;
  }
  if (!negatieveFout || !String(negatieveFout.message).includes("division by zero")) {
    throw new Error(`R1b-herstelproef: negatief pad gaf niet de oorspronkelijke herstelfout: ${negatieveFout?.message}`);
  }
  if (negatieveProbe.actief) throw new Error("R1b-herstelproef: schrijfprobe liep door na een mislukt herstel");
  verslag.negatief_pad_herstelfout = { probe_gestopt: true, oorspronkelijke_fout_behouden: true };

  // 4. Herstel met het echte psql-script, terwijl een schrijver doorloopt.
  const gemeten = await metSchrijfprobe(() => psqlHerstel());
  const herstel = gemeten.resultaat;
  const schrijf = gemeten.schrijf;
  if (schrijf.fouten > 0) throw new Error(`R1b-herstelproef: schrijfprobe faalde tijdens herstel: ${JSON.stringify(schrijf)}`);
  verslag.herstel = {
    ms: herstel.ms,
    stappen: herstel.uit.split("\n").filter((r) => /^H\d/.test(r)).map((r) => r.slice(0, 2)),
    schrijfprobe_tijdens_herbouw: schrijf,
  };

  // 5. Eindcontrole na herstel.
  const naHerstel = await indexStand();
  if (!naHerstel[VOLLEDIG]?.geldig || naHerstel[VOLLEDIG].definitie !== VOLLEDIG_DEF || !naHerstel[PARTIEEL]?.geldig) {
    throw new Error("R1b-herstelproef: volledige index niet exact hersteld");
  }
  await db.query(rollbackGuard);
  const monsterNa = await oudeRpcMonster();
  if (monsterNa.hash !== monsterVooraf.hash) throw new Error("R1b-herstelproef: oude RPC wijkt af na herstel");
  verslag.na_herstel = {
    volledig_geldig: true, definitie_gelijk: true, bytes_voor: Number(vooraf[VOLLEDIG].bytes), bytes_na: Number(naHerstel[VOLLEDIG].bytes),
    rollbackgrendel: "laat nu door", oude_rpc_monster: "gelijk",
  };

  // 6. Idempotentie: herstel nogmaals op een gezonde stand ⇒ no-op.
  const tweede = await psqlHerstel();
  if (!tweede.uit.includes("H2: idx_chunks_embedding bestaat al geldig")) throw new Error("R1b-herstelproef: tweede herstelrun was geen no-op");
  verslag.herstel_idempotent = { ms: tweede.ms };

  // 7. Partiële index: achtergebleven ongeldige index ⇒ migratie weigert.
  t0 = performance.now();
  await db.query(`drop index concurrently public.${PARTIEEL}`);
  await db.query("set statement_timeout = '300ms'");
  await verwachtFout(partieelCreate, "statement timeout");
  await db.query("set statement_timeout = 0");
  const pOngeldig = await indexStand();
  if (!pOngeldig[PARTIEEL] || pOngeldig[PARTIEEL].geldig) throw new Error("R1b-herstelproef: verwachtte een ongeldige partiële index");
  await verwachtFout(migratieVoorGuard, "bestaat maar is ongeldig");
  const { rows: [chk2] } = await db.query(indexcheck);
  if (chk2.volledig_geldig !== true || Number(chk2.ongeldige_indexen) !== 1) throw new Error("R1b-herstelproef: check bij ongeldige partiële index onjuist");
  // P1-herstel: ongeldige partiële index concurrent opruimen en opnieuw bouwen.
  await db.query(`drop index concurrently public.${PARTIEEL}`);
  await db.query(partieelCreate);
  await db.query(migratieVoorGuard);
  await db.query(migratieNaGuard);
  verslag.partieel = { ongeldig_na_afbreking: true, migratiegrendel: "weigert", herbouw_en_grendels_ms: ms(t0) };

  // 8. Eindstand gelijk aan vooraf.
  const eind = await indexStand();
  const { rows: [teller] } = await db.query("select count(*)::int as chunks from public.document_chunks");
  const { rows: [chk3] } = await db.query(indexcheck);
  if (!eind[VOLLEDIG]?.geldig || !eind[PARTIEEL]?.geldig || eind[VOLLEDIG].definitie !== vooraf[VOLLEDIG].definitie
      || eind[PARTIEEL].definitie !== vooraf[PARTIEEL].definitie || teller.chunks !== 25471 || Number(chk3.ongeldige_indexen) !== 0) {
    throw new Error("R1b-herstelproef: eindstand wijkt af van de beginstand");
  }
  vangnetNodig = false;
  verslag.eindstand = { beide_geldig: true, definities_gelijk: true, chunks: teller.chunks, ongeldige_indexen: 0 };
} finally {
  if (vangnetNodig && vooraf) {
    // Vangnet: zet beide indexen terug, ongeldige restanten eerst weg.
    await db.query("set statement_timeout = 0").catch(() => {});
    const s = await indexStand().catch(() => ({}));
    for (const naam of [VOLLEDIG, PARTIEEL]) {
      if (s[naam] && !s[naam].geldig) await db.query(`drop index concurrently if exists public.${naam}`).catch(() => {});
      if (!s[naam]?.geldig) {
        await db.query(vooraf[naam].definitie.replace(/^CREATE INDEX /i, "CREATE INDEX CONCURRENTLY ")).catch((e) => console.error("vangnet faalde:", naam, e.message));
      }
    }
    console.error("VANGNET uitgevoerd; controleer de indexstand:", JSON.stringify(await indexStand().catch(() => null)));
  }
  await schrijver.end();
  await db.end();
}
console.log(JSON.stringify({ omgeving: "uitsluitend_lokale_pr0_fixture", ...verslag }, null, 2));
