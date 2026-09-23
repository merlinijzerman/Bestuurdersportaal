// De globale env-vlag is een kill switch. De env-binding begrenst het toegestane
// fonds; de fondsflag is de afzonderlijke opt-in. Fondsbeheerders kunnen hun
// eigen flags wijzigen, maar nooit de serverbeheerde binding.
import { createServerSupabase } from "@/core/lib/supabase-server";
import { vergelijkmodusAan } from "@/core/lib/vergelijk-config";

export const VERGELIJK_FONDS_FLAG = "vergelijkmodus";

type FlagLezer = (fondsId: string) => Promise<unknown>;

async function leesVergelijkFlag(fondsId: string): Promise<unknown> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("fonds_feature_flags")
    .select("waarde")
    .eq("fonds_id", fondsId)
    .eq("flag_key", VERGELIJK_FONDS_FLAG)
    .maybeSingle();
  if (error) throw error;
  return data?.waarde;
}

/** Alle drie de poorten moeten open zijn. Ontbrekende/ongeldige vlag of leesfout = uit. */
export async function vergelijkmodusVoorFondsAan(
  fondsId: string | null,
  leesFlag: FlagLezer = leesVergelijkFlag,
): Promise<boolean> {
  if (!vergelijkmodusAan() || !fondsId || process.env.VERGELIJK_FONDS_ID !== fondsId) return false;
  try {
    return (await leesFlag(fondsId)) === true;
  } catch {
    return false;
  }
}
