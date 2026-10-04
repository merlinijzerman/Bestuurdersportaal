// ============================================================================
//  #505 — performancetest: de vier pilotvragen binnen het retrievalbudget,
//  ZONDER één database-time-out, met een JWT van productieomvang.
// ----------------------------------------------------------------------------
//  WAAROM. Op Productie kostte één `zoek_chunks`-aanroep onder RLS met een
//  realistische JWT 17–21 s (read-only gemeten 02-10-2026), tegen een
//  statement_timeout van 8 s: de policies parseten `request.jwt.claims` per
//  rij. Na `2026_10_02_505_rls_auth_uid_initplan` gebeurt dat één keer per
//  statement. Deze test eist dat de normale vragen daardoor via het NORMALE pad
//  slagen, niet via de time-outroute.
//
//  NORMALE INSTELLINGEN — geen kunstmatige verkrapping. De test controleert dat
//  de rol `authenticated` de statement_timeout van Productie en de stack draagt
//  (8 s) en dat het fonds géén eigen `retrieval_timeout_ms` heeft (dan geldt
//  het standaardbudget van 20 s, `TIMEOUT_DEFAULT_MS`). Hij verandert geen van
//  beide.
//
//  REALISTISCHE JWT. Per doelomvang (standaard ~0,9 kB en ~1,5 kB claims) zet
//  het script synthetische Microsoft-/Azure-gebruikersmetadata (Supabase neemt
//  `user_metadata` integraal op in de access token), logt in via GoTrue en
//  controleert de werkelijke claimomvang (±15 %). Herstel in `finally`.
//
//  ACCEPTATIE, per JWT-omvang en voor alle vier vragen (bedoeling, norm,
//  gecombineerd, reglement):
//    - afgerond zonder error-event, zonder "duurde te lang" en zonder 57014;
//    - `invoer.retrieval_fasetijden` aanwezig, GEEN fase met status
//      `db_timeout`, geen `fallback_reason: volscan_begrensd`;
//    - totaal < budget (20 s) en elke gerangschikte RPC-fase (`rpc_fts`,
//      `rpc_hybride`) < een kwart van het budget ("ruim binnen budget");
//    - 150d-vragen: `selectie.juridisch.artikel` exact ≥ 1 en geboost ≥ 1;
//      bedoeling: eerste wetsgeschiedenis = MvT p.395 en wet geselecteerd;
//      norm: wet eerst; gecombineerd: wet én MvT p.395, wet vóór MvT;
//    - reglement: géén `selectie.juridisch.artikel`.
//  CI draait dit tweemaal: server mét volscanbegrenzing (productieconfiguratie)
//  en server met `ARTIKELFOCUS_VOLSCANBEGRENZING=off`. De tweede toont dat #505
//  zelf de marge geeft. Het GEDRAG van de begrenzing (#516) wordt los en
//  deterministisch bewezen in `artikelspoor-516-gedrag.mjs` — niet via timing.
//
//  Grenzen van dit bewijs: lokaal is de database sneller dan Productie, dus
//  deze test onderscheidt vóór/na #505 niet scherp (de vóór-stand haalt de
//  grens lokaal net). Het vóór/na-verschil staat in de meting
//  (`rls-505-meting.mjs`); deze test borgt dat de normale route binnen budget
//  blijft. Op Productie toetst `supabase/checks/2026_10_02_505_releasecheck_
//  productie.sql` hetzelfde op echte beurten.
//
//  DRAAIRECEPT: zie `artikelspoor-500-keten.mjs` (stack, migraties, seed,
//  fixture met `art500_behoud=1`, build, stubs). Daarna, zonder HYBRID_SEARCH:
//    PORT=3006 APP_BASE_URL=http://127.0.0.1:3006 npm run start &
//    APP_BASE_URL=http://127.0.0.1:3006 node --env-file=.env.local \
//      tests/karakterisering/artikelspoor-500-budget.mjs
//  Uitsluitend lokaal (SEED_DOELOMGEVING=local, loopback-database).
// ============================================================================
import { pathToFileURL } from "node:url";
import pg from "pg";
import { ENV, FONDS_ID, WACHTWOORD, emailVoor } from "./config.mjs";
import { adminClient, seed } from "./seed.mjs";
import { controleerTekstzoekpad } from "./zoektekst-fondsvlag.mjs";
import { sessieCookies } from "./sessie.mjs";
import { bevestigVeiligeSeedDoelomgeving } from "./seed-doelomgeving.mjs";
import { VRAGEN, beschrijfChunks, concurrenten, juridischePassages, stelVraag } from "./artikelspoor-500-keten.mjs";

const BUDGET_MS = 20_000; // TIMEOUT_DEFAULT_MS (core/lib/retrieval/afbreken.ts)
const VERWACHTE_STATEMENT_TIMEOUT = "8s"; // Productie en de stack-default
const DB_URL = process.env.ART500_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OMVANGEN = (process.env.ART505_JWT_OMVANGEN ?? "900,1500").split(",").map(Number);

/** Synthetische Azure-metadata; `groepen` vult aan tot de doelomvang. */
function metadata(aantalGroepen) {
  return {
    custom_claims: { tid: "00000000-1111-2222-3333-444444444444" },
    email: "pilot.bestuurder@voorbeeld-fonds.invalid",
    email_verified: true,
    full_name: "Pilot Bestuurder",
    iss: "https://login.microsoftonline.com/00000000-1111-2222-3333-444444444444/v2.0",
    name: "Pilot Bestuurder",
    provider_id: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
    sub: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
    groepen: Array.from({ length: aantalGroepen }, (_, i) => `0000000${i % 10}-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`),
  };
}

function bevestigLokaleDatabase(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) {
    throw new Error(`Weigering: ${host} is geen lokale database.`);
  }
}

function jwtClaimOmvang(accessToken) {
  const payload = accessToken.split(".")[1] ?? "";
  return Buffer.from(payload, "base64url").toString("utf8").length;
}

export async function main() {
  bevestigVeiligeSeedDoelomgeving({ url: ENV.url });
  if (process.env.SEED_DOELOMGEVING !== "local") throw new Error("Alleen lokaal (SEED_DOELOMGEVING=local).");
  bevestigLokaleDatabase(DB_URL);

  const admin = adminClient();
  const { users } = await seed(admin);
  const { count } = await admin
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("embedding_model", "art500-perf");
  if ((count ?? 0) < 18418) throw new Error(`Fixture ontbreekt (${count ?? 0} art500-perf-chunks).`);
  const { error: cErr } = await admin.from("document_chunks").upsert(concurrenten(), { onConflict: "id" });
  if (cErr) throw new Error(`concurrenten: ${cErr.message}`);

  const bestuurder = users.bestuurder;
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const { rows: oud } = await db.query("select raw_user_meta_data from auth.users where id = $1", [bestuurder.userId]);
  const uitkomst = { budget_ms: BUDGET_MS, begrenzing: process.env.ART505_BEGRENZING_LABEL ?? "?", omvangen: {} };
  const fouten = [];
  const eis = (ok, tekst) => {
    if (!ok) fouten.push(tekst);
  };
  const metas = []; // R1 (0218) — markercontrole per ronde (ART_VERWACHT_TEKSTZOEKPAD)
  try {
    // 1. Normale instellingen: niets verkrappen, alleen vaststellen.
    const { rows: rol } = await db.query(
      "select coalesce((select c from unnest(rolconfig) c where c like 'statement_timeout=%'), '') as st from pg_roles where rolname = 'authenticated'"
    );
    uitkomst.statement_timeout = rol[0]?.st ?? "";
    eis(uitkomst.statement_timeout === `statement_timeout=${VERWACHTE_STATEMENT_TIMEOUT}`,
      `authenticated draagt niet de normale statement_timeout (${uitkomst.statement_timeout || "geen"})`);
    const { rows: vlag } = await db.query(
      "select waarde from public.fonds_feature_flags where fonds_id = $1 and flag_key = 'retrieval_timeout_ms'", [FONDS_ID]
    );
    eis(vlag.length === 0, `het fonds heeft een eigen retrieval_timeout_ms (${JSON.stringify(vlag[0]?.waarde)}); verwacht het standaardbudget`);

    const passages = await juridischePassages(admin);

    for (const doel of OMVANGEN) {
      // 2. Metadata op doelomvang; meet de werkelijke claims en stel bij.
      let groepen = 0;
      let sessie;
      let bytes = 0;
      for (let poging = 0; poging < 4; poging++) {
        await db.query("update auth.users set raw_user_meta_data = $2::jsonb where id = $1",
          [bestuurder.userId, JSON.stringify({ ...(oud[0]?.raw_user_meta_data ?? {}), ...metadata(groepen) })]);
        sessie = await sessieCookies({ url: ENV.url, anonKey: ENV.anonKey, email: emailVoor("bestuurder"), password: WACHTWOORD });
        bytes = jwtClaimOmvang(sessie.session.access_token);
        if (Math.abs(bytes - doel) <= doel * 0.05) break;
        groepen = Math.max(0, groepen + Math.round((doel - bytes) / 40));
      }
      const r = { jwt_claims_bytes: bytes, vragen: {} };
      uitkomst.omvangen[doel] = r;
      eis(Math.abs(bytes - doel) <= doel * 0.15, `JWT-claims ${bytes} B wijken > 15 % af van doel ${doel} B`);

      for (const { naam, vraag } of VRAGEN) {
        const a = await stelVraag(admin, sessie.cookieHeader, bestuurder.userId, vraag);
        const fout = a.events.find((e) => e.type === "error");
        const klaar = a.events.some((e) => e.type === "done");
        const meta = a.log?.retrieval_meta ?? null;
        metas.push(meta);
        const fasetijden = meta?.invoer?.retrieval_fasetijden ?? null;
        const fasen = fasetijden?.fasen ?? [];
        const bronnen = beschrijfChunks(passages, meta);
        const artikel = meta?.selectie?.juridisch?.artikel ?? null;
        const stroom = JSON.stringify(a.events);
        const rpcFasen = fasen.filter((f) => f.fase === "rpc_fts" || f.fase === "rpc_hybride");
        r.vragen[naam] = {
          duur_ms: a.duurMs,
          retrieval_ms: fasetijden?.totaal_ms ?? null,
          methode: meta?.methode ?? null,
          fallback_reason: meta?.fallback_reason ?? null,
          fasen: fasen.map((f) => `${f.fase}${f.poging ? `/${f.poging}` : ""}:${f.status}:${f.ms}`),
          bronnen: bronnen.map((b) => `${b.document}${b.pw150d ? " art.150d" : ""}${b.mvtP395 ? " p.395" : ""}`),
        };
        const t = `${doel} B / ${naam}`;
        eis(a.status === 200 && klaar && !fout, `${t}: niet afgerond (fout ${fout?.error ?? "-"})`);
        eis(!/duurde te lang|57014|statement timeout/i.test(stroom), `${t}: time-out in de stroom`);
        eis(Boolean(fasetijden), `${t}: geen invoer.retrieval_fasetijden`);
        const dbTimeouts = fasen.filter((f) => f.status === "db_timeout");
        eis(dbTimeouts.length === 0, `${t}: ${dbTimeouts.length} fase(n) met 57014 (${dbTimeouts.map((f) => `${f.fase}/${f.poging ?? "-"}`).join(", ")})`);
        eis(meta?.fallback_reason !== "volscan_begrensd", `${t}: via de time-outroute (volscan_begrensd)`);
        eis((fasetijden?.totaal_ms ?? Infinity) < BUDGET_MS, `${t}: retrieval ${fasetijden?.totaal_ms} ms ≥ budget ${BUDGET_MS} ms`);
        for (const f of rpcFasen) {
          eis(f.ms < BUDGET_MS / 4, `${t}: ${f.fase}/${f.poging ?? "-"} ${f.ms} ms niet ruim binnen budget (< ${BUDGET_MS / 4} ms)`);
        }
        if (naam === "reglement") {
          eis(artikel === null, `${t}: selectie.juridisch.artikel hoort te ontbreken`);
          continue;
        }
        eis((artikel?.exact ?? 0) >= 1, `${t}: artikel.exact < 1`);
        eis((artikel?.geboost_geselecteerd ?? 0) >= 1, `${t}: artikel.geboost_geselecteerd < 1`);
        const wet = bronnen.findIndex((b) => b.pw150d);
        const mvt = bronnen.findIndex((b) => b.documenttype === "wetsgeschiedenis");
        if (naam === "bedoeling") eis(bronnen[mvt]?.mvtP395 === true && wet >= 0, `${t}: MvT p.395/wet ontbreekt`);
        if (naam === "norm") eis(wet >= 0 && (mvt === -1 || wet < mvt), `${t}: wet niet eerst`);
        if (naam === "gecombineerd") {
          eis(wet >= 0 && mvt >= 0 && wet < mvt, `${t}: wet en MvT niet beide, of wet niet vóór MvT`);
          eis(bronnen[mvt]?.mvtP395 === true, `${t}: eerste MvT-passage is niet p.395`);
        }
      }
    }
  } finally {
    await db
      .query("update auth.users set raw_user_meta_data = $2::jsonb where id = $1", [bestuurder.userId, JSON.stringify(oud[0]?.raw_user_meta_data ?? {})])
      .catch(() => {});
    await db.end();
  }

  for (const f of controleerTekstzoekpad(metas)) fouten.push(`tekstzoekpad: ${f}`);
  console.log(JSON.stringify(uitkomst, null, 2));
  if (fouten.length > 0) {
    console.error(`ROOD: ${fouten.join(" | ")}`);
    process.exit(1);
  }
  console.log(
    `GROEN (#505, begrenzing ${uitkomst.begrenzing}): vier vragen × ${OMVANGEN.length} JWT-omvangen binnen het budget, zonder 57014.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
