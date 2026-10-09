// ============================================================================
//  R1b B0 — LOKAAL MEETONDERZOEK hybride/vectorzoeken (geen CI, geen keuze).
//  Vergelijkt vectorarm-routes PER CEL (fonds × documentscope × vraagtype ×
//  route) t.o.v. een exacte referentie, onder de echte rol `authenticated`
//  met productie-realistische JWT-claims (vorm uit zoekpad-pr0-meting.mjs).
// ----------------------------------------------------------------------------
//  Vereist een lokale wegwerpstack met de migraties, daarna (elk met
//  `-v pr0_lokaal_ok=ja`; de bestanden dragen het PR0-guardblok):
//    psql $DB -f supabase/checks/2026_10_03_pr0_zoekpad_fixture.sql
//    psql $DB -f supabase/checks/2026_10_04_r1b_b0_prototypes.sql
//  (stand b5000: daarna …_pr0_zoekpad_fixture_b_match.sql).
//  Nooit tegen een gehoste omgeving: alleen 127.0.0.1/localhost/
//  host.docker.internal; bij het verbinden worden bovendien serveradres en
//  public.tenant_domains getoetst (zelfde heuristiek als het SQL-guardblok).
//
//  Routes (vectorarm; FTS-arm en RRF-fusie zijn voor alle hybride routes gelijk):
//    R0                 public.zoek_chunks_hybride (huidig; bufferbasis)
//    exact              referentie: exacte KNN op de toelaatbare set
//    hnsw_ef40/100/200  HNSW-geordende scan, filter erna
//    iter_{relaxed,strict}_{10k,40k}  hnsw.iterative_scan + max_scan_tuples
//    tweetraps_m4/m10   HNSW top (40·m), dan filter + exacte herordening
//    combi2_nul_<v>     (B0.5) als samen_combi_ef400_n9000, maar bij 0 FTS-rijen een
//                       strengere generieke variant: tw5/tw10 (tweetraps m 5/10),
//                       ef800, kd4000 (kandidaatdocumenten exact, ≤ 4000 chunks), exact
//    samen_combi_ef<E>_n<N> (B0.4) telling volledige set ≤ N ⇒ exact, anders de
//                       gesplitste arm (generiek HNSW ef E via de partiële index,
//                       fonds exact); E ∈ {200, 400}, N ∈ {6000, 9000}
//    samen_split_<gen>  (B0.3) GESPLITSTE vectorarm: generiek HNSW via de partiële
//                       index (ef40/ef100/ef200/iter40k; exactgen = bewijsvariant),
//                       fonds exact (vangrail N_exact 6000), samengevoegd op afstand
//    samen_<groot>_n<N> (B0.2) SAMENGESTELDE vectorarm: begrensde telling van de
//                       toelaatbare chunks; ≤ N ⇒ exact, anders <groot>
//                       (ef200 | tweetraps_m10 | iter_relaxed_40k); N = 2400 | 6000
//    r1_tekst           GEEN vectorarm: public.zoek_chunks_begrensd strikt →
//                       terugval (bouwTerugvalFtsQuery), zoals zoekViaFTS
//  Fasen (--fase, komma-gescheiden; default alles in deze volgorde):
//    kwaliteit   recall@40 (vectorarm vs exact), cruciale bronnen in de
//                gefuseerde top-10, lek-/filtercontrole (als postgres), 2 runs.
//    meting      warme beurten: per cel N runs × (primair, origineel, verslapt).
//    koud        eerste aanroep op een verse verbinding, met en zonder
//                gewiste shared buffers (pg_buffercache_evict; --admin).
//    beslis      (B0.2/B0.3) kosten van de beslisstap zelf (stap 1 + begrensde telling).
//    planbewijs  (B0.3) EXPLAIN (ANALYZE, BUFFERS) van beide armen als authenticated.
//    diagnose    (B0.5) per nul-treffercel/vraag/build: waarom valt een cruciale bron weg?
//    integriteit (B0.5) borgingsopties I1/I2/I3: regressie, triggersamenloop, drift.
//    borgingskosten (B0.5) ingest/herindexering/documentwissel met en zonder borging.
//    regressie07 (B0.7) één-write-varianten van I1: regressie, atomiciteit, drift.
//    wissel07    (B0.7) fysieke chunk-updates en kosten per bibliotheekwissel.
//                (B0.8: --opties07, --scenarios07, --label07 maken regressie07/wissel07
//                 herbruikbaar; default = de B0.7-run.)
//    telling08   (B0.8) NULL-/drift-telling document_id/bibliotheek op de fixture.
//    aanmaak08   (B0.8) lockbewuste aanmaakstappen document_id NOT NULL + uitgestelde FK.
//    commit08    (B0.8) ECHTE transacties met COMMIT (I1b_nn): geldige wissels, foutieve
//                chunk-updates, fout halverwege; vooraf vastgelegd herstelplan; data-md5
//                vóór/na. Muteert de lokale fixture tijdelijk en zet hem exact terug.
//    kosten06    (B0.6) I1/I2 vs controle, grote batches, ≥ 10 runs, gerandomiseerd.
//    aanmaak06   (B0.6) eenmalige aanmaakstappen I1 + lockniveaus.
//    catalogus   (B0.5) momentopname (--catalogus voor|na) voor het terugzetbewijs.
//    beslisplan  (B0.4) geneste plannen van de begrensde tellingen (auto_explain, --admin).
//    consistentie (B0.3) document_chunks.bibliotheek = documenten.bibliotheek?
//    schrijfkosten (B0.3) batch-insert/-update met en zonder partiële index.
//    curve       exact_klein: kosten exacte arm vs grootte toelaatbare set.
//    plannen     auto_explain van de functie-inhoud (--admin): idx_chunks_embedding?
//    guc         set_config('hnsw.*', …, true) als authenticated (vraag 6).
//    samenvatting  poorten per cel → samenvatting-<stand>.json + tabellen-<stand>.md
//  Opties:
//    --pg <url> (verplicht, rol postgres)  --admin <url> (superuser, lokaal supabase_admin)
//    --stand b0|b5000   --uit <dir> (default tests/karakterisering/uitvoer/zoekpad-r1b)
//    --runs <n> warme runs per cel (default 10)   --runs-r0 <n> (default 5)
//    --routes a,b,…   --fondsen A,B,G   --scopes geen,klein,middel
//    --typen pilot,regressie,algemeen,nul
//    --poort v1|v2  v1 = oorspronkelijke poorten; v2 (B0.2, besluit opdrachtgever):
//                   gouden passages informatief, buffers = waarschuwing, tijd geen
//                   poort; poort = recall@40 + cruciale top-3 + lek
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { bouwTerugvalFtsQuery } from "../../core/lib/fts-terugval.ts";

const arg = (naam, std) => {
  const i = process.argv.indexOf(`--${naam}`);
  return i > 0 ? process.argv[i + 1] : std;
};
const PG_URL = arg("pg");
const ADMIN_URL = arg("admin");
const STAND = arg("stand", "b0");
const UIT = arg("uit", "tests/karakterisering/uitvoer/zoekpad-r1b");
const RUNS = Number(arg("runs", "10"));
const RUNS_R0 = Number(arg("runs-r0", "5"));
const FASEN = arg("fase", "guc,kwaliteit,meting,koud,curve,plannen,samenvatting").split(",");
const ALLE_ROUTES = ["R0", "exact", "hnsw_ef40", "hnsw_ef100", "hnsw_ef200", "iter_relaxed_10k", "iter_relaxed_40k",
  "iter_strict_10k", "iter_strict_40k", "tweetraps_m4", "tweetraps_m10", "r1_tekst"];
const ROUTES = arg("routes", ALLE_ROUTES.join(",")).split(",");
const FONDSEN = arg("fondsen", "A,B,G").split(",");
const SCOPES = arg("scopes", "geen,klein,middel").split(",");
const TYPEN = arg("typen", "pilot,regressie,algemeen,nul").split(",");
const POORTVERSIE = arg("poort", "v1");
const R0_ALLE_VRAGEN = process.argv.includes("--r0-alle-vragen");
const ZONDER_VOLLEDIGE_INDEX = process.argv.includes("--zonder-volledige-index");
// B0.3: --bouw <k> herbouwt vóór de fasen idx_chunks_embedding én de partiële
// index (drop + create, als postgres, lokaal) en schrijft de kwaliteit naar
// kwaliteit-<stand>-bouw<k>.json; de samenvatting neemt per cel het SLECHTSTE
// resultaat over alle bouw-bestanden en telt in hoeveel builds de cel groen was.
const BOUW = arg("bouw", null);
const BESLIS = arg("beslis", "samen"); // samen | split | beide
const N_EXACT_WAARDEN = [2400, 6000];
if (!PG_URL) throw new Error("--pg <url> vereist");
for (const u of [PG_URL, ADMIN_URL].filter(Boolean)) {
  const host = new URL(u).hostname;
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) throw new Error(`geen lokale DB: ${host}`);
}
fs.mkdirSync(UIT, { recursive: true });

// ── Fixture-constanten (2026_10_03_pr0_zoekpad_fixture.sql) ─────────────────
const FONDS = { A: "00000000-0000-4000-a000-00000000000a", B: "00000000-0000-4000-a000-00000000000b" };
const USER = { A: "00000000-0000-4000-b000-00000000000a", B: "00000000-0000-4000-b000-00000000000b" };
const PEILDATUM = "2026-10-03";
const doc = (klasse, nr) => `00000000-0000-4000-d000-00000000${klasse}${String(nr).padStart(3, "0")}`;
const reeks = (klasse, van, tot) => Array.from({ length: tot - van + 1 }, (_, i) => doc(klasse, van + i));

// Actoren. Filterblok = het productieblok van de chatroute (PR0 variant
// "actueel"): modus actueel + peildatum + bronsoort + p_fonds_id = eigen fonds.
// G = generieke-bibliotheekvragen: gebruiker A met bronsoort alleen 'generiek'.
const ACTOREN = {
  A: { user: USER.A, fonds: FONDS.A, bronsoort: ["fonds", "generiek"] },
  B: { user: USER.B, fonds: FONDS.B, bronsoort: ["fonds", "generiek"] },
  G: { user: USER.A, fonds: FONDS.A, bronsoort: ["generiek"] },
};
// Documentscopes, deterministisch uit de fixture. klein = 2 documenten (PR0
// "reglement+pw"-vorm), middel = 10 documenten.
const SCOPE_DEF = {
  A: { geen: null, klein: [doc("a", 1), doc("e", 1)], middel: [doc("a", 1), ...reeks("e", 1, 4), ...reeks("a", 2, 6)] },
  B: { geen: null, klein: [doc("b", 1), doc("e", 1)], middel: [...reeks("b", 1, 5), ...reeks("e", 1, 5)] },
  G: { geen: null, klein: [doc("e", 1), doc("e", 2)], middel: reeks("e", 1, 10) },
};

// ── JWT-claimset 0,9 kB (identiek aan zoekpad-pr0-meting.mjs / rls-505) ─────
function claims(sub, role = "authenticated") {
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
  let i = 0;
  while (JSON.stringify(basis).length < 900 - 20) {
    basis.user_metadata.groups ??= [];
    basis.user_metadata.groups.push(`0000000${i % 10}-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`);
    i++;
  }
  return basis;
}

// ── Vragenset: PR0 (pilot/regressie/algemeen) + nul treffers ────────────────
const VRAGEN = [
  { type: "pilot", naam: "bedoeling", vraag: "Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?" },
  { type: "pilot", naam: "norm", vraag: "Wat bepaalt artikel 150d Pensioenwet?" },
  { type: "pilot", naam: "gecombineerd", vraag: "Wat bepaalt artikel 150d Pensioenwet over het transitieplan en wat was volgens de memorie van toelichting de bedoeling daarvan?" },
  { type: "pilot", naam: "reglement", vraag: "Wat staat in artikel 5 van ons reglement?" },
  { type: "regressie", naam: "r1", vraag: "Wat is er te vinden over pensioneren?" },
  { type: "regressie", naam: "r2", vraag: "Wanneer kan ik met pensioen gaan?" },
  { type: "regressie", naam: "r3", vraag: "Kan ik eerder met pensioen?" },
  { type: "regressie", naam: "r4", vraag: "Wat gebeurt er bij pensionering?" },
  { type: "regressie", naam: "r5", vraag: "Hoe werkt deeltijdpensioen?" },
  { type: "regressie", naam: "r6", vraag: "Kan ik mijn pensioen uitstellen?" },
  { type: "regressie", naam: "r7", vraag: "Kan ik partnerpensioen omzetten in ouderdomspensioen?" },
  { type: "regressie", naam: "r8", vraag: "Kan ik eerst een hoger en daarna een lager pensioen krijgen?" },
  { type: "regressie", naam: "r9", vraag: "Wat staat er in het reglement over stoppen met werken?" },
  { type: "regressie", naam: "r10", vraag: "Welke hoofdstukken kent het pensioenreglement?" },
  { type: "regressie", naam: "c1", vraag: "documenten met beleggingsbeleid ken je?" },
  { type: "algemeen", naam: "a1", vraag: "Hoe hoog is de premie dit jaar?" },
  { type: "algemeen", naam: "a2", vraag: "Wat is het beleggingsbeleid van het fonds?" },
  { type: "algemeen", naam: "a3", vraag: "Welke risico's loopt het fonds?" },
  { type: "algemeen", naam: "a4", vraag: "Hoe is het bestuur samengesteld?" },
  { type: "algemeen", naam: "a5", vraag: "Wat doet het verantwoordingsorgaan?" },
  { type: "algemeen", naam: "a6", vraag: "Wanneer is de volgende vergadering?" },
  { type: "algemeen", naam: "a7", vraag: "Hoe werkt de waardeoverdracht?" },
  { type: "algemeen", naam: "a8", vraag: "Wat is de dekkingsgraad eind vorig jaar?" },
  { type: "algemeen", naam: "a9", vraag: "Welke kosten brengt de uitvoerder in rekening?" },
  { type: "algemeen", naam: "a10", vraag: "Hoe wordt het rendement verdeeld over de cohorten?" },
  { type: "algemeen", naam: "a11", vraag: "Wat staat er in het communicatieplan?" },
  { type: "algemeen", naam: "a12", vraag: "Hoe is de solidariteitsreserve gevuld?" },
  { type: "algemeen", naam: "a13", vraag: "Welke besluiten zijn vorig jaar genomen?" },
  { type: "algemeen", naam: "a14", vraag: "Wat is het toezichtkader van DNB?" },
  { type: "algemeen", naam: "a15", vraag: "Hoe verloopt de implementatie van het nieuwe contract?" },
  { type: "algemeen", naam: "a16", vraag: "Welke informatie krijgt een deelnemer bij uitdiensttreding?" },
  { type: "nul", naam: "nul1", vraag: "zzqxv plonkzz" },
  { type: "nul", naam: "nul2", vraag: "qwxz vlorptrank blimbo" },
].filter((v) => TYPEN.includes(v.type));
const verslaptVoor = (v) => bouwTerugvalFtsQuery(v.vraag)?.query ?? v.vraag;

// Gelabelde gouden passages (pilot; artikelspoor-500-keten.mjs, in de PR0-
// fixture aanwezig): groep = één van de chunks volstaat.
const GOUDEN_GROEPEN = {
  pw150d: { document_id: doc("e", 1), chunk: (c) => [641, 642, 673, 674].includes(c.chunk_index) },
  mvt150d: { document_id: doc("e", 2), chunk: (c) => c.chunk_index >= 2396 && c.chunk_index <= 2400 },
  reglement_h5: { document_id: doc("a", 1), chunk: (c) => c.pagina >= 22 && c.pagina <= 29 },
};
const GOUDEN_PER_VRAAG = { bedoeling: ["mvt150d", "pw150d"], norm: ["pw150d"], gecombineerd: ["pw150d", "mvt150d"], reglement: ["reglement_h5"] };

// ── Routes ──────────────────────────────────────────────────────────────────
const ROUTE_DEF = {
  R0: { soort: "r0" },
  exact: { soort: "proto", route: "exact" },
  definitief: { soort: "definitief" },
  hnsw_ef40: { soort: "proto", route: "hnsw", ef: 40 },
  hnsw_ef100: { soort: "proto", route: "hnsw", ef: 100 },
  hnsw_ef200: { soort: "proto", route: "hnsw", ef: 200 },
  iter_relaxed_10k: { soort: "proto", route: "iter_relaxed", max: 10000 },
  iter_relaxed_40k: { soort: "proto", route: "iter_relaxed", max: 40000 },
  iter_strict_10k: { soort: "proto", route: "iter_strict", max: 10000 },
  iter_strict_40k: { soort: "proto", route: "iter_strict", max: 40000 },
  tweetraps_m4: { soort: "proto", route: "tweetraps", m: 4 },
  tweetraps_m10: { soort: "proto", route: "tweetraps", m: 10 },
  r1_tekst: { soort: "tekst" },
};
// B0.2 — samengestelde routes (één route, beslisregel in de functie).
for (const [naam, gen, extra] of [["ef40", "hnsw", { ef: 40 }], ["ef100", "hnsw", { ef: 100 }], ["ef200", "hnsw", { ef: 200 }],
  ["iter40k", "iter_relaxed", { max: 40000 }], ["exactgen", "exact", {}]]) {
  ROUTE_DEF[`samen_split_${naam}`] = { soort: "split", gen, n: 6000, ...extra };
}
for (const ef of [200, 400]) for (const n of [6000, 9000]) ROUTE_DEF[`samen_combi_ef${ef}_n${n}`] = { soort: "combi", n, ef };
for (const [naam, nul, np] of [["tw5", "tweetraps", 5], ["tw10", "tweetraps", 10], ["ef800", "hnsw", 800], ["kd4000", "kanddocs", 4000], ["exact", "exact", 0]])
  ROUTE_DEF[`combi2_nul_${naam}`] = { soort: "combi2", n: 9000, ef: 400, nul, np };
for (const n of N_EXACT_WAARDEN) {
  ROUTE_DEF[`samen_ef200_n${n}`] = { soort: "samen", n, groot: "hnsw", ef: 200 };
  ROUTE_DEF[`samen_tweetraps_m10_n${n}`] = { soort: "samen", n, groot: "tweetraps", m: 10 };
  ROUTE_DEF[`samen_iter_relaxed_40k_n${n}`] = { soort: "samen", n, groot: "iter_relaxed", max: 40000 };
}
for (const r of ROUTES) if (!ROUTE_DEF[r]) throw new Error(`onbekende route ${r}`);
// Aanroepen per beurt (zoals voerHybridePogingenUit / voerFtsPogingenUit).
const AANROEPEN = { hybride: ["primair", "origineel", "verslapt"], tekst: ["strikt", "terugval"] };
const aanroepenVoor = (route) => (ROUTE_DEF[route].soort === "tekst" ? AANROEPEN.tekst : AANROEPEN.hybride);

const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
const arr = (a, t) => (a == null ? "null" : `array[${a.map(lit).join(",")}]::${t}[]`);
const uuidLit = (u) => (u == null ? "null" : `${lit(u)}::uuid`);
const intLit = (n) => (n == null ? "null" : String(n));

// ── Querievectoren (deterministisch) ────────────────────────────────────────
// vq1/vq2/vq3 uit pr0_fixture.vragen. Extra vectoren = normalize(0,9·basis +
// 0,45·ruis), ruis uit een vaste PRNG per naam. Basis: regressie → vq1
// (onderwerp reglement A/Pensioenwet); algemeen → de embedding van chunk 7 van
// een vast document per vraag (wisselend a/e/b/c, dus wisselende onderwerpen,
// onafhankelijk van de actor); nul2 → vq3. "origineel" (M-R3) = de vraagvector
// met eigen ruis (de app embedt de originele vraag apart).
function prng(naam) {
  let a = createHash("sha256").update(naam).digest().readUInt32LE(0);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normaliseer = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
function verstoor(basis, naam) {
  const r = prng(naam);
  const ruis = normaliseer(basis.map(() => r() - 0.5));
  return normaliseer(basis.map((x, i) => 0.9 * x + 0.45 * ruis[i]));
}
const vecLit = (v) => `'[${v.map((x) => x.toPrecision(7)).join(",")}]'::public.vector(1024)`;
const parseVec = (t) => t.slice(1, -1).split(",").map(Number);
const VEC = {};       // naam → literal
const VEC_HERKOMST = {};
async function laadVectoren() {
  const basis = {};
  for (const r of (await db.query("select naam, embedding::text e from pr0_fixture.vragen")).rows) basis[r.naam] = parseVec(r.e);
  const algDocs = Array.from({ length: 16 }, (_, k) => ["a", "e", "b", "c"][k % 4]).map((kl, k) =>
    kl === "a" ? doc("a", 2 + k) : kl === "e" ? doc("e", 5 + k) : kl === "b" ? doc("b", 1 + k) : doc("c", 1 + (k % 12)));
  const chunkEmb = async (d) => parseVec((await db.query("select embedding::text e from public.document_chunks where document_id = $1 and chunk_index = 7", [d])).rows[0].e);
  const zet = (naam, v, herkomst) => { VEC[naam] = vecLit(v); VEC_HERKOMST[naam] = herkomst; };
  for (const v of VRAGEN) {
    let b, h;
    if (v.naam === "bedoeling") { b = basis.vq2; h = "vq2 (onderwerp MvT)"; }
    else if (v.type === "pilot") { b = basis.vq1; h = "vq1 (onderwerp Pensioenwet/reglement A)"; }
    else if (v.type === "regressie") { b = verstoor(basis.vq1, `reg:${v.naam}`); h = "verstoor(vq1)"; }
    else if (v.type === "algemeen") { const k = Number(v.naam.slice(1)) - 1; b = verstoor(await chunkEmb(algDocs[k]), `alg:${v.naam}`); h = `verstoor(chunk 7 van ${algDocs[k].slice(-4)})`; }
    else if (v.naam === "nul1") { b = basis.vq3; h = "vq3"; }
    else { b = verstoor(basis.vq3, `nul:${v.naam}`); h = "verstoor(vq3)"; }
    zet(`q:${v.naam}`, b, h);
    zet(`o:${v.naam}`, verstoor(b, `orig:${v.naam}`), `verstoor(${h}) — origineel`);
  }
  zet("vq1", basis.vq1, "vq1");
}

// ── SQL per aanroep ─────────────────────────────────────────────────────────
// p_limit 30 (PR0-harnas; de app gebruikt overFetch = max(3·maxResults, 20)),
// p_kandidaten 40, p_k 60.
function aanroepSql(route, actor, scope, query, vec) {
  const a = ACTOREN[actor], d = ROUTE_DEF[route];
  const sc = arr(scope, "uuid"), bs = arr(a.bronsoort, "text"), f = uuidLit(a.fonds), q = lit(query), dt = `${lit(PEILDATUM)}::date`;
  if (d.soort === "r0") return `select id, document_id, rang, fts_rang, vec_rang from public.zoek_chunks_hybride(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f})`;
  if (d.soort === "definitief") return `select id, document_id, rang, fts_rang, vec_rang from public.zoek_chunks_hybride_begrensd(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f})`;
  if (d.soort === "tekst") return `select id, document_id, rang, null::int as fts_rang, null::int as vec_rang from public.zoek_chunks_begrensd(${q}, 30, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f})`;
  if (d.soort === "combi2") return `select id, document_id, rang, fts_rang, vec_rang, pad, telling from r1b_proto.hybride_combi2(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f}, ${d.n}, ${d.ef}, ${lit(d.nul)}, ${d.np})`;
  if (d.soort === "combi") return `select id, document_id, rang, fts_rang, vec_rang, pad, telling from r1b_proto.hybride_combi(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f}, ${d.n}, ${d.ef})`;
  if (d.soort === "split") return `select id, document_id, rang, fts_rang, vec_rang, pad, telling from r1b_proto.hybride_split(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f}, ${lit(d.gen)}, ${d.n}, ${intLit(d.ef)}, ${intLit(d.max)})`;
  if (d.soort === "samen") return `select id, document_id, rang, fts_rang, vec_rang, pad, telling from r1b_proto.hybride_samen(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f}, ${d.n}, ${lit(d.groot)}, ${intLit(d.ef)}, ${intLit(d.max)}, ${intLit(d.m)})`;
  return `select id, document_id, rang, fts_rang, vec_rang from r1b_proto.hybride(${q}, ${vec}, 30, 40, 60, ${sc}, null, null, null, 'actueel', ${dt}, ${bs}, ${f}, ${lit(d.route)}, ${intLit(d.ef)}, ${intLit(d.max)}, ${intLit(d.m)})`;
}
function vecArmSql(route, actor, scope, vec, k = 40, query = null) {
  const a = ACTOREN[actor], d = ROUTE_DEF[route];
  // Met lege FTS-query levert p_limit=2*k alle vectorkandidaten terug;
  // vec_rang toont de werkelijke volgorde van de definitieve RPC.
  if (d.soort === "definitief") return `select id, document_id, 'definitief'::text as pad from public.zoek_chunks_hybride_begrensd('', ${vec}, ${2 * k}, ${k}, 60, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}) where vec_rang is not null order by vec_rang`;
  if (d.soort === "combi2") return `select id, document_id, pad from r1b_proto.vec_combi2(${lit(query)}, ${vec}, ${k}, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}, ${d.n}, ${d.ef}, ${lit(d.nul)}, ${d.np})`;
  if (d.soort === "combi") return `select id, document_id, pad from r1b_proto.vec_combi(${vec}, ${k}, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}, ${d.n}, ${d.ef})`;
  if (d.soort === "split") return `select id, document_id, pad from r1b_proto.vec_split(${vec}, ${k}, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}, ${lit(d.gen)}, ${d.n}, ${intLit(d.ef)}, ${intLit(d.max)})`;
  if (d.soort === "samen") return `select id, document_id, pad from r1b_proto.vec_arm_samen(${vec}, ${k}, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}, ${d.n}, ${lit(d.groot)}, ${intLit(d.ef)}, ${intLit(d.max)}, ${intLit(d.m)})`;
  return `select id, document_id from r1b_proto.vec_arm(${vec}, ${k}, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}, ${lit(d.route)}, ${intLit(d.ef)}, ${intLit(d.max)}, ${intLit(d.m)})`;
}
// Query en vector per aanroepsoort.
function aanroepParams(soort, v) {
  switch (soort) {
    case "primair": case "strikt": return { query: v.vraag, vec: VEC[`q:${v.naam}`] };
    case "origineel": return { query: v.vraag, vec: VEC[`o:${v.naam}`] };
    case "verslapt": case "terugval": return { query: verslaptVoor(v), vec: VEC[`q:${v.naam}`] };
    default: throw new Error(soort);
  }
}

// ── DB-hulp ─────────────────────────────────────────────────────────────────
let db;
async function verbind(url) {
  const c = new pg.Client({ connectionString: url, application_name: "zoekpad-r1b-b0" });
  await c.connect();
  // Lokaal-alleen, aan de serverkant getoetst (zelfde heuristiek als het
  // SQL-guardblok): loopback/docker/privé-adres en geen tenant-host.
  const { rows } = await c.query(`select inet_server_addr()::text addr,
      (inet_server_addr() is null or inet_server_addr() <<= inet '127.0.0.0/8' or inet_server_addr() = inet '::1'
       or inet_server_addr() <<= inet '172.16.0.0/12' or inet_server_addr() <<= inet '10.0.0.0/8'
       or inet_server_addr() <<= inet '192.168.0.0/16') as lokaal,
      exists (select 1 from public.tenant_domains where host like '%bestuurdersportaal.com') as tenant`);
  if (!rows[0].lokaal || rows[0].tenant) { await c.end(); throw new Error(`R1B-GUARD: geen lokale testomgeving (adres ${rows[0].addr}, tenant-host ${rows[0].tenant})`); }
  await c.query("select set_config('pr0.lokaal_ok', 'ja', false)");
  return c;
}
async function alsActor(c, actor, fn) {
  await c.query("begin");
  try {
    await c.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(claims(ACTOREN[actor].user)))}, true)`);
    await c.query("set local role authenticated");
    // Meetverdeling: 120 s (zoals PR0); de 8 s-grens van authenticated wordt
    // achteraf per aanroep getoetst (boven_8s).
    await c.query("set local statement_timeout = '120s'");
    return await fn();
  } finally {
    await c.query("rollback");
  }
}
async function explainAanroep(c, actor, sql) {
  return alsActor(c, actor, async () => {
    const t0 = process.hrtime.bigint();
    const { rows } = await c.query(`explain (analyze, buffers, timing off, format json) ${sql}`);
    const wand = Number(process.hrtime.bigint() - t0) / 1e6;
    const p = rows[0]["QUERY PLAN"][0];
    return {
      ms: r2(p["Execution Time"] + (p["Planning Time"] ?? 0)), ms_wand: r2(wand),
      buffers: (p.Plan["Shared Hit Blocks"] ?? 0) + (p.Plan["Shared Read Blocks"] ?? 0),
      gelezen: p.Plan["Shared Read Blocks"] ?? 0, rijen: p.Plan["Actual Rows"],
    };
  });
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const stat = (xs) => xs.length ? { n: xs.length, p50: r1(pct(xs, 50)), p95: r1(pct(xs, 95)), max: r1(Math.max(...xs)) } : { n: 0 };
const gem = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const celSleutel = (f, s, t) => `${f}/${s}/${t}`;
const schrijf = (naam, data) => fs.writeFileSync(path.join(UIT, naam), JSON.stringify(data, null, 1));
const leesJson = (naam) => { const p = path.join(UIT, naam); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };

// ── Grondwaarheid als postgres ──────────────────────────────────────────────
// CHUNKS: id → eigenaar + labels (lek- en goudcontrole). TOELAATBAAR: per
// (actor, scope) de chunks die RLS-zichtbaar zijn ALS DE ACTOR én door het
// volledige filterblok komen (op de ruwe kolommen, als postgres).
const CHUNKS = new Map();
const TOELAATBAAR = {};
async function laadGrondwaarheid() {
  const { rows } = await db.query(`select c.id, c.document_id, c.chunk_index, c.pagina, d.fonds_id, d.bibliotheek
                                     from public.document_chunks c join public.documenten d on d.id = c.document_id`);
  for (const r of rows) CHUNKS.set(r.id, r);
  for (const f of FONDSEN) {
    const zichtbaar = await alsActor(db, f, async () => (await db.query("select id from public.documenten")).rows.map((r) => r.id));
    for (const s of SCOPES) {
      const a = ACTOREN[f], scope = SCOPE_DEF[f][s];
      const { rows: ids } = await db.query(`
        select c.id from public.document_chunks c join public.documenten d on d.id = c.document_id
         where d.id = any($1::uuid[]) and d.actief = true
           and c.documentstatus is distinct from 'gearchiveerd'
           and ($2::uuid[] is null or c.document_id = any($2))
           and c.documentstatus in ('vastgesteld','van_kracht') and coalesce(c.bronstatus,'actief') = 'actief'
           and (c.geldig_vanaf is null or c.geldig_vanaf <= $3::date) and (c.geldig_tot is null or c.geldig_tot >= $3::date)
           and c.bibliotheek = any($4::text[])
           and (d.fonds_id = $5::uuid or c.bibliotheek = 'generiek')
           and (c.bibliotheek is distinct from 'generiek' or (c.documentstatus = 'van_kracht' and coalesce(c.bronstatus,'actief') = 'actief'
                and (d.volgende_review is null or d.volgende_review >= $3::date)))
           and c.embedding is not null`, [zichtbaar, scope, PEILDATUM, a.bronsoort, a.fonds]);
      TOELAATBAAR[`${f}/${s}`] = new Set(ids.map((r) => r.id));
    }
  }
}
function controleerIds(actor, scope, ids) {
  const a = ACTOREN[actor], ok = TOELAATBAAR[`${actor}/${scope}`];
  let lek = 0, buiten = 0;
  const lekIds = [];
  for (const id of ids) {
    const c = CHUNKS.get(id);
    if (!c || (c.bibliotheek !== "generiek" && c.fonds_id !== a.fonds)) { lek++; lekIds.push(id); }
    if (!ok.has(id)) buiten++;
  }
  return { lek, buiten, lekIds };
}

// ── Fase: guc (vraag 6) ─────────────────────────────────────────────────────
async function faseGuc() {
  const uit = {};
  // 1. Verse verbinding, set_config vóór enig vectorgebruik (pgvector nog
  //    niet geladen ⇒ placeholder-GUC), daarna een HNSW-scan: neemt de index
  //    de waarde over?
  const vers = await verbind(PG_URL);
  try {
    uit.verse_verbinding_placeholder = await alsActor(vers, "A", async () => {
      const voor = (await vers.query("select count(*)::int n from pg_settings where name like 'hnsw.%'")).rows[0].n;
      const zet = (await vers.query("select set_config('hnsw.ef_search', '5', true) a")).rows[0].a;
      await vers.query("select set_config('enable_seqscan','off',true), set_config('enable_bitmapscan','off',true), set_config('enable_sort','off',true)");
      const n = (await vers.query(`select count(*)::int n from (select c.id from public.document_chunks c where c.embedding is not null order by c.embedding <=> ${VEC.vq1} limit 40) x`)).rows[0].n;
      const na = (await vers.query("select current_setting('hnsw.ef_search') ef")).rows[0].ef;
      return { hnsw_gucs_in_pg_settings_voor: voor, set_config_resultaat: zet, rijen_hnsw_limit40: n, ef_search_na_laden: na, conclusie: n <= 5 ? "ef_search=5 werkte door na het laden van pgvector" : "ef_search=5 werkte NIET door" };
    });
  } finally { await vers.end(); }
  // 2. r1b_proto.guc_proef als authenticated (SECURITY INVOKER plpgsql,
  //    dynamische SQL), eerste aanroep op een verse verbinding.
  const vers2 = await verbind(PG_URL);
  try {
    uit.guc_proef_eerste_aanroep = await alsActor(vers2, "A", async () => (await vers2.query(`select stap, waarde from r1b_proto.guc_proef(${VEC.vq1})`)).rows);
    uit.guc_proef_tweede_aanroep = await alsActor(vers2, "A", async () => (await vers2.query(`select stap, waarde from r1b_proto.guc_proef(${VEC.vq1})`)).rows);
    // 3. Lekt een set_config(…, true) uit de functie naar de volgende transactie?
    uit.na_transactie = (await vers2.query("select current_setting('hnsw.ef_search') ef, current_setting('hnsw.iterative_scan') it, current_setting('enable_seqscan') seq")).rows[0];
    uit.pg_settings = (await vers2.query("select name, setting, context from pg_settings where name like 'hnsw.%' order by 1")).rows;
    uit.pgvector = (await vers2.query("select extversion from pg_extension where extname = 'vector'")).rows[0].extversion;
    uit.rolconfig_authenticated = (await vers2.query("select rolconfig from pg_roles where rolname = 'authenticated'")).rows[0].rolconfig;
  } finally { await vers2.end(); }
  schrijf(`guc-${STAND}.json`, uit);
  console.log(JSON.stringify({ fase: "guc", uit }, null, 1));
}

// ── Fase: kwaliteit ─────────────────────────────────────────────────────────
// Per route × actor × scope × vraag: de gefuseerde rijen van primair en
// verslapt (r1_tekst: strikt en terugval) en — hybride routes — de vectorarm.
// Twee runs (determinisme). R0 alleen voor pilotvragen (pariteitscontrole
// referentie ↔ huidige RPC; R0 is vooral de bufferbasis).
function beurtFusie(primair, verslapt) {
  // voerHybridePogingenUit + fuseerHybridePogingen: verslapt telt alleen mee
  // als de strikte poging geen enkele FTS-treffer had (moetHybrideVerslappen).
  const pogingen = [primair];
  if (primair.length > 0 && !primair.some((r) => r.fts_rang != null)) pogingen.push(verslapt);
  const beste = new Map();
  for (const p of pogingen) for (const r of p) if (!beste.has(r.id) || r.rang > beste.get(r.id).rang) beste.set(r.id, r);
  return [...beste.values()].sort((a, b) => b.rang - a.rang || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => r.id);
}
const tekstFusie = (strikt, terugval) => (strikt.length > 0 ? strikt : terugval).map((r) => r.id);
async function faseKwaliteit() {
  const ruw = fs.createWriteStream(path.join(UIT, `kwaliteit-${STAND}${BOUW ? `-bouw${BOUW}` : ""}.jsonl`));
  const res = {}; // route → cel/vraag → { top, primair, vec, det }
  const volgorde = ["exact", ...ROUTES.filter((r) => r !== "exact")];
  for (const route of volgorde) {
    res[route] = {};
    const t0 = Date.now();
    const d = ROUTE_DEF[route];
    for (const f of FONDSEN) for (const s of SCOPES) for (const v of VRAGEN) {
      if (route === "R0" && !R0_ALLE_VRAGEN && v.type !== "pilot") continue;
      const scope = SCOPE_DEF[f][s];
      const runs = route === "R0" ? 1 : 2;
      const uitRuns = [];
      for (let k = 0; k < runs; k++) {
        const rij = {};
        for (const soort of aanroepenVoor(route).filter((x) => x !== "origineel")) {
          const p = aanroepParams(soort, v);
          rij[soort] = await alsActor(db, f, async () => (await db.query(aanroepSql(route, f, scope, p.query, p.vec))).rows.map((r) => ({ id: r.id, rang: Number(r.rang), fts_rang: r.fts_rang })));
        }
        if (["proto", "samen", "split", "combi", "combi2", "definitief"].includes(d.soort)) {
          const rows = await alsActor(db, f, async () => (await db.query(vecArmSql(route, f, scope, VEC[`q:${v.naam}`], 40, v.vraag))).rows);
          rij.vec = rows.map((r) => r.id);
          if (["samen", "split", "combi", "combi2", "definitief"].includes(d.soort)) rij.pad = rows[0]?.pad ?? "leeg";
        }
        uitRuns.push(rij);
      }
      const eerste = uitRuns[0];
      const top = d.soort === "tekst" ? tekstFusie(eerste.strikt, eerste.terugval) : beurtFusie(eerste.primair, eerste.verslapt);
      const det = uitRuns.every((u) => JSON.stringify(u) === JSON.stringify(eerste));
      const alleIds = new Set([...Object.entries(eerste).filter(([k]) => k !== "pad").flatMap(([, x]) => x.map((r) => (typeof r === "string" ? r : r.id)))]);
      const ctl = controleerIds(f, s, alleIds);
      const vecRuns = ["proto", "samen", "split", "combi", "combi2", "definitief"].includes(d.soort) ? uitRuns.map((u) => u.vec) : null;
      const pad = ["samen", "split", "combi", "combi2", "definitief"].includes(d.soort) ? uitRuns.map((u) => u.pad) : null;
      const sleutel = `${f}/${s}/${v.naam}`;
      res[route][sleutel] = { type: v.type, top, primair: (eerste.primair ?? eerste.strikt).map((r) => r.id), vec: vecRuns, pad, det, ...ctl };
      ruw.write(JSON.stringify({ stand: STAND, route, cel: sleutel, top: top.slice(0, 10), vec: vecRuns?.[0], det, lek: ctl.lek, buiten: ctl.buiten }) + "\n");
    }
    console.log(JSON.stringify({ fase: "kwaliteit", route, s: Math.round((Date.now() - t0) / 1000) }));
  }
  ruw.end();
  // Evaluatie per cel t.o.v. de referentie (exact).
  const ref = res.exact;
  const uit = {};
  for (const route of volgorde) {
    uit[route] = {};
    for (const f of FONDSEN) for (const s of SCOPES) for (const t of TYPEN) {
      const vragen = VRAGEN.filter((v) => v.type === t);
      const cel = { vragen: 0, vec_runs: 0, vec_volgorde_identiek_aan_exact: 0, recall: [], vec_n_min: null, cruciaal_ok: 0, cruciaal_top3_ok: 0, paden: {}, cruciaal_ok_excl_ref_goud: 0, cruciaal_primair_ok: 0, missers: [], gouden: [], lek: 0, buiten_filter: 0, lek_ids: [], deterministisch: true, toelaatbaar_n: TOELAATBAAR[`${f}/${s}`].size, ...(route === "R0" ? { pariteit_top10_met_exact: 0 } : {}) };
      for (const v of vragen) {
        const k = `${f}/${s}/${v.naam}`;
        const r = res[route][k], rf = ref[k];
        if (!r) continue;
        cel.vragen++;
        cel.lek += r.lek; cel.buiten_filter += r.buiten; cel.lek_ids.push(...r.lekIds.slice(0, 5));
        cel.deterministisch &&= r.det;
        if (r.vec) {
          const exactSet = new Set(rf.vec[0]);
          for (const run of r.vec) {
            if (exactSet.size > 0) cel.recall.push(r3(run.filter((id) => exactSet.has(id)).length / exactSet.size));
            cel.vec_n_min = Math.min(cel.vec_n_min ?? Infinity, run.length);
            cel.vec_runs++;
            if (JSON.stringify(run) === JSON.stringify(rf.vec[0])) cel.vec_volgorde_identiek_aan_exact++;
          }
        }
        // Cruciale bronnen: top-3 van de referentiebeurt + gouden groepen die
        // in deze cel toelaatbaar zijn.
        const ok = TOELAATBAAR[`${f}/${s}`];
        const top10 = new Set(r.top.slice(0, 10)), prim10 = new Set(r.primair.slice(0, 10));
        const refTop3 = rf.top.slice(0, 3);
        const mistTop3 = refTop3.filter((id) => !top10.has(id));
        const mistTop3Prim = rf.primair.slice(0, 3).filter((id) => !prim10.has(id));
        const goudMis = [], goudMisOokRef = [];
        if (route === "R0" && JSON.stringify(r.top.slice(0, 10)) === JSON.stringify(rf.top.slice(0, 10))) cel.pariteit_top10_met_exact++;
        for (const g of GOUDEN_PER_VRAAG[v.naam] ?? []) {
          const G = GOUDEN_GROEPEN[g];
          const leden = [...ok].filter((id) => { const c = CHUNKS.get(id); return c.document_id === G.document_id && G.chunk(c); });
          if (leden.length === 0) { cel.gouden.push({ vraag: v.naam, groep: g, toepasbaar: false }); continue; }
          const inRoute = leden.some((id) => top10.has(id));
          const inRef = leden.some((id) => new Set(rf.top.slice(0, 10)).has(id));
          cel.gouden.push({ vraag: v.naam, groep: g, toepasbaar: true, in_top10: inRoute, in_referentie_top10: inRef });
          if (!inRoute) { goudMis.push(g); if (!inRef) goudMisOokRef.push(g); }
        }
        if (mistTop3.length === 0) cel.cruciaal_top3_ok++;
        for (const p of r.pad ?? []) cel.paden[p] = (cel.paden[p] ?? 0) + 1;
        if (mistTop3.length === 0 && goudMis.length === 0) cel.cruciaal_ok++;
        else cel.missers.push({ vraag: v.naam, mist_ref_top3: mistTop3.length, mist_gouden: goudMis, gouden_mist_ook_in_referentie: goudMisOokRef });
        // Variant voor de attributie: gouden passages die óók de referentie
        // niet in haar top-10 heeft, tellen hier niet mee (geen route-effect).
        if (mistTop3.length === 0 && goudMis.length === goudMisOokRef.length) cel.cruciaal_ok_excl_ref_goud++;
        if (mistTop3Prim.length === 0) cel.cruciaal_primair_ok++;
      }
      if (cel.vragen === 0) continue;
      const rs = cel.recall;
      cel.recall_stat = rs.length ? { n: rs.length, gem: r3(gem(rs)), p50: pct(rs, 50), min: Math.min(...rs) } : null;
      delete cel.recall;
      cel.lek_ids = [...new Set(cel.lek_ids)].slice(0, 5);
      uit[route][celSleutel(f, s, t)] = cel;
    }
  }
  schrijf(`kwaliteit-${STAND}${BOUW ? `-bouw${BOUW}` : ""}.json`, { stand: STAND, bouw: BOUW, vectoren: VEC_HERKOMST, routes: uit });
}

// ── Fase: meting (warm) ─────────────────────────────────────────────────────
// Per cel N runs; run r gebruikt vraag r mod |vragen van dat type|; elke run is
// een volledige beurt (alle aanroepen sequentieel, elk in een eigen transactie
// zoals een PostgREST-aanroep). De kwaliteitsfase loopt vooraf (warmt op).
async function faseMeting() {
  const ruw = fs.createWriteStream(path.join(UIT, `meting-${STAND}.jsonl`));
  const uit = {};
  for (const route of ROUTES) {
    uit[route] = {};
    const t0 = Date.now();
    for (const f of FONDSEN) for (const s of SCOPES) for (const t of TYPEN) {
      const vragen = VRAGEN.filter((v) => v.type === t);
      const n = route === "R0" ? RUNS_R0 : RUNS;
      const perAanroep = { ms: [], ms_wand: [], buffers: [] }, beurt2 = [], beurt3 = [], perSoort = {};
      let boven8s = 0, fouten = 0, eersteFout = null;
      for (let k = 0; k < n; k++) {
        const v = vragen[k % vragen.length];
        const beurt = {};
        for (const soort of aanroepenVoor(route)) {
          const p = aanroepParams(soort, v);
          try {
            const r = await explainAanroep(db, f, aanroepSql(route, f, SCOPE_DEF[f][s], p.query, p.vec));
            beurt[soort] = r;
            perAanroep.ms.push(r.ms); perAanroep.ms_wand.push(r.ms_wand); perAanroep.buffers.push(r.buffers);
            (perSoort[soort] ??= []).push(r.buffers);
            if (r.ms_wand > 8000) boven8s++;
            ruw.write(JSON.stringify({ stand: STAND, route, cel: celSleutel(f, s, t), vraag: v.naam, run: k, soort, ...r }) + "\n");
          } catch (e) {
            fouten++; eersteFout ??= String(e.message).slice(0, 200);
          }
        }
        const som = (ks) => (ks.every((x) => beurt[x]) ? ks.reduce((a, x) => a + beurt[x].ms_wand, 0) : null);
        const b2 = route === "r1_tekst" ? som(["strikt", "terugval"]) : som(["primair", "verslapt"]);
        const b3 = route === "r1_tekst" ? null : som(["primair", "origineel", "verslapt"]);
        if (b2 != null) beurt2.push(b2);
        if (b3 != null) beurt3.push(b3);
      }
      uit[route][celSleutel(f, s, t)] = {
        aanroep_ms: stat(perAanroep.ms), aanroep_ms_wand: stat(perAanroep.ms_wand),
        buffers_gem: Math.round(gem(perAanroep.buffers)), buffers_max: Math.max(...perAanroep.buffers),
        buffers_per_soort: Object.fromEntries(Object.entries(perSoort).map(([k, xs]) => [k, Math.round(gem(xs))])),
        beurt2_ms_wand: stat(beurt2), beurt3_ms_wand: stat(beurt3), boven_8s: boven8s, fouten, ...(eersteFout ? { eerste_fout: eersteFout } : {}),
      };
    }
    console.log(JSON.stringify({ fase: "meting", route, s: Math.round((Date.now() - t0) / 1000) }));
    schrijf(`meting-${STAND}.json`, { stand: STAND, runs: RUNS, runs_r0: RUNS_R0, routes: uit });
  }
  ruw.end();
}

// ── Fase: koud ──────────────────────────────────────────────────────────────
// Per route zes representatieve cellen, elk twee keer: (1) verbinding_koud —
// verse verbinding (lege plan-/catalogcaches in de backend), shared buffers
// warm; (2) buffer_koud — eerst ALLE shared buffers van deze database gewist
// (pg_buffercache_evict, superuser), dan een verse verbinding. De OS-paginacache
// in de Docker-VM blijft warm: "gelezen" blokken komen uit het RAM, niet van
// schijf (beperking, zie rapport).
const KOUDE_CELLEN = [["A", "geen", "norm"], ["A", "klein", "reglement"], ["A", "middel", "bedoeling"], ["B", "geen", "r2"], ["G", "geen", "bedoeling"], ["A", "geen", "nul1"]];
let admin;
async function wisBuffers() {
  const { rows } = await admin.query(`select count(*) filter (where pg_buffercache_evict(bufferid))::int as gewist
                                        from pg_buffercache where reldatabase = (select oid from pg_database where datname = current_database())`);
  return rows[0].gewist;
}
async function faseKoud() {
  if (!admin) { console.log("koud: --admin ontbreekt, overgeslagen"); return; }
  const uit = {};
  for (const route of ROUTES) {
    uit[route] = [];
    for (const [f, s, vn] of KOUDE_CELLEN) {
      const v = VRAGEN.find((x) => x.naam === vn);
      if (!v || !FONDSEN.includes(f) || !SCOPES.includes(s)) continue;
      for (const soortKoud of ["verbinding_koud", "buffer_koud"]) {
        const gewist = soortKoud === "buffer_koud" ? await wisBuffers() : 0;
        const c = await verbind(PG_URL);
        const aanroepen = [];
        try {
          for (const soort of aanroepenVoor(route)) {
            const p = aanroepParams(soort, v);
            aanroepen.push({ soort, ...(await explainAanroep(c, f, aanroepSql(route, f, SCOPE_DEF[f][s], p.query, p.vec))) });
          }
        } finally { await c.end(); }
        const sel = route === "r1_tekst" ? aanroepen : aanroepen;
        uit[route].push({ cel: `${f}/${s}`, vraag: vn, koud: soortKoud, gewiste_buffers: gewist, aanroepen,
          beurt2_ms_wand: r1(sel.filter((a) => a.soort !== "origineel").reduce((x, a) => x + a.ms_wand, 0)),
          beurt3_ms_wand: route === "r1_tekst" ? null : r1(sel.reduce((x, a) => x + a.ms_wand, 0)) });
      }
    }
    console.log(JSON.stringify({ fase: "koud", route, eerste_aanroep_ms_wand: uit[route].map((x) => x.aanroepen[0].ms_wand) }));
  }
  schrijf(`koud-${STAND}.json`, { stand: STAND, cellen: KOUDE_CELLEN, routes: uit });
}

// ── Fase: beslis (B0.2) — kosten van de beslisstap zelf ──────────────────────
// r1b_proto.beslis = stap 1 + begrensde telling (≤ N_exact + 1 rijen via
// idx_chunks_document). Per actor × scope × N_exact: 10 warm, 2 buffer-koud.
async function faseBeslis() {
  const uit = [];
  const varianten = BESLIS === "combi" ? [["combi", 6000], ["combi", 9000], ["split", 6000]]
    : [...(BESLIS !== "split" ? N_EXACT_WAARDEN.map((n) => ["samen", n]) : []), ...(BESLIS !== "samen" ? [["split", 6000]] : [])];
  for (const [soort, n] of varianten) for (const f of FONDSEN) for (const s of SCOPES) {
    const a = ACTOREN[f];
    const sql = `select * from r1b_proto.${{ split: "beslis_split", combi: "beslis_combi", samen: "beslis" }[soort]}(${n}, ${arr(SCOPE_DEF[f][s], "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)})`;
    const uitkomst = await alsActor(db, f, async () => (await db.query(sql)).rows[0]);
    const warm = [], koud = [];
    for (let k = 0; k < 10; k++) warm.push(await explainAanroep(db, f, sql));
    if (admin) for (let k = 0; k < 2; k++) {
      await wisBuffers();
      const c = await verbind(PG_URL);
      try { koud.push(await explainAanroep(c, f, sql)); } finally { await c.end(); }
    }
    const regel = { beslisstap: soort, n_exact: n, cel: `${f}/${s}`, toelaatbaar_n: TOELAATBAAR[`${f}/${s}`]?.size, telling: uitkomst.telling, ...(uitkomst.telling_fonds != null ? { telling_fonds: uitkomst.telling_fonds } : {}), pad: uitkomst.pad,
      warm_ms: stat(warm.map((x) => x.ms_wand)), warm_buffers: Math.round(gem(warm.map((x) => x.buffers))),
      koud_ms: stat(koud.map((x) => x.ms_wand)), koud_buffers: koud.length ? Math.round(gem(koud.map((x) => x.buffers))) : null,
      koud_gelezen: koud.length ? Math.round(gem(koud.map((x) => x.gelezen))) : null };
    uit.push(regel);
    console.log(JSON.stringify({ fase: "beslis", ...regel }));
  }
  schrijf(`beslis-${STAND}.json`, { stand: STAND, punten: uit });
}

// ── B0.3: HNSW-indexen opnieuw bouwen (drop + create, lokaal) ───────────────
// Beide indexen met hun eigen definitie (pg_indexes.indexdef) — de partiële
// staat in 2026_10_04_r1b_b0_prototypes.sql. Bouwtijd en grootte per build.
const PARTIEEL = "idx_r1b_chunks_embedding_generiek";
async function herbouwIndexen() {
  const uit = { bouw: BOUW, stand: STAND, maintenance_work_mem: (await db.query("show maintenance_work_mem")).rows[0].maintenance_work_mem, indexen: {} };
  const namen = ZONDER_VOLLEDIGE_INDEX
    ? ["idx_chunks_embedding_generiek_r1b"]
    : ["idx_chunks_embedding", PARTIEEL];
  for (const naam of namen) {
    const { rows } = await db.query("select indexdef from pg_indexes where schemaname = 'public' and indexname = $1", [naam]);
    if (!rows.length) throw new Error(`index ${naam} ontbreekt — eerst de prototypes toepassen`);
    await db.query(`drop index public.${naam}`);
    const t0 = process.hrtime.bigint();
    await db.query(rows[0].indexdef);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const g = (await db.query("select pg_relation_size(('public.' || $1)::regclass)::bigint b, (select reltuples from pg_class where oid = ('public.' || $1)::regclass) t", [naam])).rows[0];
    uit.indexen[naam] = { indexdef: rows[0].indexdef, bouw_ms: Math.round(ms), bytes: Number(g.b), mb: r1(Number(g.b) / 1048576), tuples: Number(g.t) };
  }
  await db.query("analyze public.document_chunks");
  schrijf(`bouw-${STAND}-${BOUW}.json`, uit);
  console.log(JSON.stringify({ fase: "bouw", partieel: uit.indexen[PARTIEEL] ?? uit.indexen.idx_chunks_embedding_generiek_r1b,
    volledig: uit.indexen.idx_chunks_embedding ?? null }));
}

// ── B0.3: planbewijs — EXPLAIN (ANALYZE, BUFFERS) als authenticated ─────────
// Beide armen als losse query met letterlijke predicaten (zoals de dynamische
// SQL ze uitvoert), onder RLS: de generieke arm moet de PARTIËLE index
// gebruiken, de fondsarm géén HNSW, en de RLS-InitPlans moeten in het plan staan.
async function fasePlanbewijs() {
  const tekst = [], bewijs = {};
  for (const [f, s] of [["A", "geen"], ["B", "geen"], ["A", "klein"], ["G", "geen"]]) {
    if (!FONDSEN.includes(f)) continue;
    const a = ACTOREN[f], scope = SCOPE_DEF[f][s];
    const blok = `c.embedding is not null
        and c.document_id = any (array(select d.id from public.documenten d where d.actief = true ${scope ? `and d.id = any(${arr(scope, "uuid")})` : ""}))
        and c.documentstatus is distinct from 'gearchiveerd'
        and c.documentstatus in ('vastgesteld','van_kracht') and coalesce(c.bronstatus,'actief') = 'actief'
        and (c.geldig_vanaf is null or c.geldig_vanaf <= '${PEILDATUM}') and (c.geldig_tot is null or c.geldig_tot >= '${PEILDATUM}')
        and c.bibliotheek = any(${arr(a.bronsoort, "text")})`;
    const gen = `select c.id from public.document_chunks c where c.bibliotheek = 'generiek' and ${blok}
        and c.documentstatus = 'van_kracht' order by c.embedding <=> ${VEC.vq1}, c.id limit 40`;
    const fonds = `select c.id from public.document_chunks c where c.bibliotheek = 'fonds' and ${blok}
        and exists (select 1 from public.documenten d where d.id = c.document_id and d.fonds_id = ${uuidLit(a.fonds)})
        order by (c.embedding <=> ${VEC.vq1}) + 0, c.id limit 40`;
    for (const [arm, sql] of [["generiek", gen], ["fonds", fonds]]) {
      const plan = await alsActor(db, f, async () => {
        if (arm === "generiek") await db.query("select set_config('enable_seqscan','off',true), set_config('enable_bitmapscan','off',true), set_config('enable_sort','off',true), set_config('hnsw.ef_search','100',true)");
        return (await db.query(`explain (analyze, buffers) ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
      });
      const k = `${f}/${s}/${arm}`;
      bewijs[k] = { partiele_index: plan.includes(PARTIEEL), volledige_hnsw: /idx_chunks_embedding\b/.test(plan),
        rls_initplan: /InitPlan|SubPlan/.test(plan), rls_filter_auth: /auth\.uid|profielen|fonds_id/.test(plan) };
      tekst.push(`==== ${k} (stand ${STAND}, rol authenticated, JWT gebruiker ${f === "B" ? "B" : "A"}) ====\n${plan.replace(/'\[-?\d[^\]]{200,}\]'(::[a-z.()0-9]+)?/g, "'[…vector…]'")}\n`);
    }
  }
  fs.writeFileSync(path.join(UIT, `planbewijs-${STAND}.txt`), tekst.join("\n"));
  schrijf(`planbewijs-${STAND}.json`, bewijs);
  console.log(JSON.stringify({ fase: "planbewijs", bewijs }));
}

// ── B0.5 deel 1a: diagnose van de nul-treffercellen ─────────────────────────
// Per cel (A/B/G zonder scope, vraagtype nul), per vraag, in de huidige build:
// welke bronnen uit de top-3 van de referentiebeurt ontbreken in de top-10 van
// de leidende kandidaat (samen_combi_ef400_n9000), op welke rang ze in de
// exacte vectorarm staan, of ze in de HNSW-kandidatenlijst van de generieke arm
// zaten (top-40 bij ef 400, en de volledige ef-400-lijst), of ze fondsbronnen
// zijn, en of de FTS-arm leeg was.
const DIAG_ROUTE = arg("diagroute", "samen_combi_ef400_n9000");
const DIAG_TYPEN = arg("diagtypen", "nul").split(",");
async function faseDiagnose() {
  const uit = [];
  const vragen = VRAGEN.filter((v) => DIAG_TYPEN.includes(v.type));
  for (const f of ["A", "B", "G"].filter((x) => FONDSEN.includes(x))) {
    const a = ACTOREN[f], scope = SCOPE_DEF[f].geen;
    for (const v of vragen) {
      const vec = VEC[`q:${v.naam}`];
      const r = await alsActor(db, f, async () => {
        const rij = async (route, soort) => { const p = aanroepParams(soort, v); return (await db.query(aanroepSql(route, f, scope, p.query, p.vec))).rows.map((x) => ({ id: x.id, rang: Number(x.rang), fts_rang: x.fts_rang })); };
        const refP = await rij("exact", "primair"), refV = await rij("exact", "verslapt");
        const rouP = await rij(DIAG_ROUTE, "primair"), rouV = await rij(DIAG_ROUTE, "verslapt");
        const exactVec = (await db.query(vecArmSql("exact", f, scope, vec))).rows.map((x) => x.id);
        const routeVec = (await db.query(vecArmSql(DIAG_ROUTE, f, scope, vec, 40, v.vraag))).rows;
        const gen = async (k, route, ef) => (await db.query(`select k.id from r1b_proto.stap1(${arr(scope, "uuid")}, ${uuidLit(a.fonds)}, ${lit(PEILDATUM)}::date) s,
            lateral r1b_proto.split_kandidaten(${vec}, ${k}, 'generiek', ${lit(route)}, s.docs, s.fonds_ok, s.review_ok, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)}, ${intLit(ef)}, null) k`)).rows.map((x) => x.id);
        return { refP, refV, rouP, rouV, exactVec, routeVec, genH40: await gen(40, "hnsw", 400), genH400: await gen(400, "hnsw", 400), genE40: await gen(40, "exact", null) };
      });
      const refTop3 = beurtFusie(r.refP, r.refV).slice(0, 3);
      const rouTop10 = beurtFusie(r.rouP, r.rouV).slice(0, 10);
      const pos = (lijst, id) => { const i = lijst.indexOf(id); return i < 0 ? null : i + 1; };
      const bronnen = refTop3.map((id) => {
        const c = CHUNKS.get(id);
        const p = { bron: id, bibliotheek: c?.bibliotheek, document: c?.document_id?.slice(-4), chunk_index: c?.chunk_index,
          in_route_top10: rouTop10.includes(id), exacte_vectorrang: pos(r.exactVec, id), routevector_pos: pos(r.routeVec.map((x) => x.id), id),
          gen_hnsw_top40_pos: pos(r.genH40, id), gen_hnsw_ef400_lijst_pos: pos(r.genH400, id), gen_exact_top40_pos: pos(r.genE40, id) };
        p.categorie = p.in_route_top10 ? "aanwezig"
          : c?.bibliotheek === "fonds" ? (p.routevector_pos ? "rangverschil in fusie (fondsbron)" : "samenvoegfout (fondsbron ontbreekt)")
          : p.gen_hnsw_ef400_lijst_pos == null ? "HNSW-graaf mist bron (niet in de ef-400-kandidatenlijst)"
          : p.gen_hnsw_top40_pos == null ? "bron in HNSW-lijst maar buiten top-40"
          : p.routevector_pos == null ? "samenvoegfout (generieke bron ontbreekt na samenvoegen)"
          : "rangverschil in fusie";
        return p;
      });
      const regel = { stand: STAND, bouw: BOUW ?? arg("bouwlabel", null), route: DIAG_ROUTE, cel: `${f}/geen/${v.type}`, vraag: v.naam,
        fts_leeg: [...r.refP, ...r.refV].every((x) => x.fts_rang == null),
        pad: r.routeVec[0]?.pad ?? "leeg", routevector_n: r.routeVec.length, gen_hnsw_top40_n: r.genH40.length, gen_hnsw_ef400_n: r.genH400.length,
        gen_hnsw_recall_tov_gen_exact: r.genE40.length ? r3(r.genH40.filter((id) => r.genE40.includes(id)).length / r.genE40.length) : null,
        top3_ontbreekt: bronnen.filter((b) => !b.in_route_top10).length, bronnen };
      uit.push(regel);
      console.log(JSON.stringify({ fase: "diagnose", cel: regel.cel, vraag: v.naam, bouw: BOUW, ontbreekt: regel.top3_ontbreekt, categorieen: bronnen.map((b) => b.categorie) }));
    }
  }
  const bl = BOUW ?? arg("bouwlabel", null);
  schrijf(`diagnose-${STAND}${bl ? `-bouw${bl}` : ""}${DIAG_TYPEN.join("") === "nul" ? "" : `-${DIAG_TYPEN.join("+")}`}${DIAG_ROUTE === "samen_combi_ef400_n9000" ? "" : `-${DIAG_ROUTE}`}.json`, uit);
}

// ── B0.5 deel 2: integriteitsborging — regressie, samenloop, drift ─────────
// Alles in transacties met ROLLBACK. De DDL staat in het prototypebestand
// (r1b_proto.borging_aan, achter het guardblok).
// Deze kopie draait uitsluitend kwaliteit/schrijfkosten; de B0.5-driftfase
// hoort bij het oorspronkelijke onderzoeksmeetharnas.
const DRIFT_SQL = fs.existsSync("supabase/checks/2026_10_05_r1b_bibliotheek_drift.sql")
  ? fs.readFileSync("supabase/checks/2026_10_05_r1b_bibliotheek_drift.sql", "utf8") : null;
async function probeer(rol, sql, metClaims = null) {
  await db.query("savepoint p");
  try {
    if (rol !== "postgres") await db.query(`set local role ${rol}`);
    if (metClaims) await db.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(metClaims))}, true)`);
    const r = await db.query(sql);
    return { uitkomst: "toegestaan", rijen: r.rowCount };
  } catch (e) {
    return { uitkomst: "geweigerd", sqlstate: e.code, melding: String(e.message).slice(0, 160) };
  } finally {
    await db.query("rollback to savepoint p");
  }
}
async function faseIntegriteit() {
  const uit = { stand: STAND };
  const q1 = async (s) => (await db.query(s)).rows[0];
  uit.data = await q1(`select
      (select is_nullable from information_schema.columns where table_schema='public' and table_name='documenten' and column_name='bibliotheek') documenten_bibliotheek_nullable,
      (select is_nullable from information_schema.columns where table_schema='public' and table_name='document_chunks' and column_name='bibliotheek') chunks_bibliotheek_nullable,
      (select count(*) from public.documenten where bibliotheek is null)::int documenten_null,
      (select count(*) from public.document_chunks where bibliotheek is null)::int chunks_null,
      (select count(*) from public.document_chunks c join public.documenten d on d.id = c.document_id where c.bibliotheek is distinct from d.bibliotheek)::int afwijkend,
      (select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end, ', ') from pg_proc p
        where p.proname in ('fn_chunk_denorm_refresh', 'fn_chunk_denorm_before_insert', 'fn_chunk_denorm') and p.pronamespace = 'public'::regnamespace) denorm_functies`);
  const chunkA = (await q1(`select id from public.document_chunks where document_id = ${uuidLit(doc("a", 2))} order by chunk_index limit 1`)).id;
  const cA = claims(USER.A);
  const tests = {
    fonds_chunk_naar_generiek: [ "authenticated", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA)}`, cA ],
    fonds_chunk_verhangen_naar_generiek_doc: [ "authenticated", `update public.document_chunks set document_id = ${uuidLit(doc("e", 5))} where id = ${uuidLit(chunkA)}`, cA ],
    fonds_chunk_verhangen_plus_bibliotheek: [ "authenticated", `update public.document_chunks set document_id = ${uuidLit(doc("e", 5))}, bibliotheek = 'generiek' where id = ${uuidLit(chunkA)}`, cA ],
    service_chunk_naar_generiek: [ "service_role", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA)}`, { role: "service_role" } ],
    service_chunk_verhangen_naar_generiek_doc: [ "service_role", `update public.document_chunks set document_id = ${uuidLit(doc("e", 5))} where id = ${uuidLit(chunkA)}`, { role: "service_role" } ],
    legitiem_fonds_herindexering: [ "authenticated", `update public.document_chunks set embedding = embedding, embedding_model = 'r1b-test' where id = ${uuidLit(chunkA)}`, cA ],
    legitiem_fonds_markeer_overgeslagen: [ "authenticated", `update public.document_chunks set indexering_versie = 'r1b-test' where document_id = ${uuidLit(doc("a", 2))}`, cA ],
    fonds_documentwijziging_eigen_doc: [ "authenticated", `update public.documenten set documentdatum = coalesce(documentdatum, date '2026-01-01') + 1 where id = ${uuidLit(doc("a", 2))}`, cA ],
    postgres_insert_zonder_bibliotheek: [ "postgres", `insert into public.document_chunks (document_id, chunk_index, tekst, embedding_model) values (${uuidLit(doc("a", 2))}, 999001, 'r1b test', 'r1b-test')`, null ],
  };
  uit.opties = {};
  for (const optie of ["geen", "I1", "I2", "I3"]) {
    await db.query("begin");
    try {
      const t0 = process.hrtime.bigint();
      const aan = (await db.query("select r1b_proto.borging_aan($1) a", [optie])).rows[0].a;
      const ms = r1(Number(process.hrtime.bigint() - t0) / 1e6);
      const res = {};
      for (const [naam, [rol, sql, c]] of Object.entries(tests)) res[naam] = await probeer(rol, sql, c);
      // Samenloop: documentwissel fonds → generiek (cascade/refresh/triggers).
      await db.query("savepoint s");
      try {
        const p = (await db.query(`explain (analyze, buffers, format json) update public.documenten set bibliotheek = 'generiek', fonds_id = null where id = ${uuidLit(doc("a", 10))}`)).rows[0]["QUERY PLAN"][0];
        const na = (await db.query(`select count(*) filter (where bibliotheek = 'generiek')::int generiek, count(*)::int n from public.document_chunks where document_id = ${uuidLit(doc("a", 10))}`)).rows[0];
        res.samenloop_documentwissel = { uitkomst: "toegestaan", triggers: (p.Triggers ?? []).map((t) => ({ naam: t["Trigger Name"], relatie: t.Relation, aanroepen: t.Calls, ms: r1(t.Time) })), chunks_na: na };
      } catch (e) {
        res.samenloop_documentwissel = { uitkomst: "geweigerd", sqlstate: e.code, melding: String(e.message).slice(0, 200) };
      } finally { await db.query("rollback to savepoint s"); }
      uit.opties[optie] = { borging: aan, aanmaak_ms: ms, tests: res };
    } finally { await db.query("rollback"); }
    console.log(JSON.stringify({ fase: "integriteit", optie, uitkomsten: Object.fromEntries(Object.entries(uit.opties[optie].tests).map(([k, x]) => [k, x.uitkomst + (x.sqlstate ? `:${x.sqlstate}` : "")])) }));
  }
  // Driftcontrole: schoon ⇒ notice; met een geïnjecteerde afwijking (zonder
  // borging, in een transactie) ⇒ exception; daarna rollback.
  const drift = async (injectie) => {
    await db.query("begin");
    try {
      if (injectie) await db.query(injectie);
      const meldingen = [];
      const h = (n) => meldingen.push(n.message);
      db.on("notice", h);
      try { await db.query(DRIFT_SQL); return { uitkomst: "schoon", melding: meldingen.join(" ") }; }
      catch (e) { return { uitkomst: "gevonden", sqlstate: e.code, melding: e.message }; }
      finally { db.off("notice", h); }
    } finally { await db.query("rollback"); }
  };
  uit.drift = {
    schoon: await drift(null),
    injectie_afwijkend: await drift(`update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA)}`),
    injectie_null: await drift(`update public.document_chunks set bibliotheek = null where id = ${uuidLit(chunkA)}`),
  };
  console.log(JSON.stringify({ fase: "drift", drift: uit.drift }));
  schrijf(`integriteit-${STAND}.json`, uit);
}

// ── B0.5 deel 2d: kosten met en zonder borging ──────────────────────────────
// Per optie × geval 3 runs, elk in een transactie met ROLLBACK; de partiële
// index wordt in die transactie gedropt (migratiestand: alleen de volledige
// HNSW). Wandklok, WAL via pg_current_wal_insert_lsn (incl. trigger- en
// cascadewerk), buffers van de planknopen (exclusief AFTER-triggers) en de
// triggertijden uit EXPLAIN.
async function faseBorgingskosten() {
  const gevallen = {
    ingest_generiek_440: `insert into public.document_chunks (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie)
        select document_id, chunk_index + 100000, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie
          from public.document_chunks where document_id = ${uuidLit(doc("e", 5))}`,
    ingest_fonds_480: `insert into public.document_chunks (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie)
        select document_id, chunk_index + 100000, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie
          from public.document_chunks where document_id = any(${arr(reeks("a", 2, 5), "uuid")})`,
    herindex_generiek_440: `update public.document_chunks set embedding = embedding where document_id = ${uuidLit(doc("e", 6))}`,
    herindex_fonds_480: `update public.document_chunks set embedding = embedding where document_id = any(${arr(reeks("a", 6, 9), "uuid")})`,
    documentwissel_bibliotheek_120: `update public.documenten set bibliotheek = 'generiek', fonds_id = null where id = ${uuidLit(doc("a", 10))}`,
    documentwijziging_zonder_bibliotheek_440: `update public.documenten set documentdatum = coalesce(documentdatum, date '2026-01-01') + 1 where id = ${uuidLit(doc("e", 7))}`,
  };
  const uit = [];
  for (const optie of ["geen", "I1", "I2", "I3"]) for (const [geval, sql] of Object.entries(gevallen)) {
    const runs = [];
    for (let k = 0; k < 3; k++) {
      await db.query("begin");
      try {
        await db.query("drop index if exists public.idx_r1b_chunks_embedding_generiek");
        await db.query("select r1b_proto.borging_aan($1)", [optie]);
        const lsn0 = (await db.query("select pg_current_wal_insert_lsn() l")).rows[0].l;
        const t0 = process.hrtime.bigint();
        let p = null, fout = null;
        try { p = (await db.query(`explain (analyze, buffers, format json) ${sql}`)).rows[0]["QUERY PLAN"][0]; } catch (e) { fout = `${e.code}: ${e.message}`.slice(0, 160); }
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const wal = Number((await db.query("select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), $1::pg_lsn)::bigint b", [lsn0])).rows[0].b);
        runs.push({ ms, wal, fout, buffers: p ? (p.Plan["Shared Hit Blocks"] ?? 0) + (p.Plan["Shared Read Blocks"] ?? 0) + (p.Plan["Shared Dirtied Blocks"] ?? 0) : null,
          rijen: p?.Plan["Actual Rows"] ?? null, trigger_ms: p ? r1((p.Triggers ?? []).reduce((a, t) => a + t.Time, 0)) : null,
          triggers: p ? (p.Triggers ?? []).map((t) => `${t["Trigger Name"]}×${t.Calls}`) : [] });
      } finally { await db.query("rollback"); }
    }
    const med = (xs) => pct(xs.filter((x) => x != null), 50);
    const regel = { optie, geval, ms_p50: r1(med(runs.map((r) => r.ms))), ms_max: r1(Math.max(...runs.map((r) => r.ms))),
      buffers_plan_p50: med(runs.map((r) => r.buffers)), trigger_ms_p50: med(runs.map((r) => r.trigger_ms)),
      wal_mb_p50: r2(med(runs.map((r) => r.wal)) / 1048576), triggers: runs[0].triggers, fout: runs[0].fout };
    uit.push(regel);
    console.log(JSON.stringify({ fase: "borgingskosten", ...regel }));
  }
  schrijf(`borgingskosten-${STAND}.json`, { stand: STAND, methode: "3 runs, mediaan; transactie met rollback; partiële index in de transactie gedropt; WAL via LSN-verschil; buffers = planknopen (excl. AFTER-triggers)", punten: uit });
}

// ── B0.5: catalogusmomentopname (vóór/na-vergelijking van het terugzetten) ───
async function faseCatalogus() {
  const label = arg("catalogus", "momentopname");
  const rels = "('public.document_chunks'::regclass, 'public.documenten'::regclass)";
  const r = (await db.query(`select jsonb_build_object(
      'indexen', (select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('document_chunks', 'documenten')),
      'constraints', (select jsonb_agg(conname || ': ' || pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid in ${rels}),
      'triggers', (select jsonb_agg(tgname || ': ' || pg_get_triggerdef(oid) order by tgname) from pg_trigger where not tgisinternal and tgrelid in ${rels}),
      'kolommen', (select jsonb_agg(attrelid::regclass::text || '.' || attname || ' notnull=' || attnotnull || ' acl=' || coalesce(attacl::text, '') order by attrelid, attnum)
                     from pg_attribute where attrelid in ${rels} and attnum > 0 and not attisdropped),
      'tabel_acl', (select jsonb_agg(relname || ': ' || coalesce(relacl::text, '') order by relname) from pg_class where oid in ${rels}),
      'policies', (select jsonb_agg(tablename || '.' || policyname || ': ' || coalesce(qual, '') || ' | ' || coalesce(with_check, '') order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename in ('document_chunks', 'documenten')),
      'schemas', (select jsonb_agg(nspname order by nspname) from pg_namespace where nspname in ('r1b_proto', 'pr0_proto', 'pr0_fixture')),
      'extensies', (select jsonb_agg(extname || ' ' || extversion order by extname) from pg_extension),
      'public_functies_md5', (select md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, ''), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace),
      'aantal_documenten', (select count(*) from public.documenten), 'aantal_chunks', (select count(*) from public.document_chunks)) m`)).rows[0].m;
  schrijf(`catalogus-${label}.json`, r);
  const voor = leesJson("catalogus-voor.json");
  if (label !== "voor" && voor) {
    const verschil = Object.keys({ ...voor, ...r }).filter((k) => JSON.stringify(voor[k]) !== JSON.stringify(r[k]));
    schrijf(`catalogus-vergelijking-${label}.json`, { gelijk: verschil.length === 0, verschillende_onderdelen: verschil });
    console.log(JSON.stringify({ fase: "catalogus", label, gelijk_aan_voor: verschil.length === 0, verschil }));
  } else console.log(JSON.stringify({ fase: "catalogus", label, vastgelegd: Object.keys(r) }));
}

// ── B0.6: kostenmeting I1/I2 t.o.v. controle (grote batches) ────────────────
// Documentwissel: generiek → fonds (bibliotheek + fonds_id + documentdatum). De
// status blijft van_kracht: de transitietabel (trg op documenten) staat
// van_kracht → vastgesteld niet toe. Pensioenwet/MvT zijn wetgeving/wetsgeschiedenis; die mogen
// niet in een fondsbibliotheek (documenten_juridisch_generiek_check), dus de
// wissel zet documenttype/subtype/dossiernummer in dezelfde UPDATE op NULL.
// Per run worden de opties in een per run gerandomiseerde volgorde gemeten
// (vaste PRNG-seed); elke meting in een EIGEN transactie met ROLLBACK:
//   begin; drop partiële index (migratiestand); borging_aan(optie);
//   [scenario-statement(s), getimed]; rollback.
// Buffers en WAL uit pg_stat_statements (delta per statement, inclusief
// trigger-, cascade- en RI-werk dat binnen de statement draait); ms = wandklok.
const KOSTEN_RUNS = Number(arg("kostenruns", "10"));
// --zonderhnsw: variant die ook idx_chunks_embedding in de transactie dropt,
// zodat de borgingskosten niet in het HNSW-onderhoud verdrinken.
const ZONDER_HNSW = process.argv.includes("--zonderhnsw");
function scenario06() {
  const ins = (tag, bib, n) => [`insert /* r1b-b06:${tag} */ into public.document_chunks (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie)
      select document_id, chunk_index + 100000, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie
        from public.document_chunks where bibliotheek = '${bib}' order by id limit ${n}`];
  const reidx = (tag, n) => [`update /* r1b-b06:${tag} */ public.document_chunks set embedding = embedding, indexering_versie = 'r1b-b06'
      where id in (select id from public.document_chunks order by id limit ${n})`];
  const wissel = (tag, d) => [`update /* r1b-b06:${tag} */ public.documenten set bibliotheek = 'fonds', fonds_id = ${uuidLit(FONDS.A)}, documenttype = null, wetsgeschiedenis_subtype = null, dossiernummer = null, documentdatum = date '2026-05-05' where id = ${uuidLit(d)}`];
  // Zoals core/lib/reindex.ts: chunks van het document verwijderen en opnieuw
  // invoegen (hier: dezelfde inhoud, nieuwe rijen) — twee statements.
  const herdoc = (tag, d) => [
    `create temp table if not exists r1b_b06_bron as select * from public.document_chunks where false`,
    `insert into r1b_b06_bron select * from public.document_chunks where document_id = ${uuidLit(d)}`,
    `delete /* r1b-b06:${tag}_del */ from public.document_chunks where document_id = ${uuidLit(d)}`,
    `insert /* r1b-b06:${tag}_ins */ into public.document_chunks (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie)
      select document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie from r1b_b06_bron`];
  return {
    ingest_generiek_2000: { sql: ins("ingest_generiek_2000", "generiek", 2000) },
    ingest_generiek_10000: { sql: ins("ingest_generiek_10000", "generiek", 10000) },
    ingest_fonds_2000: { sql: ins("ingest_fonds_2000", "fonds", 2000) },
    ingest_fonds_10000: { sql: ins("ingest_fonds_10000", "fonds", 10000) },
    herindexering_2000: { sql: reidx("herindexering_2000", 2000) },
    herindexering_10000: { sql: reidx("herindexering_10000", 10000) },
    documentwissel_968: { sql: wissel("documentwissel_968", doc("e", 1)) },
    documentwissel_2738: { sql: wissel("documentwissel_2738", doc("e", 2)) },
    herindex_document_generiek_440: { sql: herdoc("herindex_document_generiek_440", doc("e", 5)), getimed: [2, 3] },
    herindex_document_fonds_300: { sql: herdoc("herindex_document_fonds_300", doc("a", 1)), getimed: [2, 3] },
  };
}
// Totaal over alle pg_stat_statements-regels van deze rol in deze database,
// behalve de leesquery zelf. Statements met dezelfde vorm delen één queryid
// (constanten worden genormaliseerd), dus per-tag zoeken kan niet; het
// verschil vóór/na de getimede statements in deze ene sessie wel.
async function pgssTotaal() {
  const { rows } = await db.query(`select coalesce(sum(shared_blks_hit + shared_blks_read), 0)::bigint b, coalesce(sum(shared_blks_dirtied), 0)::bigint d,
      coalesce(sum(wal_bytes), 0)::bigint w, coalesce(sum(calls), 0)::bigint c from pg_stat_statements
      where userid = (select oid from pg_roles where rolname = current_user) and dbid = (select oid from pg_database where datname = current_database())
        and query not ilike '%pg_stat_statements%'`);
  return { b: Number(rows[0].b), d: Number(rows[0].d), w: Number(rows[0].w), c: Number(rows[0].c) };
}
function bootstrapMediaan(xs, seed) {
  const r = prng(seed), meds = [];
  for (let k = 0; k < 2000; k++) { const s = xs.map(() => xs[Math.floor(r() * xs.length)]); meds.push(pct(s, 50)); }
  return [pct(meds, 2.5), pct(meds, 97.5)];
}
async function faseKosten06() {
  const sc = scenario06(), opties = ["controle", "I1", "I2"];
  // Hervatbaar: elke meting wordt direct aan het ruwe bestand toegevoegd; een
  // al aanwezige (scenario, optie, run) wordt overgeslagen.
  const variant = ZONDER_HNSW ? "-zonderhnsw" : "";
  const ruwPad = path.join(UIT, `kosten06-ruw-${STAND}${variant}.jsonl`);
  await db.query("set maintenance_work_mem = '1GB'");
  const ruw = fs.existsSync(ruwPad) ? fs.readFileSync(ruwPad, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const gedaan = new Set(ruw.map((x) => `${x.scenario}|${x.optie}|${x.run}`));
  const filter = arg("scenarios", null)?.split(",");
  for (const [naam, def] of Object.entries(sc)) {
    if (filter && !filter.includes(naam)) continue;
    for (let run = 0; run < KOSTEN_RUNS; run++) {
      const r = prng(`b06:${naam}:${run}`);
      const volgorde = [...opties].map((o) => [r(), o]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
      for (const optie of volgorde) {
        if (gedaan.has(`${naam}|${optie}|${run}`)) continue;
        await db.query("begin");
        try {
          await db.query("drop index if exists public.idx_r1b_chunks_embedding_generiek");
          if (ZONDER_HNSW) await db.query("drop index public.idx_chunks_embedding");
          await db.query("select r1b_proto.borging_aan($1)", [optie === "controle" ? "geen" : optie]);
          const getimed = def.getimed ?? def.sql.map((_, i) => i);
          let ms = 0, rijen = 0;
          for (const [i, q] of def.sql.entries()) if (!getimed.includes(i)) await db.query(q);
          const voor = await pgssTotaal();
          for (const [i, q] of def.sql.entries()) {
            if (!getimed.includes(i)) continue;
            const t0 = process.hrtime.bigint();
            const res = await db.query(q);
            ms += Number(process.hrtime.bigint() - t0) / 1e6; rijen += res.rowCount ?? 0;
          }
          const na = await pgssTotaal();
          const b = na.b - voor.b, d = na.d - voor.d, w = na.w - voor.w;
          var rij = { scenario: naam, optie, run, positie: volgorde.indexOf(optie), ms: r2(ms), rijen, buffers: b, dirtied: d, wal_bytes: w };
        } finally { await db.query("rollback"); }
        // Herstel naar dezelfde beginstand: de teruggedraaide rijen laten dode
        // tuples én dode HNSW-ingangen achter; zonder VACUUM groeit de tabel
        // (gemeten: 1,03 mln dode tuples, 4 GB na de eerste, afgebroken poging)
        // en worden latere runs trager. VACUUM telt niet mee in de meting.
        const tv = process.hrtime.bigint();
        await db.query("vacuum public.document_chunks");
        await db.query("vacuum public.documenten");
        rij.vacuum_ms = Math.round(Number(process.hrtime.bigint() - tv) / 1e6);
        ruw.push(rij);
        fs.appendFileSync(ruwPad, JSON.stringify(rij) + "\n");
      }
      console.log(JSON.stringify({ fase: "kosten06", scenario: naam, run, klaar: true }));
    }
  }
  if (filter) return;
  // Samenvatting per scenario × optie, plus verschil t.o.v. controle (gepaard per run).
  const uit = [];
  for (const naam of Object.keys(sc)) {
    if (!ruw.some((x) => x.scenario === naam)) continue;
    const per = (o) => ruw.filter((x) => x.scenario === naam && x.optie === o).sort((a, b) => a.run - b.run);
    const ctrl = per("controle");
    for (const o of opties) {
      const xs = per(o), ms = xs.map((x) => x.ms);
      const regel = { scenario: naam, optie: o, n: xs.length, rijen: xs[0]?.rijen,
        ms_mediaan: r1(pct(ms, 50)), ms_p90: r1(pct(ms, 90)), ms_min: r1(Math.min(...ms)), ms_max: r1(Math.max(...ms)), ms_iqr: r1(pct(ms, 75) - pct(ms, 25)),
        buffers_mediaan: pct(xs.map((x) => x.buffers), 50), dirtied_mediaan: pct(xs.map((x) => x.dirtied), 50), wal_mb_mediaan: r2(pct(xs.map((x) => x.wal_bytes), 50) / 1048576) };
      if (o !== "controle") {
        const dms = xs.map((x, i) => x.ms - ctrl[i].ms), dbuf = xs.map((x, i) => x.buffers - ctrl[i].buffers), dwal = xs.map((x, i) => x.wal_bytes - ctrl[i].wal_bytes);
        const [lo, hi] = bootstrapMediaan(dms, `boot:${naam}:${o}`);
        const [blo, bhi] = bootstrapMediaan(dbuf, `bootb:${naam}:${o}`);
        Object.assign(regel, { verschil_ms_mediaan: r1(pct(dms, 50)), verschil_ms_bi95: [r1(lo), r1(hi)], verschil_ms_min: r1(Math.min(...dms)), verschil_ms_max: r1(Math.max(...dms)),
          verschil_ms_pct: r1((pct(dms, 50) / pct(ctrl.map((x) => x.ms), 50)) * 100), binnen_ruis_ms: lo <= 0 && hi >= 0,
          verschil_buffers_mediaan: pct(dbuf, 50), verschil_buffers_bi95: [blo, bhi], binnen_ruis_buffers: blo <= 0 && bhi >= 0,
          verschil_wal_mb_mediaan: r2(pct(dwal, 50) / 1048576) });
      }
      uit.push(regel);
    }
  }
  schrijf(`kosten06-${STAND}${variant}.json`, { stand: STAND, variant: ZONDER_HNSW ? "zonder HNSW-onderhoud (idx_chunks_embedding in de transactie gedropt)" : "met HNSW-onderhoud (migratiestand)", runs: KOSTEN_RUNS, methode: "per run gerandomiseerde optievolgorde; elke meting eigen transactie met ROLLBACK, gevolgd door VACUUM (herstel naar dezelfde beginstand, niet gemeten); partiële index in de transactie gedropt; ms wandklok; buffers/WAL uit pg_stat_statements (delta per statement incl. triggers/RI); verschil gepaard per run, 95%-bootstrapinterval van de mediaan (2000 trekkingen)", punten: uit });
}

// ── B0.6: eenmalige aanmaakkosten I1 + lockniveaus per stap ────────────────
// Per stap: voorafgaande stappen (niet getimed), dan de stap getimed, dan de
// locks die DEZE stap er bij nam (pg_locks van de eigen backend, verschil met
// vóór de stap), dan ROLLBACK. 5 runs per stap.
async function faseAanmaak06(stappenArg = null, label = "06") {
  const stappen = stappenArg ?? {
    unique: [],
    not_null_direct: [],
    check_not_valid: [],
    check_validate: ["check_not_valid"],
    not_null_na_check: ["check_not_valid", "check_validate"],
    fk_direct: ["unique"],
    fk_not_valid: ["unique"],
    fk_validate: ["unique", "fk_not_valid"],
  };
  const locks = async () => (await db.query(`select coalesce(c.relname, l.locktype) rel, l.mode from pg_locks l left join pg_class c on c.oid = l.relation
      where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relname in ('document_chunks', 'documenten')`)).rows.map((x) => `${x.rel}:${x.mode}`);
  const uit = {};
  const n = (await db.query("select count(*)::int n, count(*) filter (where bibliotheek = 'generiek')::int g from public.document_chunks")).rows[0];
  for (const [stap, voor] of Object.entries(stappen)) {
    const ms = [];
    let nieuw = [];
    for (let k = 0; k < 5; k++) {
      await db.query("begin");
      try {
        // Geen DROP INDEX hier: die neemt een AccessExclusiveLock op
        // document_chunks en zou de locks van de stap zelf maskeren.
        for (const v of voor) await db.query("select r1b_proto.i1_stap($1)", [v]);
        const l0 = new Set(await locks());
        const t0 = process.hrtime.bigint();
        await db.query("select r1b_proto.i1_stap($1)", [stap]);
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
        nieuw = (await locks()).filter((x) => !l0.has(x));
      } finally { await db.query("rollback"); }
    }
    uit[stap] = { voorafgaand: voor, ms_mediaan: r1(pct(ms, 50)), ms_min: r1(Math.min(...ms)), ms_max: r1(Math.max(...ms)), locks_door_deze_stap: [...new Set(nieuw)].sort() };
    console.log(JSON.stringify({ fase: `aanmaak${label}`, stap, ...uit[stap] }));
  }
  schrijf(`aanmaak${label}-${STAND}.json`, { stand: STAND, chunks: n.n, generiek: n.g, stappen: uit,
    noot: "locks: pg_locks (locktype relation) van de eigen backend ná de stap, minus vóór de stap; een backend die een mode al hield (uit een voorafgaande stap) toont die niet opnieuw" });
}

// ── B0.7: één-write-varianten van I1 — regressie en meting ──────────────────
// Opties: geen (controle), I1 (B0.6: FK on update cascade), I1a (refresh zonder
// bibliotheek), I1b (FK no action deferrable initially deferred, refresh zet
// alles), I1c (cascade, maar refresh-trigger hernoemd zodat hij vóór de
// RI-triggers vuurt). DDL in het prototypebestand (borging_aan); alles in
// transacties met ROLLBACK. `set constraints all immediate` na elke
// gecontroleerde statement emuleert de commit-toets van een uitgestelde FK.
// B0.8: opties/scenario's/label instelbaar (default = de B0.7-run).
const OPTIES07 = arg("opties07", "geen,I1,I1a,I1b,I1c").split(",");
const SCENARIOS07 = arg("scenarios07", "").split(",").filter(Boolean);
const LABEL07 = arg("label07", "07");
const DENORM_KOLOMMEN = ["procesmodel_id", "procesinstantie_id", "vergadering_id", "agendapunt_id", "documenttype", "documentstatus", "documentdatum",
  "periode", "bronstatus", "geldig_vanaf", "geldig_tot", "bibliotheek", "bronorganisatie", "normgewicht", "extern_url", "wettelijk_regime"];
const consistentieSql = (docId) => `select count(*)::int afwijkend, count(*) filter (where dc.bibliotheek is distinct from d.bibliotheek)::int bib_afwijkend
    from public.document_chunks dc join public.documenten d on d.id = dc.document_id
    cross join lateral public.fn_chunk_denorm(dc.document_id) v
   where dc.document_id = ${uuidLit(docId)}
     and ((${DENORM_KOLOMMEN.map((k) => `dc.${k}`).join(", ")}) is distinct from (${DENORM_KOLOMMEN.map((k) => `v.${k}`).join(", ")})
          or dc.bibliotheek is distinct from d.bibliotheek)`;
const wisselPuurPrep = (d) => `update public.documenten set documenttype = null, wetsgeschiedenis_subtype = null, dossiernummer = null where id = ${uuidLit(d)}`;
const wisselPuur = (d) => `update public.documenten set bibliotheek = 'fonds', fonds_id = ${uuidLit(FONDS.A)} where id = ${uuidLit(d)}`;
const wisselGecombineerd = (d) => `update public.documenten set bibliotheek = 'fonds', fonds_id = ${uuidLit(FONDS.A)}, documenttype = null, wetsgeschiedenis_subtype = null, dossiernummer = null, documentdatum = date '2026-05-05' where id = ${uuidLit(d)}`;
async function probeer07(rol, stappen, metClaims = null, na = null) {
  await db.query("savepoint p");
  try {
    if (rol !== "postgres") await db.query(`set local role ${rol}`);
    if (metClaims) await db.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(metClaims))}, true)`);
    let rijen = 0;
    for (const s of [].concat(stappen)) rijen += (await db.query(s)).rowCount ?? 0;
    await db.query("set constraints all immediate");
    const extra = na ? await na() : undefined;
    return { uitkomst: "toegestaan", rijen, ...(extra !== undefined ? { na: extra } : {}) };
  } catch (e) {
    return { uitkomst: "geweigerd", sqlstate: e.code, melding: String(e.message).slice(0, 150) };
  } finally {
    await db.query("rollback to savepoint p");
  }
}
async function faseRegressie07() {
  const q1 = async (s) => (await db.query(s)).rows[0];
  const chunkA = (await q1(`select id from public.document_chunks where document_id = ${uuidLit(doc("a", 2))} order by chunk_index limit 1`)).id;
  const cA = claims(USER.A), sr = { role: "service_role" };
  const cons = (d) => async () => (await db.query(consistentieSql(d))).rows[0];
  const tests = {
    // (1) foutieve directe chunk-updates
    fonds_chunk_bibliotheek_generiek: ["authenticated", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA)}`, cA],
    fonds_chunk_verhangen_generiek_doc: ["authenticated", `update public.document_chunks set document_id = ${uuidLit(doc("e", 5))} where id = ${uuidLit(chunkA)}`, cA],
    fonds_chunk_bibliotheek_null: ["authenticated", `update public.document_chunks set bibliotheek = null where id = ${uuidLit(chunkA)}`, cA],
    service_chunk_bibliotheek_generiek: ["service_role", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA)}`, sr],
    service_chunk_verhangen_generiek_doc: ["service_role", `update public.document_chunks set document_id = ${uuidLit(doc("e", 5))} where id = ${uuidLit(chunkA)}`, sr],
    service_chunk_bibliotheek_null: ["service_role", `update public.document_chunks set bibliotheek = null where id = ${uuidLit(chunkA)}`, sr],
    service_chunk_document_id_null: ["service_role", `update public.document_chunks set document_id = null where id = ${uuidLit(chunkA)}`, sr],
    fonds_chunk_document_id_null: ["authenticated", `update public.document_chunks set document_id = null where id = ${uuidLit(chunkA)}`, cA],
    // (2) legitieme paden
    insert_zonder_bibliotheek: ["postgres", `insert into public.document_chunks (document_id, chunk_index, tekst, embedding_model) values (${uuidLit(doc("a", 2))}, 999001, 'r1b test', 'r1b-test')`, null, cons(doc("a", 2))],
    herindexering_fonds: ["authenticated", `update public.document_chunks set embedding = embedding, embedding_model = 'r1b-test', indexering_versie = 'r1b-test' where document_id = ${uuidLit(doc("a", 2))}`, cA, cons(doc("a", 2))],
    reindex_delete_insert_fonds: ["authenticated", [
      `create temp table if not exists r1b_b07_bron on commit drop as select * from public.document_chunks where document_id = ${uuidLit(doc("a", 3))}`,
      `delete from public.document_chunks where document_id = ${uuidLit(doc("a", 3))}`,
      `insert into public.document_chunks (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie)
         select document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model, indexering_versie from r1b_b07_bron`], cA, cons(doc("a", 3))],
    documentwijziging_datum_titel: ["postgres", `update public.documenten set documentdatum = date '2026-04-04', titel = titel || ' (r1b)' where id = ${uuidLit(doc("e", 6))}`, null, cons(doc("e", 6))],
    documentwijziging_bronstatus: ["postgres", `update public.documenten set bronstatus = 'historisch' where id = ${uuidLit(doc("e", 7))}`, null, cons(doc("e", 7))],
    documentwijziging_status: ["postgres", `update public.documenten set status = 'historisch' where id = ${uuidLit(doc("e", 8))}`, null, cons(doc("e", 8))],
    documentwijziging_review_geldig: ["postgres", `update public.documenten set volgende_review = date '2027-01-01', geldig_tot = date '2030-12-31' where id = ${uuidLit(doc("e", 9))}`, null, cons(doc("e", 9))],
    documentwijziging_fonds_eigen: ["authenticated", `update public.documenten set documentdatum = date '2026-03-03' where id = ${uuidLit(doc("a", 4))}`, cA, cons(doc("a", 4))],
    // (4) bibliotheekwissel 968 / 2.738 chunks, puur en gecombineerd
    wissel_puur_968: ["postgres", [wisselPuurPrep(doc("e", 1)), wisselPuur(doc("e", 1))], null, cons(doc("e", 1))],
    wissel_puur_2738: ["postgres", [wisselPuurPrep(doc("e", 2)), wisselPuur(doc("e", 2))], null, cons(doc("e", 2))],
    wissel_gecombineerd_968: ["postgres", wisselGecombineerd(doc("e", 1)), null, cons(doc("e", 1))],
    wissel_gecombineerd_2738: ["postgres", wisselGecombineerd(doc("e", 2)), null, cons(doc("e", 2))],
  };
  const uit = { stand: STAND, opties: {} };
  for (const optie of OPTIES07) {
    await db.query("begin");
    try {
      await db.query("select r1b_proto.borging_aan($1)", [optie]);
      const res = {};
      for (const [naam, [rol, sql, c, na]] of Object.entries(tests)) res[naam] = await probeer07(rol, sql, c, na);
      // (4b) atomiciteit: fout bij chunk-update nr. 500 tijdens de wissel van
      // 968 chunks ⇒ niets mag half zijn doorgevoerd.
      for (const [d, n] of [[doc("e", 1), 968], [doc("e", 2), 2738]]) {
        await db.query("savepoint atoom");
        let fout = null;
        try {
          await db.query("select r1b_proto.storing_aan(500)");
          await db.query("savepoint binnen");
          try { await db.query(wisselGecombineerd(d)); await db.query("set constraints all immediate"); } catch (e) { fout = `${e.code}: ${e.message}`.slice(0, 120); await db.query("rollback to savepoint binnen"); }
          const na = (await db.query(`select (select bibliotheek from public.documenten where id = ${uuidLit(d)}) doc_bib,
              count(*) filter (where bibliotheek = 'generiek')::int chunks_generiek, count(*)::int n from public.document_chunks where document_id = ${uuidLit(d)}`)).rows[0];
          res[`atomiciteit_fout_halverwege_${n}`] = { fout, na, heel: na.doc_bib === "generiek" && na.chunks_generiek === na.n };
        } finally { await db.query("rollback to savepoint atoom"); }
      }
      // (3) drift na de tests (binnen dezelfde transactie, ná de rollbacks per test)
      const meld = [];
      const h = (m) => meld.push(m.message);
      db.on("notice", h);
      try { await db.query(DRIFT_SQL); res.drift = { uitkomst: "schoon", melding: meld.join(" ") }; } catch (e) { res.drift = { uitkomst: "gevonden", melding: e.message }; } finally { db.off("notice", h); }
      uit.opties[optie] = res;
    } finally { await db.query("rollback"); }
    console.log(JSON.stringify({ fase: `regressie${LABEL07}`, optie, uitkomsten: Object.fromEntries(Object.entries(uit.opties[optie]).map(([k, x]) => [k, (x.uitkomst ?? (x.heel ? "heel" : "HALF")) + (x.sqlstate ? `:${x.sqlstate}` : "") + (x.na?.afwijkend !== undefined ? `/afw=${x.na.afwijkend}` : "")])) }));
  }
  schrijf(`regressie${LABEL07}-${STAND}.json`, uit);
}

// Meting: aantal fysieke chunk-updates en kosten per wissel. Tellen via
// pg_stat_get_xact_tuples_updated / _hot_updated (transactie-lokale tellers van
// de eigen backend, ook bij ROLLBACK leesbaar); kosten zoals kosten06.
async function faseWissel07() {
  const scen = {
    puur_968: { prep: wisselPuurPrep(doc("e", 1)), sql: wisselPuur(doc("e", 1)), n: 968 },
    puur_2738: { prep: wisselPuurPrep(doc("e", 2)), sql: wisselPuur(doc("e", 2)), n: 2738 },
    gecombineerd_968: { sql: wisselGecombineerd(doc("e", 1)), n: 968 },
    gecombineerd_2738: { sql: wisselGecombineerd(doc("e", 2)), n: 2738 },
  };
  if (SCENARIOS07.length) for (const k of Object.keys(scen)) if (!SCENARIOS07.includes(k)) delete scen[k];
  const variant = ZONDER_HNSW ? "-zonderhnsw" : "";
  const ruwPad = path.join(UIT, `wissel${LABEL07}-ruw-${STAND}${variant}.jsonl`);
  const ruw = fs.existsSync(ruwPad) ? fs.readFileSync(ruwPad, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const gedaan = new Set(ruw.map((x) => `${x.scenario}|${x.optie}|${x.run}`));
  await db.query("set maintenance_work_mem = '1GB'");
  const tel = async () => (await db.query("select pg_stat_get_xact_tuples_updated('public.document_chunks'::regclass)::int u, pg_stat_get_xact_tuples_hot_updated('public.document_chunks'::regclass)::int h")).rows[0];
  for (const [naam, def] of Object.entries(scen)) for (let run = 0; run < KOSTEN_RUNS; run++) {
    const r = prng(`b07:${naam}:${run}`);
    const volgorde = [...OPTIES07].map((o) => [r(), o]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    for (const optie of volgorde) {
      if (gedaan.has(`${naam}|${optie}|${run}`)) continue;
      let rij;
      await db.query("begin");
      try {
        await db.query("drop index if exists public.idx_r1b_chunks_embedding_generiek");
        if (ZONDER_HNSW) await db.query("drop index public.idx_chunks_embedding");
        await db.query("select r1b_proto.borging_aan($1)", [optie]);
        if (def.prep) await db.query(def.prep);
        const t0tel = await tel(), voor = await pgssTotaal();
        const t0 = process.hrtime.bigint();
        await db.query(def.sql);
        await db.query("set constraints all immediate");
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const na = await pgssTotaal(), t1tel = await tel();
        const c = (await db.query(consistentieSql(naam.endsWith("968") ? doc("e", 1) : doc("e", 2)))).rows[0];
        rij = { scenario: naam, optie, run, positie: volgorde.indexOf(optie), ms: r2(ms), buffers: na.b - voor.b, wal_bytes: na.w - voor.w,
          chunk_updates: t1tel.u - t0tel.u, chunk_hot_updates: t1tel.h - t0tel.h, chunks: def.n, updates_per_chunk: r2((t1tel.u - t0tel.u) / def.n), afwijkend_na: c.afwijkend };
      } finally { await db.query("rollback"); }
      await db.query("vacuum public.document_chunks");
      await db.query("vacuum public.documenten");
      ruw.push(rij);
      fs.appendFileSync(ruwPad, JSON.stringify(rij) + "\n");
    }
    console.log(JSON.stringify({ fase: `wissel${LABEL07}`, scenario: naam, run }));
  }
  const uit = [];
  for (const naam of Object.keys(scen)) {
    const per = (o) => ruw.filter((x) => x.scenario === naam && x.optie === o).sort((a, b) => a.run - b.run);
    const ctrl = per("geen");
    for (const o of OPTIES07) {
      const xs = per(o), ms = xs.map((x) => x.ms);
      if (!xs.length) continue;
      const regel = { scenario: naam, optie: o, n: xs.length, updates_per_chunk: [...new Set(xs.map((x) => x.updates_per_chunk))], hot: [...new Set(xs.map((x) => x.chunk_hot_updates))],
        afwijkend_na_max: Math.max(...xs.map((x) => x.afwijkend_na)),
        ms_mediaan: r1(pct(ms, 50)), ms_p90: r1(pct(ms, 90)), ms_min: r1(Math.min(...ms)), ms_max: r1(Math.max(...ms)), ms_iqr: r1(pct(ms, 75) - pct(ms, 25)),
        buffers_mediaan: pct(xs.map((x) => x.buffers), 50), wal_mb_mediaan: r2(pct(xs.map((x) => x.wal_bytes), 50) / 1048576) };
      if (o !== "geen") {
        for (const [ref, refnaam] of [[ctrl, "controle"], [per("I1"), "I1"]]) {
          if (o === "I1" && refnaam === "I1") continue;
          const dms = xs.map((x, i) => x.ms - ref[i].ms), dbuf = xs.map((x, i) => x.buffers - ref[i].buffers), dwal = xs.map((x, i) => x.wal_bytes - ref[i].wal_bytes);
          const [lo, hi] = bootstrapMediaan(dms, `b07:${naam}:${o}:${refnaam}`);
          regel[`t_o_v_${refnaam}`] = { ms_mediaan: r1(pct(dms, 50)), ms_bi95: [r1(lo), r1(hi)], ms_pct: r1((pct(dms, 50) / pct(ref.map((x) => x.ms), 50)) * 100),
            binnen_ruis: lo <= 0 && hi >= 0, buffers_mediaan: pct(dbuf, 50), wal_mb_mediaan: r2(pct(dwal, 50) / 1048576) };
        }
      }
      uit.push(regel);
    }
  }
  schrijf(`wissel${LABEL07}-${STAND}${variant}.json`, { stand: STAND, opties: OPTIES07, variant: ZONDER_HNSW ? "zonder HNSW-onderhoud" : "met HNSW-onderhoud", runs: KOSTEN_RUNS,
    methode: "per run gerandomiseerde optievolgorde; eigen transactie met ROLLBACK + VACUUM; ms incl. `set constraints all immediate` (commit-toets uitgestelde FK); fysieke updates via pg_stat_get_xact_tuples_updated/_hot_updated (document_chunks); buffers/WAL via pg_stat_statements; gepaarde verschillen met 95%-bootstrap", punten: uit });
}

// ── B0.8: document_id NOT NULL (I1b_nn) en een echte COMMIT-proef ───────────
// telling08: NULL-/drift-telling op de lokale fixture (geen backfill).
async function faseTelling08() {
  const t = (await db.query(`select count(*)::int chunks,
      count(*) filter (where document_id is null)::int document_id_null,
      count(*) filter (where bibliotheek is null)::int bibliotheek_null,
      (select count(*)::int from public.document_chunks dc join public.documenten d on d.id = dc.document_id where dc.bibliotheek is distinct from d.bibliotheek) bibliotheek_afwijkend,
      (select count(*)::int from public.document_chunks dc where dc.document_id is not null and not exists (select 1 from public.documenten d where d.id = dc.document_id)) zonder_document
    from public.document_chunks`)).rows[0];
  const kol = (await db.query(`select attname, attnotnull from pg_attribute where attrelid = 'public.document_chunks'::regclass and attname in ('document_id', 'bibliotheek') order by attname`)).rows;
  const fk = (await db.query(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.document_chunks'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%(document_id)%'`)).rows;
  const docnn = (await db.query(`select attnotnull from pg_attribute where attrelid = 'public.documenten'::regclass and attname = 'bibliotheek'`)).rows[0];
  const uit = { stand: STAND, telling: t, kolommen: kol, fk_document_id: fk, documenten_bibliotheek_notnull: docnn.attnotnull };
  schrijf(`telling08-${STAND}.json`, uit);
  console.log(JSON.stringify({ fase: "telling08", ...uit }));
  return t;
}
// aanmaak08: lockbewuste route voor I1b_nn (elke stap in een eigen ROLLBACK-transactie).
async function faseAanmaak08() {
  await faseAanmaak06({
    docid_not_null_direct: [],
    docid_check_not_valid: [],
    docid_check_validate: ["docid_check_not_valid"],
    docid_not_null_na_check: ["docid_check_not_valid", "docid_check_validate"],
    fk_deferred_not_valid: ["unique"],
    fk_validate: ["unique", "fk_deferred_not_valid"],
  }, "08");
}
// commit08: echte transacties met COMMIT (autocommit-verbinding, expliciete
// begin/commit). Alleen herkenbare fixture-id's (00000000-0000-4000-d000-…).
// Het herstelplan wordt VÓÓR de eerste mutatie vastgelegd (commit08-herstelplan).
async function faseCommit08() {
  const D1 = doc("e", 1), D2 = doc("e", 2), DG = doc("e", 5), DA = doc("a", 2);
  const chunkA = (await db.query(`select id, document_id, bibliotheek from public.document_chunks where document_id = ${uuidLit(DA)} order by chunk_index limit 1`)).rows[0];
  const cA = claims(USER.A);
  const docKol = ["bibliotheek", "fonds_id", "documenttype", "wetsgeschiedenis_subtype", "dossiernummer", "documentdatum"];
  // Als tekst ophalen: node-pg zet `date` om naar een lokale Date (tijdzoneverschuiving).
  const origineel = (await db.query(`select id::text, ${docKol.map((k) => `${k}::text as ${k}`).join(", ")} from public.documenten where id in (${uuidLit(D1)}, ${uuidLit(D2)}) order by id`)).rows;
  const terugSql = (d) => {
    const o = origineel.find((x) => x.id === d);
    const typ = { fonds_id: "::uuid", documentdatum: "::date" };
    return `update public.documenten set ${docKol.map((k) => `${k} = ${o[k] === null ? "null" : lit(o[k]) + (typ[k] ?? "")}`).join(", ")} where id = ${uuidLit(d)}`;
  };
  const momentopname = async () => (await db.query(`select
      (select md5(string_agg(md5(t::text), '' order by t.id)) from public.documenten t) documenten_md5,
      (select md5(string_agg(md5(t::text), '' order by t.id)) from public.document_chunks t) chunks_md5,
      (select count(*)::int from public.documenten) documenten, (select count(*)::int from public.document_chunks) chunks,
      (select jsonb_object_agg(relname, n_live_tup) from pg_stat_user_tables where schemaname = 'public' and n_live_tup > 0) live_tup`)).rows[0];
  const herstelplan = {
    vooraf_vastgelegd: new Date().toISOString(),
    documenten_origineel: origineel,
    chunk_origineel: chunkA,
    stappen: [
      "1. Documenten D1/D2 terugzetten op de originele waarden (één UPDATE per document, met borging nog aan: tevens test van een geldige terugwissel); de refresh-trigger herstelt de 16 chunkvelden.",
      "2. Borging terugdraaien: drop constraint r1b_chunks_document_bibliotheek_fk; drop constraint r1b_documenten_id_bibliotheek_uniek; alter document_chunks.bibliotheek drop not null; alter document_chunks.document_id drop not null.",
      "3. Negatieve controle zonder borging: gecommitte foutieve chunk-updates op chunk_origineel, direct daarna teruggezet op chunk_origineel.document_id/bibliotheek.",
      "4. Vergelijk md5 van documenten en document_chunks (rij-voor-rij) en de catalogus met de momentopname vóór de proef.",
    ],
  };
  schrijf("commit08-herstelplan.json", herstelplan);
  const voor = await momentopname();
  const res = { stand: STAND, voor, stappen: {} };
  const tel = async () => (await db.query("select pg_stat_get_xact_tuples_updated('public.document_chunks'::regclass)::int u")).rows[0].u;
  const docStand = async (d) => (await db.query(`select (select bibliotheek from public.documenten where id = ${uuidLit(d)}) doc_bib,
      count(*)::int n, count(*) filter (where bibliotheek = 'fonds')::int fonds, count(*) filter (where bibliotheek = 'generiek')::int generiek
      from public.document_chunks where document_id = ${uuidLit(d)}`)).rows[0];
  const chunkStand = async () => (await db.query(`select document_id, bibliotheek from public.document_chunks where id = ${uuidLit(chunkA.id)}`)).rows[0];
  // Eén transactie met echte COMMIT; vangt fouten per statement én bij COMMIT.
  async function tx(naam, stappen, { rol = "postgres", c = null, telUpdates = false } = {}) {
    const r = { statements: [], commit: null };
    let u0 = null;
    await db.query("begin");
    try {
      if (rol !== "postgres") await db.query(`set local role ${rol}`);
      if (c) await db.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(c))}, true)`);
      if (telUpdates) u0 = await tel();
      for (const s of stappen) {
        try { const q = await db.query(s); r.statements.push({ ok: true, rijen: q.rowCount ?? null }); }
        catch (e) { r.statements.push({ ok: false, sqlstate: e.code, melding: String(e.message).slice(0, 140) }); break; }
      }
      if (telUpdates && r.statements.every((x) => x.ok)) r.chunk_updates_voor_commit = (await tel()) - u0;
    } catch (e) { r.voorbereiding_fout = `${e.code}: ${e.message}`.slice(0, 140); }
    try { const q = await db.query("commit"); r.commit = q.command === "ROLLBACK" ? "ROLLBACK (transactie was afgebroken)" : "COMMIT ok"; }
    catch (e) { r.commit = `COMMIT geweigerd ${e.code}: ${String(e.message).slice(0, 140)}`; r.commit_sqlstate = e.code; }
    res.stappen[naam] = r;
    return r;
  }
  // T0 borging I1b_nn aanzetten en committen (lokaal; teruggedraaid in stap H2).
  await tx("T0_borging_I1b_nn_aan", ["select r1b_proto.borging_aan('I1b_nn')"]);
  // T1/T2 geldige gecombineerde wissel (968 / 2.738 chunks) met COMMIT.
  for (const [naam, d, n] of [["T1_wissel_gecombineerd_968", D1, 968], ["T2_wissel_gecombineerd_2738", D2, 2738]]) {
    const r = await tx(naam, [wisselGecombineerd(d)], { telUpdates: true });
    r.na = { ...(await docStand(d)), ...(await db.query(consistentieSql(d))).rows[0] };
    r.updates_per_chunk = r.chunk_updates_voor_commit != null ? r2(r.chunk_updates_voor_commit / n) : null;
  }
  // T3–T6 foutieve directe chunk-updates; verwacht: geweigerd (FK bij COMMIT, NOT NULL direct).
  const fout = [
    ["T3_service_chunk_bibliotheek_generiek", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA.id)}`, "service_role", { role: "service_role" }],
    ["T4_fonds_chunk_bibliotheek_generiek", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA.id)}`, "authenticated", cA],
    ["T5_service_chunk_verhangen_generiek_doc", `update public.document_chunks set document_id = ${uuidLit(DG)} where id = ${uuidLit(chunkA.id)}`, "service_role", { role: "service_role" }],
    ["T6a_service_chunk_document_id_null", `update public.document_chunks set document_id = null where id = ${uuidLit(chunkA.id)}`, "service_role", { role: "service_role" }],
    ["T6b_fonds_chunk_document_id_null", `update public.document_chunks set document_id = null where id = ${uuidLit(chunkA.id)}`, "authenticated", cA],
    ["T6c_service_chunk_bibliotheek_null", `update public.document_chunks set bibliotheek = null where id = ${uuidLit(chunkA.id)}`, "service_role", { role: "service_role" }],
  ];
  for (const [naam, sql, rol, c] of fout) { const r = await tx(naam, [sql], { rol, c }); r.chunk_na = await chunkStand(); r.ongewijzigd = r.chunk_na.document_id === chunkA.document_id && r.chunk_na.bibliotheek === chunkA.bibliotheek; }
  // T7 geldige terugwissel van D1 + een foutieve chunk-update in DEZELFDE transactie:
  // COMMIT moet falen en ook de geldige wissel mag niet doorgevoerd zijn.
  {
    const terug = terugSql(D1);
    const r = await tx("T7_geldige_terugwissel_plus_foutieve_chunk", [terug, `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA.id)}`]);
    r.d1_na = await docStand(D1); r.chunk_na = await chunkStand();
  }
  // T8 fout halverwege de wissel (storing bij chunk-update nr. 500), 968 en 2.738: COMMIT ⇒ ROLLBACK, niets half.
  for (const [naam, d] of [["T8a_storing_halverwege_968", D1], ["T8b_storing_halverwege_2738", D2]]) {
    const terug = terugSql(d);
    const r = await tx(naam, ["select r1b_proto.storing_aan(500)", terug]);
    r.na = await docStand(d);
    r.storing_trigger_na = (await db.query("select count(*)::int n from pg_trigger where tgname = 'r1b_storing'")).rows[0].n;
  }
  // T9 legitieme paden met COMMIT: insert (denormalisatie vult alle 16 velden) en no-op-herindexering.
  {
    const r = await tx("T9a_insert_legitiem", [`insert into public.document_chunks (document_id, chunk_index, tekst, embedding_model) values (${uuidLit(DA)}, 999801, 'r1b b08 commitproef', 'r1b-b08')`]);
    r.na = (await db.query(consistentieSql(DA))).rows[0];
    const del = await tx("T9b_insert_opruimen", [`delete from public.document_chunks where document_id = ${uuidLit(DA)} and chunk_index = 999801 and embedding_model = 'r1b-b08'`]);
    del.rest = (await db.query(`select count(*)::int n from public.document_chunks where embedding_model = 'r1b-b08'`)).rows[0].n;
    const h = await tx("T9c_herindexering_noop_fonds", [`update public.document_chunks set embedding = embedding where document_id = ${uuidLit(DA)}`], { rol: "authenticated", c: cA });
    h.na = (await db.query(consistentieSql(DA))).rows[0];
  }
  // H1 herstel D1/D2 (geldige terugwissel met borging aan, COMMIT).
  for (const d of [D1, D2]) {
    const terug = terugSql(d);
    const r = await tx(`H1_herstel_${d === D1 ? "968" : "2738"}`, [terug], { telUpdates: true });
    r.na = { ...(await docStand(d)), ...(await db.query(consistentieSql(d))).rows[0] };
  }
  // H2 borging terugdraaien (COMMIT).
  await tx("H2_borging_uit", [
    "alter table public.document_chunks drop constraint r1b_chunks_document_bibliotheek_fk",
    "alter table public.documenten drop constraint r1b_documenten_id_bibliotheek_uniek",
    "alter table public.document_chunks alter column bibliotheek drop not null",
    "alter table public.document_chunks alter column document_id drop not null"]);
  // N negatieve controle ZONDER borging, met COMMIT, direct teruggezet.
  for (const [naam, sql] of [["N1_zonder_borging_service_bibliotheek_generiek", `update public.document_chunks set bibliotheek = 'generiek' where id = ${uuidLit(chunkA.id)}`],
                             ["N2_zonder_borging_service_document_id_null", `update public.document_chunks set document_id = null where id = ${uuidLit(chunkA.id)}`]]) {
    const r = await tx(naam, [sql], { rol: "service_role", c: { role: "service_role" } });
    r.chunk_na = await chunkStand();
    r.gat_zichtbaar = r.commit === "COMMIT ok" && (r.chunk_na.bibliotheek !== chunkA.bibliotheek || r.chunk_na.document_id !== chunkA.document_id);
    const h = await tx(`${naam}_herstel`, [`update public.document_chunks set document_id = ${uuidLit(chunkA.document_id)}, bibliotheek = ${lit(chunkA.bibliotheek)} where id = ${uuidLit(chunkA.id)}`]);
    h.chunk_na = await chunkStand();
  }
  const na = await momentopname();
  res.na = na;
  res.data_gelijk = na.documenten_md5 === voor.documenten_md5 && na.chunks_md5 === voor.chunks_md5 && na.documenten === voor.documenten && na.chunks === voor.chunks;
  res.restanten = { r1b_storing: (await db.query("select count(*)::int n from pg_trigger where tgname = 'r1b_storing'")).rows[0].n,
    r1b_constraints: (await db.query("select count(*)::int n from pg_constraint where conname like 'r1b%'")).rows[0].n };
  schrijf(`commit08-${STAND}.json`, res);
  for (const [k, v] of Object.entries(res.stappen)) console.log(JSON.stringify({ fase: "commit08", stap: k, commit: v.commit, statements: v.statements.map((s) => s.ok ? "ok" : s.sqlstate), ...(v.updates_per_chunk != null ? { updates_per_chunk: v.updates_per_chunk } : {}), ...(v.na ? { na: v.na } : {}), ...(v.ongewijzigd !== undefined ? { ongewijzigd: v.ongewijzigd } : {}), ...(v.d1_na ? { d1_na: v.d1_na, chunk_na: v.chunk_na } : {}), ...(v.gat_zichtbaar !== undefined ? { gat_zichtbaar: v.gat_zichtbaar } : {}) }));
  console.log(JSON.stringify({ fase: "commit08", data_gelijk: res.data_gelijk, restanten: res.restanten }));
}

// ── B0.4: plan van de begrensde tellingen (open punt B0.3) ──────────────────
// auto_explain (superuser-verbinding, set local role authenticated) van
// beslis_split en beslis_combi: welke index/scan gebruikt de telling, en hoeveel
// rijen/buffers worden er werkelijk gelezen?
async function faseBeslisplan() {
  if (!ADMIN_URL) { console.log("beslisplan: --admin ontbreekt, overgeslagen"); return; }
  const adm = await verbind(ADMIN_URL);
  const notices = [];
  adm.on("notice", (n) => notices.push(n.message));
  for (const x of ["load 'auto_explain'", "set auto_explain.log_nested_statements = on", "set auto_explain.log_min_duration = 0",
    "set auto_explain.log_analyze = on", "set auto_explain.log_buffers = on", "set auto_explain.log_timing = on",
    "set auto_explain.log_level = notice", "set client_min_messages = notice"]) await adm.query(x);
  const tekst = [], bewijs = {};
  for (const [f, s] of [["A", "geen"], ["B", "geen"], ["A", "middel"], ["G", "geen"]]) {
    if (!FONDSEN.includes(f)) continue;
    const a = ACTOREN[f];
    for (const [fn, n] of [["beslis_split", 6000], ["beslis_combi", 6000], ["beslis_combi", 9000]]) {
      notices.length = 0;
      await adm.query("begin");
      try {
        await adm.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(claims(a.user)))}, true)`);
        await adm.query("set local role authenticated");
        await adm.query(`select * from r1b_proto.${fn}(${n}, ${arr(SCOPE_DEF[f][s], "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(a.bronsoort, "text")}, ${uuidLit(a.fonds)})`);
      } catch (e) { notices.push(`FOUT: ${e.message}`); } finally { await adm.query("rollback"); }
      const tel = notices.filter((m) => m.includes("plan:") && /count\(\*\)/.test(m));
      const k = `${fn}/${n}/${f}/${s}`;
      bewijs[k] = tel.map((m) => ({
        bibliotheek_predicaat: /c\.bibliotheek = 'fonds'/.test(m),
        index: [...new Set([...m.matchAll(/Index (?:Only )?Scan using (\w+)/g)].map((x) => x[1]))],
        seq_scan: /Seq Scan on document_chunks/.test(m),
        rijen_verwijderd_door_filter: [...m.matchAll(/Rows Removed by Filter: (\d+)/g)].map((x) => Number(x[1])),
        buffers: [...m.matchAll(/Buffers: shared hit=(\d+)(?: read=(\d+))?/g)].map((x) => Number(x[1]) + Number(x[2] ?? 0))[0] ?? null,
      }));
      tekst.push(`==== ${k} (stand ${STAND}) ====\n${tel.join("\n\n")}\n`);
    }
  }
  fs.writeFileSync(path.join(UIT, `beslisplan-${STAND}.txt`), tekst.join("\n"));
  schrijf(`beslisplan-${STAND}.json`, bewijs);
  console.log(JSON.stringify({ fase: "beslisplan", bewijs }));
  await adm.end();
}

// ── B0.3: consistentie document_chunks.bibliotheek ↔ documenten.bibliotheek ─
async function faseConsistentie() {
  const r = (await db.query(`
    select count(*)::int chunks,
           count(*) filter (where c.bibliotheek is distinct from d.bibliotheek)::int afwijkend,
           count(*) filter (where c.bibliotheek is null)::int chunk_null,
           count(*) filter (where c.bibliotheek = 'generiek')::int chunk_generiek,
           count(*) filter (where d.bibliotheek = 'generiek')::int doc_generiek,
           count(*) filter (where c.bibliotheek = 'generiek' and c.embedding is not null)::int generiek_met_embedding
      from public.document_chunks c join public.documenten d on d.id = c.document_id`)).rows[0];
  const idx = (await db.query(`select indexname, indexdef, pg_relation_size(('public.' || indexname)::regclass)::bigint bytes
      from pg_indexes where schemaname = 'public' and tablename = 'document_chunks' and indexdef ilike '%hnsw%' order by 1`)).rows
    .map((x) => ({ ...x, bytes: Number(x.bytes), mb: r1(Number(x.bytes) / 1048576) }));
  const trig = (await db.query(`select tgname, tgrelid::regclass::text tabel, pg_get_triggerdef(oid) def from pg_trigger
      where not tgisinternal and tgrelid in ('public.document_chunks'::regclass, 'public.documenten'::regclass) and tgname like '%denorm%' order by 1`)).rows;
  const uit = { stand: STAND, ...r, hnsw_indexen: idx, denorm_triggers: trig };
  schrijf(`consistentie-${STAND}.json`, uit);
  console.log(JSON.stringify({ fase: "consistentie", ...r, hnsw_indexen: idx.map((x) => `${x.indexname} ${x.mb} MB`) }));
}

// Definitieve R1b-index: gepaarde bulkingest en fysieke vervanging.
// De bestaande volledige index blijft in beide varianten aanwezig. Alleen de
// nieuwe partiële index wordt in de 'zonder'-transactie tijdelijk gedropt;
// ROLLBACK herstelt catalogus en data. Geen omgevingsdatabase is toegestaan.
async function faseSchrijfkosten() {
  const index = "idx_chunks_embedding_generiek_r1b";
  const columns = (await db.query(`select attname from pg_attribute where attrelid='public.document_chunks'::regclass
    and attnum > 0 and not attisdropped and attgenerated = '' and attidentity = '' order by attnum`)).rows.map((r) => r.attname);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const before = (await db.query(`select count(*)::int n, sum(chunk_index)::bigint som,
    md5(string_agg(id::text, ',' order by id)) ids from public.document_chunks`)).rows[0];
  const indexdef = (await db.query("select indexdef from pg_indexes where schemaname='public' and indexname=$1", [index])).rows[0]?.indexdef;
  if (!indexdef || !/m\s*=\s*'?32'?/.test(indexdef) || !/ef_construction\s*=\s*'?256'?/.test(indexdef)) throw new Error("definitieve partiële index ontbreekt of heeft verkeerde opbouw");
  const raw = [];
  const measure = async (sql) => {
    const p = (await db.query(`explain (analyze, buffers, wal, format json) ${sql}`)).rows[0]["QUERY PLAN"][0];
    return { ms: p["Execution Time"], rows: p.Plan.Plans?.[0]?.["Actual Rows"] ?? p.Plan["Actual Rows"] ?? null,
      hits: p.Plan["Shared Hit Blocks"] ?? 0, reads: p.Plan["Shared Read Blocks"] ?? 0,
      dirtied: p.Plan["Shared Dirtied Blocks"] ?? 0, wal_bytes: p.Plan["WAL Bytes"] ?? 0 };
  };
  for (const workload of ["bulkingest", "vervangen"]) for (let pair = 0; pair < 10; pair++) {
    for (const variant of pair % 2 === 0 ? ["met", "zonder"] : ["zonder", "met"]) {
      await db.query("begin");
      try {
        await db.query("set local statement_timeout = '120s'");
        if (variant === "zonder") await db.query(`drop index public.${index}`);
        const source = `select * from public.document_chunks where bibliotheek='generiek' order by id limit 1000`;
        let steps;
        if (workload === "bulkingest") {
          const selectList = columns.map((c) => c === "id" ? "gen_random_uuid()" : c === "chunk_index" ? "chunk_index + 100000" : `"${c}"`).join(", ");
          steps = [await measure(`insert into public.document_chunks (${colList}) select ${selectList} from (${source}) src`)];
        } else {
          await db.query(`create temporary table r1b_replace on commit drop as ${source}`);
          steps = [await measure("delete from public.document_chunks where id in (select id from r1b_replace)"),
            await measure(`insert into public.document_chunks (${colList}) select ${colList} from r1b_replace`)];
        }
        const result = { workload, pair: pair + 1, variant,
          rows: steps.at(-1).rows, ms: r2(steps.reduce((n, x) => n + x.ms, 0)),
          hits: steps.reduce((n, x) => n + x.hits, 0), reads: steps.reduce((n, x) => n + x.reads, 0),
          dirtied: steps.reduce((n, x) => n + x.dirtied, 0), wal_bytes: steps.reduce((n, x) => n + x.wal_bytes, 0) };
        if (result.rows !== 1000) throw new Error(`${workload}: ${result.rows} in plaats van 1000 rijen`);
        raw.push(result);
        console.log(JSON.stringify({ fase: "schrijfkosten", ...result }));
      } finally { await db.query("rollback"); }
    }
  }
  const after = (await db.query(`select count(*)::int n, sum(chunk_index)::bigint som,
    md5(string_agg(id::text, ',' order by id)) ids from public.document_chunks`)).rows[0];
  const indexAfter = (await db.query("select indexdef from pg_indexes where schemaname='public' and indexname=$1", [index])).rows[0]?.indexdef;
  if (JSON.stringify(before) !== JSON.stringify(after) || indexdef !== indexAfter) throw new Error("data-/cataloguspariteit na benchmark ontbreekt");
  const summary = Object.fromEntries(["bulkingest", "vervangen"].map((w) => {
    const pairs = Array.from({ length: 10 }, (_, i) => {
      const m = raw.find((x) => x.workload === w && x.pair === i + 1 && x.variant === "met");
      const z = raw.find((x) => x.workload === w && x.pair === i + 1 && x.variant === "zonder");
      return { pair: i + 1, delta_ms: r2(m.ms - z.ms), ratio: r3(m.ms / z.ms), met_ms: m.ms, zonder_ms: z.ms };
    });
    return [w, { pairs, median_delta_ms: pct(pairs.map((p) => p.delta_ms), 50), median_ratio: pct(pairs.map((p) => p.ratio), 50) }];
  }));
  schrijf(`schrijfkosten-definitief-${STAND}.json`, { stand: STAND, rows_per_run: 1000, pairs_per_workload: 10,
    full_index_kept: true, partial_index: index, before, after, catalog_equal: true, summary, raw });
}

// ── Fase: curve (exact_klein) ───────────────────────────────────────────────
// Actor A, productiefilterblok, vectorvraag vq1; documentscopes van oplopende
// grootte (prefixen van een vaste documentvolgorde) tot de hele zichtbare set.
// Per punt: exacte vectorarm alleen (r1b_proto.vec_arm 'exact'), 10 warm + 2
// buffer-koud; plus de volledige hybride aanroep (exact) 5 warm.
async function faseCurve() {
  const volgorde = [...reeks("a", 2, 38), doc("a", 1), doc("e", 3), doc("e", 4), ...reeks("e", 5, 26), doc("e", 1), doc("e", 2)];
  const doelen = [100, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, null];
  // Toelaatbare chunks per document (actor A, productiefilterblok).
  const okA = TOELAATBAAR["A/geen"];
  const perDoc = {};
  for (const id of okA) { const c = CHUNKS.get(id); perDoc[c.document_id] = (perDoc[c.document_id] ?? 0) + 1; }
  const punten = [];
  for (const doel of doelen) {
    let scope = null, n = okA.size;
    if (doel != null) {
      scope = []; n = 0;
      for (const d of volgorde) { if (n >= doel) break; scope.push(d); n += perDoc[d] ?? 0; }
    }
    const vecSql = `select * from r1b_proto.vec_arm(${VEC.vq1}, 40, ${arr(scope, "uuid")}, null, null, null, 'actueel', ${lit(PEILDATUM)}::date, ${arr(ACTOREN.A.bronsoort, "text")}, ${uuidLit(FONDS.A)}, 'exact')`;
    const hybSql = aanroepSql("exact", "A", scope, "pensioen transitieplan", VEC.vq1);
    const warm = [], koud = [], hyb = [];
    await explainAanroep(db, "A", vecSql);
    for (let k = 0; k < 10; k++) warm.push(await explainAanroep(db, "A", vecSql));
    for (let k = 0; k < 5; k++) hyb.push(await explainAanroep(db, "A", hybSql));
    if (admin) for (let k = 0; k < 2; k++) {
      await wisBuffers();
      const c = await verbind(PG_URL);
      try { koud.push(await explainAanroep(c, "A", vecSql)); } finally { await c.end(); }
    }
    const regel = {
      doel, documenten: scope ? scope.length : "alle", toelaatbare_chunks: n,
      vec_warm_ms: stat(warm.map((x) => x.ms_wand)), vec_warm_buffers: Math.round(gem(warm.map((x) => x.buffers))),
      vec_koud_ms: stat(koud.map((x) => x.ms_wand)), vec_koud_buffers: koud.length ? Math.round(gem(koud.map((x) => x.buffers))) : null,
      vec_koud_gelezen: koud.length ? Math.round(gem(koud.map((x) => x.gelezen))) : null,
      hybride_warm_ms: stat(hyb.map((x) => x.ms_wand)), hybride_warm_buffers: Math.round(gem(hyb.map((x) => x.buffers))),
    };
    punten.push(regel);
    console.log(JSON.stringify({ fase: "curve", ...regel }));
  }
  schrijf(`curve-${STAND}.json`, { stand: STAND, actor: "A", vector: "vq1", punten });
}

// ── Fase: plannen (auto_explain, superuser-verbinding, rol authenticated) ───
async function fasePlannen() {
  if (!ADMIN_URL) { console.log("plannen: --admin ontbreekt, overgeslagen"); return; }
  const adm = await verbind(ADMIN_URL);
  const notices = [];
  adm.on("notice", (n) => notices.push(n.message));
  for (const s of ["load 'auto_explain'", "set auto_explain.log_nested_statements = on", "set auto_explain.log_min_duration = 0",
    "set auto_explain.log_analyze = on", "set auto_explain.log_buffers = on", "set auto_explain.log_timing = off",
    "set auto_explain.log_level = notice", "set client_min_messages = notice"]) await adm.query(s);
  const tekst = [], bewijs = {};
  const v = VRAGEN.find((x) => x.naam === "norm") ?? VRAGEN[0];
  for (const route of ROUTES) {
    for (const s of ["geen", "klein"]) {
      const p = aanroepParams(route === "r1_tekst" ? "strikt" : "primair", v);
      notices.length = 0;
      await adm.query("begin");
      try {
        await adm.query(`select set_config('request.jwt.claims', ${lit(JSON.stringify(claims(USER.A)))}, true)`);
        await adm.query("set local role authenticated");
        await adm.query(`select count(*) from (${aanroepSql(route, "A", SCOPE_DEF.A[s], p.query, p.vec)}) x`);
      } catch (e) { notices.push(`FOUT: ${e.message}`); } finally { await adm.query("rollback"); }
      const plannen = notices.filter((n) => n.includes("plan:") && !/Query Text: (select|SELECT) (set_config|r1b_proto\.zet_knoppen|current_setting)/.test(n))
        .map((n) => n.replace(/'\[-?\d[^\]]{200,}\]'(::[a-z.()0-9]+)?/g, "'[…vector…]'").replace(/\[-?\d[^\]]{200,}\]/g, "[…vector…]"));
      const alles = plannen.join("\n");
      const armPlan = (pred) => plannen.filter((n) => n.includes(`c.bibliotheek = '${pred}'`) && !/count\(\*\)/.test(n)).join("\n");
      const gen = armPlan("generiek"), fonds = armPlan("fonds");
      bewijs[`${route}/${s}`] = {
        ...(ROUTE_DEF[route].soort === "split" ? { gen_partiele_index: gen.includes(PARTIEEL), gen_volledige_hnsw: /idx_chunks_embedding\b/.test(gen),
          fonds_hnsw: /idx_chunks_embedding|idx_r1b_chunks_embedding_generiek/.test(fonds), rls_initplan: /InitPlan|SubPlan/.test(alles) } : {}),
        idx_chunks_embedding: /idx_chunks_embedding\b/.test(alles), partiele_index: alles.includes(PARTIEEL),
        seq_scan_chunks: /Seq Scan on document_chunks/.test(alles),
        nested_loop: /Nested Loop/.test(alles),
      };
      tekst.push(`==== ${route} / scope ${s} (stand ${STAND}) ====\n${alles}\n`);
    }
    console.log(JSON.stringify({ fase: "plannen", route, bewijs: bewijs[`${route}/geen`] }));
  }
  fs.writeFileSync(path.join(UIT, `plannen-${STAND}.txt`), tekst.join("\n"));
  schrijf(`plannen-${STAND}.json`, bewijs);
  await adm.end();
}

// ── Fase: samenvatting (poorten per cel) ────────────────────────────────────
const POORT = { recall_gem: 0.95, recall_min: 0.9, aanroep_p95_ms: 5000, beurt_p95_ms: 20000, buffer_fractie_r0: 0.15 };
// B0.3 — meerdere HNSW-builds: per route × cel het SLECHTSTE resultaat (laagste
// recall-gemiddelde én laagste minimum, laagste cruciale top-3, som lekken) en
// het aantal builds waarin de cel op de kwaliteitspoorten groen was.
function samenvoegBouwen(kws) {
  if (kws.length === 1) return kws[0];
  const groen = (q) => (!q.recall_stat || (q.recall_stat.gem >= POORT.recall_gem && q.recall_stat.min >= POORT.recall_min))
    && q.cruciaal_top3_ok === q.vragen && q.lek === 0;
  const uit = { ...kws[0], bouwen: kws.map((k) => k.bouw), routes: {} };
  for (const route of Object.keys(kws[0].routes)) {
    uit.routes[route] = {};
    for (const cel of Object.keys(kws[0].routes[route])) {
      const qs = kws.map((k) => k.routes[route]?.[cel]).filter(Boolean);
      const slechtst = [...qs].sort((a, b) => (groen(a) - groen(b)) || (a.cruciaal_top3_ok - b.cruciaal_top3_ok) || ((a.recall_stat?.gem ?? 1) - (b.recall_stat?.gem ?? 1)))[0];
      const rs = qs.map((q) => q.recall_stat).filter(Boolean);
      uit.routes[route][cel] = { ...slechtst,
        recall_stat: rs.length ? { n: rs.reduce((a, r) => a + r.n, 0), gem: Math.min(...rs.map((r) => r.gem)), p50: Math.min(...rs.map((r) => r.p50)), min: Math.min(...rs.map((r) => r.min)), per_bouw: rs.map((r) => `${r.gem}/${r.min}`) } : null,
        cruciaal_top3_ok: Math.min(...qs.map((q) => q.cruciaal_top3_ok)), lek: qs.reduce((a, q) => a + q.lek, 0), buiten_filter: qs.reduce((a, q) => a + q.buiten_filter, 0),
        paden: Object.assign({}, ...qs.map((q) => q.paden)), deterministisch: qs.every((q) => q.deterministisch),
        vec_volgorde_identiek_aan_exact: Math.min(...qs.map((q) => q.vec_volgorde_identiek_aan_exact ?? 0)),
        bouwen_groen: `${qs.filter(groen).length}/${qs.length}` };
    }
  }
  return uit;
}
function faseSamenvatting() {
  const bouwBestanden = fs.readdirSync(UIT).filter((f) => new RegExp(`^kwaliteit-${STAND}-bouw\\d+\\.json$`).test(f)).sort();
  const kw = bouwBestanden.length ? samenvoegBouwen(bouwBestanden.map(leesJson)) : leesJson(`kwaliteit-${STAND}.json`);
  const me = leesJson(`meting-${STAND}.json`), ko = leesJson(`koud-${STAND}.json`);
  if (!kw || !me) { console.log("samenvatting: kwaliteit/meting ontbreekt"); return; }
  const routes = Object.keys(me.routes).filter((r) => kw.routes[r] || r === "R0");
  const cellen = Object.keys(me.routes[routes[0]]);
  const uit = { stand: STAND, poortversie: POORTVERSIE, poort: POORT, bouwen: kw.bouwen ?? null, routes: {} };
  for (const route of routes) {
    const perCel = {};
    for (const cel of cellen) {
      const m = me.routes[route]?.[cel], q = kw.routes[route]?.[cel], r0 = me.routes.R0?.[cel];
      if (!m) continue;
      const g = {};
      const tekst = route === "r1_tekst";
      g.recall = route === "R0" || tekst || !q?.recall_stat ? "n.v.t." : (q.recall_stat.gem >= POORT.recall_gem && q.recall_stat.min >= POORT.recall_min ? "ok" : "rood");
      // v2 (B0.2): cruciaal = alleen de top-3 van de referentiefusie; gouden
      // passages informatief.
      g.cruciaal = !q ? "n.v.t." : (POORTVERSIE === "v2" ? q.cruciaal_top3_ok : q.cruciaal_ok) === q.vragen ? "ok" : "rood";
      // Attributie (geen aparte poort): 'g' = uitsluitend gouden passages die
      // ook de referentie mist; 'C' = route-toerekenbaar (ref-top-3 of goud dat
      // de referentie wél heeft).
      const cruciaalAttr = !q || q.cruciaal_ok === q.vragen ? null : q.cruciaal_ok_excl_ref_goud === q.vragen ? "g" : "C";
      const b3 = tekst ? m.beurt2_ms_wand : m.beurt3_ms_wand;
      const fractie = r0 ? m.buffers_gem / r0.buffers_gem : null;
      const tijdOk = m.aanroep_ms_wand.p95 < POORT.aanroep_p95_ms && b3.p95 < POORT.beurt_p95_ms && m.fouten === 0;
      const bufOk = route === "R0" || (fractie != null && fractie < POORT.buffer_fractie_r0);
      if (POORTVERSIE === "v2") {
        // Tijd en buffers zijn lokaal GEEN poort (besluit): alleen waarschuwing.
        if (m.fouten > 0) g.fouten = "rood";
      } else {
        g.tijd_warm = tijdOk ? "ok" : "rood";
        g.buffers = route === "R0" ? "n.v.t." : bufOk ? "ok" : "rood";
      }
      const waarschuwingen = [...(bufOk ? [] : ["buffers≥15%R0"]), ...(tijdOk ? [] : ["tijd"])];
      g.lek = q ? (q.lek === 0 ? "ok" : "ROOD-LEK") : "n.v.t.";
      perCel[cel] = { poorten: g, waarschuwingen, paden: q?.paden ?? null, bouwen_groen: q?.bouwen_groen ?? null,
        vec_volgorde_identiek_aan_exact: q?.vec_runs ? `${q.vec_volgorde_identiek_aan_exact}/${q.vec_runs}` : null, cruciaal_top3: q ? `${q.cruciaal_top3_ok}/${q.vragen}` : null, cruciaal_attributie: cruciaalAttr, alle_ok: Object.values(g).every((x) => x === "ok" || x === "n.v.t."),
        alle_ok_excl_ref_goud: Object.entries(g).every(([p, x]) => x === "ok" || x === "n.v.t." || (p === "cruciaal" && cruciaalAttr === "g")),
        toelaatbaar_n: kw.routes.exact?.[cel]?.toelaatbaar_n ?? q?.toelaatbaar_n,
        ...(route === "R0" && q ? { pariteit_top10_met_exact: `${q.pariteit_top10_met_exact}/${q.vragen}` } : {}), recall: q?.recall_stat ?? null, vec_n_min: q?.vec_n_min ?? null,
        cruciaal: q ? `${q.cruciaal_ok}/${q.vragen}` : null, cruciaal_excl_ref_goud: q ? `${q.cruciaal_ok_excl_ref_goud}/${q.vragen}` : null, cruciaal_primair: q ? `${q.cruciaal_primair_ok}/${q.vragen}` : null,
        missers: q?.missers ?? [], gouden: q?.gouden ?? [], lek: q?.lek ?? null, buiten_filter: q?.buiten_filter ?? null, deterministisch: q?.deterministisch ?? null,
        aanroep_ms_wand: m.aanroep_ms_wand, aanroep_ms_server: m.aanroep_ms, beurt2_ms_wand: m.beurt2_ms_wand, beurt3_ms_wand: m.beurt3_ms_wand,
        buffers_gem: m.buffers_gem, buffers_max: m.buffers_max, buffers_per_soort: m.buffers_per_soort, r0_buffers_gem: r0?.buffers_gem ?? null,
        buffer_fractie_r0: fractie != null ? r3(fractie) : null, boven_8s: m.boven_8s, fouten: m.fouten };
    }
    const koud = ko?.routes?.[route] ?? [];
    const eerste = koud.map((x) => x.aanroepen[0].ms_wand), alleKoud = koud.flatMap((x) => x.aanroepen.map((a) => a.ms_wand));
    const beurtenKoud = koud.map((x) => (route === "r1_tekst" ? x.beurt2_ms_wand : x.beurt3_ms_wand));
    const koudOk = koud.length ? Math.max(...alleKoud) < POORT.aanroep_p95_ms && Math.max(...beurtenKoud) < POORT.beurt_p95_ms : null;
    uit.routes[route] = {
      cellen: perCel,
      rode_cellen: Object.entries(perCel).filter(([, c]) => !c.alle_ok).map(([k, c]) => `${k}: ${Object.entries(c.poorten).filter(([, x]) => x !== "ok" && x !== "n.v.t.").map(([p]) => (p === "cruciaal" ? `cruciaal(${c.cruciaal_attributie})` : p)).join("+")}`),
      rode_cellen_excl_ref_goud: Object.entries(perCel).filter(([, c]) => !c.alle_ok_excl_ref_goud).map(([k]) => k),
      koud: koud.length ? { metingen: koud.length, eerste_aanroep_ms_wand: stat(eerste), alle_aanroepen_ms_wand: stat(alleKoud), beurt_ms_wand: stat(beurtenKoud), poort_koud: koudOk ? "ok" : "rood",
        per_cel: koud.map((x) => ({ cel: x.cel, vraag: x.vraag, koud: x.koud, eerste_ms: x.aanroepen[0].ms_wand, eerste_gelezen: x.aanroepen[0].gelezen, beurt_ms: route === "r1_tekst" ? x.beurt2_ms_wand : x.beurt3_ms_wand })) } : null,
      lekken_totaal: Object.values(perCel).reduce((a, c) => a + (c.lek ?? 0), 0),
    };
  }
  schrijf(`samenvatting-${STAND}.json`, uit);
  fs.writeFileSync(path.join(UIT, `tabellen-${STAND}.md`), POORTVERSIE === "v2" ? tabellenV2(uit) : tabellen(uit, kw));
  for (const [r, x] of Object.entries(uit.routes)) console.log(JSON.stringify({ route: r, rode_cellen: x.rode_cellen.length, lekken: x.lekken_totaal, koud: x.koud?.poort_koud }));
}

// v2 (B0.2): poort = recall (R) + cruciale top-3 (C) + lek; w = waarschuwing
// buffers ≥ 15 % R0; g = gouden passage mist (informatief). Plus het gekozen pad.
function tabellenV2(s) {
  const routes = Object.keys(s.routes);
  const cellen = Object.keys(s.routes[routes[0]].cellen);
  const kort = (r) => r.replace("samen_", "s_").replace("iter_relaxed_", "rel").replace("tweetraps_", "2t");
  const code = (c) => {
    if (!c) return "–";
    let t = c.alle_ok ? "ok" : Object.entries(c.poorten).filter(([, x]) => x !== "ok" && x !== "n.v.t.").map(([p, x]) => (x === "ROOD-LEK" ? "**LEK**" : { recall: "R", cruciaal: "C", fouten: "F" }[p])).join("");
    if (c.waarschuwingen.includes("buffers≥15%R0")) t += "·w";
    if (c.gouden.some((g) => g.toepasbaar && !g.in_top10)) t += "·g";
    return t;
  };
  // 'leeg' = de vectorarm gaf 0 rijen (kan alleen op het HNSW-pad: exact geeft
  // altijd rijen als de toelaatbare set niet leeg is) ⇒ telt als H.
  // B0.3: split-paden 'gen_<route>+fonds_exact' ⇒ S; boven N_exact ⇒ S>N.
  const padCode = (c) => (c?.paden ? [...new Set(Object.keys(c.paden).map((p) => (p === "exact" ? "E" : p.startsWith("gen_") ? (p.includes("boven_n") ? "S>N" : "S") : "H")))].join("") : "");
  const L = [];
  L.push(`#### Poortmatrix ${s.bouwen ? "B0.3+" : "B0.2"} stand \`${s.stand}\` (poort = recall@40 + cruciale top-3 + lek${s.bouwen ? `, SLECHTSTE van ${s.bouwen.length} HNSW-builds; x/n = builds waarin de cel groen was` : ""}; R = recall rood, C = cruciale top-3 mist, **LEK**; ·w = waarschuwing buffers ≥ 15 % R0; ·g = gouden passage mist (informatief); [E]/[H] = pad exact/HNSW; [S] = gesplitst (generiek HNSW-partieel + fonds exact), [S>N] = fondsset boven N_exact, fondsarm tóch exact)\n`);
  L.push(`| cel (N) | ${routes.map(kort).join(" | ")} |`);
  L.push(`|---|${routes.map(() => "---").join("|")}|`);
  for (const cel of cellen) L.push(`| ${cel} (${s.routes[routes[0]].cellen[cel].toelaatbaar_n}) | ${routes.map((r) => { const c = s.routes[r].cellen[cel]; const p = padCode(c); return code(c) + (p ? ` [${p}]` : "") + (c?.bouwen_groen && s.bouwen ? ` ${c.bouwen_groen}` : ""); }).join(" | ")} |`);
  L.push("");
  L.push(`#### Rode cellen per route — stand \`${s.stand}\` (v2)\n`);
  L.push("| route | rood / 36 | pad (cellen) | waarschuwing buffers (cellen) | rode cellen |");
  L.push("|---|---|---|---|---|");
  for (const r of routes) {
    const cs = Object.values(s.routes[r].cellen);
    const tel = {};
    for (const c of cs) { const p = padCode(c); if (p) tel[p] = (tel[p] ?? 0) + 1; }
    L.push(`| ${r} | ${s.routes[r].rode_cellen.length} | ${Object.keys(tel).length ? Object.entries(tel).map(([k, v]) => `${k}: ${v}`).join(", ") : "–"} | ${cs.filter((c) => c.waarschuwingen.includes("buffers≥15%R0")).length} | ${s.routes[r].rode_cellen.join("; ") || "–"} |`);
  }
  L.push("");
  L.push(`#### Detail per cel — stand \`${s.stand}\`: recall gem/min · cruciale top-3 behouden · buffers gem (÷R0) · ms p95 aanroep · ms p95 beurt 3\n`);
  L.push(`| cel | ${routes.map(kort).join(" | ")} |`);
  L.push(`|---|${routes.map(() => "---").join("|")}|`);
  for (const cel of cellen) L.push(`| ${cel} | ${routes.map((r) => { const c = s.routes[r].cellen[cel]; return `${c.recall ? `${c.recall.gem}/${c.recall.min}` : "–"} · ${c.cruciaal_top3 ?? "–"} · ${c.buffers_gem} (${c.buffer_fractie_r0 ?? "–"}) · ${c.aanroep_ms_wand.p95} · ${c.beurt3_ms_wand.p95 ?? "–"}`; }).join(" | ")} |`);
  L.push("");
  L.push(`#### Koud (eerste aanroep, verse verbinding) — stand \`${s.stand}\`\n`);
  L.push("| route | eerste aanroep p50 / max ms | alle koude aanroepen max | beurt max |");
  L.push("|---|---|---|---|");
  for (const r of routes) { const k = s.routes[r].koud; L.push(k ? `| ${r} | ${k.eerste_aanroep_ms_wand.p50} / ${k.eerste_aanroep_ms_wand.max} | ${k.alle_aanroepen_ms_wand.max} | ${k.beurt_ms_wand.max} |` : `| ${r} | – | – | – |`); }
  L.push("");
  return L.join("\n");
}

function tabellen(s, kw) {
  const routes = Object.keys(s.routes);
  const cellen = Object.keys(s.routes[routes[0]].cellen);
  const L = [];
  const code = (c) => {
    if (!c) return "–";
    if (c.alle_ok) return "ok";
    return Object.entries(c.poorten).filter(([, x]) => x !== "ok" && x !== "n.v.t.").map(([p, x]) => (x === "ROOD-LEK" ? "**LEK**" : p === "cruciaal" ? c.cruciaal_attributie : { recall: "R", tijd_warm: "T", buffers: "B" }[p])).join("");
  };
  L.push(`### Poortmatrix stand \`${s.stand}\` (ok = alle poorten groen; R = recall@40; C = cruciale bron mist, route-toerekenbaar; g = cruciaal rood UITSLUITEND door een gouden passage die ook de referentie niet in haar top-10 heeft; T = tijd warm; B = buffers ≥ 15 % R0; **LEK** = tenantlek)\n`);
  L.push(`| cel (fonds/scope/type) | ${routes.join(" | ")} |`);
  L.push(`|---|${routes.map(() => "---").join("|")}|`);
  for (const cel of cellen) L.push(`| ${cel} | ${routes.map((r) => code(s.routes[r].cellen[cel])).join(" | ")} |`);
  L.push("");
  L.push(`### Routes die álle cellen halen (stand \`${s.stand}\`)\n`);
  const groen = routes.filter((r) => r !== "R0" && s.routes[r].rode_cellen.length === 0);
  L.push(`Strikt (gouden passages tellen altijd mee): ${groen.length ? groen.map((r) => `\`${r}\`${s.routes[r].koud ? ` (koud: ${s.routes[r].koud.poort_koud})` : ""}`).join(", ") : "geen"}.\n`);
  const groenG = routes.filter((r) => r !== "R0" && s.routes[r].rode_cellen_excl_ref_goud.length === 0);
  L.push(`Zonder gouden passages die ook de referentie mist (attributie, geen poort): ${groenG.length ? groenG.map((r) => `\`${r}\``).join(", ") : "geen"}.\n`);
  L.push("Rode cellen per route (strikt):\n");
  for (const r of routes) L.push(`- \`${r}\` (${s.routes[r].rode_cellen.length}): ${s.routes[r].rode_cellen.join("; ") || "–"}`);
  L.push("");
  L.push(`### Koude eerste aanroep per route (stand \`${s.stand}\`; ms wandklok, verse verbinding; buffer_koud = shared buffers gewist)\n`);
  L.push("| route | eerste aanroep p50 / max | alle koude aanroepen max | beurt max | poort koud | per cel: eerste aanroep ms (verbinding_koud / buffer_koud) |");
  L.push("|---|---|---|---|---|---|");
  for (const r of routes) {
    const k = s.routes[r].koud;
    if (!k) { L.push(`| ${r} | – | – | – | – | – |`); continue; }
    const pc = {};
    for (const x of k.per_cel) (pc[`${x.cel} ${x.vraag}`] ??= {})[x.koud] = x.eerste_ms;
    L.push(`| ${r} | ${k.eerste_aanroep_ms_wand.p50} / ${k.eerste_aanroep_ms_wand.max} | ${k.alle_aanroepen_ms_wand.max} | ${k.beurt_ms_wand.max} | ${k.poort_koud} | ${Object.entries(pc).map(([c, x]) => `${c}: ${r1(x.verbinding_koud ?? NaN)}/${r1(x.buffer_koud ?? NaN)}`).join("; ")} |`);
  }
  L.push("");
  for (const r of routes) {
    L.push(`#### Route \`${r}\` — stand \`${s.stand}\`\n`);
    L.push("| cel | N toelaatbaar | recall@40 gem / p50 / min (n) | vec n min | cruciaal beurt (excl. ref-goud) / primair-top3 | gouden | ms/aanroep p50 / p95 / max | beurt 2 p95 | beurt 3 p50 / p95 / max | buffers gem (max) | ÷ R0 | lek | buiten filter | poorten |");
    L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const cel of cellen) {
      const c = s.routes[r].cellen[cel];
      if (!c) continue;
      const rc = c.recall ? `${c.recall.gem} / ${c.recall.p50} / ${c.recall.min} (${c.recall.n})` : "n.v.t.";
      const gd = c.gouden.filter((g) => g.toepasbaar);
      const goud = gd.length ? gd.map((g) => `${g.vraag}:${g.groep}=${g.in_top10 ? "ja" : "NEE"}${g.in_referentie_top10 ? "" : "(ref nee)"}`).join(", ") : "–";
      const a = c.aanroep_ms_wand, b2 = c.beurt2_ms_wand, b3 = c.beurt3_ms_wand;
      L.push(`| ${cel} | ${c.toelaatbaar_n ?? "–"} | ${rc} | ${c.vec_n_min ?? "–"} | ${c.cruciaal ?? "–"} (${c.cruciaal_excl_ref_goud ?? "–"}) / ${c.cruciaal_primair ?? "–"}${c.pariteit_top10_met_exact ? ` · top10=exact ${c.pariteit_top10_met_exact}` : ""} | ${goud} | ${a.p50} / ${a.p95} / ${a.max} | ${b2.p95 ?? "–"} | ${b3.n ? `${b3.p50} / ${b3.p95} / ${b3.max}` : "n.v.t."} | ${c.buffers_gem} (${c.buffers_max}) | ${c.buffer_fractie_r0 ?? "–"} | ${c.lek ?? "–"} | ${c.buiten_filter ?? "–"} | ${code(c)} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

async function main() {
  db = await verbind(PG_URL);
  if (FASEN.length === 1 && FASEN[0] === "catalogus") { try { await faseCatalogus(); } finally { await db.end(); } return; }
  let herstelVolledigeIndex = null;
  try {
    if (ADMIN_URL && FASEN.some((f) => ["koud", "curve", "beslis"].includes(f))) {
      admin = await verbind(ADMIN_URL);
      // pg_buffercache (PG17: pg_buffercache_evict) — alleen lokaal, superuser.
      await admin.query("create extension if not exists pg_buffercache with schema extensions");
      await admin.query("set search_path = extensions, public");
    }
    const info = (await db.query(`select (select count(*) from public.document_chunks where embedding_model like 'pr0-zoekpad%')::int chunks,
      (select count(*) from public.document_chunks where embedding_model = 'pr0-zoekpad-bmatch')::int bmatch,
      (select count(*) from public.documenten where id::text like '00000000-0000-4000-d000-%')::int docs, version() pg,
      (select extversion from pg_extension where extname='vector') pgvector, current_setting('shared_buffers') shared_buffers`)).rows[0];
    console.log(JSON.stringify({ stand: STAND, fixture: info }));
    if (FASEN.some((f) => f !== "samenvatting") && STAND !== "bprod" && (STAND === "b0") !== (info.bmatch === 0)) throw new Error(`stand ${STAND} past niet bij de fixture (${info.bmatch} b_match-chunks)`);
    if (FASEN.some((f) => f !== "samenvatting")) await laadVectoren();
    if (FASEN.some((f) => f !== "guc" && f !== "samenvatting")) await laadGrondwaarheid();
    if (FASEN.some((f) => f !== "samenvatting")) schrijf(`fixture-${STAND}.json`, { ...info, toelaatbaar: Object.fromEntries(Object.entries(TOELAATBAAR).map(([k, v]) => [k, v.size])), vectoren: VEC_HERKOMST });
    if (ZONDER_VOLLEDIGE_INDEX) {
      if (FASEN.join(",") !== "kwaliteit" ||
          !["exact,R0,definitief", "exact,definitief"].includes(ROUTES.join(",")))
        throw new Error("--zonder-volledige-index mag alleen voor kwaliteit met exact en definitief, eventueel R0");
      const indexdef = (await db.query(`select indexdef from pg_indexes
        where schemaname='public' and indexname='idx_chunks_embedding'`)).rows[0]?.indexdef;
      if (!/^CREATE INDEX idx_chunks_embedding ON public\.document_chunks USING hnsw /i.test(indexdef ?? ""))
        throw new Error("Onverwachte of ontbrekende definitie van de volledige HNSW-index");
      await db.query("drop index public.idx_chunks_embedding");
      herstelVolledigeIndex = indexdef;
    }
    if (BOUW) await herbouwIndexen();
    if (FASEN.includes("consistentie")) await faseConsistentie();
    if (FASEN.includes("planbewijs")) await fasePlanbewijs();
    if (FASEN.includes("beslisplan")) await faseBeslisplan();
    if (FASEN.includes("diagnose")) await faseDiagnose();
    if (FASEN.includes("integriteit")) await faseIntegriteit();
    if (FASEN.includes("borgingskosten")) await faseBorgingskosten();
    if (FASEN.includes("aanmaak06")) await faseAanmaak06();
    if (FASEN.includes("telling08")) await faseTelling08();
    if (FASEN.includes("aanmaak08")) await faseAanmaak08();
    if (FASEN.includes("commit08")) await faseCommit08();
    if (FASEN.includes("regressie07")) await faseRegressie07();
    if (FASEN.includes("wissel07")) await faseWissel07();
    if (FASEN.includes("kosten06")) await faseKosten06();
    if (FASEN.includes("schrijfkosten")) await faseSchrijfkosten();
    if (FASEN.includes("guc")) await faseGuc();
    if (FASEN.includes("kwaliteit")) await faseKwaliteit();
    if (FASEN.includes("meting")) await faseMeting();
    if (FASEN.includes("koud")) await faseKoud();
    if (FASEN.includes("beslis")) await faseBeslis();
    if (FASEN.includes("curve")) await faseCurve();
    if (FASEN.includes("plannen")) await fasePlannen();
    if (FASEN.includes("samenvatting")) faseSamenvatting();
  } finally {
    try {
      if (herstelVolledigeIndex) {
        await db.query("set statement_timeout = '180s'");
        await db.query(herstelVolledigeIndex);
        console.log(JSON.stringify({ volledige_index_hersteld: true }));
      }
    } finally {
      await db.end();
      if (admin) await admin.end();
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
