// ============================================================================
// Classificatie-service — Increment E (DB-orchestratie rond lib/classificatie.ts).
// ----------------------------------------------------------------------------
// De PURE beslissing leeft in lib/classificatie.ts (getest in .sanity.ts). Hier
// staat de I/O: cataloguskandidaten ophalen en de governance-handeling (koppeling
// + status) append-only loggen in document_metadata_log. Alles via de RLS-client
// (anon-key + fonds_id); nooit de service-role-key.
// ============================================================================

import type { createServerSupabase } from "@/core/lib/supabase-server";
import type { KandidaatInstantie } from "@/core/lib/classificatie";

export type SupabaseServer = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Haal de kandidaat-procesinstanties van één fonds op met de catalogusgegevens
 * die de engine nodig heeft (procesmodelnaam, synoniemen, verwachte typen,
 * status, periodejaar). RLS beperkt tot het eigen fonds.
 */
export async function haalKandidaten(
  supabase: SupabaseServer,
  fondsId: string
): Promise<KandidaatInstantie[]> {
  const { data, error } = await supabase
    .from("procedures")
    .select(
      "id, status, periode_jaar, procesmodel_id, " +
        "procesmodellen ( naam, synoniemen, verwachte_documenttypen )"
    )
    .eq("fonds_id", fondsId);

  if (error || !data) return [];

  // Geen gegenereerde DB-types in de repo → de embedded-relatieselect valt terug
  // op een error-union. Cast naar de werkelijke vorm.
  type ProcesmodelRel = {
    naam: string | null;
    synoniemen: string[] | null;
    verwachte_documenttypen: string[] | null;
  };
  type ProcedureRij = {
    id: string;
    status: string | null;
    periode_jaar: number | null;
    procesmodel_id: string | null;
    procesmodellen: ProcesmodelRel | ProcesmodelRel[] | null;
  };

  return (data as unknown as ProcedureRij[]).map((r): KandidaatInstantie => {
    // Supabase typeert de embedded relatie soms als array; normaliseer.
    const pm = Array.isArray(r.procesmodellen) ? r.procesmodellen[0] : r.procesmodellen;
    return {
      procesinstantie_id: r.id,
      procesmodel_id: r.procesmodel_id ?? null,
      procesmodel_naam: pm?.naam ?? null,
      synoniemen: pm?.synoniemen ?? [],
      verwachte_documenttypen: pm?.verwachte_documenttypen ?? [],
      status: r.status ?? "",
      periode_jaar: r.periode_jaar ?? null,
    };
  });
}

/**
 * Leg een classificatie-governance-handeling append-only vast in
 * document_metadata_log (wijzig_type 'classificatie'). De DB-trigger berekent de
 * hash; deze functie levert het canonieke event. Reden draagt confidence + bron
 * mee zodat de auto-/handmatige koppeling herleidbaar is.
 */
export async function logClassificatieKoppeling(
  supabase: SupabaseServer,
  params: {
    documentId: string;
    documentTitel: string | null;
    fondsId: string | null;
    gebruikerId: string;
    gebruikerNaam: string | null;
    veldNaam: string; // 'procesinstantie_id' of 'classificatie_status'
    oudeWaarde: string | null;
    nieuweWaarde: string | null;
    reden: string | null;
    ragImpact: boolean;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("document_metadata_log").insert({
    document_id: params.documentId,
    document_titel_snapshot: params.documentTitel,
    fonds_id: params.fondsId,
    gewijzigd_door: params.gebruikerId,
    gewijzigd_door_naam: params.gebruikerNaam,
    veld_naam: params.veldNaam,
    oude_waarde: params.oudeWaarde,
    nieuwe_waarde: params.nieuweWaarde,
    wijzig_reden: params.reden,
    wijzig_type: "classificatie",
    rag_impact: params.ragImpact,
  });
  return { error: error?.message ?? null };
}

/** Compacte, leesbare reden voor het auditlog: "confidence via bron (toelichting)". */
export function bouwClassificatieReden(
  confidence: string,
  bron: string,
  toelichting?: string | null
): string {
  const basis = `classificatie ${confidence} via ${bron}`;
  return toelichting ? `${basis} — ${toelichting}` : basis;
}
