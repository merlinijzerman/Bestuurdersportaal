"use client";
// ============================================================================
//  `/ai` — de VOLLEDIG-SCHERMSTAND van het paneel (T1, besluit 0204).
// ----------------------------------------------------------------------------
//  Dit bestand rendert de assistent niet meer. Sinds T1 hangt er precies één
//  oppervlak in `DashboardShell`; zou deze route er een tweede mounten, dan
//  waren dat twee gesprekken, twee Supabase-clients en twee schrijvers naar
//  dezelfde `gesprekken`-rij. De route doet daarom nog drie dingen, en verder
//  niets:
//
//   1. de paneelstand op `volledig` zetten (en bij weglopen weer krimpen);
//   2. de startpuntgegevens publiceren — `getPortaalContext()` draait alleen
//      hier, want het zijn vier à vijf query's die niet op elke dashboardpagina
//      thuishoren (besluit 0085/0088 blijft daarmee intact op /ai);
//   3. een deeplink die tijdens een CLIENT-navigatie binnenkomt alsnog
//      toepassen.
//
//  Waarom (3) hier hoort: `useAssistent` leest `window.location.search` één
//  keer, in zijn initialisatie-effect, ná het profiel en ná de auto-restore.
//  Die volgorde is er niet toevallig (P1a) en blijft staan. Maar het oppervlak
//  blijft na de eerste opening gemount, dus bij een navigatie naar `/ai?doc=…`
//  draait dat effect niet opnieuw en zou de deeplink stil worden genegeerd.
//  De eerste doorloop slaan we daarom over — die dekt het init-effect al — en
//  elke volgende zoekstring gaat door dezelfde aanvraag als een module-knop.
// ============================================================================

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAssistentPaneel } from "@/core/components/assistent/AssistentPaneelProvider";
import { leesAssistentContextUitUrl } from "@/core/lib/assistent-url-ingang";
import type { PortaalContext } from "@/core/lib/portaalcontext-afleiding";

export default function AssistentClient({
  startpuntContext,
}: {
  startpuntContext: PortaalContext;
}) {
  const { zetStand, krimpUitVolledig, zetStartpuntContext, openMet } =
    useAssistentPaneel();
  const zoekparams = useSearchParams();
  const eersteDoorloop = useRef(true);

  useEffect(() => {
    zetStand("volledig");
    // Weglopen van /ai terwijl het paneel nog volledig scherm is: krimpen naar
    // het paneel. Zou het volledig blijven, dan dekt het de module af waar de
    // bestuurder net naartoe navigeerde. De "stond hij nog volledig?"-vraag
    // beantwoordt de paneelstaat zelf, zodat dit effect niet aan elke
    // standwissel hoeft te hangen.
    return () => krimpUitVolledig();
  }, [zetStand, krimpUitVolledig]);

  useEffect(() => {
    zetStartpuntContext(startpuntContext);
    return () => zetStartpuntContext(null);
  }, [startpuntContext, zetStartpuntContext]);

  useEffect(() => {
    if (eersteDoorloop.current) {
      eersteDoorloop.current = false;
      return;
    }
    const { ingangen } = leesAssistentContextUitUrl(zoekparams.toString());
    if (ingangen.length > 0) openMet({ ingangen, module: null });
  }, [zoekparams, openMet]);

  return null;
}
