// ============================================================================
//  R1 (besluit 0218) — fondsvlag `zoek_tekst_v2` voor het W1-testfonds zetten
//  of wissen, en de bijbehorende markercontrole voor de karakteriseringsrondes.
// ----------------------------------------------------------------------------
//  Het nieuwe tekstzoekpad is ALLEEN aan bij env ZOEK_TEKST_V2=on ÉN fondsvlag
//  `zoek_tekst_v2 = true`. Een ronde "vlag aan" moet dus beide zetten; alleen
//  de env laat het pad (terecht) uit. Zonder markercontrole zou zo'n ronde
//  stil het oude pad testen — vandaar `controleerTekstzoekpad`.
//
//  Gebruik (lokaal, ephemere stack):
//    SEED_DOELOMGEVING=local node tests/karakterisering/zoektekst-fondsvlag.mjs zet
//    SEED_DOELOMGEVING=local node tests/karakterisering/zoektekst-fondsvlag.mjs wis
//
//  Markerverwachting in de harnassen via env ART_VERWACHT_TEKSTZOEKPAD:
//    nieuw    — elke beurt waarin een rpc_fts-fase werkelijk draaide, draagt
//               `tekstzoekpad = "nieuw"`, en minstens één beurt in de ronde
//               doet dat (anders bewijst de ronde niets);
//    afwezig  — geen enkele beurt draagt een `tekstzoekpad`-marker;
//    (leeg)   — geen controle.
// ============================================================================
import { pathToFileURL } from "node:url";
import { ENV, FONDS_ID } from "./config.mjs";
import { adminClient } from "./seed.mjs";
import { bevestigVeiligeSeedDoelomgeving } from "./seed-doelomgeving.mjs";

export const ZOEK_TEKST_V2_FONDSVLAG = "zoek_tekst_v2";

// De audittrigger (fn_fonds_config_capture) kopieert `versie` van de rij naar
// fonds_config_log, uniek per (fonds, type, sleutel, versie). Na `wis` (delete)
// staat de logregel er nog; een nieuwe insert met de default-versie botst dan.
// Daarom altijd de volgende versie t.o.v. rij én log — zoals `schrijfFlag`.
async function volgendeVersie(admin) {
  const { data: rij } = await admin
    .from("fonds_feature_flags")
    .select("versie")
    .eq("fonds_id", FONDS_ID)
    .eq("flag_key", ZOEK_TEKST_V2_FONDSVLAG)
    .maybeSingle();
  const { data: log, error } = await admin
    .from("fonds_config_log")
    .select("versie")
    .eq("fonds_id", FONDS_ID)
    .eq("config_type", "flag")
    .eq("config_sleutel", ZOEK_TEKST_V2_FONDSVLAG)
    .order("versie", { ascending: false })
    .limit(1);
  if (error) throw new Error(`zoek_tekst_v2 versie lezen: ${error.message}`);
  return Math.max(rij?.versie ?? 0, log?.[0]?.versie ?? 0) + 1;
}

export async function zetFondsvlag(admin = adminClient()) {
  const versie = await volgendeVersie(admin);
  const { error } = await admin
    .from("fonds_feature_flags")
    .upsert(
      { fonds_id: FONDS_ID, flag_key: ZOEK_TEKST_V2_FONDSVLAG, waarde: true, versie },
      { onConflict: "fonds_id,flag_key" }
    );
  if (error) throw new Error(`zoek_tekst_v2 zetten: ${error.message}`);
  const { data, error: leesFout } = await admin
    .from("fonds_feature_flags")
    .select("waarde")
    .eq("fonds_id", FONDS_ID)
    .eq("flag_key", ZOEK_TEKST_V2_FONDSVLAG)
    .single();
  if (leesFout || data?.waarde !== true) throw new Error("zoek_tekst_v2 zetten: vlag niet exact true");
}

export async function wisFondsvlag(admin = adminClient()) {
  const { error } = await admin
    .from("fonds_feature_flags")
    .delete()
    .eq("fonds_id", FONDS_ID)
    .eq("flag_key", ZOEK_TEKST_V2_FONDSVLAG);
  if (error) throw new Error(`zoek_tekst_v2 wissen: ${error.message}`);
}

const UITGEVOERD = new Set(["ok", "db_timeout", "fout", "afgebroken"]);

/**
 * Markercontrole per ronde. `beurten` = lijst van `retrieval_meta`-objecten
 * (null mag). Geeft een lijst met foutteksten terug (leeg = in orde).
 */
export function controleerTekstzoekpad(beurten, verwachting = process.env.ART_VERWACHT_TEKSTZOEKPAD ?? "") {
  if (!verwachting) return [];
  const fouten = [];
  let nieuw = 0;
  beurten.forEach((meta, i) => {
    const ft = meta?.invoer?.retrieval_fasetijden ?? null;
    const marker = ft?.tekstzoekpad;
    const ftsGedraaid = (ft?.fasen ?? []).some((f) => f.fase === "rpc_fts" && UITGEVOERD.has(f.status));
    if (verwachting === "afwezig") {
      if (marker !== undefined) fouten.push(`beurt ${i + 1}: tekstzoekpad=${marker}, verwacht geen marker (vlag hoort uit)`);
    } else if (verwachting === "nieuw") {
      if (marker === "nieuw") nieuw++;
      if (ftsGedraaid && marker !== "nieuw") fouten.push(`beurt ${i + 1}: rpc_fts draaide met tekstzoekpad=${marker ?? "∅"}, verwacht "nieuw"`);
    } else {
      fouten.push(`onbekende ART_VERWACHT_TEKSTZOEKPAD=${verwachting}`);
    }
  });
  if (verwachting === "nieuw" && nieuw === 0) fouten.push("geen enkele beurt met tekstzoekpad=nieuw — de ronde bewijst het nieuwe pad niet");
  return fouten;
}

async function cli() {
  bevestigVeiligeSeedDoelomgeving({ url: ENV.url });
  if (process.env.SEED_DOELOMGEVING !== "local") throw new Error("Alleen lokaal (SEED_DOELOMGEVING=local).");
  const actie = process.argv[2];
  if (actie === "zet") await zetFondsvlag();
  else if (actie === "wis") await wisFondsvlag();
  else throw new Error("Gebruik: zoektekst-fondsvlag.mjs zet|wis");
  console.log(`zoek_tekst_v2 ${actie === "zet" ? "gezet (true)" : "gewist"} voor fonds ${FONDS_ID}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
