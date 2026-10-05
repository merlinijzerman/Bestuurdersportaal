// ============================================================================
//  R1 (besluit 0218) — LOKALE pariteitsmeting zoek_chunks_begrensd ↔ zoek_chunks
//  op de PR0-fixture: 31 vragen × 6 varianten × fonds A/B × JWT 0,9/1,5 kB,
//  onder ECHTE RLS (rol authenticated), met de limiet van de app (30).
// ----------------------------------------------------------------------------
//  Vereist: lokale wegwerpstack met de migraties (incl. 2026_10_03_r1) en
//    psql $DB -v pr0_lokaal_ok=ja -f supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql
//  (optioneel …_fixture_b_match.sql voor stand b5000). Nooit tegen gehost:
//  alleen 127.0.0.1/localhost/host.docker.internal.
//
//  Tie-regel. De nieuwe functie heeft de tiebreaker `, c.id` (0218); de oude
//  niet. Per cel geldt daarom:
//    • de geordende (rang, chunk_index)-reeks is identiek;
//    • op posities waarvan (rang, chunk_index) uniek is, staat hetzelfde id;
//    • binnen een tie-groep die volledig binnen de limiet valt, is de id-set
//      gelijk en staat de nieuwe groep op id gesorteerd;
//    • valt de limiet (30) middenin een tie-groep (`grens_tie`), dan is de
//      id-set van die groep per constructie niet vergelijkbaar (de oude
//      functie kiest willekeurig binnen de groep); de groep wordt geteld en
//      alleen op (rang, chunk_index) vergeleken.
//  Uitvoer: tests/karakterisering/uitvoer/zoekpad-r1/pariteit-<stand>.json
//  Exit 1 bij één of meer afwijkingen.
//
//  Gebruik: node tests/karakterisering/zoekpad-r1-pariteit.mjs --pg <url> [--stand b0] [--limit 30]
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
const STAND = arg("stand", "b0");
const LIMIT = Number(arg("limit", "30"));
const UIT = arg("uit", "tests/karakterisering/uitvoer/zoekpad-r1");
if (!PG_URL) throw new Error("--pg <url> vereist");
{
  const host = new URL(PG_URL).hostname;
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) throw new Error(`geen lokale DB: ${host}`);
}
fs.mkdirSync(UIT, { recursive: true });

// Fixture-constanten (2026_10_03_pr0_zoekpad_fixture.sql).
const FONDS = { A: "00000000-0000-4000-a000-00000000000a", B: "00000000-0000-4000-a000-00000000000b" };
const USER = { A: "00000000-0000-4000-b000-00000000000a", B: "00000000-0000-4000-b000-00000000000b" };
const DOC = { reglementA: "00000000-0000-4000-d000-00000000a001", pw: "00000000-0000-4000-d000-00000000e001" };
const PEILDATUM = "2026-10-03";

// JWT-claimsets (identiek aan rls-505-meting.mjs / zoekpad-pr0-meting.mjs).
function claims(omvang, sub) {
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
    role: "authenticated", aal: "aal1", amr: [{ method: "oauth", timestamp: nu }],
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

// Dezelfde 31 vragen als zoekpad-pr0-meting.mjs.
const VRAGEN = [
  { naam: "bedoeling", vraag: "Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?", frase: '"artikel 150d" OR "art 150d"' },
  { naam: "norm", vraag: "Wat bepaalt artikel 150d Pensioenwet?", frase: '"artikel 150d" OR "art 150d"' },
  { naam: "gecombineerd", vraag: "Wat bepaalt artikel 150d Pensioenwet over het transitieplan en wat was volgens de memorie van toelichting de bedoeling daarvan?", frase: '"artikel 150d" OR "art 150d"' },
  { naam: "reglement", vraag: "Wat staat in artikel 5 van ons reglement?", frase: '"artikel 5"' },
  { naam: "r1", vraag: "Wat is er te vinden over pensioneren?" },
  { naam: "r2", vraag: "Wanneer kan ik met pensioen gaan?" },
  { naam: "r3", vraag: "Kan ik eerder met pensioen?" },
  { naam: "r4", vraag: "Wat gebeurt er bij pensionering?" },
  { naam: "r5", vraag: "Hoe werkt deeltijdpensioen?" },
  { naam: "r6", vraag: "Kan ik mijn pensioen uitstellen?" },
  { naam: "r7", vraag: "Kan ik partnerpensioen omzetten in ouderdomspensioen?" },
  { naam: "r8", vraag: "Kan ik eerst een hoger en daarna een lager pensioen krijgen?" },
  { naam: "r9", vraag: "Wat staat er in het reglement over stoppen met werken?" },
  { naam: "r10", vraag: "Welke hoofdstukken kent het pensioenreglement?" },
  { naam: "c1", vraag: "documenten met beleggingsbeleid ken je?" },
  { naam: "a1", vraag: "Hoe hoog is de premie dit jaar?" },
  { naam: "a2", vraag: "Wat is het beleggingsbeleid van het fonds?" },
  { naam: "a3", vraag: "Welke risico's loopt het fonds?" },
  { naam: "a4", vraag: "Hoe is het bestuur samengesteld?" },
  { naam: "a5", vraag: "Wat doet het verantwoordingsorgaan?" },
  { naam: "a6", vraag: "Wanneer is de volgende vergadering?" },
  { naam: "a7", vraag: "Hoe werkt de waardeoverdracht?" },
  { naam: "a8", vraag: "Wat is de dekkingsgraad eind vorig jaar?" },
  { naam: "a9", vraag: "Welke kosten brengt de uitvoerder in rekening?" },
  { naam: "a10", vraag: "Hoe wordt het rendement verdeeld over de cohorten?" },
  { naam: "a11", vraag: "Wat staat er in het communicatieplan?" },
  { naam: "a12", vraag: "Hoe is de solidariteitsreserve gevuld?" },
  { naam: "a13", vraag: "Welke besluiten zijn vorig jaar genomen?" },
  { naam: "a14", vraag: "Wat is het toezichtkader van DNB?" },
  { naam: "a15", vraag: "Hoe verloopt de implementatie van het nieuwe contract?" },
  { naam: "a16", vraag: "Welke informatie krijgt een deelnemer bij uitdiensttreding?" },
];
if (VRAGEN.length !== 31) throw new Error("vragenset ≠ 31");

function fraseVoor(v) {
  if (v.frase) return v.frase;
  const t = bouwTerugvalFtsQuery(v.vraag)?.termen ?? [];
  return t.length >= 2 ? `"${t[0]} ${t[1]}"` : `"${t[0] ?? "pensioen"}"`;
}
function variantParams(variant, v) {
  const basis = { query: v.vraag, scope: null, modus: "alles", peildatum: PEILDATUM, bronsoort: null };
  switch (variant) {
    case "strikt": return basis;
    case "verslapt": return { ...basis, query: bouwTerugvalFtsQuery(v.vraag)?.query ?? v.vraag };
    case "frase": return { ...basis, query: fraseVoor(v) };
    case "nul": return { ...basis, query: "zzqxv plonkzz" };
    case "scope": return { ...basis, scope: [DOC.reglementA, DOC.pw] };
    case "actueel": return { ...basis, modus: "actueel", bronsoort: ["fonds", "generiek"] };
    default: throw new Error(`onbekende variant ${variant}`);
  }
}
const VARIANTEN = ["strikt", "verslapt", "frase", "nul", "scope", "actueel"];

const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
const arr = (a, t) => (a == null ? "null" : `array[${a.map(lit).join(",")}]::${t}[]`);
function sql(fn, p, fonds) {
  return `select id, rang, chunk_index from public.${fn}(${lit(p.query)}, ${LIMIT}, ${arr(p.scope, "uuid")}, null, null, null, ${lit(p.modus)}, ${lit(p.peildatum)}::date, ${arr(p.bronsoort, "text")}, ${lit(fonds)}::uuid)`;
}

let db;
async function alsActor(c, fn) {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(c))}, true)`);
    await db.query("set local role authenticated");
    await db.query("set local statement_timeout = '120s'");
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

// Vergelijking volgens de tie-regel. Geeft { status, detail }.
function vergelijk(oud, nieuw) {
  const key = (r) => `${r.rang}|${r.chunk_index}`;
  if (oud.length !== nieuw.length) return { status: "afwijking", detail: `aantal ${oud.length} ≠ ${nieuw.length}` };
  for (let i = 0; i < oud.length; i++) {
    if (key(oud[i]) !== key(nieuw[i])) return { status: "afwijking", detail: `(rang, chunk_index) op positie ${i}: ${key(oud[i])} ≠ ${key(nieuw[i])}` };
  }
  // tie-groepen op de nieuwe reeks (identiek aan de oude).
  const groepen = new Map();
  nieuw.forEach((r, i) => { const k = key(r); if (!groepen.has(k)) groepen.set(k, []); groepen.get(k).push(i); });
  let grensTie = 0, ties = 0;
  for (const [, posities] of groepen) {
    // Een groep die op de laatste positie eindigt terwijl de limiet is bereikt,
    // kan buiten het venster doorlopen (ook als ze binnen het venster uit één
    // rij bestaat): de oude functie koos daar willekeurig. Alleen (rang,
    // chunk_index) telt dan — dat is hierboven al vergeleken.
    const aanGrens = posities[posities.length - 1] === nieuw.length - 1 && nieuw.length === LIMIT;
    if (posities.length === 1) {
      if (aanGrens) { grensTie++; continue; }
      const i = posities[0];
      if (oud[i].id !== nieuw[i].id) return { status: "afwijking", detail: `positie ${i} (geen tie): ${oud[i].id} ≠ ${nieuw[i].id}` };
      continue;
    }
    ties++;
    const nieuwIds = posities.map((i) => nieuw[i].id);
    const gesorteerd = [...nieuwIds].sort();
    if (JSON.stringify(nieuwIds) !== JSON.stringify(gesorteerd)) return { status: "afwijking", detail: `tie-groep niet op id gesorteerd in nieuw: ${nieuwIds.join(",")}` };
    if (aanGrens) { grensTie++; continue; }
    const oudIds = posities.map((i) => oud[i].id).sort();
    if (JSON.stringify(oudIds) !== JSON.stringify(gesorteerd)) return { status: "afwijking", detail: `tie-groep id-set verschilt: ${oudIds.join(",")} ≠ ${gesorteerd.join(",")}` };
  }
  return { status: grensTie ? "gelijk_grens_tie" : "gelijk", detail: { ties, grensTie, n: nieuw.length } };
}

async function main() {
  db = new pg.Client({ connectionString: PG_URL });
  await db.connect();
  await db.query("select set_config('pr0.lokaal_ok', 'ja', false)");
  const telling = { stand: STAND, limit: LIMIT, cellen: 0, gelijk: 0, gelijk_grens_tie: 0, afwijking: 0, fout: 0, met_ties: 0, leeg: 0 };
  const afwijkingen = [];
  const cellen = [];
  try {
    const info = (await db.query(`select (select count(*) from public.document_chunks where embedding_model like 'pr0-zoekpad%') chunks,
      (select count(*) from public.documenten where id::text like '00000000-0000-4000-d000-%') docs`)).rows[0];
    if (Number(info.chunks) < 25000) throw new Error(`PR0-fixture ontbreekt (${info.chunks} chunks)`);
    console.log(JSON.stringify({ stand: STAND, fixture: info }));
    for (const fonds of ["A", "B"]) {
      for (const jwt of ["09", "15"]) {
        const c = claims(jwt, USER[fonds]);
        for (const v of VRAGEN) {
          for (const variant of VARIANTEN) {
            const p = variantParams(variant, v);
            telling.cellen++;
            let r;
            try {
              const [oud, nieuw] = await alsActor(c, async () => [
                (await db.query(sql("zoek_chunks", p, FONDS[fonds]))).rows,
                (await db.query(sql("zoek_chunks_begrensd", p, FONDS[fonds]))).rows,
              ]);
              r = vergelijk(oud, nieuw);
              if (nieuw.length === 0) telling.leeg++;
              if (r.detail?.ties) telling.met_ties++;
            } catch (e) {
              r = { status: "fout", detail: String(e.message).slice(0, 200) };
            }
            telling[r.status === "fout" ? "fout" : r.status]++;
            const cel = { fonds, jwt, vraag: v.naam, variant, ...r };
            cellen.push(cel);
            if (r.status === "afwijking" || r.status === "fout") { afwijkingen.push(cel); console.log(JSON.stringify(cel)); }
          }
        }
      }
    }
  } finally {
    await db.end();
  }
  const uit = { ...telling, afwijkingen, cellen };
  fs.writeFileSync(path.join(UIT, `pariteit-${STAND}.json`), JSON.stringify(uit, null, 1));
  console.log(JSON.stringify(telling));
  if (afwijkingen.length) {
    console.error(`R1-pariteit: ${afwijkingen.length} afwijking(en)/fout(en)`);
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
