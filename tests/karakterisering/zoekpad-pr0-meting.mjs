// ============================================================================
//  PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK (geen CI).
//  Drie routes (R0 huidig, R1 RLS-behoudend, R2 definer-prototype), tekst én
//  vector, onder ECHTE rollen met productie-realistische JWT-claims.
// ----------------------------------------------------------------------------
//  Vereist: een lokale wegwerpstack met de migraties, daarna
//    psql $DB -f supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql
//    psql $DB -f supabase/checks/2026_10_03_pr0_zoekpad_prototypes.sql
//  (optioneel, voor stand "b5000": …_fixture_b_match.sql; opruimen met
//   …_fixture_opruimen.sql). Nooit tegen een gehoste omgeving: alleen
//   127.0.0.1/localhost/host.docker.internal worden geaccepteerd.
//
//  Fasen (--fase, komma-gescheiden; default alles):
//    meting      route × JWT × variant × vraag, N runs, p50/p95/max/buffers.
//    plannen     één intern plan per route × variant (auto_explain, vereist
//                --admin <superuser-url>, lokaal supabase_admin).
//    lek         pariteits-/lekmatrix (8 actoren) voor R0/R1/R2 incl.
//                negatieve controles (p_lek) — elke verruiming ⇒ rood.
//    vector      recall@k van HNSW (ef 40/100/200, iteratief) t.o.v. exacte
//                KNN mét filters, per fonds, incl. kosten.
//    invariantie legt scores/id's van fonds A vast (vergelijk b0 ↔ b5000).
//    hypothesen  H4 (GUC-route), H5 (plan_cache_mode), H7 (plain-config).
//  Opties:
//    --pg <url>          verplicht (postgres-rol, lokaal)
//    --admin <url>       superuser-url voor auto_explain (fase plannen)
//    --stand <label>     b0 | b5000 | cpu025 … (label in de uitvoer)
//    --uit <dir>         uitvoermap (default tests/karakterisering/uitvoer/zoekpad-pr0)
//    --runs <n>          runs per pilotvraag per cel (default 20)
//    --runs-overig <n>   runs per overige vraag per cel (default 2)
//    --routes R0,R1,R1p,R2,R2g   subset
//    --jwt 09,15         subset
//    --varianten strikt,verslapt,frase,nul,scope,actueel,hybride,hybride_verslapt,hybride_hnsw,hybride_iteratief
//                (hybride = exacte vectorarm zoals R0; hybride_hnsw = HNSW ef 40 zonder
//                 iteratieve scan; hybride_iteratief = HNSW + hnsw.iterative_scan)
//    --vragen pilot,regressie,algemeen
//  Uitvoer: JSONL (per run) + samenvattingen (JSON) + plannen (tekst) in --uit.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { bouwTerugvalFtsQuery } from "../../core/lib/fts-terugval.ts";

const arg = (naam, std) => {
  const i = process.argv.indexOf(`--${naam}`);
  return i > 0 ? process.argv[i + 1] : std;
};
const PG_URL = arg("pg");
const ADMIN_URL = arg("admin");
const STAND = arg("stand", "b0");
const UIT = arg("uit", "tests/karakterisering/uitvoer/zoekpad-pr0");
const RUNS = Number(arg("runs", "20"));
const RUNS_OVERIG = Number(arg("runs-overig", "2"));
const FASEN = arg("fase", "meting,plannen,lek,vector,invariantie,hypothesen").split(",");
const ROUTES = arg("routes", "R0,R1,R1p,R2,R2g").split(",");
const JWTS = arg("jwt", "09,15").split(",");
const VARIANTEN = arg("varianten", "strikt,verslapt,frase,nul,scope,actueel,hybride,hybride_verslapt,hybride_hnsw,hybride_iteratief").split(",");
const VRAAGSETS = arg("vragen", "pilot,regressie,algemeen").split(",");
if (!PG_URL) throw new Error("--pg <url> vereist");
for (const u of [PG_URL, ADMIN_URL].filter(Boolean)) {
  const host = new URL(u).hostname;
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) throw new Error(`geen lokale DB: ${host}`);
}
fs.mkdirSync(UIT, { recursive: true });

// ── Fixture-constanten (2026_10_03_pr0_zoekpad_fixture.sql) ─────────────────
const FONDS = { A: "00000000-0000-4000-a000-00000000000a", B: "00000000-0000-4000-a000-00000000000b", C: "00000000-0000-4000-a000-00000000000c" };
const USER = { A: "00000000-0000-4000-b000-00000000000a", B: "00000000-0000-4000-b000-00000000000b", C: "00000000-0000-4000-b000-00000000000c", N: "00000000-0000-4000-b000-0000000000ff" };
const DOC = { reglementA: "00000000-0000-4000-d000-00000000a001", pw: "00000000-0000-4000-d000-00000000e001", mvt: "00000000-0000-4000-d000-00000000e002" };
const PEILDATUM = "2026-10-03";

// ── JWT-claimsets (identiek aan tests/karakterisering/rls-505-meting.mjs) ───
function claims(omvang, sub, role = "authenticated") {
  if (omvang === "minimaal") return { sub, role };
  const nu = 1_790_000_000;
  const basis = {
    aud: "authenticated", exp: nu + 3600, iat: nu,
    iss: "https://voorbeeldref000000000.supabase.co/auth/v1", sub,
    email: "bestuurder.synthetisch@voorbeeld-fonds.invalid", phone: "",
    app_metadata: { provider: "azure", providers: ["azure"] },
    user_metadata: {
      custom_claims: { tid: "00000000-1111-2222-3333-444444444444" },
      email: "bestuurder.synthetisch@voorbeeld-fonds.invalid", email_verified: true,
      full_name: "Synthetische Bestuurder",
      iss: "https://login.microsoftonline.com/00000000-1111-2222-3333-444444444444/v2.0",
      name: "Synthetische Bestuurder", phone_verified: false,
      provider_id: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ", sub: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
    },
    role, aal: "aal1", amr: [{ method: "oauth", timestamp: nu }],
    session_id: "11111111-2222-4333-8444-555555555555", is_anonymous: false,
  };
  const doel = omvang === "09" ? 900 : 1500;
  if (omvang === "15") Object.assign(basis.user_metadata, {
    preferred_username: "bestuurder.synthetisch@voorbeeld-fonds.invalid",
    picture: "https://graph.microsoft.invalid/v1.0/me/photos/48x48/$value",
    tenant_naam: "Stichting Pensioenfonds Voorbeeld — bestuursondersteuning",
  });
  let i = 0;
  while (JSON.stringify(basis).length < doel - 20) {
    basis.user_metadata.groups ??= [];
    basis.user_metadata.groups.push(`0000000${i % 10}-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`);
    i++;
  }
  return basis;
}

// ── Vragenset ───────────────────────────────────────────────────────────────
// pilot: tests/karakterisering/artikelspoor-500-keten.mjs; regressie + C1:
// WERKOPDRACHT-RETRIEVAL-RECALL.md §A; algemeen: ≥ 15 niet-juridische vragen.
const VRAGEN = [
  { set: "pilot", naam: "bedoeling", vraag: "Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?", frase: '"artikel 150d" OR "art 150d"' },
  { set: "pilot", naam: "norm", vraag: "Wat bepaalt artikel 150d Pensioenwet?", frase: '"artikel 150d" OR "art 150d"' },
  { set: "pilot", naam: "gecombineerd", vraag: "Wat bepaalt artikel 150d Pensioenwet over het transitieplan en wat was volgens de memorie van toelichting de bedoeling daarvan?", frase: '"artikel 150d" OR "art 150d"' },
  { set: "pilot", naam: "reglement", vraag: "Wat staat in artikel 5 van ons reglement?", frase: '"artikel 5"' },
  { set: "regressie", naam: "r1", vraag: "Wat is er te vinden over pensioneren?" },
  { set: "regressie", naam: "r2", vraag: "Wanneer kan ik met pensioen gaan?" },
  { set: "regressie", naam: "r3", vraag: "Kan ik eerder met pensioen?" },
  { set: "regressie", naam: "r4", vraag: "Wat gebeurt er bij pensionering?" },
  { set: "regressie", naam: "r5", vraag: "Hoe werkt deeltijdpensioen?" },
  { set: "regressie", naam: "r6", vraag: "Kan ik mijn pensioen uitstellen?" },
  { set: "regressie", naam: "r7", vraag: "Kan ik partnerpensioen omzetten in ouderdomspensioen?" },
  { set: "regressie", naam: "r8", vraag: "Kan ik eerst een hoger en daarna een lager pensioen krijgen?" },
  { set: "regressie", naam: "r9", vraag: "Wat staat er in het reglement over stoppen met werken?" },
  { set: "regressie", naam: "r10", vraag: "Welke hoofdstukken kent het pensioenreglement?" },
  { set: "regressie", naam: "c1", vraag: "documenten met beleggingsbeleid ken je?" },
  { set: "algemeen", naam: "a1", vraag: "Hoe hoog is de premie dit jaar?" },
  { set: "algemeen", naam: "a2", vraag: "Wat is het beleggingsbeleid van het fonds?" },
  { set: "algemeen", naam: "a3", vraag: "Welke risico's loopt het fonds?" },
  { set: "algemeen", naam: "a4", vraag: "Hoe is het bestuur samengesteld?" },
  { set: "algemeen", naam: "a5", vraag: "Wat doet het verantwoordingsorgaan?" },
  { set: "algemeen", naam: "a6", vraag: "Wanneer is de volgende vergadering?" },
  { set: "algemeen", naam: "a7", vraag: "Hoe werkt de waardeoverdracht?" },
  { set: "algemeen", naam: "a8", vraag: "Wat is de dekkingsgraad eind vorig jaar?" },
  { set: "algemeen", naam: "a9", vraag: "Welke kosten brengt de uitvoerder in rekening?" },
  { set: "algemeen", naam: "a10", vraag: "Hoe wordt het rendement verdeeld over de cohorten?" },
  { set: "algemeen", naam: "a11", vraag: "Wat staat er in het communicatieplan?" },
  { set: "algemeen", naam: "a12", vraag: "Hoe is de solidariteitsreserve gevuld?" },
  { set: "algemeen", naam: "a13", vraag: "Welke besluiten zijn vorig jaar genomen?" },
  { set: "algemeen", naam: "a14", vraag: "Wat is het toezichtkader van DNB?" },
  { set: "algemeen", naam: "a15", vraag: "Hoe verloopt de implementatie van het nieuwe contract?" },
  { set: "algemeen", naam: "a16", vraag: "Welke informatie krijgt een deelnemer bij uitdiensttreding?" },
];

function fraseVoor(v) {
  if (v.frase) return v.frase;
  const t = bouwTerugvalFtsQuery(v.vraag)?.termen ?? [];
  return t.length >= 2 ? `"${t[0]} ${t[1]}"` : `"${t[0] ?? "pensioen"}"`;
}
function verslaptVoor(v) {
  return bouwTerugvalFtsQuery(v.vraag)?.query ?? v.vraag;
}

// Variant → (tekstquery, modus/peildatum/bronsoort, scope, hybride?, iteratief?)
function variantParams(variant, v) {
  const basis = { query: v.vraag, scope: null, modus: "alles", peildatum: PEILDATUM, bronsoort: null, hybride: false, iteratief: false, strategie: "planner" };
  switch (variant) {
    case "strikt": return basis;
    case "verslapt": return { ...basis, query: verslaptVoor(v) };
    case "frase": return { ...basis, query: fraseVoor(v) };
    case "nul": return { ...basis, query: "zzqxv plonkzz" };
    case "scope": return { ...basis, scope: [DOC.reglementA, DOC.pw] };
    // Productiefilterblok (chatroute, bibliotheekmodus): modus actueel +
    // peildatum + bronsoort fonds+generiek.
    case "actueel": return { ...basis, modus: "actueel", bronsoort: ["fonds", "generiek"] };
    // Alleen voor de lekmatrix: een bronsoortfilter dat werkelijk iets uitsluit.
    case "bronsoort_fonds": return { ...basis, bronsoort: ["fonds"] };
    case "hybride": return { ...basis, hybride: true };
    case "hybride_verslapt": return { ...basis, query: verslaptVoor(v), hybride: true };
    case "hybride_hnsw": return { ...basis, hybride: true, strategie: "hnsw" };
    case "hybride_iteratief": return { ...basis, hybride: true, iteratief: true, strategie: "hnsw" };
    default: throw new Error(`onbekende variant ${variant}`);
  }
}

const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
const arr = (a, t) => (a == null ? "null" : `array[${a.map(lit).join(",")}]::${t}[]`);
const uuidLit = (u) => (u == null ? "null" : `${lit(u)}::uuid`);

// Routes: SQL-tekst per route voor een variant. `vec` = vectorliteraal.
function routeSql(route, p, vec, fonds = FONDS.A) {
  const f = uuidLit(fonds);
  const sc = arr(p.scope, "uuid");
  const bs = arr(p.bronsoort, "text");
  const q = lit(p.query), m = lit(p.modus), d = `${lit(p.peildatum)}::date`;
  if (route === "R0") {
    return p.hybride
      ? `select id, document_id, rang, fts_rang, vec_rang from public.zoek_chunks_hybride(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, ${m}, ${d}, ${bs}, ${f})`
      : `select id, document_id, rang from public.zoek_chunks(${q}, 30, ${sc}, null, null, null, ${m}, ${d}, ${bs}, ${f})`;
  }
  if (route === "R1" || route === "R1p") {
    const fn = route === "R1p" ? "r1_fts_plpgsql" : "r1_fts";
    return p.hybride
      ? `select * from pr0_proto.r1_hybride(${q}, ${vec}, 30, 40, 60, ${sc}, ${m}, ${d}, ${bs}, ${f}, true, null, ${p.iteratief}, ${lit(p.strategie)})`
      : `select * from pr0_proto.${fn}(${q}, 30, ${sc}, ${m}, ${d}, ${bs}, ${f}, true, null)`;
  }
  if (route === "R2" || route === "R2g") {
    const armv = lit(route === "R2g" ? "gedeeld" : "tenantzuiver");
    return p.hybride
      ? `select * from pr0_proto.r2_hybride(${q}, ${vec}, 30, 40, 60, ${sc}, ${m}, ${d}, ${bs}, true, null, ${p.iteratief}, ${armv}, ${lit(p.strategie)})`
      : `select * from pr0_proto.r2_fts(${q}, 30, ${sc}, ${m}, ${d}, ${bs}, true, null, ${armv})`;
  }
  throw new Error(`onbekende route ${route}`);
}

// ── DB-hulp ─────────────────────────────────────────────────────────────────
let db;
async function alsActor(c, rol, fn, extra = []) {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(c))}, true)`);
    await db.query(`set local role ${rol}`);
    await db.query(`set local statement_timeout = '120s'`);
    for (const s of extra) await db.query(s);
    return await fn();
  } finally {
    await db.query("rollback");
  }
}
async function explainJson(c, rol, sql) {
  return alsActor(c, rol, async () => {
    const { rows } = await db.query(`explain (analyze, buffers, format json) ${sql}`);
    const p = rows[0]["QUERY PLAN"][0];
    return { ms: p["Execution Time"], buffers: (p.Plan["Shared Hit Blocks"] ?? 0) + (p.Plan["Shared Read Blocks"] ?? 0), rijen: p.Plan["Actual Rows"] };
  });
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const r1 = (x) => Math.round(x * 10) / 10;
const stat = (xs) => xs.length ? { n: xs.length, p50: r1(pct(xs, 50)), p95: r1(pct(xs, 95)), max: r1(Math.max(...xs)), gem: r1(xs.reduce((a, b) => a + b, 0) / xs.length) } : { n: 0 };

let VEC = {};
async function laadVectoren() {
  const { rows } = await db.query("select naam, embedding::text as e from pr0_fixture.vragen order by naam");
  for (const r of rows) VEC[r.naam] = `${lit(r.e)}::public.vector(1024)`;
}
const vecVoor = (i) => VEC[`vq${(i % 3) + 1}`];

// ── Fase: meting ────────────────────────────────────────────────────────────
async function faseMeting() {
  const uitRuns = fs.createWriteStream(path.join(UIT, `meting-${STAND}.jsonl`), { flags: "a" });
  const samen = [];
  const vragen = VRAGEN.filter((v) => VRAAGSETS.includes(v.set));
  for (const route of ROUTES) {
    for (const jwt of JWTS) {
      const c = claims(jwt, USER.A);
      for (const variant of VARIANTEN) {
        if (variant.startsWith("hybride_") && variant !== "hybride_verslapt" && route === "R0") continue;
        const tijden = [], buffers = [], perVraag = {};
        let fouten = 0, eersteFout = null;
        for (const [i, v] of vragen.entries()) {
          const p = variantParams(variant, v);
          const sql = routeSql(route, p, vecVoor(i));
          const n = v.set === "pilot" ? RUNS : RUNS_OVERIG;
          const t = [];
          for (let k = 0; k < n; k++) {
            try {
              const r = await explainJson(c, "authenticated", sql);
              tijden.push(r.ms); buffers.push(r.buffers); t.push(r.ms);
              uitRuns.write(JSON.stringify({ stand: STAND, route, jwt, variant, vraag: v.naam, run: k, ms: r1(r.ms), buffers: r.buffers, rijen: r.rijen }) + "\n");
            } catch (e) {
              fouten++; eersteFout ??= String(e.message).slice(0, 200);
              uitRuns.write(JSON.stringify({ stand: STAND, route, jwt, variant, vraag: v.naam, run: k, fout: String(e.message).slice(0, 200) }) + "\n");
            }
          }
          perVraag[v.naam] = stat(t);
        }
        const regel = { stand: STAND, route, jwt, jwt_bytes: JSON.stringify(c).length, variant, ...stat(tijden), buffers_gem: buffers.length ? Math.round(buffers.reduce((a, b) => a + b, 0) / buffers.length) : null, buffers_max: buffers.length ? Math.max(...buffers) : null, fouten, ...(eersteFout ? { eerste_fout: eersteFout } : {}), per_vraag: perVraag };
        samen.push(regel);
        const { per_vraag, ...kort } = regel;
        console.log(JSON.stringify(kort));
      }
    }
  }
  uitRuns.end();
  fs.writeFileSync(path.join(UIT, `meting-${STAND}-samenvatting.json`), JSON.stringify(samen, null, 1));
}

// ── Fase: plannen (auto_explain via superuser; rol authenticated) ───────────
async function fasePlannen() {
  if (!ADMIN_URL) { console.log("plannen: --admin ontbreekt, overgeslagen"); return; }
  const adm = new pg.Client({ connectionString: ADMIN_URL });
  await adm.connect();
  const notices = [];
  adm.on("notice", (n) => notices.push(n.message));
  for (const s of ["load 'auto_explain'", "set auto_explain.log_nested_statements = on", "set auto_explain.log_min_duration = 0",
    "set auto_explain.log_analyze = on", "set auto_explain.log_buffers = on", "set auto_explain.log_timing = off",
    "set auto_explain.log_level = notice", "set client_min_messages = notice"]) await adm.query(s);
  const uit = [];
  const c = claims("09", USER.A);
  const v = VRAGEN[0];
  for (const route of ROUTES) {
    for (const variant of VARIANTEN) {
      if (variant.startsWith("hybride_") && variant !== "hybride_verslapt" && route === "R0") continue;
      const p = variantParams(variant, v);
      const sql = routeSql(route, p, vecVoor(0));
      notices.length = 0;
      await adm.query("begin");
      try {
        await adm.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(c))}, true)`);
        await adm.query("set local role authenticated");
        await adm.query(`select count(*) from (${sql}) x`);
      } catch (e) {
        notices.push(`FOUT: ${e.message}`);
      } finally {
        await adm.query("rollback");
      }
      // Alleen de geneste plannen (de functie-inhoud), zonder de vectorliteralen.
      // Alleen de geneste plannen; de querytekst (het functielichaam) tot één
      // regel ingekort, set_config-regels weg, vectorliteralen weg.
      const tekst = notices
        .filter((n) => n.includes("plan:") && !/Query Text: (select|SELECT) set_config/.test(n))
        .map((n) => n
          .replace(/Query Text: ([^\n]*)\n[\s\S]*?(?=\n(?:Query Parameters:|[A-Z][A-Za-z ]+ {2}\(cost))/, "Query Text: $1 …")
          .replace(/\[-?\d[^\]]{200,}\]/g, "[…vector…]")
          .replace(/Query Parameters:.*\n?/g, "")
          // RLS-boilerplate (InitPlans voor auth.uid()/profielen) weglaten.
          .split("\n").filter((l) => !/^\s*(InitPlan \d+( \(returns \$\d+\))?|->  Result .*|One-Time Filter: .*|->  Seq Scan on profielen.*|Filter: \(id = \(InitPlan \d+\)\.col1\)|Rows Removed by Filter: 2|Buffers: shared hit=1)\s*$/.test(l)).join("\n"))
        .join("\n\n");
      uit.push(`==== ${route} / ${variant} (stand ${STAND}) ====\n${tekst}\n`);
      console.log(`plan ${route}/${variant}: ${notices.length} notices`);
    }
  }
  fs.writeFileSync(path.join(UIT, `plannen-${STAND}.txt`), uit.join("\n"));
  await adm.end();
}

// ── Fase: lek-/pariteitsmatrix ──────────────────────────────────────────────
// Verwachting per actor en scenario, als postgres (BYPASSRLS? nee: postgres is
// hier eigenaar; de "RLS-zichtbare" set wordt juist ALS DE ACTOR gemeten).
const ACTOREN = [
  ["eigen_fonds_A", "authenticated", (o) => claims(o, USER.A)],
  ["ander_fonds_B", "authenticated", (o) => claims(o, USER.B)],
  ["zonder_profiel", "authenticated", (o) => claims(o, USER.N)],
  ["authenticated_zonder_sub", "authenticated", () => ({ role: "authenticated" })],
  ["anon", "anon", () => ({ role: "anon" })],
  ["anon_met_sub_A", "anon", () => ({ sub: USER.A, role: "anon" })],
  ["service_role", "service_role", () => ({ role: "service_role" })],
  ["portaal_beperkt_A", "portaal_beperkt", () => ({ sub: USER.A, role: "portaal_beperkt" })],
];
// De pilotvraag strikt levert 0 treffers (AND-keten met '150d'); de
// verslapte OR-keten raakt duizenden chunks in álle randgevaldocumenten en is
// daarom de drager van de lek- en negatieve controles.
const VRAAG_VERSLAPT = { ...VRAGEN[0], vraag: verslaptVoor(VRAGEN[0]) };
const SCENARIOS = {
  pilot_strikt: { variant: "strikt", vraag: VRAGEN[0] },
  verslapt: { variant: "strikt", vraag: VRAAG_VERSLAPT },
  actueel: { variant: "actueel", vraag: VRAAG_VERSLAPT },
  scope: { variant: "scope", vraag: VRAAG_VERSLAPT },
  frase: { variant: "frase", vraag: VRAGEN[0] },
  bronsoort_fonds: { variant: "bronsoort_fonds", vraag: VRAAG_VERSLAPT },
  algemeen: { variant: "strikt", vraag: VRAGEN[5] },
  hybride: { variant: "hybride", vraag: VRAAG_VERSLAPT },
};
// Scenario-SQL met grote limiet (set-vergelijking) en p_lek voor de negatieve controles.
function lekSql(route, p, vec, fonds, lek) {
  const sc = arr(p.scope, "uuid"), bs = arr(p.bronsoort, "text"), q = lit(p.query), m = lit(p.modus), d = `${lit(p.peildatum)}::date`, f = uuidLit(fonds);
  const L = lek ? lit(lek) : "null";
  if (route === "R0") return p.hybride
    ? `select id from public.zoek_chunks_hybride(${q}, ${vec}, 100000, 100000, 60, ${sc}, null, null, null, ${m}, ${d}, ${bs}, ${f})`
    : `select id from public.zoek_chunks(${q}, 100000, ${sc}, null, null, null, ${m}, ${d}, ${bs}, ${f})`;
  if (route === "R1") return p.hybride
    ? `select id from pr0_proto.r1_hybride(${q}, ${vec}, 100000, 100000, 60, ${sc}, ${m}, ${d}, ${bs}, ${f}, true, ${L}, false)`
    : `select id from pr0_proto.r1_fts(${q}, 100000, ${sc}, ${m}, ${d}, ${bs}, ${f}, true, ${L})`;
  if (route === "R2") return p.hybride
    ? `select id from pr0_proto.r2_hybride(${q}, ${vec}, 100000, 100000, 60, ${sc}, ${m}, ${d}, ${bs}, true, ${L}, false, 'tenantzuiver')`
    : `select id from pr0_proto.r2_fts(${q}, 100000, ${sc}, ${m}, ${d}, ${bs}, true, ${L}, 'tenantzuiver')`;
  throw new Error(route);
}
// Grondwaarheid: RLS-zichtbare documenten ALS DE ACTOR (alle effectieve
// policies) ∩ de functiefilters + scanbewijs, berekend als postgres op de ruwe
// kolommen; chunkniveau: @@ op de 'dutch'-tsvector (hybride: @@ OF vector-
// kandidaat — bij limiet 100000 is dat elke chunk van een toegelaten document).
async function grondwaarheid(c, rol, p, scan = true, fondsParam = null) {
  let zichtbaar, zichtbaarFout = null;
  try {
    zichtbaar = await alsActor(c, rol, async () => (await db.query("select id from public.documenten")).rows.map((r) => r.id));
  } catch (e) {
    zichtbaar = []; zichtbaarFout = `fout:${e.code ?? e.message}`;
  }
  const filters = `
    d.actief = true and d.status is distinct from 'gearchiveerd'
    and (${p.scope ? `d.id = any(${arr(p.scope, "uuid")})` : "true"})
    and (${p.bronsoort ? `d.bibliotheek = any(${arr(p.bronsoort, "text")})` : "true"})
    and (d.bibliotheek is distinct from 'generiek' or (d.status = 'van_kracht' and coalesce(d.bronstatus,'actief') = 'actief' and (d.volgende_review is null or d.volgende_review >= ${lit(p.peildatum)}::date)))
    and (${p.modus !== "actueel" ? "true" : `d.status in ('vastgesteld','van_kracht') and coalesce(d.bronstatus,'actief') = 'actief' and (d.geldig_vanaf is null or d.geldig_vanaf <= ${lit(p.peildatum)}::date) and (d.geldig_tot is null or d.geldig_tot >= ${lit(p.peildatum)}::date)`})
    and (${scan ? `d.bestand_hash ~ '^[a-f0-9]{64}$' and d.scan_resultaat->>'verdict' = 'clean' and d.scan_resultaat->>'sha256' = d.bestand_hash` : "true"})
    and (${fondsParam ? `d.fonds_id = ${uuidLit(fondsParam)} or d.bibliotheek = 'generiek'` : "true"})`;
  const chunkFilter = p.hybride
    ? `(c.zoek_vector @@ websearch_to_tsquery('dutch', ${lit(p.query)}) or c.embedding is not null)`
    : `c.zoek_vector @@ websearch_to_tsquery('dutch', ${lit(p.query)})`;
  const { rows } = await db.query(`
    select c.id from public.document_chunks c join public.documenten d on d.id = c.document_id
     where d.id = any(${arr(zichtbaar, "uuid")}) and ${filters} and ${chunkFilter}
       and c.documentstatus is distinct from 'gearchiveerd'`);
  return { zichtbaarDocs: zichtbaar.length, zichtbaarFout, ids: new Set(rows.map((r) => r.id)) };
}
async function faseLek() {
  const matrix = {};
  const bevindingen = [];
  let rood = 0;
  for (const [naam, rol, mk] of ACTOREN) {
    const c = mk("09");
    matrix[naam] = {};
    for (const [snaam, s] of Object.entries(SCENARIOS)) {
      const p = variantParams(s.variant, s.vraag);
      const fondsParam = naam === "ander_fonds_B" ? FONDS.B : FONDS.A; // R0/R1: p_fonds_id zoals de app het meegeeft (eigen fonds)
      for (const route of ["R0", "R1", "R2"]) {
        const scan = route !== "R0";
        // R0/R1 krijgen p_fonds_id mee zoals de app dat doet; R2 leidt het fonds
        // zelf af en kent die parameter niet.
        const gw = await grondwaarheid(c, rol, p, scan, route === "R2" ? null : fondsParam);
        let uit;
        try {
          uit = await alsActor(c, rol, async () => new Set((await db.query(lekSql(route, p, VEC.vq1, fondsParam, null))).rows.map((r) => r.id)));
        } catch (e) {
          uit = `fout:${e.code ?? e.message}`;
        }
        let cel;
        const basis = { verwacht_n: gw.ids.size, rls_docs: gw.zichtbaarDocs, ...(gw.zichtbaarFout ? { rls_select: gw.zichtbaarFout } : {}) };
        if (typeof uit === "string") cel = { uitkomst: uit, ...basis };
        else {
          const buiten = [...uit].filter((id) => !gw.ids.has(id)).length;
          const mist = [...gw.ids].filter((id) => !uit.has(id)).length;
          cel = { n: uit.size, ...basis, buiten_verwachting: buiten, ontbrekend: mist, lek: buiten > 0, pariteit: buiten === 0 && mist === 0 };
          if (buiten > 0) { rood++; bevindingen.push(`LEK ${route} ${naam} ${snaam}: ${buiten} id's buiten de verwachting`); }
        }
        matrix[naam][`${snaam}/${route}`] = cel;
      }
    }
    console.log(`lek: actor ${naam} gemeten`);
  }
  // Negatieve controles: elke verruiming moet rood worden (actor A, R1 én R2).
  const NEG = [
    ["fonds", "verslapt"], ["scope", "scope"], ["scan", "verslapt"], ["review", "verslapt"], ["actief", "verslapt"],
    ["gearchiveerd", "verslapt"], ["actueel", "actueel"], ["generiek_published", "verslapt"], ["bronstatus", "actueel"], ["bronsoort", "bronsoort_fonds"],
  ];
  const negatief = {};
  const cA = claims("09", USER.A);
  for (const [lek, snaam] of NEG) {
    const p = variantParams(SCENARIOS[snaam].variant, SCENARIOS[snaam].vraag);
    for (const route of ["R1", "R2"]) {
      const gw = await grondwaarheid(cA, "authenticated", p, true, route === "R2" ? null : FONDS.A);
      let buiten = null, fout = null;
      try {
        const uit = await alsActor(cA, "authenticated", async () => new Set((await db.query(lekSql(route, p, VEC.vq1, FONDS.A, lek))).rows.map((r) => r.id)));
        buiten = [...uit].filter((id) => !gw.ids.has(id)).length;
      } catch (e) { fout = e.message; }
      const roodGeworden = buiten !== null && buiten > 0;
      // R1: een verruiming van de FONDSclausule in functiecode lekt niet, omdat
      // RLS op documenten de grens al trekt — dat is precies de defense-in-depth
      // van R1 en wordt apart vastgelegd (rls_dekt), niet als falende controle.
      const rlsDekt = route === "R1" && lek === "fonds" && !roodGeworden && !fout;
      negatief[`${lek}/${route}`] = { scenario: snaam, buiten_verwachting: buiten, rood: roodGeworden, ...(rlsDekt ? { rls_dekt: true } : {}), ...(fout ? { fout } : {}) };
      if (!roodGeworden && !rlsDekt) bevindingen.push(`NEGATIEVE CONTROLE NIET ROOD: p_lek=${lek} ${route} (${snaam})${fout ? ` fout: ${fout}` : ""}`);
    }
  }
  const uit = { stand: STAND, lekken: rood, bevindingen, matrix, negatieve_controles: negatief };
  fs.writeFileSync(path.join(UIT, `lekmatrix-${STAND}.json`), JSON.stringify(uit, null, 1));
  console.log(JSON.stringify({ fase: "lek", lekken: rood, bevindingen }));
}

// ── Fase: vector (recall@k t.o.v. exacte KNN mét filters) ───────────────────
async function faseVector() {
  const uit = [];
  const cA = claims("09", USER.A), cB = claims("09", USER.B);
  const K = 40;
  for (const [fonds, c, fid] of [["A", cA, FONDS.A], ["B", cB, FONDS.B]]) {
    for (const vq of ["vq1", "vq2"]) {
      for (const scope of [null, [DOC.reglementA, DOC.pw]]) {
        for (const route of ["R1", "R2"]) {
          const fn = route === "R1" ? `pr0_proto.r1_vec(${VEC[vq]}, ${K}, ${arr(scope, "uuid")}, 'alles', ${lit(PEILDATUM)}::date, null, ${uuidLit(fid)}, true, null`
                                   : `pr0_proto.r2_vec(${VEC[vq]}, ${K}, ${arr(scope, "uuid")}, 'alles', ${lit(PEILDATUM)}::date, null, true, null`;
          const varianten = {
            exact: `${fn}, false, 'exact', null)`,
            planner: `${fn}, false, 'planner', null)`,
            hnsw_ef40: `${fn}, false, 'hnsw', 40)`,
            hnsw_ef100: `${fn}, false, 'hnsw', 100)`,
            hnsw_ef200: `${fn}, false, 'hnsw', 200)`,
            iteratief_ef40: `${fn}, true, 'hnsw', 40)`,
          };
          const exact = await alsActor(c, "authenticated", async () => (await db.query(`select id from ${varianten.exact}`)).rows.map((r) => r.id));
          const exactSet = new Set(exact);
          for (const [vnaam, sql] of Object.entries(varianten)) {
            const ids = await alsActor(c, "authenticated", async () => (await db.query(`select id from ${sql}`)).rows.map((r) => r.id));
            const t = [], b = [];
            for (let k = 0; k < 5; k++) { const r = await explainJson(c, "authenticated", `select * from ${sql}`); t.push(r.ms); b.push(r.buffers); }
            const regel = { stand: STAND, fonds, vq, scope: scope ? "reglement+pw" : "geen", route, variant: vnaam, teruggegeven: ids.length, recall_at_40: Math.round((ids.filter((i) => exactSet.has(i)).length / K) * 1000) / 1000, ...stat(t), buffers_gem: Math.round(b.reduce((x, y) => x + y, 0) / b.length) };
            uit.push(regel);
            console.log(JSON.stringify(regel));
          }
        }
      }
    }
  }
  fs.writeFileSync(path.join(UIT, `vector-${STAND}.json`), JSON.stringify(uit, null, 1));
}

// ── Fase: invariantie (scores/id's fonds A vastleggen voor b0 ↔ b5000) ──────
async function faseInvariantie() {
  const cA = claims("09", USER.A);
  const uit = {};
  for (const [snaam, s] of Object.entries(SCENARIOS)) {
    const p = variantParams(s.variant, s.vraag);
    for (const route of ["R0", "R1", "R2"]) {
      const sql = lekSql(route, p, VEC.vq1, FONDS.A, null).replace("select id from", "select id, rang from");
      const rows = await alsActor(cA, "authenticated", async () => (await db.query(sql)).rows);
      uit[`${snaam}/${route}`] = Object.fromEntries(rows.map((r) => [r.id, Number(r.rang)]));
    }
  }
  fs.writeFileSync(path.join(UIT, `invariantie-${STAND}.json`), JSON.stringify(uit));
  // Vergelijk met b0 als die bestaat en dit niet b0 is.
  const b0 = path.join(UIT, "invariantie-b0.json");
  if (STAND !== "b0" && fs.existsSync(b0)) {
    const ref = JSON.parse(fs.readFileSync(b0, "utf8"));
    const verschil = {};
    for (const k of Object.keys(uit)) {
      const a = ref[k] ?? {}, b = uit[k];
      const idsGelijk = Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((id) => id in b);
      const scoresGelijk = idsGelijk && Object.keys(a).every((id) => Math.abs(a[id] - b[id]) < 1e-9);
      verschil[k] = { ids_b0: Object.keys(a).length, ids_nu: Object.keys(b).length, ids_gelijk: idsGelijk, scores_gelijk: scoresGelijk };
    }
    fs.writeFileSync(path.join(UIT, `invariantie-${STAND}-vs-b0.json`), JSON.stringify(verschil, null, 1));
    console.log(JSON.stringify({ fase: "invariantie", vergelijking: verschil }));
  } else console.log(JSON.stringify({ fase: "invariantie", vastgelegd: Object.keys(uit).length }));
}

// ── Fase: hypothesen H4/H5/H7 ───────────────────────────────────────────────
async function faseHypothesen() {
  const uit = {};
  const probeer = async (label, fn) => { try { uit[label] = await fn(); } catch (e) { uit[label] = `fout ${e.code ?? ""}: ${e.message}`.trim(); } };
  const cA = claims("09", USER.A);
  // H4 — GUC-route voor hnsw.* op Supabase-achtige rechten (postgres is hier
  // GEEN superuser, zoals gehost).
  await probeer("H4.postgres_is_superuser", async () => (await db.query("select rolsuper from pg_roles where rolname = current_user")).rows[0].rolsuper);
  await probeer("H4.set_local_als_authenticated", () => alsActor(cA, "authenticated", async () => {
    await db.query("set local hnsw.ef_search = 123"); await db.query("set local hnsw.iterative_scan = relaxed_order");
    return (await db.query("select current_setting('hnsw.ef_search') a, current_setting('hnsw.iterative_scan') b")).rows[0];
  }));
  await probeer("H4.create_function_set_hnsw_als_postgres", async () => {
    await db.query("begin");
    try {
      await db.query("create function pg_temp.h4() returns text language sql stable set hnsw.ef_search = 150 set hnsw.iterative_scan = relaxed_order as $$ select current_setting('hnsw.ef_search') || '/' || current_setting('hnsw.iterative_scan') $$");
      return (await db.query("select pg_temp.h4() v")).rows[0].v;
    } finally { await db.query("rollback"); }
  });
  await probeer("H4.alter_function_set_hnsw_als_postgres", async () => {
    await db.query("begin");
    try {
      await db.query("alter function pr0_proto.r2_fonds() set hnsw.ef_search = 77");
      return (await db.query("select proconfig from pg_proc where proname = 'r2_fonds' and pronamespace = 'pr0_proto'::regnamespace")).rows[0].proconfig;
    } finally { await db.query("rollback"); }
  });
  await probeer("H4.set_config_in_stable_plpgsql_zichtbaar_in_plan", () => alsActor(cA, "authenticated", async () => {
    await db.query(`select * from pr0_proto.r1_vec(${VEC.vq1}, 5, null, 'alles', current_date, null, ${uuidLit(FONDS.A)}, true, null, true, 'hnsw', 99)`);
    return (await db.query("select current_setting('hnsw.ef_search') a, current_setting('hnsw.iterative_scan') b")).rows[0];
  }));
  // H5 — plan_cache_mode: plpgsql-variant 8× (generiek plan na 5), met en
  // zonder force_custom_plan; de SQL-variant krijgt altijd een generiek plan
  // (boundParams = NULL in functions.c), zie het rapport.
  for (const modus of ["auto", "force_custom_plan", "force_generic_plan"]) {
    await probeer(`H5.plpgsql_${modus}`, async () => {
      const p = variantParams("actueel", VRAGEN[0]);
      const sql = routeSql("R1p", p, VEC.vq1);
      const t = [], b = [];
      await db.query("begin");
      try {
        await db.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(cA))}, true)`);
        await db.query("set local role authenticated");
        await db.query(`set local plan_cache_mode = ${modus}`);
        for (let k = 0; k < 8; k++) {
          const { rows } = await db.query(`explain (analyze, buffers, format json) ${sql}`);
          const pl = rows[0]["QUERY PLAN"][0];
          t.push(r1(pl["Execution Time"])); b.push((pl.Plan["Shared Hit Blocks"] ?? 0) + (pl.Plan["Shared Read Blocks"] ?? 0));
        }
      } finally { await db.query("rollback"); }
      return { ms_per_run: t, buffers_per_run: b };
    });
  }
  // H7 — welke tekstzoekconfiguratie gebruikt het `plain`-vangnet? PostgREST
  // vertaalt `.textSearch(col, q, { type: "plain" })` naar
  // `col @@ plainto_tsquery(q)` ZONDER regconfig ⇒ default_text_search_config.
  await probeer("H7.default_text_search_config", async () => (await db.query("show default_text_search_config")).rows[0].default_text_search_config);
  await probeer("H7.plainto_zonder_config_vs_dutch", async () => (await db.query(`
    select plainto_tsquery('pensioneren deeltijdpensioen')::text as zonder_config,
           plainto_tsquery('dutch', 'pensioneren deeltijdpensioen')::text as dutch,
           to_tsvector('dutch', 'pensioneren deeltijdpensioen') @@ plainto_tsquery('pensioneren deeltijdpensioen') as match_zonder_config,
           to_tsvector('dutch', 'pensioneren deeltijdpensioen') @@ plainto_tsquery('dutch', 'pensioneren deeltijdpensioen') as match_dutch`)).rows[0]);
  await probeer("H7.treffers_fixture_zonder_config_vs_dutch", async () => (await db.query(`
    select count(*) filter (where zoek_vector @@ plainto_tsquery('pensioneren')) as zonder_config,
           count(*) filter (where zoek_vector @@ plainto_tsquery('dutch', 'pensioneren')) as dutch
      from public.document_chunks where embedding_model like 'pr0-zoekpad%'`)).rows[0]);
  // H9 — pgvector-versie lokaal.
  await probeer("H9.pgvector_lokaal", async () => (await db.query("select extversion from pg_extension where extname = 'vector'")).rows[0].extversion);
  await probeer("H9.hnsw_gucs", async () => (await db.query("select name, setting, context from pg_settings where name like 'hnsw.%' order by 1")).rows);
  fs.writeFileSync(path.join(UIT, `hypothesen-${STAND}.json`), JSON.stringify(uit, null, 1));
  console.log(JSON.stringify({ fase: "hypothesen", uit }, null, 1));
}

async function main() {
  db = new pg.Client({ connectionString: PG_URL });
  await db.connect();
  try {
    await laadVectoren();
    const info = (await db.query(`select (select count(*) from public.document_chunks where embedding_model like 'pr0-zoekpad%') chunks,
      (select count(*) from public.documenten where id::text like '00000000-0000-4000-d000-%') docs, version() pg,
      (select extversion from pg_extension where extname='vector') pgvector`)).rows[0];
    console.log(JSON.stringify({ stand: STAND, fixture: info }));
    if (FASEN.includes("meting")) await faseMeting();
    if (FASEN.includes("plannen")) await fasePlannen();
    if (FASEN.includes("lek")) await faseLek();
    if (FASEN.includes("vector")) await faseVector();
    if (FASEN.includes("invariantie")) await faseInvariantie();
    if (FASEN.includes("hypothesen")) await faseHypothesen();
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
