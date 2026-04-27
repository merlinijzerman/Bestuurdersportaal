import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import Sidebar from "@/components/Sidebar";

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
        {children}
      </main>
    </div>
  );
}
