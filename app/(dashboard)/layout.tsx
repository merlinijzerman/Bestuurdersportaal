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

  const fondsNaam =
    (profiel?.fondsen as { naam: string } | null)?.naam ||
    process.env.NEXT_PUBLIC_FONDS_NAAM;

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
