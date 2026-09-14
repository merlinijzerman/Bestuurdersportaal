import "server-only";

import { microsoftSharePointActief } from "@/core/lib/microsoft-connector";
import {
  SHAREPOINT_RETRIEVAL_SMOKE_FLAG,
  isSharePointRetrievalSmokePreview,
} from "@/core/lib/microsoft-sharepoint-retrieval-smoke-core";

type RlsClient = { from: (table: string) => any };

/** Extra, fail-closed grendel bovenop sessie, capability en hostguard. */
export async function sharePointRetrievalSmokeToegestaan(
  supabase: RlsClient,
  fondsId: string,
): Promise<boolean> {
  if (!isSharePointRetrievalSmokePreview({
    seedDoelomgeving: process.env.SEED_DOELOMGEVING,
    vercelEnv: process.env.VERCEL_ENV,
  })) return false;

  const [{ data: fonds }, { data: vlag }, sharePointActief] = await Promise.all([
    supabase.from("fondsen").select("slug").eq("id", fondsId).maybeSingle(),
    supabase.from("fonds_feature_flags").select("waarde").eq("fonds_id", fondsId).eq("flag_key", SHAREPOINT_RETRIEVAL_SMOKE_FLAG).maybeSingle(),
    microsoftSharePointActief(supabase, fondsId),
  ]);
  return fonds?.slug === "pgb" && vlag?.waarde === true && sharePointActief;
}
