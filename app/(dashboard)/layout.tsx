import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam, rol, fondsen(naam)")
    .eq("id", user.id)
    .single();

  // 3b-blokkade (wederzijds): een sessie zonder profielen-rij is een
  // platform-identiteit (of een ongeldig account) en hoort niet op de
  // tenant-surface. Stuur door naar de tenant-login; de platform-kant heeft
  // zijn eigen gate in app/(platform)/platform/(beveiligd)/layout.tsx.
  if (!profiel) {
    redirect("/login");
  }

  // Supabase kan `fondsen` als array of als enkel object teruggeven,
  // afhankelijk van de relatie en versie van @supabase/supabase-js.
  // Robuust: behandel beide gevallen.
  const fondsenRel = profiel?.fondsen as
    | { naam: string }
    | { naam: string }[]
    | null
    | undefined;
  const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
  const fondsNaam = fondsenObj?.naam || process.env.NEXT_PUBLIC_FONDS_NAAM;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        gebruikerNaam={profiel?.naam}
        gebruikerRol={profiel?.rol}
        fondsNaam={fondsNaam}
      />
      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        <TopBar
          gebruikerNaam={profiel?.naam}
          gebruikerRol={profiel?.rol}
          fondsNaam={fondsNaam}
        />
        {children}
      </main>
    </div>
  );
}
