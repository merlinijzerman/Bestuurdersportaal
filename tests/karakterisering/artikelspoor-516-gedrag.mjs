// ============================================================================
//  #516 (#500-hotfix) — GEDRAG van de volscanbegrenzing, deterministisch.
// ----------------------------------------------------------------------------
//  Wat bewezen wordt hangt NIET af van hoe snel de database is. De test
//  injecteert de database-time-out zelf: `zoek_chunks` en `zoek_chunks_hybride`
//  worden voor de duur van de test vervangen door een functie met dezelfde
//  signatuur, dezelfde grants en dezelfde returnvorm die onmiddellijk
//  `57014 canceling statement due to statement timeout` gooit (een testdouble
//  op RPC-niveau; PostgREST geeft de app precies de fout die Productie gaf).
//  Daarna staat de oorspronkelijke definitie er weer, gecontroleerd op md5.
//
//  ART516_PAD          fts | hybride   (server met resp. zonder/met HYBRID_SEARCH=on)
//  ART516_VERWACHTING  begrensd        (server met de begrenzing, productieconfiguratie)
//                      onbegrensd      (server met ARTIKELFOCUS_VOLSCANBEGRENZING=off)
//  ART516_MUTATIECONTROLE=1  negatieve controle: verwacht 'begrensd' tegen een
//                      server waar de begrenzing genegeerd wordt; de test is dan
//                      alleen GROEN als hij rood wordt op uitsluitend
//                      [begrenzing]-eisen (spoor en garanties blijven intact).
//
//  EISEN per 150d-vraag (artikelfocus):
//    [injectie]   de gerangschikte RPC gaf werkelijk db_timeout;
//    [begrenzing] begrensd   — FTS-pad: fts_plain én fts_ilike `overgeslagen`,
//                              `fallback_reason: volscan_begrensd`; hybride pad:
//                              de FTS-terugval (`rpc_fts`) `overgeslagen` en geen
//                              plain/ilike-volscan, `volscan_begrensd`;
//                 onbegrensd — de vangnetten (en in het hybride pad de
//                              terugval naar tekstzoeken) worden WÉL aangeroepen;
//    [spoor]      het artikelspoor levert in beide gevallen de exacte passages:
//                 artikel.exact/geboost/via_artikelspoor ≥ 1; bedoeling: eerste
//                 wetsgeschiedenis = MvT p.395 en wet geselecteerd; norm: wet
//                 eerst; gecombineerd: wet én MvT p.395, wet vóór MvT;
//    [garantie]   nooit geselecteerd: de 150d-passage van fonds B (tenant), een
//                 concept- en een gearchiveerde kopie (status), een kopie met
//                 verlopen review (toelatingspoort) en een kopie zonder schoon
//                 scanbewijs (scanpoort; de server draait met
//                 WP3_MALWARESCAN_AAN=true, alle overige documenten krijgen
//                 tijdelijk een schoon, hash-gebonden verdict).
//  De reglementvraag (géén artikelfocus) is de controle dat de begrenzing
//  alleen bij een artikelfocus werkt: daar lopen de vangnetten in BEIDE modi.
//
//  DRAAIRECEPT: zoals `artikelspoor-500-keten.mjs` (fixture met
//  `art500_behoud=1`, build, beide stubs); server met WP3_MALWARESCAN_AAN=true
//  en per variant HYBRID_SEARCH / ARTIKELFOCUS_VOLSCANBEGRENZING. Uitsluitend
//  lokaal (SEED_DOELOMGEVING=local, loopback-database).
// ============================================================================
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";
import { ENV, FONDS_ID, WACHTWOORD, emailVoor } from "./config.mjs";
import { adminClient, seed } from "./seed.mjs";
import { sessieCookies } from "./sessie.mjs";
import { bevestigVeiligeSeedDoelomgeving } from "./seed-doelomgeving.mjs";
import { VRAGEN, beschrijfChunks, concurrenten, juridischePassages, stelVraag } from "./artikelspoor-500-keten.mjs";

const DB_URL = process.env.ART500_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PAD = process.env.ART516_PAD ?? "fts";
const VERWACHTING = process.env.ART516_VERWACHTING ?? "begrensd";
const MUTATIE = process.env.ART516_MUTATIECONTROLE === "1";
const FONDS_B = "05002000-2222-2222-2222-222222222222"; // uit de art500-fixture
const PW = "05002000-0000-0000-0000-00000000a001";

// Verboden kopieën van de exacte 150d-passage (vaste id's, opgeruimd in finally).
const VERBODEN = [
  { id: "05160000-0000-4000-8000-0000000000b1", soort: "tenant (fonds B)", fonds: FONDS_B, bib: "fonds", status: "vastgesteld", juridisch: false },
  { id: "05160000-0000-4000-8000-0000000000c1", soort: "status concept", status: "concept" },
  { id: "05160000-0000-4000-8000-0000000000c2", soort: "status gearchiveerd", status: "gearchiveerd" },
  { id: "05160000-0000-4000-8000-0000000000c3", soort: "review verlopen", status: "van_kracht", review: "2020-01-01" },
  { id: "05160000-0000-4000-8000-0000000000c4", soort: "geen scanbewijs", status: "van_kracht", onschoon: true },
];
const TEKST150D = "Artikel 150d. Transitieplan\nSociale partners stellen een transitieplan op; bedoeling van de wetgever, memorie van toelichting, pensioenwet.";

function sleutel(prefix, delen) {
  const canoniek = [`bestuurdersportaal:${prefix}:v1`, ...delen]
    .map((deel) => `${Buffer.byteLength(deel, "utf8")}:${deel}`)
    .join("|");
  return `${prefix}_v1_${createHash("sha256").update(canoniek).digest("hex")}`;
}
const passageId = (namespace, documentId, chunkIndex) =>
  sleutel("passage", [sleutel("doc", [namespace, documentId]), `chunk-index:${chunkIndex}`]);

function bevestigLokaleDatabase(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host)) {
    throw new Error(`Weigering: ${host} is geen lokale database.`);
  }
}

// R1 (0218): ook `zoek_chunks_begrensd` (plpgsql) krijgt de 57014-injectie,
// zodat de #516-begrenzing met ZOEK_TEKST_V2=on hetzelfde bewijs levert.
const RPCS = ["zoek_chunks", "zoek_chunks_hybride", "zoek_chunks_begrensd"];
const INJECTIEBODY =
  "\nbegin\n  raise exception using errcode = '57014',\n    message = 'canceling statement due to statement timeout';\nend\n";

async function injecteer(db) {
  const origineel = {};
  for (const naam of RPCS) {
    const { rows } = await db.query(
      "select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl " +
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
      [naam]
    );
    if (rows.length !== 1) throw new Error(`${naam}: verwacht precies één overload, kreeg ${rows.length}`);
    origineel[naam] = rows[0];
    const def = rows[0].def;
    const kop = def.slice(0, def.indexOf("AS $function$"));
    // `zoek_chunks`/`_hybride` zijn LANGUAGE sql, `zoek_chunks_begrensd` is al plpgsql (R1).
    if (!/ LANGUAGE (sql|plpgsql)\n/.test(kop)) throw new Error(`${naam}: onverwachte definitievorm`);
    const nieuw = `${kop.replace(/ LANGUAGE (sql|plpgsql)\n/, " LANGUAGE plpgsql\n")}AS $function$${INJECTIEBODY}$function$`;
    await db.query(nieuw);
  }
  await db.query("notify pgrst, 'reload schema'");
  await new Promise((r) => setTimeout(r, 1_500));
  return origineel;
}

async function herstel(db, origineel) {
  const fouten = [];
  for (const [naam, o] of Object.entries(origineel)) {
    await db.query(o.def);
    const { rows } = await db.query(
      "select md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
      [naam]
    );
    if (rows[0]?.h !== o.h || rows[0]?.acl !== o.acl) fouten.push(`${naam}: herstel wijkt af (md5/acl)`);
  }
  await db.query("notify pgrst, 'reload schema'");
  if (fouten.length) throw new Error(fouten.join("; "));
}

export async function main() {
  bevestigVeiligeSeedDoelomgeving({ url: ENV.url });
  if (process.env.SEED_DOELOMGEVING !== "local") throw new Error("Alleen lokaal (SEED_DOELOMGEVING=local).");
  bevestigLokaleDatabase(DB_URL);
  if (!["fts", "hybride"].includes(PAD)) throw new Error(`ART516_PAD=${PAD}?`);
  if (!["begrensd", "onbegrensd"].includes(VERWACHTING)) throw new Error(`ART516_VERWACHTING=${VERWACHTING}?`);

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
  const uitkomst = { pad: PAD, verwachting: VERWACHTING, mutatiecontrole: MUTATIE, vragen: {} };
  const fouten = [];
  const eis = (ok, cat, tekst) => {
    if (!ok) fouten.push(`[${cat}] ${tekst}`);
  };
  let origineel = null;
  let gescand = [];
  try {
    // 1. Verboden kopieën (tenant/status/review/scan).
    for (const v of VERBODEN) {
      const juridisch = v.juridisch !== false;
      await db.query(
        `insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
            documenttype, normgewicht, wettelijk_regime, volgende_review)
         values ($1, $2, $3, $4, $5, $6, 'actief', true, $7, $8, $9, $10)
         on conflict (id) do nothing`,
        [v.id, v.fonds ?? null, v.bib ?? "generiek", juridisch ? "Extern" : "Intern", `Pensioenwet — ${v.soort} (#516-test)`,
          v.status, juridisch ? "wetgeving" : null, juridisch ? "bindend" : null, juridisch ? "pw" : null, v.review ?? null]
      );
      await db.query(
        `insert into public.document_chunks (id, document_id, chunk_index, pagina, tekst, structuur_type, structuur_label)
         values ($1, $1, 0, 1, $2, 'artikel', 'Artikel 150d') on conflict (id) do nothing`,
        [v.id, TEKST150D]
      );
    }
    const verbodenIds = new Map(
      VERBODEN.map((v) => [passageId(v.bib === "fonds" ? `fonds:${v.fonds}` : "generiek", v.id, 0), v.soort])
    );

    // 2. WP3: schoon, hash-gebonden scanbewijs voor alle documenten zonder
    //    scanbewijs, behalve de opzettelijk onschone kopie. Hersteld in finally.
    const { rows: zonderScan } = await db.query(
      "select id, bestand_hash from public.documenten where scan_resultaat is null and id <> $1",
      [VERBODEN.find((v) => v.onschoon).id]
    );
    gescand = zonderScan.map((r) => ({ id: r.id, bestand_hash: r.bestand_hash }));
    await db.query(
      `update public.documenten
          set bestand_hash = coalesce(bestand_hash, encode(sha256(id::text::bytea), 'hex')),
              scan_resultaat = jsonb_build_object('verdict', 'clean',
                'sha256', coalesce(bestand_hash, encode(sha256(id::text::bytea), 'hex')))
        where id = any($1::uuid[])`,
      [gescand.map((g) => g.id)]
    );

    // 3. De database-time-out injecteren.
    origineel = await injecteer(db);

    const passages = await juridischePassages(admin);
    const sessie = await sessieCookies({ url: ENV.url, anonKey: ENV.anonKey, email: emailVoor("bestuurder"), password: WACHTWOORD });

    for (const { naam, vraag } of VRAGEN) {
      const a = await stelVraag(admin, sessie.cookieHeader, bestuurder.userId, vraag);
      const fout = a.events.find((e) => e.type === "error");
      const klaar = a.events.some((e) => e.type === "done");
      const meta = a.log?.retrieval_meta ?? null;
      const fasen = meta?.invoer?.retrieval_fasetijden?.fasen ?? [];
      const bronnen = beschrijfChunks(passages, meta);
      const artikel = meta?.selectie?.juridisch?.artikel ?? null;
      const status = (fase, poging) =>
        fasen.filter((f) => f.fase === fase && (poging === undefined || f.poging === poging)).map((f) => f.status);
      const uitgevoerd = (fase) => status(fase).some((s) => s !== "overgeslagen" && s !== "ongebruikt");
      const geselecteerd = (meta?.chunks ?? []).map((c) => c.id);
      uitkomst.vragen[naam] = {
        afgerond: klaar && !fout,
        fallback_reason: meta?.fallback_reason ?? null,
        methode: meta?.methode ?? null,
        fasen: fasen.map((f) => `${f.fase}${f.poging ? `/${f.poging}` : ""}:${f.status}`),
        bronnen: bronnen.map((b) => `${b.document}${b.pw150d ? " art.150d" : ""}${b.mvtP395 ? " p.395" : ""}`),
      };
      const t = `${PAD}/${naam}`;
      eis(a.status === 200 && klaar && !fout, "spoor", `${t}: niet afgerond (fout ${fout?.error ?? "-"})`);

      // [injectie] De gerangschikte RPC brak werkelijk af op 57014.
      const injectieFase = PAD === "hybride" ? "rpc_hybride" : "rpc_fts";
      eis(status(injectieFase).includes("db_timeout"), "injectie", `${t}: ${injectieFase} gaf geen db_timeout (${status(injectieFase)})`);

      // [garantie] Nooit een verboden kopie.
      for (const id of geselecteerd) {
        eis(!verbodenIds.has(id), "garantie", `${t}: verboden passage geselecteerd (${verbodenIds.get(id)})`);
      }

      const artikelfocus = naam !== "reglement";
      const begrensd = artikelfocus && VERWACHTING === "begrensd";
      if (begrensd) {
        eis(meta?.fallback_reason === "volscan_begrensd", "begrenzing", `${t}: fallback_reason ${meta?.fallback_reason} ≠ volscan_begrensd`);
        eis(!uitgevoerd("fts_plain") && !uitgevoerd("fts_ilike"), "begrenzing", `${t}: een plain/ilike-volscan werd toch gestart`);
        if (PAD === "fts") {
          eis(status("fts_plain").includes("overgeslagen") && status("fts_ilike").includes("overgeslagen"),
            "begrenzing", `${t}: fts_plain/fts_ilike niet als overgeslagen genoteerd`);
        } else {
          eis(status("rpc_fts").includes("overgeslagen") && !status("rpc_fts").some((s) => s !== "overgeslagen"),
            "begrenzing", `${t}: de terugval naar tekstzoeken (rpc_fts) werd niet overgeslagen (${status("rpc_fts")})`);
        }
      } else {
        // Onbegrensd, of geen artikelfocus: de vangnetten lopen wél.
        const cat = artikelfocus ? "begrenzing" : "controle";
        eis(meta?.fallback_reason !== "volscan_begrensd", cat, `${t}: onterecht volscan_begrensd`);
        if (PAD === "hybride") {
          eis(uitgevoerd("rpc_fts"), cat, `${t}: geen terugval naar tekstzoeken (rpc_fts ${status("rpc_fts")})`);
        }
        eis(uitgevoerd("fts_plain") && uitgevoerd("fts_ilike"), cat,
          `${t}: vangnetten niet aangeroepen (plain ${status("fts_plain")}, ilike ${status("fts_ilike")})`);
      }

      // [spoor] Het artikelspoor levert de exacte passages, in beide modi.
      if (!artikelfocus) {
        eis(artikel === null, "spoor", `${t}: selectie.juridisch.artikel hoort te ontbreken`);
        continue;
      }
      eis((artikel?.exact ?? 0) >= 1, "spoor", `${t}: artikel.exact < 1`);
      eis((artikel?.geboost_geselecteerd ?? 0) >= 1, "spoor", `${t}: artikel.geboost_geselecteerd < 1`);
      eis((artikel?.via_artikelspoor ?? 0) >= 1, "spoor", `${t}: artikel.via_artikelspoor < 1`);
      const wet = bronnen.findIndex((b) => b.pw150d);
      const mvt = bronnen.findIndex((b) => b.documenttype === "wetsgeschiedenis");
      const eersteJuridisch = bronnen.find((b) => b.documenttype === "wetgeving" || b.documenttype === "wetsgeschiedenis");
      if (naam === "bedoeling") eis(bronnen[mvt]?.mvtP395 === true && wet >= 0, "spoor", `${t}: MvT p.395/wet ontbreekt`);
      if (naam === "norm") {
        eis(eersteJuridisch?.pw150d === true, "spoor", `${t}: eerste juridische bron is niet Pensioenwet art. 150d`);
        eis(mvt === -1 || wet < mvt, "spoor", `${t}: MvT vóór de wet`);
      }
      if (naam === "gecombineerd") {
        eis(wet >= 0 && mvt >= 0 && wet < mvt, "spoor", `${t}: wet en MvT niet beide, of wet niet vóór MvT`);
        eis(bronnen[mvt]?.mvtP395 === true, "spoor", `${t}: eerste MvT-passage is niet p.395`);
      }
      // De echte Pensioenwet-passage komt uit het juiste document (niet een kopie).
      eis(bronnen.filter((b) => b.pw150d).length >= 1, "spoor", `${t}: geen passage uit ${PW}`);
    }
  } finally {
    if (origineel) await herstel(db, origineel);
    if (gescand.length) {
      // Exact terug: scan_resultaat weer leeg, bestand_hash naar de oude waarde.
      await db.query(
        `update public.documenten d set scan_resultaat = null, bestand_hash = o.bestand_hash
           from jsonb_to_recordset($1::jsonb) as o(id uuid, bestand_hash text) where d.id = o.id`,
        [JSON.stringify(gescand)]
      );
    }
    await db.query("delete from public.document_chunks where id = any($1::uuid[])", [VERBODEN.map((v) => v.id)]).catch(() => {});
    await db.query("delete from public.documenten where id = any($1::uuid[])", [VERBODEN.map((v) => v.id)]).catch(() => {});
    await db.end();
  }

  uitkomst.fouten = fouten;
  console.log(JSON.stringify(uitkomst, null, 2));
  if (MUTATIE) {
    // Negatieve controle: rood op [begrenzing], en op niets anders.
    const begrenzing = fouten.filter((f) => f.startsWith("[begrenzing]"));
    const overig = fouten.filter((f) => !f.startsWith("[begrenzing]"));
    if (begrenzing.length >= 3 && overig.length === 0) {
      console.log(`GROEN (mutatiecontrole): begrenzing genegeerd ⇒ ${begrenzing.length} [begrenzing]-eisen rood; spoor en garanties intact.`);
      return;
    }
    console.error(`ROOD (mutatiecontrole): verwacht ≥ 3 [begrenzing]-fouten en verder niets; kreeg ${begrenzing.length} / overig: ${overig.join(" | ") || "-"}`);
    process.exit(1);
  }
  if (fouten.length > 0) {
    console.error(`ROOD (${PAD}, ${VERWACHTING}): ${fouten.join(" | ")}`);
    process.exit(1);
  }
  console.log(`GROEN (#516 ${PAD}, ${VERWACHTING}): 57014 geïnjecteerd; vangnetten ${VERWACHTING === "begrensd" ? "overgeslagen" : "aangeroepen"}, artikelspoor exact, garanties intact.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
