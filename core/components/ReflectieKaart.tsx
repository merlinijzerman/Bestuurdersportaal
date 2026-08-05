"use client";

// ============================================================================
//  core/components/ReflectieKaart.tsx — Plateau B / B-2: de reflectie-uitnodiging
// ----------------------------------------------------------------------------
//  ⚠ DIT IS GEEN CHATBERICHT ⚠
//
//  De uitnodiging is een TIJDELIJKE UI-KAART (besluit 0109, FR-50). Ze leeft in
//  componentstate, niet in `gesprekken.berichten`. Wegklikken of "Geen
//  aanvullende reflectie" kiezen:
//
//    • voegt geen chatbericht toe,
//    • slaat geen databasewaarde op,
//    • schrijft geen auditregel,
//    • heeft geen inhoudelijke betekenis.
//
//  Dat laatste is niet vrijblijvend. "Geen aanvullende reflectie" betekent geen
//  instemming, geen geruststelling, geen akkoord en geen besluitrijpheid
//  (FR-22). Zou de keuze ergens landen, dan zou iemand hem later als zodanig
//  kunnen lezen — en dat is precies de betekenis die hij niet heeft.
//
//  PAS wanneer de gebruiker een ingang kiest, start de dialoog: de keuze wordt
//  een gewoon gebruikersbericht en de flow gaat via reflectie_transitie().
//
//  TOON. De kaart mag niet duwen. Geen uitroeptekens, geen "let op", geen
//  badge, geen kleuraccent dat om aandacht vraagt. Ze staat rustig onder het
//  antwoord en is met één klik weg. Wie niet reflecteert, mist niets — en de
//  interface hoort dat uit te stralen.
// ============================================================================

import {
  REFLECTIE_INGANGEN,
  INGANG_LABEL,
  type ReflectieIngang,
} from "@/core/lib/reflectie-flow";

interface Props {
  /**
   * De openingsvraag. Bij een expliciet besluitmoment een andere formulering
   * (v1.0 §9.2) — de aanroeper kiest, want alleen die weet of dit een
   * besluitmoment is.
   */
  vraag?: string;
  /** De gekozen ingang. De aanroeper zet de kaart daarna zelf weg. */
  onKies: (ingang: ReflectieIngang) => void;
  /** Wegklikken of "Geen aanvullende reflectie". Slaat NIETS op. */
  onSluit: () => void;
  /** Tijdens het streamen van een antwoord staan de knoppen uit. */
  bezig?: boolean;
}

export const REFLECTIE_VRAAG_STANDAARD =
  "Wilt u nog iets toetsen voordat u uw oordeel vormt?";

export const REFLECTIE_VRAAG_BESLUITMOMENT =
  "Wat verdient nog aandacht voordat u hierover een oordeel vormt?";

export default function ReflectieKaart({
  vraag = REFLECTIE_VRAAG_STANDAARD,
  onKies,
  onSluit,
  bezig = false,
}: Props) {
  return (
    <div
      className="mt-3 rounded-lg border border-line bg-card px-4 py-3"
      // De kaart is aanvullend, niet urgent: geen role="alert", geen focusroof.
      // Een schermlezer krijgt hem als gewone regio met een eigen label.
      role="group"
      aria-label="Reflectie op dit antwoord"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink">{vraag}</p>
        <button
          type="button"
          onClick={onSluit}
          disabled={bezig}
          className="shrink-0 text-xs text-muted hover:text-ink disabled:opacity-40 transition-colors"
          aria-label="Sluiten zonder reflectie"
        >
          Sluiten
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {REFLECTIE_INGANGEN.map((ingang) => (
          <button
            key={ingang}
            type="button"
            onClick={() => onKies(ingang)}
            disabled={bezig}
            className="text-xs text-ink bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {INGANG_LABEL[ingang]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSluit}
        disabled={bezig}
        className="mt-3 text-xs text-muted hover:text-ink disabled:opacity-40 transition-colors"
      >
        Geen aanvullende reflectie
      </button>

      {/* De belofte die de hele functie draagt, en die volgens de gebruikerstoets
          (criterium B2) door élke deelnemer correct moet worden benoemd. Ze staat
          hier en niet in een tooltip: wie de kaart ziet, hoort dit te lezen. */}
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Wat u hier invult blijft in deze privéchat en is alleen voor u zichtbaar.
        Deze vraag wegklikken wordt nergens vastgelegd.
      </p>
    </div>
  );
}
