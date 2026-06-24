// ============================================================================
//  Platform — Standaardcatalogus / generieke beheerconfiguratie
//  (Increment P2/B14, FO §9 Platform-beheermodule).
// ----------------------------------------------------------------------------
//  Lijst + beheer-UI voor de PLATFORMBREDE standaardcatalogus (templates,
//  fonds_id = NULL) die de profielkeuzelijsten voedt: gremia (incl. commissies),
//  expertises en kritische focusgebieden. Deze items zijn de importeerbare
//  startwaarden die fondsen via de catalogus-import (O1) naar hun eigen
//  configuratie kopiëren.
//
//  LEESKANT via de anon-RLS-client: de SELECT-policy maakt template-rijen
//  (fonds_id is null) voor elke ingelogde identiteit leesbaar. SCHRIJFKANT
//  uitsluitend via de server-actions (acties.ts) achter withPlatform
//  (service-role + capability platform.config.manage + twee-fasen-audit).
// ============================================================================

import { createServerSupabase } from "@/lib/supabase-server";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import StandaardcatalogusClient, {
  type CatalogusItem,
} from "./_components/StandaardcatalogusClient";

export const dynamic = "force-dynamic";

const CAP = "platform.config.manage";

export default async function StandaardcatalogusPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const magBeheren = (identiteit?.capabilities ?? []).includes(CAP);

  const supabase = await createServerSupabase();

  const [{ data: gremia }, { data: expertises }, { data: focusgebieden }] =
    await Promise.all([
      supabase
        .from("gremia")
        .select("id, naam, type, categorie, omschrijving, actief, sort_order")
        .is("fonds_id", null)
        .order("sort_order", { ascending: true })
        .order("naam", { ascending: true }),
      supabase
        .from("expertises")
        .select("id, naam, omschrijving, actief, sort_order")
        .is("fonds_id", null)
        .order("sort_order", { ascending: true })
        .order("naam", { ascending: true }),
      supabase
        .from("kritische_focusgebieden")
        .select("id, naam, omschrijving, actief, sort_order")
        .is("fonds_id", null)
        .order("sort_order", { ascending: true })
        .order("naam", { ascending: true }),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Standaardcatalogus</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#0F2744]/70">
          Platformbrede standaarditems voor gremia/commissies, expertises en
          kritische focusgebieden. Deze items voeden de keuzelijsten in het
          persoonlijk profiel van bestuursleden en zijn de importeerbare
          startwaarden voor elk fonds. Wijzigingen raken alleen de standaard;
          bestaande fonds-kopieën blijven ongemoeid en worden append-only
          geaudit.
        </p>
      </div>

      {!magBeheren && (
        <div className="rounded-lg border border-[#C9A84C]/40 bg-[#C9A84C]/10 px-4 py-3 text-sm text-[#0F2744]">
          Je kunt de standaardcatalogus inzien maar niet beheren. Beheer vereist
          de capability <code className="font-mono">{CAP}</code>.
        </div>
      )}

      <StandaardcatalogusClient
        gremia={(gremia ?? []) as CatalogusItem[]}
        expertises={(expertises ?? []) as CatalogusItem[]}
        focusgebieden={(focusgebieden ?? []) as CatalogusItem[]}
        magBeheren={magBeheren}
      />
    </div>
  );
}
