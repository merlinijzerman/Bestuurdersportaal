import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beeindigSessie, beoordeelPortaalSessie } from "@/core/lib/microsoft-login-sessieguard";

// Server-laag rond de (client-)loginpagina. Twee taken:
//  1. noindex/follow: de login mag niet in de zoekindex, maar links erin mogen
//     wel gevolgd worden (SEO, TO §9.1).
//  2. Reeds ingelogde TENANTgebruikers worden weggeleid naar de app — geen
//     login tonen aan wie al een geldige tenant-sessie heeft. Een platform-
//     identiteit heeft bewust geen profielen-rij. Die sessie mag hier niet
//     terug naar `/`, want het tenantdashboard stuurt haar juist naar `/login`
//     en dat zou een redirectlus veroorzaken.
export const metadata: Metadata = {
  title: "Inloggen",
  robots: { index: false, follow: true },
};

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Guard L3 (#335 T2, uitgebreid in #344): een sessie die volgens het actuele
    // fondsbeleid niet mag bestaan blijft op de login — sessie beëindigen, géén
    // redirect naar `/` (dat zou een lus met de tenant-layout geven).
    if (!(await beoordeelPortaalSessie(supabase, user.id)).toegestaan) {
      await beeindigSessie(supabase);
    } else {
      const { data: profiel } = await supabase
        .from("profielen")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (profiel) redirect("/");
    }
  }

  return children;
}
