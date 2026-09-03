// ============================================================================
//  /ai — server-wrapper: de VOLLEDIG-SCHERMSTAND van het assistentpaneel.
// ----------------------------------------------------------------------------
//  Sinds T1 (besluit 0204) rendert deze route de assistent niet meer zelf: het
//  oppervlak hangt één keer in `DashboardShell`. `AssistentClient` is nog
//  uitsluitend de brug — stand op volledig, startpuntgegevens publiceren,
//  deeplinks bij een client-navigatie toepassen.
//
//  Deze server-component leidt de sessie server-side af (haalFondsSessie /
//  getPortaalContext — nooit fonds uit de URL) en haalt de gedeelde
//  portaalcontext op. Dat blijft híer en gaat niet naar de layout: het zijn
//  vier à vijf query's, en elke dashboardpagina ermee belasten voor een
//  startpunt dat alleen op deze route past, is een slechte ruil.
//
//  GATE — BEWUSTE HERZIENING VAN 0085 §Alternatieven. Besluit 0085 zag bewust
//  af van een manifest-gate op /ai: de route was toen een pagina die alleen via
//  het nav-item bereikbaar was, en het manifest verborg dat item al. Met T1 is
//  die redenering vervallen — staat module `ai` uit, dan verbergt de shell
//  paneel, knop en ingangen, maar bleef /ai zelf bereikbaar en toonde hij een
//  lege paneelstand. Daarom nu wél een paginagate, gelijk aan het huispatroon
//  (`vergaderingen/[id]/page.tsx` r. 92). Beschikbaarheid ≠ autorisatie: dit is
//  netheid. De echte poort staat server-side in /api/chat (weigerAlsModuleUit).
// ============================================================================

import { notFound } from "next/navigation";
import { getPortaalContext } from "@/core/lib/portaalcontext";
import { haalFondsSessie } from "@/core/lib/fonds-sessie";
import { moduleBeschikbaar } from "@/core/lib/fonds-config";
import AssistentClient from "./_components/AssistentClient";

export default async function AiPage() {
  const sessie = await haalFondsSessie();
  if (!(await moduleBeschikbaar(sessie.fondsId, "ai"))) notFound();

  // getPortaalContext leidt de sessie zelf af (redirect naar /login bij geen
  // sessie/fonds). Dat blijft de effectieve gate; de modulecheck komt erbovenop.
  const startpuntContext = await getPortaalContext();
  return <AssistentClient startpuntContext={startpuntContext} />;
}
