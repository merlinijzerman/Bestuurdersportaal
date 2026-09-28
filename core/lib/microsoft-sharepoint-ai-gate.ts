import "server-only";

export const SHAREPOINT_AI_CONTEXT_FLAG = "microsoft_sharepoint_ai_context";

/**
 * De directe SharePoint-context is een aanvullende, standaard gesloten arm.
 * Zowel het Microsoft-profiel, fase 3 als deze eigen vlag moeten exact aanstaan.
 */
export async function microsoftSharePointAiContextActief(
  supabase: { from: (table: string) => any },
  fondsId: string
): Promise<boolean> {
  const [{ data: profiel }, { data: fase3 }, { data: aiContext }] = await Promise.all([
    supabase
      .from("fonds_integratie_profielen")
      .select("integratieprofiel, microsoft_koppeling_pilot")
      .eq("fonds_id", fondsId)
      .maybeSingle(),
    supabase
      .from("fonds_feature_flags")
      .select("waarde")
      .eq("fonds_id", fondsId)
      .eq("flag_key", "microsoft_sharepoint_fase3")
      .maybeSingle(),
    supabase
      .from("fonds_feature_flags")
      .select("waarde")
      .eq("fonds_id", fondsId)
      .eq("flag_key", SHAREPOINT_AI_CONTEXT_FLAG)
      .maybeSingle(),
  ]);

  return profiel?.integratieprofiel === "microsoft"
    && profiel?.microsoft_koppeling_pilot === true
    && fase3?.waarde === true
    && aiContext?.waarde === true;
}
