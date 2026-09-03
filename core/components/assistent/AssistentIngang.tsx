"use client";
// ============================================================================
//  Assistent — DE ingang. Eén component voor alle module-knoppen (T1, 0204).
// ----------------------------------------------------------------------------
//  Het ingangenregister (`README.md` in deze map) is bindend: elke module heeft
//  precies één AI-knop, en die knop opent het paneel. Er komt er geen tweede
//  naast. Dat register is alleen aftoetsbaar als alle ingangen door hetzelfde
//  component lopen — anders is "geen dubbele ingangen" een belofte in proza.
//
//  WAAROM EEN <a> EN GEEN <button>. Drie redenen, alle drie uit de code:
//   1. `StapPaneel.tsx` zet zijn ingang bewust als anker neer omdat hij binnen
//      een `<fieldset disabled>` (leesmodus) staat; een <button> is daar
//      uitgeschakeld en de knop zou stil niets doen.
//   2. Midden-klik, "open in nieuw tabblad" en bookmarken blijven werken.
//   3. Er is een echte val-terug: staat er geen paneel boven (het platformdeel
//      heeft een eigen schil), dan navigeert de link gewoon naar /ai.
//  De href komt uit `bouwAssistentDeeplink`, zodat parser en bouwer dezelfde
//  parameternamen delen.
//
//  MANIFESTGATE. Staat module `ai` uit voor dit fonds, dan rendert deze
//  component niets — voor alle ingangen tegelijk. Dat is netheid, geen
//  beveiliging: de poort staat server-side in `/api/chat` (`weigerAlsModuleUit`).
// ============================================================================

import type { ReactNode } from "react";
import {
  bouwAssistentDeeplink,
  type AssistentUrlIngang,
} from "@/core/lib/assistent-url-ingang";
import { useAssistentPaneelOptioneel } from "./AssistentPaneelProvider";

export interface AssistentIngangProps {
  /** Wat deze ingang aanwijst. Leeg = de generieke ingang (fondsbreed). */
  ingangen: AssistentUrlIngang[];
  /**
   * De module waar de klik vandaan komt, als slug. Uitsluitend clientstaat voor
   * het label "Vanuit «…»" in de paneelkop — dit veld gaat NIET de payload in;
   * zie de toelichting in `AssistentPaneelProvider.tsx`.
   */
  module: string;
  className?: string;
  title?: string;
  /** Bijwerk van de klik in de module zelf (bijv. een menu sluiten). */
  onClick?: () => void;
  children: ReactNode;
}

/** Een gewone linkerklik zonder modifiers — al het andere laten we aan de browser. */
function isGewoneKlik(e: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}

export default function AssistentIngang({
  ingangen,
  module,
  className,
  title,
  onClick,
  children,
}: AssistentIngangProps) {
  const paneel = useAssistentPaneelOptioneel();
  if (paneel && !paneel.aiBeschikbaar) return null;

  return (
    <a
      href={bouwAssistentDeeplink(ingangen)}
      className={className}
      title={title}
      aria-expanded={paneel ? paneel.stand !== "dicht" : undefined}
      aria-controls={paneel ? "assistent-paneel" : undefined}
      onClick={(e) => {
        onClick?.();
        if (!paneel || !isGewoneKlik(e)) return;
        e.preventDefault();
        paneel.openMet({ ingangen, module });
      }}
    >
      {children}
    </a>
  );
}
