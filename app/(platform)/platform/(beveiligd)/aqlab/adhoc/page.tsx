// ============================================================================
//  Scherm 6b — Ad-hoc consistentietest (server). Laadt de opties + checkt de
//  capability; het formulier + de synchrone uitvoering leven in de client-
//  component (useActionState). Alleen platform-console.
// ============================================================================

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { haalModelConfiguraties, haalFixtures } from "@/lib/aqlab/console-lees";
import AdHocForm from "./adhoc-form";

export const dynamic = "force-dynamic";
const CAP = "platform.aqlab.operate";

export default async function AdHocPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  if (!(identiteit?.capabilities ?? []).includes(CAP)) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-sm text-ink/70">
          Geen toegang. Vereist: <code className="font-mono text-xs">{CAP}</code>.
        </p>
      </div>
    );
  }

  const svc = createServiceSupabase();
  const [modelConfigs, fixtures] = await Promise.all([haalModelConfiguraties(svc), haalFixtures(svc)]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/aqlab" className="text-sm text-accent hover:underline">← Terug naar het Lab</Link>
        <h1 className="mt-1 font-serif text-2xl font-bold">Ad-hoc consistentietest</h1>
      </div>
      <AdHocForm modelConfigs={modelConfigs} fixtures={fixtures} />
    </div>
  );
}
