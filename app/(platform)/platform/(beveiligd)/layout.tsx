// ============================================================================
//  Platform-auth + MFA-gate (Increment P0 — TO §3.2, FO §6.1.2/6.1.3).
// ----------------------------------------------------------------------------
//  Wrapt de BEVEILIGDE platform-pagina's. Twee harde poorten:
//   1. geldige platform-identiteit (platform_identities-rij, GEEN profielen-rij,
//      actief) — anders redirect naar de platform-login;
//   2. live AAL2 (echte MFA-factor in deze sessie, niet de mfa_enrolled-cache) —
//      anders redirect naar login met mfa-stap.
//  De login zelf valt BUITEN deze gate (eigen pad /platform/login).
//  Dit is server-side; de capability-check per handeling blijft in withPlatform.
// ============================================================================

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  huidigePlatformIdentiteit,
  heeftActueleMFA,
} from "@/lib/platform-auth";
import PlatformUitloggen from "../_components/Uitloggen";

export const dynamic = "force-dynamic";

export default async function BeveiligdePlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Onderscheid "geen sessie" van "sessie maar geen platform-account": dat
  // tweede geval (bv. een tenant-account, 3b-blokkade) krijgt een EIGEN fout-
  // param, zodat de login het account uitlogt i.p.v. een redirect-loop.
  const sessie = await createServerSupabase();
  const {
    data: { user },
  } = await sessie.auth.getUser();
  if (!user) {
    redirect("/platform/login");
  }

  const identiteit = await huidigePlatformIdentiteit();
  if (!identiteit || !identiteit.actief) {
    redirect("/platform/login?fout=geen_toegang");
  }
  const mfaOk = await heeftActueleMFA();
  if (!mfaOk) {
    redirect("/platform/login?mfa=1");
  }

  return (
    <div className="min-h-screen bg-app-bg text-[#0F2744]">
      <header className="flex items-center justify-between bg-[#0F2744] px-6 py-3 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-black text-[#0F2744]">
            P
          </div>
          <div>
            <div className="text-sm font-semibold">Platform back-office</div>
            <div className="text-xs text-white/70">{identiteit.email}</div>
          </div>
        </div>
        <PlatformUitloggen />
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
