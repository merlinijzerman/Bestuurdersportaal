import { createServerSupabase } from "@/core/lib/supabase-server";
import NieuweVergaderingForm from "./_components/NieuweVergaderingForm";
import VergaderingenLijst, {
  type VergaderingRij,
} from "./_components/VergaderingenLijst";

// ============================================================================
//  Vergaderingenoverzicht — besluit 0141
// ----------------------------------------------------------------------------
//  Deze pagina haalt de data server-side op (RLS, geen extra roundtrip) en laat
//  de weergave over aan een client-component: archiveren en het uitklapbare
//  archiefblok vragen interactie.
//
//  De sortering en de driedeling komen uit core/lib/vergadering-archief.ts, niet
//  uit een query. Eén plek, met sanity-tests, zodat een gearchiveerde
//  vergadering nooit óók bij "komend" of "afgelopen" kan opduiken.
// ============================================================================

export default async function VergaderingenPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id")
    .eq("id", user.id)
    .single();

  const { data: vergaderingen } = await supabase
    .from("vergaderingen")
    .select("id, titel, datum, locatie, status, gearchiveerd_op")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("datum", { ascending: false });

  const lijst = (vergaderingen || []) as VergaderingRij[];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-xl font-bold text-ink">Vergaderingen</h1>
          <p className="mt-0.5 text-sm text-muted">
            Plan, agendeer en bereid bestuursvergaderingen voor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NieuweVergaderingForm />
        </div>
      </div>

      <VergaderingenLijst lijst={lijst} />
    </div>
  );
}
