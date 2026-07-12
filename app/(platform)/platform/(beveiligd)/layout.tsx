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
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  huidigePlatformIdentiteit,
  heeftActueleMFA,
} from "@/platform/lib/platform-auth";
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
    <div className="min-h-screen bg-app-bg text-ink">
      <header className="flex items-center justify-between gap-3 bg-nav border-b border-nav-line px-4 py-3 text-nav-text-active sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nav-accent font-black text-white">
            P
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Platform back-office</div>
            <div className="truncate text-xs text-nav-text">{identiteit.email}</div>
          </div>
        </div>
        <PlatformUitloggen />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
