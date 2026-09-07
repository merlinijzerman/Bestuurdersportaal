// ============================================================================
//  Auth-callback — code-exchange + veilige terugkeer naar de app.
// ----------------------------------------------------------------------------
//  H-03 (review 2026-07-30): `next` werd zonder validatie aan `origin` geplakt.
//  Omdat URL.origin geen afsluitende slash heeft, kan een aanvaller daarmee de
//  AUTHORITY van de URL herschrijven:
//     next="@evil.com/pad"  →  https://portaal.fonds.nl@evil.com/pad  (host = evil.com)
//     next=".evil.com"      →  https://portaal.fonds.nl.evil.com      (host = …evil.com)
//  Beide beginnen zichtbaar met het eigen fondsdomein — ideaal voor phishing.
//  /auth is expliciet uitgezonderd van de middleware (matcher in middleware.ts),
//  dus er is geen enkele andere laag die dit afvangt.
//
//  Maatregel: `next` moet een RELATIEF pad binnen de eigen origin zijn. Alles
//  wat daar niet aan voldoet valt fail-safe terug op "/".
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { veiligVervolgpad } from "@/core/lib/redirect-veilig";
import { beeindigSessie, beoordeelOAuthSessie, heeftAzureIdentiteit } from "@/core/lib/microsoft-login-sessieguard";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = veiligVervolgpad(searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // L4 (#335 T2, ontwerp §3.2): een hosted-flow-restant — `azure`-identiteit
      // zonder actieve binding — wordt opgeruimd: identiteit weg, sessie weg,
      // terug naar de login. Sessies zonder azure-identiteit raken de gateway niet.
      const { data: { user } } = await supabase.auth.getUser();
      if (user && heeftAzureIdentiteit(user)) {
        const oordeel = await beoordeelOAuthSessie(supabase, user.id);
        if (!oordeel.toegestaan) {
          const azure = user.identities?.find((i) => i.provider === "azure");
          if (azure) await supabase.auth.unlinkIdentity(azure).catch(() => undefined);
          await beeindigSessie(supabase);
          console.warn("[MICROSOFT-LOGIN] L4: azure-identiteit zonder actieve binding verwijderd");
          return NextResponse.redirect(`${origin}/login?error=auth_callback`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
