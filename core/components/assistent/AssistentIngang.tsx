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
import {
  useAssistentPaneelOptioneel,
  type PaneelStartbeurt,
} from "./AssistentPaneelProvider";

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
  /**
   * Een beurt die deze ingang meteen laat versturen (T2, #304) — vandaag alleen
   * "Bereid dit punt voor" / "Opnieuw opstellen". De ingang blijft een <a>: bij
   * midden-klik of "openen in nieuw tabblad" volgt de browser gewoon de
   * deeplink, en dan opent /ai mét de context maar ZONDER automatische beurt.
   * Dat is bewust: een nieuw tabblad dat uit zichzelf een kostendragende
   * AI-beurt start, is niet wat de bestuurder vroeg.
   */
  startbeurt?: PaneelStartbeurt;
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
  startbeurt,
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
        paneel.openMet({ ingangen, module, startbeurt });
      }}
    >
      {children}
    </a>
  );
}
