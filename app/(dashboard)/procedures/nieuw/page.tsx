import Link from "next/link";
import NieuweProcedureForm from "../_components/NieuweProcedureForm";
import { TEMPLATES } from "@/core/lib/proces-templates";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalFondsleden } from "@/core/lib/fondsleden";

export default async function NieuweProcedurePage() {
  // Co-eigenaars worden gekozen uit de leden van het eigen fonds (besluit 0102).
  // vw_fondsleden scopet zelf op het fonds van de ingelogde gebruiker; bestaat de
  // view nog niet, dan is de lijst leeg en meldt het formulier dat.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ledenKaart = await haalFondsleden(supabase);
  const leden = Array.from(ledenKaart.values())
    .filter((l) => l.id !== user?.id && l.naam?.trim())
    .map((l) => ({ id: l.id, naam: l.naam as string, rol: l.rol }))
    // Deterministisch sorteren zonder localeCompare — ICU-gedrag verschilt per
    // Node-build, en besluit 0099 legt die regel al vast voor de bronnenlijst.
    .sort((a, b) => (a.naam < b.naam ? -1 : a.naam > b.naam ? 1 : a.id < b.id ? -1 : 1));

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-3xl">
      <Link
        href="/procedures"
        className="text-sm text-muted hover:text-ink inline-flex items-center gap-1"
      >
        ← Terug naar procedures
      </Link>
      <h1 className="font-serif text-ink text-xl font-bold mt-2">
        Start een nieuwe procedure
      </h1>
      <p className="text-muted text-sm mt-0.5">
        Kies een procestemplate. De stappen, checklist-items en bewijsvereisten
        worden automatisch op basis van de template ingericht.
      </p>
      <div className="mt-6">
        <NieuweProcedureForm templates={TEMPLATES} leden={leden} />
      </div>
    </div>
  );
}
