import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/core/lib/supabase-server";

// Server-laag rond de (client-)loginpagina. Twee taken:
//  1. noindex/follow: de login mag niet in de zoekindex, maar links erin mogen
//     wel gevolgd worden (SEO, TO §9.1).
//  2. Reeds ingelogde gebruikers worden weggeleid naar de app — geen login
//     tonen aan wie al een sessie heeft. De auth-logica zelf zit ongewijzigd in
//     page.tsx (supabase.auth.signInWithPassword).
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
    redirect("/");
  }

  return children;
}
