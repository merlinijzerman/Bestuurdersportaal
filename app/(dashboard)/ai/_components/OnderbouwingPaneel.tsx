"use client";

// Increment I-1 (FO §11c) — "Onderbouwing en bronnen".
// Rustige weergave: de controle-informatie (bronbasis, antwoordmodus, gebruikte
// documenten/bronverwijzingen, of historische context/algemene kennis is
// meegenomen) staat standaard INGEKLAPT onder het antwoord. De bestuurder krijgt
// eerst het inhoudelijke antwoord; deze laag is er voor vertrouwen en controle.
//
// Controlled component: page beheert open/dicht (een klik op een [Bron N]-pill
// of de vervolgactie "Toon gebruikte bronnen" klapt het paneel open en scrolt).
// De bronkaarten zelf komen als children mee (renderlogica leeft in page).

import { type ReactNode } from "react";

export interface OnderbouwingMeta {
  /** Korte samenvatting van de bronbasis (lib/vraagtype.bronbasisLabel). */
  bronbasis?: string | null;
  /** Label van de gebruikte/automatisch bepaalde antwoordmodus. */
  antwoordmodusLabel?: string | null;
  /** Ruwe antwoordmodus-waarde (voor het bepalen van vervolgacties). */
  antwoordmodus?: string | null;
  /** Retrieval-scope: 'actueel' | 'historisch' | 'besluitvorming' | 'alles'. */
  retrievalModus?: string | null;
  /** Peildatum waarop de actuele-bron-filtering is toegepast. */
  peildatum?: string | null;
  /** Of er (ook) algemene kennis is gebruikt. */
  algemeneKennis?: boolean | null;
  /** Aantal geraadpleegde bronnen (voor de count-badge). */
  aantalBronnen?: number;
  // Increment I-2 (FO §11a) — de automatische bronkeuze. Géén zichtbare badge in
  // de chat; de bestuurder ziet de gekozen intentie hier, in het controlevlak.
  /** Automatisch (of via verduidelijkingschip) bepaalde bron-intentie. */
  bronIntent?: "fonds" | "algemeen" | "gecombineerd" | null;
  /** Vertrouwen in de automatische bronkeuze ('zeker' | 'onzeker'). */
  bronVertrouwen?: "zeker" | "onzeker" | null;
  /** Of de bestuurder de vraag bewust tot fondsdocumenten beperkte. */
  alleenFondsdocumenten?: boolean | null;
  /** Intentie door de gebruiker bevestigd via een verduidelijkingschip (vs. heuristisch). */
  bronIntentOverride?: boolean | null;
}

// Bestuurlijk leesbare labels voor de automatische bronkeuze (geen jargon).
const BRON_INTENT_LABEL: Record<string, string> = {
  fonds: "Eigen fondsdocumenten",
  algemeen: "Algemene kennis",
  gecombineerd: "Fondsdocumenten + algemene kennis",
};

interface Props {
  meta: OnderbouwingMeta;
  open: boolean;
  onToggle: () => void;
  ankerId?: string;
  /** De bronkaarten (gerenderd door page). */
  children?: ReactNode;
}

function Rij({ label, waarde }: { label: string; waarde: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-400 w-36 flex-shrink-0">{label}</span>
      <span className="text-gray-700">{waarde}</span>
    </div>
  );
}

export default function OnderbouwingPaneel({
  meta,
  open,
  onToggle,
  ankerId,
  children,
}: Props) {
  const historischMeegenomen = meta.retrievalModus === "historisch";

  return (
    <div id={ankerId} className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 bg-white border border-gray-200 text-left hover:bg-gray-50 transition-colors ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-gray-400 text-xs">
            🔎
          </span>
          <span className="text-xs font-semibold text-[#0F2744]">
            Onderbouwing en bronnen
          </span>
          {typeof meta.aantalBronnen === "number" && meta.aantalBronnen > 0 && (
            <span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
              {meta.aantalBronnen}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={`flex-shrink-0 text-gray-400 text-xs transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border border-t-0 border-gray-200 rounded-b-lg bg-white px-3 py-3 space-y-3">
          {/* Gestructureerde controle-informatie (§11c). */}
          <div className="space-y-1">
            {meta.alleenFondsdocumenten ? (
              <Rij label="Brongebruik" waarde="Beperkt tot fondsdocumenten (uw keuze)" />
            ) : (
              meta.bronIntent && (
                <Rij
                  label="Brongebruik"
                  waarde={
                    <>
                      {BRON_INTENT_LABEL[meta.bronIntent] ?? meta.bronIntent}
                      <span className="text-gray-400">
                        {" "}
                        {meta.bronIntentOverride
                          ? "— door u bevestigd na verduidelijking"
                          : "— automatisch gekozen"}
                      </span>
                    </>
                  }
                />
              )
            )}
            {meta.bronbasis && <Rij label="Bronbasis" waarde={meta.bronbasis} />}
            {meta.antwoordmodusLabel && (
              <Rij label="Antwoordmodus" waarde={meta.antwoordmodusLabel} />
            )}
            {typeof meta.algemeneKennis === "boolean" && (
              <Rij
                label="Algemene kennis"
                waarde={meta.algemeneKennis ? "Gebruikt" : "Niet gebruikt"}
              />
            )}
            <Rij
              label="Historische context"
              waarde={historischMeegenomen ? "Meegenomen" : "Niet meegenomen"}
            />
            {meta.peildatum && <Rij label="Peildatum" waarde={meta.peildatum} />}
          </div>

          {/* Aannames en beperkingen staan inhoudelijk in het antwoord zelf
              (duiding/sparring scheiden feit/interpretatie/aanname expliciet). */}
          <p className="text-[11px] text-gray-400 italic">
            Aannames, beperkingen en openstaande vragen staan, waar van toepassing,
            in het antwoord zelf benoemd.
          </p>

          {/* Geraadpleegde documenten / bronverwijzingen. */}
          {children ? (
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                Geraadpleegde bronnen
              </div>
              <div className="space-y-2">{children}</div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Geen interne bronnen geraadpleegd voor dit antwoord.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
