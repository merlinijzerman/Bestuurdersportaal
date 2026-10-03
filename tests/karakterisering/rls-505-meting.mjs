// ============================================================================
//  #505 — voor/na-meting van de RLS-kosten op document_chunks en documenten,
//  onder ECHTE RLS (rol authenticated) met een productie-realistische JWT.
// ----------------------------------------------------------------------------
//  Per variant (query × JWT-omvang × policystand) N uitvoeringen van
//    begin; set_config('request.jwt.claims', <claims>, true);
//    set local role authenticated; set local statement_timeout = '60s';
//    explain (analyze, buffers, format json) <query>;  (daarna rollback)
//  en rapporteert p50, p95, max, gemiddelde gedeelde buffers en het plan.
//
//  JWT-claims: dezelfde structuur als Supabase/GoTrue uitgeeft (aud, exp, iat,
//  iss, sub, email, phone, app_metadata, user_metadata, role, aal, amr,
//  session_id, is_anonymous). `fn_access_token_hook` voegt in deze repo geen
//  eigen claims toe (hij geeft het event ongewijzigd terug of zet alleen `role`
//  op portaal_beperkt). Volledig synthetisch — geen persoonsgegevens. Omvang:
//  minimaal (sub + role), ~0,9 kB en ~1,5 kB.
//
//  Backends:
//    --pg <url>              lokaal (node-postgres, één verbinding);
//    --linked <project-ref>  gehost, READ-ONLY via `supabase db query --linked`
//                            (één EXPLAIN per aanroep; geen schrijfacties).
//  Opties:
//    --stand <label>         label in de uitvoer (voor/na/…)
//    --runs <n>              uitvoeringen per variant (default 20)
//    --sub <uuid> --fonds <uuid|null>
//    --queries a,b,…         subset (default: alle)
//    --jwt minimaal,09,15    subset
//    --zonder-all            (alleen --pg) drop de ALL-policy BINNEN de
//                            meettransactie (rollback; experiment, geen wijziging)
//    --plan                  print per variant één tekstplan
//  Uitvoer: JSON-regels op stdout (één per variant).
// ============================================================================
import { execFileSync } from "node:child_process";
import pg from "pg";

const arg = (naam, std) => {
  const i = process.argv.indexOf(`--${naam}`);
  return i > 0 ? process.argv[i + 1] : std;
};
const vlag = (naam) => process.argv.includes(`--${naam}`);

const PG_URL = arg("pg");
const LINKED = arg("linked");
const STAND = arg("stand", "?");
const RUNS = Number(arg("runs", "20"));
const SUB = arg("sub", "00000000-0000-4000-8000-0000000000b1");
const FONDS = arg("fonds", "null");
const ZONDER_ALL = vlag("zonder-all");
const MET_PLAN = vlag("plan");
if (!PG_URL && !LINKED) throw new Error("--pg <url> of --linked <ref> vereist");
if (PG_URL) {
  const host = new URL(PG_URL).hostname;
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) throw new Error(`geen lokale DB: ${host}`);
}
if (LINKED && ZONDER_ALL) throw new Error("--zonder-all is een schrijvend experiment: alleen lokaal");

// ── JWT-claimsets ───────────────────────────────────────────────────────────
function claims(omvang) {
  if (omvang === "minimaal") return { sub: SUB, role: "authenticated" };
  const nu = 1_790_000_000;
  const basis = {
    aud: "authenticated",
    exp: nu + 3600,
    iat: nu,
    iss: "https://voorbeeldref000000000.supabase.co/auth/v1",
    sub: SUB,
    email: "bestuurder.synthetisch@voorbeeld-fonds.invalid",
    phone: "",
    app_metadata: { provider: "azure", providers: ["azure"] },
    user_metadata: {
      custom_claims: { tid: "00000000-1111-2222-3333-444444444444" },
      email: "bestuurder.synthetisch@voorbeeld-fonds.invalid",
      email_verified: true,
      full_name: "Synthetische Bestuurder",
      iss: "https://login.microsoftonline.com/00000000-1111-2222-3333-444444444444/v2.0",
      name: "Synthetische Bestuurder",
      phone_verified: false,
      provider_id: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
      sub: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
    },
    role: "authenticated",
    aal: "aal1",
    amr: [{ method: "oauth", timestamp: nu }],
    session_id: "11111111-2222-4333-8444-555555555555",
    is_anonymous: false,
  };
  const doel = omvang === "09" ? 900 : 1500;
  // Vul aan met realistische Entra-velden tot de doelomvang.
  const extra = {
    preferred_username: "bestuurder.synthetisch@voorbeeld-fonds.invalid",
    picture: "https://graph.microsoft.invalid/v1.0/me/photos/48x48/$value",
    tenant_naam: "Stichting Pensioenfonds Voorbeeld — bestuursondersteuning",
  };
  if (omvang === "15") Object.assign(basis.user_metadata, extra);
  let i = 0;
  while (JSON.stringify(basis).length < doel - 20) {
    basis.user_metadata.groups ??= [];
    basis.user_metadata.groups.push(`0000000${i % 10}-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`);
    i++;
  }
  return basis;
}

// ── Queries ─────────────────────────────────────────────────────────────────
const f = FONDS === "null" ? "null" : `'${FONDS}'::uuid`;
const QUERIES = {
  zoek_chunks_strikt: `select * from public.zoek_chunks('bedoeling wetgever transitieplan', 24, null, null, null, null, 'alles', current_date, null, ${f})`,
  zoek_chunks_verslapt: `select * from public.zoek_chunks('bedoeling or wetgever or transitieplan', 24, null, null, null, null, 'alles', current_date, null, ${f})`,
  // R1 (0218): dezelfde twee vragen via zoek_chunks_begrensd (zelfde parameterblok).
  zcb_strikt: `select * from public.zoek_chunks_begrensd('bedoeling wetgever transitieplan', 24, null, null, null, null, 'alles', current_date, null, ${f})`,
  zcb_verslapt: `select * from public.zoek_chunks_begrensd('bedoeling or wetgever or transitieplan', 24, null, null, null, null, 'alles', current_date, null, ${f})`,
  zoek_chunks_hybride: `select * from public.zoek_chunks_hybride('bedoeling wetgever transitieplan', array_fill(0.01::real, array[1024])::vector, 8, 40, 60, null, null, null, null, 'alles', current_date, null, ${f})`,
  // PostgREST-vorm van het ilike-vangnet (`document_chunks?tekst=ilike.*…*&limit=50`).
  chunks_postgrest_ilike: `with pgrst_source as (select "document_chunks"."id", "document_chunks"."document_id", "document_chunks"."chunk_index", "document_chunks"."tekst" from "public"."document_chunks" where "document_chunks"."tekst" ilike '%transitieplan%' limit 50 offset 0) select coalesce(json_agg(_postgrest_t), '[]') as body from (select * from pgrst_source) _postgrest_t`,
  // PostgREST `Prefer: count=exact` op document_chunks (volledige RLS-evaluatie).
  chunks_count: `select count(*) from "public"."document_chunks"`,
  // PostgREST-lijst van documenten (documentenbibliotheek).
  documenten_postgrest: `with pgrst_source as (select "documenten"."id", "documenten"."titel", "documenten"."bibliotheek", "documenten"."status" from "public"."documenten" where "documenten"."actief" = true order by "documenten"."titel" limit 1000 offset 0) select coalesce(json_agg(_postgrest_t), '[]') as body from (select * from pgrst_source) _postgrest_t`,
  documenten_count: `select count(*) from "public"."documenten"`,
};
const gekozen = (arg("queries") ?? Object.keys(QUERIES).join(",")).split(",");
const omvangen = (arg("jwt") ?? "minimaal,09,15").split(",");

const lit = (s) => `'${s.replaceAll("'", "''")}'`;
function preambule(c) {
  return [
    ZONDER_ALL ? `drop policy "chunks write eigen fonds" on public.document_chunks` : null,
    `select set_config('request.jwt.claims', ${lit(JSON.stringify(c))}, true)`,
    `set local role authenticated`,
    `set local statement_timeout = '60s'`,
  ].filter(Boolean);
}

// ── Backends ────────────────────────────────────────────────────────────────
let db;
async function explain(c, sql, formaat) {
  const ex = `explain (analyze, buffers${formaat === "json" ? ", format json" : ""}) ${sql}`;
  if (PG_URL) {
    await db.query("begin");
    try {
      for (const s of preambule(c)) await db.query(s);
      const { rows } = await db.query(ex);
      return formaat === "json" ? rows[0]["QUERY PLAN"] : rows.map((r) => r["QUERY PLAN"]).join("\n");
    } finally {
      await db.query("rollback");
    }
  }
  // Gehost: één aanroep, EXPLAIN als laatste statement; geen commit (read-only).
  const tekst = ["begin", ...preambule(c), ex].join(";\n") + ";";
  const uit = execFileSync("npx", ["-y", "supabase@2.114.0", "db", "query", "--linked", "--project-ref", LINKED, "-o", "json", tekst], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = JSON.parse(uit).rows;
  if (formaat === "json") {
    const v = rows[0]["QUERY PLAN"];
    return typeof v === "string" ? JSON.parse(v) : v;
  }
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const r1 = (x) => Math.round(x * 10) / 10;

async function main() {
  if (PG_URL) {
    db = new pg.Client({ connectionString: PG_URL });
    await db.connect();
  }
  try {
    for (const q of gekozen) {
      for (const o of omvangen) {
        const c = claims(o);
        const tijden = [];
        const buffers = [];
        const fouten = [];
        for (let i = 0; i < RUNS; i++) {
          try {
            const plan = (await explain(c, QUERIES[q], "json"))[0];
            tijden.push(plan["Execution Time"]);
            buffers.push((plan.Plan["Shared Hit Blocks"] ?? 0) + (plan.Plan["Shared Read Blocks"] ?? 0));
          } catch (e) {
            fouten.push(String(e.message ?? e).slice(0, 160));
          }
        }
        const regel = {
          stand: STAND, doel: PG_URL ? "lokaal" : LINKED, query: q, jwt: o,
          jwt_bytes: JSON.stringify(c).length, runs: tijden.length, fouten: fouten.length,
          p50_ms: tijden.length ? r1(pct(tijden, 50)) : null,
          p95_ms: tijden.length ? r1(pct(tijden, 95)) : null,
          max_ms: tijden.length ? r1(Math.max(...tijden)) : null,
          buffers_gem: buffers.length ? Math.round(buffers.reduce((a, b) => a + b, 0) / buffers.length) : null,
          ...(ZONDER_ALL ? { experiment: "zonder ALL-policy (in transactie, rollback)" } : {}),
          ...(fouten.length ? { eerste_fout: fouten[0] } : {}),
        };
        if (MET_PLAN) regel.plan = await explain(c, QUERIES[q], "tekst").catch((e) => `fout: ${e.message}`);
        console.log(JSON.stringify(regel));
      }
    }
  } finally {
    await db?.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
