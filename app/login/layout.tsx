import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/core/lib/supabase-server";

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
    const { data: profiel } = await supabase
      .from("profielen")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (profiel) redirect("/");
  }

  return children;
}
