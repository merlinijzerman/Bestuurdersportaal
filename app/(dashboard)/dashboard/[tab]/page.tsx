import { notFound } from "next/navigation";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { StuurinfoShell } from "../_components/StuurinfoShell";
import { STUURINFO_TABS } from "../_components/StuurinfoTabs";

// ============================================================
//  Bestuurdersdashboard — placeholders tabs 2/3 (T13; T15 bouwde 4+5,
//  T16 bouwde 6+7). Server-side gegate "Binnenkort"-pagina's: dezelfde
//  toegangsguard als de Balans-tab (manifest + capability + RLS-sessie),
//  allowlist op de tab-key (onbekend → notFound). BEWUST geen data of
//  nep-cijfers — geen schijnzekerheid; de inhoud volgt per tab in een eigen
//  ticket (Plan uitbreiding stuurinformatie, AZL-lijn). Gebouwde tabs
//  (balans, spreiding, solidariteit, operationeel, premie) hebben een eigen
//  statische route die van deze dynamische route wint — hier expliciet
//  uitgefilterd (geen dead paths).
// ============================================================

const GEBOUWDE_TABS = ["balans", "spreiding", "solidariteit", "operationeel", "premie"];
const PLACEHOLDER_TABS = STUURINFO_TABS.filter((t) => !GEBOUWDE_TABS.includes(t.key));
const TOELICHTING: Record<string, string> = {
  rendement:
    "Gerealiseerd vs. toebedeeld rendement, beschermings- en overrendement en de kapitaalontwikkeling per cohort.",
  biometrie: "Biometrische resultaten: micro/macro langleven, PP/Wzp en AO per cohort.",
};

export default async function StuurinfoTabPlaceholder({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>;
  searchParams: Promise<{ periode?: string }>;
}) {
  // Zelfde server-side gate als de Balans-tab (beschikbaarheid + capability).
  const { fondsId } = await vereisModuleToegang("stuurinformatie", "stuurinformatie.view");

  const { tab } = await params;
  const tabDef = PLACEHOLDER_TABS.find((t) => t.key === tab);
  if (!tabDef) notFound();

  const { periode } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: fonds } = await supabase.from("fondsen").select("naam").eq("id", fondsId).single();

  return (
    <StuurinfoShell
      actieveTab={tabDef.key}
      fondsNaam={fonds?.naam ?? ""}
      // Geen registry-lezing nodig: de placeholder toont geen data. De
      // ?periode-parameter reist via de tab-links mee terug naar de Balans-tab.
      periodeParam={typeof periode === "string" && periode ? periode : undefined}
    >
      <div className="bg-white rounded-xl border border-line p-8 text-center">
        <div className="text-sm font-semibold text-ink">
          {tabDef.nummer}. {tabDef.label}
        </div>
        <div className="text-sm text-muted mt-2 max-w-xl mx-auto">{TOELICHTING[tabDef.key]}</div>
        <div className="inline-flex items-center gap-2 mt-4 text-xs text-accent-ink bg-accent-tint px-3 py-1.5 rounded-full">
          Binnenkort — dit onderdeel wordt in een volgende release gebouwd
        </div>
      </div>
    </StuurinfoShell>
  );
}
