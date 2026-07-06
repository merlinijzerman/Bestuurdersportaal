import { createServerSupabase } from "@/lib/supabase-server";
import BeheerClient from "./_components/BeheerClient";

// Beheer-sectie: procescatalogus + organen + import. UI-gating op rol is
// cosmetisch; de autorisatie zit server-side in de API (catalog.manage).
export default async function BeheerPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("rol")
    .eq("id", user.id)
    .single();

  const magBeheren = profiel?.rol === "beheerder";

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-ink">Catalogus &amp; organen</h1>
        <p className="text-muted text-sm mt-1">
          Beheer fonds-specifieke procesmodellen, gremia, expertises en kritische
          focusgebieden. Importeer de standaardset als startpunt.
        </p>
      </div>

      {!magBeheren ? (
        <div className="rounded-xl border border-warn/30 bg-warn-tint p-4 text-warn-ink text-sm">
          U heeft geen beheerrechten. Catalogus- en organenbeheer is voorbehouden
          aan de rol <strong>beheerder</strong>.
        </div>
      ) : (
        <BeheerClient />
      )}
    </div>
  );
}
