// ============================================================================
//  Lijn-iconenset (T3, besluit 0202) — vervangt de Unicode-tekens (⌂ ◐ ◍ ▤ ▦ ✓
//  ◧ ◇ ⚙ ◎) in de navigatie. Die tekens waren het sterkste
//  "niet-professioneel"-signaal in de chrome, en twee ervan waren bovendien
//  dubbel in gebruik: ▦ voor Vergaderingen én Stemmen, ◇ voor Risicomatrix én
//  Kwaliteitsborging.
//
//  GEEN icoonbibliotheek als dependency. De paden zijn ontleend aan Lucide
//  (ISC — zie LICENSE-lucide.txt in deze map), zodat alle iconen hetzelfde
//  optische grid (24x24), dezelfde streekbreedte en dezelfde eindvormen delen.
//  Zelf natekenen zou per icoon net iets ander gewicht opleveren en dat zie je
//  juist in een zijbalk waar twaalf iconen onder elkaar staan.
//
//  Toegankelijkheid: het icoon is ALTIJD decoratief (`aria-hidden`) — de
//  toegankelijke naam komt van het label ernaast (guardrail 5 van de opdracht,
//  en besluit 0097: kleur/vorm is nooit de enige drager).
//
//  Uitbreiden = één regel in PADEN + de sleutel in IcoonSleutel. TypeScript
//  meldt het als een module een sleutel gebruikt die niet bestaat.
// ============================================================================

import type { ReactNode } from "react";

export type IcoonSleutel =
  | "huis"
  | "staafgrafiek"
  | "personen"
  | "sprankel"
  | "boeken"
  | "agenda"
  | "document"
  | "stembiljet"
  | "stroomschema"
  | "waarschuwing"
  | "tandwiel"
  | "logboek"
  | "schild-vink"
  | "schild"
  | "chevron-rechts"
  | "uitloggen"
  | "menu";

/** Paden op het 24x24-grid van Lucide. Alleen `d`-attributen en primitieven;
 *  streekbreedte, kleur en eindvormen staan één keer op het <svg> hieronder. */
const PADEN: Record<IcoonSleutel, ReactNode> = {
  huis: (
    <>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  staafgrafiek: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  personen: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  sprankel: (
    <>
      <path d="M11.5 3.2a.55.55 0 0 1 1 0l1.6 4.6a2 2 0 0 0 1.1 1.1l4.6 1.6a.55.55 0 0 1 0 1l-4.6 1.6a2 2 0 0 0-1.1 1.1l-1.6 4.6a.55.55 0 0 1-1 0l-1.6-4.6a2 2 0 0 0-1.1-1.1l-4.6-1.6a.55.55 0 0 1 0-1l4.6-1.6a2 2 0 0 0 1.1-1.1z" />
      <path d="M18.5 15.5 19 17l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 18l1.5-.5z" />
    </>
  ),
  boeken: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </>
  ),
  agenda: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  document: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  stembiljet: (
    <>
      <path d="m9 12 2 2 4-4" />
      <path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5z" />
      <path d="M22 19H2" />
    </>
  ),
  stroomschema: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  waarschuwing: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  tandwiel: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  logboek: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  "schild-vink": (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  schild: (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  ),
  "chevron-rechts": <path d="m9 18 6-6-6-6" />,
  uitloggen: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  menu: (
    <>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </>
  ),
};

export interface IcoonProps {
  sleutel: IcoonSleutel;
  /** Zijde in px. Nav-iconen staan op 18; kleinere bijschriften op 14-15. */
  grootte?: number;
  /** Streekbreedte. 1,7 is de nav-maat uit het goedgekeurde prototype; kleine
   *  maten mogen iets zwaarder zodat ze niet verdwijnen. */
  streek?: number;
  className?: string;
}

/**
 * Decoratief lijn-icoon. Draagt NOOIT de toegankelijke naam: `aria-hidden` staat
 * vast aan en is niet overschrijfbaar. Staat een icoon zonder tekstlabel (een
 * icoonknop), geef die knop dan een `aria-label`.
 */
export default function Icoon({ sleutel, grootte = 18, streek = 1.7, className }: IcoonProps) {
  return (
    <svg
      width={grootte}
      height={grootte}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={streek}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PADEN[sleutel]}
    </svg>
  );
}
