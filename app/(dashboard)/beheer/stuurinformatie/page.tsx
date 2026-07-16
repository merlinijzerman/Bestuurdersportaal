import Link from "next/link";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { requireCapability } from "@/core/lib/capabilities";
import StuurinfoInvoer from "./_components/StuurinfoInvoer";

// ============================================================
//  Beheer › Stuurinformatie — invoerlaag (T14, decisions/0075).
//  UI-gating op de capability is cosmetisch (warn-banner); de echte grens is
//  de API (/api/stuurinformatie/beheer: capability + module + RLS-rolgate).
//  Bewust géén vereisModuleToegang op de pagina (beheerpagina-patroon); de
//  module-beschikbaarheidscheck zit in de API-routes.
// ============================================================
export default async function StuurinfoBeheerPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const magInvoeren = await requireCapability(user.id, "stuurinformatie.manage");

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <div className="text-xs text-muted mb-1">
          <Link href="/beheer" className="hover:underline">
            Beheer
          </Link>{" "}
          › Stuurinformatie
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink">Bedragen invoeren</h1>
        <p className="text-muted text-sm mt-1">
          Vul de standen per rapportageperiode. Deze voeden alle tabs van het
          bestuurdersdashboard.
        </p>
      </div>

      {!magInvoeren ? (
        <div className="rounded-xl border border-warn/30 bg-warn-tint p-4 text-warn-ink text-sm">
          U heeft geen rechten om stuurinformatie in te voeren. Dit is voorbehouden
          aan de rol <strong>beheerder</strong> of <strong>voorzitter</strong>.
        </div>
      ) : (
        <StuurinfoInvoer />
      )}
    </div>
  );
}
