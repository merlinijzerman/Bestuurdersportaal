import { NextResponse } from "next/server";
import { errorResponse, badRequest } from "@/lib/api-errors";
import {
  catalogusContext,
  magCatalogusBeheren,
  logCatalogus,
  type CatalogusSupabase,
} from "@/lib/catalogus-api";
import {
  PROCESMODEL_TEMPLATES,
  PROCES_ORGAAN_SUGGESTIES,
} from "@/lib/catalogus-templates";

type OrgaanTabel = "gremia" | "expertises" | "kritische_focusgebieden";
type ImportTelling = { aangemaakt: number; overgeslagen: number };

// Kopieert globale organen-templates (fonds_id NULL) naar fonds-specifieke
// records. Idempotent: slaat templates over die al gekopieerd zijn
// (gekopieerd_van_id binnen het fonds).
async function importeerOrganen(
  supabase: CatalogusSupabase,
  tabel: OrgaanTabel,
  fondsId: string,
  heeftType: boolean
): Promise<ImportTelling> {
  const { data: templates } = await supabase
    .from(tabel)
    .select("*")
    .is("fonds_id", null);
  const { data: bestaand } = await supabase
    .from(tabel)
    .select("gekopieerd_van_id")
    .eq("fonds_id", fondsId)
    .not("gekopieerd_van_id", "is", null);

  const alGekopieerd = new Set(
    (bestaand ?? []).map((r) => r.gekopieerd_van_id as string)
  );
  const teMaken = (templates ?? []).filter((t) => !alGekopieerd.has(t.id));

  let aangemaakt = 0;
  if (teMaken.length > 0) {
    const rows = teMaken.map((t) => ({
      fonds_id: fondsId,
      naam: t.naam,
      omschrijving: t.omschrijving,
      sort_order: t.sort_order,
      gekopieerd_van_id: t.id,
      ...(heeftType ? { type: t.type } : {}),
    }));
    const { data: ins, error } = await supabase
      .from(tabel)
      .insert(rows)
      .select("id");
    if (error) console.error(`[catalogus.import] ${tabel} insert:`, error);
    else aangemaakt = ins?.length ?? 0;
  }
  return {
    aangemaakt,
    overgeslagen: (templates?.length ?? 0) - aangemaakt,
  };
}

// naam → fonds-specifiek orgaan-id (voor het resolven van default-koppelingen).
async function naamMap(
  supabase: CatalogusSupabase,
  tabel: OrgaanTabel,
  fondsId: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from(tabel)
    .select("id, naam")
    .eq("fonds_id", fondsId);
  const m = new Map<string, string>();
  (data ?? []).forEach((r) => m.set(r.naam as string, r.id as string));
  return m;
}

export async function POST() {
  try {
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("catalogus.import", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("catalogus.import", "Geen fonds gekoppeld aan profiel");
    if (!magCatalogusBeheren(profiel.rol))
      return badRequest("catalogus.import", "Onvoldoende rechten", 403);

    const fondsId = profiel.fonds_id;

    // 1. Organen eerst (procesmodel-koppelingen verwijzen ernaar).
    const gremia = await importeerOrganen(supabase, "gremia", fondsId, true);
    const expertises = await importeerOrganen(supabase, "expertises", fondsId, false);
    const focusgebieden = await importeerOrganen(
      supabase,
      "kritische_focusgebieden",
      fondsId,
      false
    );

    // 2. Procesmodellen (code-templates → fonds-specifieke rijen).
    //    Idempotent op generiek_procestype binnen het fonds.
    const { data: bestaandePm } = await supabase
      .from("procesmodellen")
      .select("generiek_procestype")
      .eq("fonds_id", fondsId);
    const bestaandeTypes = new Set(
      (bestaandePm ?? []).map((r) => r.generiek_procestype as string)
    );
    const teMakenPm = PROCESMODEL_TEMPLATES.filter(
      (t) => !bestaandeTypes.has(t.generiek_procestype)
    );

    const nieuwePm: { id: string; generiek_procestype: string }[] = [];
    for (const t of teMakenPm) {
      const { data, error } = await supabase
        .from("procesmodellen")
        .insert({
          fonds_id: fondsId,
          generiek_procestype: t.generiek_procestype,
          naam: t.naam,
          domein: t.domein,
          frequentie: t.frequentie,
          verwachte_documenttypen: t.verwachte_documenttypen,
          synoniemen: t.synoniemen,
          default_tijdlijnfases: t.default_tijdlijnfases,
        })
        .select("id, generiek_procestype")
        .single();
      if (error) console.error("[catalogus.import] procesmodel insert:", error);
      else if (data)
        nieuwePm.push({ id: data.id, generiek_procestype: data.generiek_procestype });
    }
    const procesmodellen: ImportTelling = {
      aangemaakt: nieuwePm.length,
      overgeslagen: PROCESMODEL_TEMPLATES.length - nieuwePm.length,
    };

    // 3. Default proces↔orgaan-koppelingen — alleen voor net aangemaakte
    //    procesmodellen, naar reeds geïmporteerde fonds-specifieke organen.
    const [gMap, eMap, fMap] = await Promise.all([
      naamMap(supabase, "gremia", fondsId),
      naamMap(supabase, "expertises", fondsId),
      naamMap(supabase, "kritische_focusgebieden", fondsId),
    ]);

    let koppelingenAangemaakt = 0;
    for (const pm of nieuwePm) {
      const sug = PROCES_ORGAAN_SUGGESTIES[pm.generiek_procestype];
      if (!sug) continue;

      const gRows = sug.gremia
        .map((naam) => gMap.get(naam))
        .filter((id): id is string => !!id)
        .map((gremium_id) => ({
          fonds_id: fondsId,
          procesmodel_id: pm.id,
          gremium_id,
          aangemaakt_door: user.id,
        }));
      const eRows = sug.expertises
        .map((naam) => eMap.get(naam))
        .filter((id): id is string => !!id)
        .map((expertise_id) => ({
          fonds_id: fondsId,
          procesmodel_id: pm.id,
          expertise_id,
          aangemaakt_door: user.id,
        }));
      const fRows = sug.focusgebieden
        .map((naam) => fMap.get(naam))
        .filter((id): id is string => !!id)
        .map((focusgebied_id) => ({
          fonds_id: fondsId,
          procesmodel_id: pm.id,
          focusgebied_id,
          aangemaakt_door: user.id,
        }));

      if (gRows.length) {
        const { data } = await supabase
          .from("procesmodel_gremia")
          .upsert(gRows, { onConflict: "procesmodel_id,gremium_id", ignoreDuplicates: true })
          .select("id");
        koppelingenAangemaakt += data?.length ?? 0;
      }
      if (eRows.length) {
        const { data } = await supabase
          .from("procesmodel_expertises")
          .upsert(eRows, { onConflict: "procesmodel_id,expertise_id", ignoreDuplicates: true })
          .select("id");
        koppelingenAangemaakt += data?.length ?? 0;
      }
      if (fRows.length) {
        const { data } = await supabase
          .from("procesmodel_focusgebieden")
          .upsert(fRows, { onConflict: "procesmodel_id,focusgebied_id", ignoreDuplicates: true })
          .select("id");
        koppelingenAangemaakt += data?.length ?? 0;
      }
    }

    const resultaat = {
      gremia,
      expertises,
      focusgebieden,
      procesmodellen,
      koppelingen: { aangemaakt: koppelingenAangemaakt },
    };

    await logCatalogus(supabase, {
      fonds_id: fondsId,
      entiteit: "import",
      event_type: "geimporteerd",
      actor_id: user.id,
      payload: resultaat,
    });

    return NextResponse.json({ resultaat });
  } catch (e) {
    return errorResponse("catalogus.import", e);
  }
}
