// ============================================================================
//  #500 — de GECOMBINEERDE 150d-vraag binnen het retrievalbudget, onder een
//  geschaalde replica van de productieomstandigheden.
// ----------------------------------------------------------------------------
//  WAAROM DEZE TEST. Op Productie (02-10-2026) eindigde de gecombineerde vraag
//  tweemaal na ~20 s in `retrieval:timeout`. Read-only gemeten als
//  authenticated (fonds m365-demo, ~18k chunks na de legacy-rescan):
//    - elke `zoek_chunks`-aanroep is onder RLS een volledige scan; de policy
//      evalueert `auth.uid()` (een jsonb-parse van `request.jwt.claims`) per rij;
//    - met een minimale claimset 1,5 s per aanroep, met een JWT van
//      productieomvang (~0,5–0,9 kB) 6–12 s — tegen een statement_timeout van 8 s;
//    - de FTS-keten deed er tot vier na elkaar (strikt → verslapt → plain →
//      ilike): 8 + 8 + … > 20 s.
//  De bestaande keten-test (`artikelspoor-500-keten.mjs`) zag dit niet: hij
//  draait met een JWT van ~0,1 kB op een snelle lokale CPU (0,3 s per aanroep).
//
//  DE GESCHAALDE REPLICA. Lokaal kost dezelfde aanroep met een JWT van
//  productieomvang ~2 s (Productie 8–12 s; factor ~4–5). Deze test schaalt
//  daarom de twee grenzen in dezelfde verhouding als Productie (8 s / 20 s = 0,4):
//    statement_timeout van `authenticated` = 2 s, retrievalbudget = 5 s
//  en geeft de W1-bestuurder een JWT van productieomvang. Daarmee ontstaat lokaal
//  precies het productiepatroon: beide gerangschikte FTS-aanroepen breken af met
//  57014, en de oude keten scant daarna nog twee keer.
//
//  ACCEPTATIE (`ART500_BUDGET_VERWACHTING=groen`, de fix aan):
//    - alle drie 150d-vragen ronden af zonder error-event of time-out;
//    - `invoer.retrieval_fasetijden.totaal_ms` < het budget;
//    - gecombineerd: Pensioenwet 150d én MvT p.395 geselecteerd, wet vóór MvT;
//      bedoeling: eerste wetsgeschiedenis = MvT p.395; norm: wet eerst;
//    - `selectie.juridisch.artikel`: exact ≥ 1, geboost_geselecteerd ≥ 1.
//  NEGATIEVE CONTROLE (`ART500_BUDGET_VERWACHTING=rood`, server met
//  `ARTIKELFOCUS_VOLSCANBEGRENZING=off`): de gecombineerde vraag eindigt in een
//  time-out OF haar retrieval duurt aantoonbaar langer (≥ 1,5× de groene run,
//  doorgegeven via `ART500_GROEN_MS`). De reglementvraag (géén artikelfocus,
//  dus buiten deze hotfix) wordt alleen gerapporteerd: zij laat zien dat
//  vragen zonder artikelfocus onder dezelfde RLS-kosten krap blijven (#505).
//
//  #505 (RLS-InitPlan, 02-10-2026). Sinds `2026_10_02_505_rls_auth_uid_initplan`
//  evalueert de RLS `auth.uid()` eenmaal per statement; de JWT-omvang drukt dan
//  niet meer per rij op de kosten en de oude, sequentiële FTS-keten past zelf
//  binnen het geschaalde budget. Daarom twee aanvullingen:
//    - `ART500_BUDGET_VERWACHTING=groen-505` (#505 toegepast; CI draait haar
//      met de begrenzing aan én met ARTIKELFOCUS_VOLSCANBEGRENZING=off): de
//      tweede bewijst dat #505 ZELF de marge geeft — alle VIER vragen (ook de reglementvraag, die buiten
//      de #500-hotfix valt) ronden af zonder 57014/time-out en binnen het budget.
//      De gelijktijdigheidseis van de begrenzing geldt hier bewust niet: met
//      #505 slaagt de strikte poging, dus wordt de verslapte niet gebruikt.
//    - `ART500_REGLEMENT_EISEN=1` (bij `groen`): ook de reglementvraag moet
//      zonder time-out en binnen het budget afronden.
//  De #500-negatieve controle (`rood`) bewijst nog steeds dat de begrenzing
//  werkt: zij draait in CI met de RLS-kosten van vóór #505, door het
//  #505-rollbackscript tijdelijk toe te passen (en daarna de migratie opnieuw;
//  zie .github/workflows/karakterisering.yml). Zonder die opzet zou de
//  begrenzing op een snelle database niets meer te begrenzen hebben, en zou de
//  controle niets bewijzen.
//
//  DRAAIRECEPT: zie `artikelspoor-500-keten.mjs` (stack, migraties, seed,
//  fixture met `art500_behoud=1`, build, beide stubs). Daarna, ZONDER
//  HYBRID_SEARCH (Productie draait voor dit fonds het FTS-pad):
//    PORT=3006 APP_BASE_URL=http://127.0.0.1:3006 npm run start &
//    APP_BASE_URL=http://127.0.0.1:3006 node --env-file=.env.local \
//      tests/karakterisering/artikelspoor-500-budget.mjs
//  en voor de negatieve controle dezelfde server met
//  ARTIKELFOCUS_VOLSCANBEGRENZING=off en ART500_BUDGET_VERWACHTING=rood.
//  Het script zet de rolinstelling, de fondsvlag en de gebruikersmetadata zelf
//  en herstelt ze in `finally`. Uitsluitend lokaal (SEED_DOELOMGEVING=local,
//  loopback-database).
// ============================================================================
import { pathToFileURL } from "node:url";
import pg from "pg";
import { ENV, FONDS_ID, WACHTWOORD, emailVoor } from "./config.mjs";
import { adminClient, seed } from "./seed.mjs";
import { sessieCookies } from "./sessie.mjs";
import { bevestigVeiligeSeedDoelomgeving } from "./seed-doelomgeving.mjs";
import { VRAGEN, beschrijfChunks, concurrenten, juridischePassages, stelVraag } from "./artikelspoor-500-keten.mjs";

const STATEMENT_TIMEOUT = "2s";
const BUDGET_MS = 5_000;
const DB_URL = process.env.ART500_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Gebruikersmetadata zoals een Microsoft-/Azure-login die in de JWT zet
 * (Supabase neemt `user_metadata` integraal op in de access token). Synthetisch;
 * de omvang (~0,6 kB metadata, ~0,9 kB claims) is waar het om gaat.
 */
const PRODUCTIEMETADATA = {
  custom_claims: { tid: "00000000-1111-2222-3333-444444444444" },
  email: "pilot.bestuurder@voorbeeld-fonds.invalid",
  email_verified: true,
  full_name: "Pilot Bestuurder",
  iss: "https://login.microsoftonline.com/00000000-1111-2222-3333-444444444444/v2.0",
  name: "Pilot Bestuurder",
  phone_verified: false,
  provider_id: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
  sub: "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
  picture: "https://graph.microsoft.invalid/v1.0/me/photos/48x48/$value",
  preferred_username: "pilot.bestuurder@voorbeeld-fonds.invalid",
  tenant_naam: "Stichting Pensioenfonds Voorbeeld — bestuursondersteuning",
};

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
  const verwachting = process.env.ART500_BUDGET_VERWACHTING ?? "groen";
  if (!["groen", "groen-505", "rood"].includes(verwachting)) throw new Error(`ART500_BUDGET_VERWACHTING=${verwachting}?`);

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
  const { rows: oud } = await db.query(
    "select raw_user_meta_data from auth.users where id = $1",
    [bestuurder.userId]
  );
  const uitkomst = { verwachting, statement_timeout: STATEMENT_TIMEOUT, budget_ms: BUDGET_MS, vragen: {} };
  const fouten = [];
  const eis = (ok, tekst) => {
    if (!ok) fouten.push(tekst);
  };
  try {
    // 1. De geschaalde grenzen (zie de kop) en een JWT van productieomvang.
    await db.query(`alter role authenticated set statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await db.query("notify pgrst, 'reload config'");
    // `fonds_config_log` is append-only met een unieke versie per sleutel: neem
    // dus altijd de volgende versie, ook na een eerdere run die de vlag wiste.
    await db.query(
      `insert into public.fonds_feature_flags (fonds_id, flag_key, waarde, versie)
       values ($1, 'retrieval_timeout_ms', to_jsonb($2::int),
               (select coalesce(max(versie), 0) + 1 from public.fonds_config_log
                 where fonds_id = $1 and config_type = 'flag' and config_sleutel = 'retrieval_timeout_ms'))
       on conflict (fonds_id, flag_key) do update
         set waarde = excluded.waarde, versie = excluded.versie`,
      [FONDS_ID, BUDGET_MS]
    );
    await db.query(
      "update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || $2::jsonb where id = $1",
      [bestuurder.userId, JSON.stringify(PRODUCTIEMETADATA)]
    );
    await new Promise((r) => setTimeout(r, 1_500)); // PostgREST herlaadt zijn rolinstellingen

    const passages = await juridischePassages(admin);
    const sessie = await sessieCookies({
      url: ENV.url,
      anonKey: ENV.anonKey,
      email: emailVoor("bestuurder"),
      password: WACHTWOORD,
    });
    uitkomst.jwt_claims_bytes = jwtClaimOmvang(sessie.session.access_token);
    eis(uitkomst.jwt_claims_bytes >= 800, `JWT-claims niet van productieomvang (${uitkomst.jwt_claims_bytes} bytes)`);

    for (const { naam, vraag } of VRAGEN) {
      const r = await stelVraag(admin, sessie.cookieHeader, bestuurder.userId, vraag);
      const fout = r.events.find((e) => e.type === "error");
      const klaar = r.events.some((e) => e.type === "done");
      const meta = r.log?.retrieval_meta ?? null;
      const fasetijden = meta?.invoer?.retrieval_fasetijden ?? null;
      const bronnen = beschrijfChunks(passages, meta);
      const artikel = meta?.selectie?.juridisch?.artikel ?? null;
      const timeout = /duurde te lang/i.test(JSON.stringify(r.events));
      uitkomst.vragen[naam] = {
        http: r.status,
        duur_ms: r.duurMs,
        afgerond: klaar && !fout,
        timeout,
        retrieval_ms: fasetijden?.totaal_ms ?? null,
        fallback_reason: meta?.fallback_reason ?? null,
        methode: meta?.methode ?? null,
        artikel,
        fasen: (fasetijden?.fasen ?? []).map((f) => `${f.fase}${f.poging ? `/${f.poging}` : ""}:${f.status}:${f.ms}`),
        bronnen: bronnen.map((b) => `${b.document}${b.pw150d ? " art.150d" : ""}${b.mvtP395 ? " p.395" : ""}`),
      };
      if (verwachting === "rood") continue; // beoordeeld na de lus
      // #505: "zonder 57014" betekent ook geen enkele RPC-fase die op de
      // statement_timeout afbrak. De app vangt zo'n 57014 op (begrenzing of
      // vangnet), dus de SSE-stroom zelf toont hem niet — de fasetijden wel.
      const dbTimeouts = (fasetijden?.fasen ?? []).filter((f) => f.status === "db_timeout");
      if (verwachting === "groen-505" || (naam === "reglement" && process.env.ART500_REGLEMENT_EISEN === "1")) {
        eis(dbTimeouts.length === 0,
          `${naam}: ${dbTimeouts.length} RPC-fase(n) met 57014 (${dbTimeouts.map((f) => `${f.fase}/${f.poging ?? "-"}`).join(", ")})`);
      }
      if (naam === "reglement") {
        // Buiten de #500-hotfix (geen artikelfocus). Onder #505 moet zij wél
        // afronden zonder time-out en binnen het budget (acceptatie #505).
        if (verwachting === "groen-505" || process.env.ART500_REGLEMENT_EISEN === "1") {
          eis(r.status === 200 && klaar && !fout && !timeout, `${naam}: niet afgerond (fout ${fout?.error ?? "-"}, time-out ${timeout})`);
          eis(!/57014|statement timeout/i.test(JSON.stringify(r.events)), `${naam}: 57014 in de stroom`);
          eis(Boolean(fasetijden), `${naam}: geen invoer.retrieval_fasetijden`);
          eis((fasetijden?.totaal_ms ?? Infinity) < BUDGET_MS, `${naam}: retrieval ${fasetijden?.totaal_ms} ms ≥ budget ${BUDGET_MS} ms`);
          eis(artikel === null, `${naam}: selectie.juridisch.artikel hoort te ontbreken`);
        }
        continue;
      }
      eis(r.status === 200 && klaar && !fout && !timeout, `${naam}: niet afgerond (fout ${fout?.error ?? "-"})`);
      eis(!/57014|statement timeout/i.test(JSON.stringify(r.events)), `${naam}: 57014 in de stroom`);
      eis(Boolean(fasetijden), `${naam}: geen invoer.retrieval_fasetijden`);
      eis((fasetijden?.totaal_ms ?? Infinity) < BUDGET_MS, `${naam}: retrieval ${fasetijden?.totaal_ms} ms ≥ budget ${BUDGET_MS} ms`);
      eis((artikel?.exact ?? 0) >= 1, `${naam}: artikel.exact < 1`);
      eis((artikel?.geboost_geselecteerd ?? 0) >= 1, `${naam}: artikel.geboost_geselecteerd < 1`);
      const wet = bronnen.findIndex((b) => b.pw150d);
      const mvt = bronnen.findIndex((b) => b.documenttype === "wetsgeschiedenis");
      if (naam === "gecombineerd" && verwachting === "groen") {
        // De fix zelf, zichtbaar in de fasetijden: de twee gerangschikte
        // volscans liepen gelijktijdig, niet na elkaar.
        const fts = (fasetijden?.fasen ?? []).filter((f) => f.fase === "rpc_fts");
        const strikt = fts.find((f) => f.poging === "strikt");
        const terugval = fts.find((f) => f.poging === "terugval" && f.status !== "ongebruikt");
        eis(Boolean(strikt && terugval) && terugval.start_ms < strikt.start_ms + strikt.ms,
          `${naam}: strikte en verslapte FTS-poging liepen niet gelijktijdig (${JSON.stringify(fts)})`);
      }
      if (naam === "gecombineerd") {
        eis(wet >= 0 && mvt >= 0, `${naam}: wet en MvT niet beide geselecteerd`);
        eis(wet < mvt, `${naam}: wet niet vóór MvT`);
        eis(bronnen[mvt]?.mvtP395 === true, `${naam}: eerste MvT-passage is niet p.395`);
      }
      if (naam === "bedoeling") eis(bronnen[mvt]?.mvtP395 === true && wet >= 0, `${naam}: MvT p.395/wet ontbreekt`);
      if (naam === "norm") eis(wet >= 0 && (mvt === -1 || wet < mvt), `${naam}: wet niet eerst`);
    }

    if (verwachting === "rood") {
      const g = uitkomst.vragen.gecombineerd;
      const groenMs = Number(process.env.ART500_GROEN_MS ?? NaN);
      const trager = Number.isFinite(groenMs) && (g.retrieval_ms ?? Infinity) >= 1.5 * groenMs;
      uitkomst.negatieve_controle = { timeout: g.timeout, retrieval_ms: g.retrieval_ms, groen_ms: Number.isFinite(groenMs) ? groenMs : null };
      eis(g.timeout || !g.afgerond || trager,
        `negatieve controle: zonder de fix rondde de gecombineerde vraag af in ${g.retrieval_ms} ms ` +
        `(geen time-out en niet ≥ 1,5× ${Number.isFinite(groenMs) ? groenMs : "?"} ms)`);
    }
  } finally {
    // Herstel: rolinstelling (8 s zoals Productie en de stack-default), fondsvlag, metadata.
    await db.query("alter role authenticated set statement_timeout = '8s'").catch(() => {});
    await db.query("notify pgrst, 'reload config'").catch(() => {});
    await db.query("delete from public.fonds_feature_flags where fonds_id = $1 and flag_key = 'retrieval_timeout_ms'", [FONDS_ID]).catch(() => {});
    await db
      .query("update auth.users set raw_user_meta_data = $2::jsonb where id = $1", [bestuurder.userId, JSON.stringify(oud[0]?.raw_user_meta_data ?? {})])
      .catch(() => {});
    await db.end();
  }

  console.log(JSON.stringify(uitkomst, null, 2));
  if (fouten.length > 0) {
    console.error(`ROOD (${verwachting}): ${fouten.join(" | ")}`);
    process.exit(1);
  }
  console.log(
 verwachting === "groen"
      ? "GROEN: de drie 150d-vragen ronden binnen het geschaalde budget af, wet vóór MvT."
      : verwachting === "groen-505"
      ? "GROEN (#505): zonder volscanbegrenzing ronden alle vier vragen (incl. reglement) binnen het budget af, zonder 57014."
      : "GROEN (negatieve controle): zonder de fix is de gecombineerde vraag rood of aantoonbaar trager."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
