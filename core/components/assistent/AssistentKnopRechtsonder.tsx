"use client";
// ============================================================================
//  Assistent — de generieke ingang, rechtsonder (T1, besluit 0204).
// ----------------------------------------------------------------------------
//  Dit is de ENIGE generieke ingang. Besluit van 3-9-2026: géén assistentknop
//  in de topbalk — die zou naast de module-eigen knoppen een tweede,
//  concurrerende ingang zijn. Het effect is meetbaar: gebruikt niemand deze
//  knop, dan is de topbalk alsnog een optie; andersom is een knop terugnemen
//  lastiger.
//
//  Hij is een toggle en geen "open"-knop, omdat hij anders bij een open paneel
//  een knop is die niets doet. `aria-expanded` zegt daarmee de waarheid.
// ============================================================================

import { usePathname } from "next/navigation";
import Icoon from "@/core/components/icons/Icoon";
import { useAssistentPaneel } from "./AssistentPaneelProvider";

/** De generieke knop neemt geen inhoudelijke scope over, maar onthoudt wel
 * vanuit welke zichtbare module hij is geopend. Zo kan de paneelkop dezelfde
 * contexttaal gebruiken als het mockup zonder te doen alsof er een document is
 * geselecteerd. */
function moduleVanPad(pad: string): string | null {
  if (pad.startsWith("/bibliotheek")) return "bibliotheek";
  if (pad.startsWith("/vergaderingen")) return "vergaderingen";
  if (pad.startsWith("/risicomatrix")) return "risicomatrix";
  if (pad.startsWith("/procedures")) return "procedures";
  if (pad.startsWith("/notulen")) return "notulen";
  if (pad.startsWith("/dashboard")) return "dashboard";
  if (pad.startsWith("/klantbeeld")) return "klantbeeld";
  if (pad === "/") return "home";
  return null;
}

export default function AssistentKnopRechtsonder() {
  const { stand, aiBeschikbaar, openMet, sluit } = useAssistentPaneel();
  const pad = usePathname();
  if (!aiBeschikbaar) return null;

  const open = stand !== "dicht";
  // In volledig scherm dekt het paneel de contentkolom af; een zwevende knop
  // erbovenop zou over het gesprek heen liggen.
  if (stand === "volledig") return null;

  return (
    <button
      type="button"
      onClick={() =>
        open ? sluit() : openMet({ ingangen: [], module: moduleVanPad(pad) })
      }
      aria-expanded={open}
      aria-controls="assistent-paneel"
      aria-label={open ? "Assistent sluiten" : "Assistent openen"}
      // Het assistent-accent uit besluit 0202, dat T3 juist voor deze knop en de
      // contextchip heeft gemaakt: teal voor AI, navy voor bestuurlijke acties.
      // Wit op `--ai` haalt 5,62:1. De hover verdonkert met een filter en niet
      // met `--ai-500`: dat token is grafisch (3,85:1) en mag geen tekst dragen.
      className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-ai px-4 py-2.5 text-sm font-medium text-white shadow-card transition-[filter] hover:brightness-90"
    >
      <Icoon sleutel={open ? "sluiten" : "sprankel"} grootte={17} streek={1.9} />
      <span className="max-sm:hidden">{open ? "Sluiten" : "Assistent"}</span>
    </button>
  );
}
