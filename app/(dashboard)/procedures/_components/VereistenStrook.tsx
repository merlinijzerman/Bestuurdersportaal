// Server-component (geen state): herbruikbare vereisten-strook die
// boven elke actieknop kan staan die kan falen door ontbrekende
// randvoorwaarden. Eén regel per voorwaarde, met groen vinkje als
// vervuld of amber kruisje als niet vervuld; optioneel een leesbare
// hint per voorwaarde.
//
// Conform het overkoepelende ontwerpprincipe "Maak vereisten en
// blokkers expliciet" (zie HANDOVER.md): de gebruiker mag nooit op
// een knop klikken zonder te weten waarom hij niet werkt.

import type { ReactNode } from "react";

export interface Vereiste {
  /** Korte titel — bijv. "5 van 5 checklist-items voldaan". */
  label: string;
  /** Boolean: vervuld of niet. */
  voldaan: boolean;
  /** Optionele leesbare hint, bijv. wat ontbreekt. */
  hint?: string | null;
  /** Markeert deze vereiste als blokkerend (anders: aanbevolen). */
  blokkerend?: boolean;
}

interface Props {
  /** Korte introtekst, bijv. "Vereisten voor stap-voltooien". */
  titel?: string;
  /** Lijst van te tonen vereisten. */
  vereisten: Vereiste[];
  /** Optionele actie-component (bijv. de actieknop) onderaan. */
  actie?: ReactNode;
  /** Compactere weergave (zonder kop). */
  compact?: boolean;
}

export default function VereistenStrook({
  titel,
  vereisten,
  actie,
  compact,
}: Props) {
  if (vereisten.length === 0 && !actie) return null;

  const voldoetAantal = vereisten.filter((v) => v.voldaan).length;
  const blokkerendOntbrekend = vereisten.filter(
    (v) => !v.voldaan && v.blokkerend !== false
  );
  const allesVoldaan = blokkerendOntbrekend.length === 0;

  return (
    <div
      className={`rounded-md border ${
        allesVoldaan
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-amber-200 bg-amber-50/40"
      } ${compact ? "p-2.5" : "p-3"}`}
    >
      {!compact && titel && (
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wide text-gray-700 font-semibold">
            {titel}
          </h4>
          <span className="text-[11px] text-gray-600">
            {voldoetAantal} van {vereisten.length} voldaan
          </span>
        </div>
      )}
      <ul className="space-y-1">
        {vereisten.map((v, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-xs"
          >
            <span
              aria-hidden
              className={`flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                v.voldaan
                  ? "bg-emerald-500 text-white"
                  : v.blokkerend === false
                    ? "bg-gray-300 text-white"
                    : "bg-rose-500 text-white"
              }`}
            >
              {v.voldaan ? "✓" : "×"}
            </span>
            <div className="flex-1 min-w-0">
              <span
                className={
                  v.voldaan
                    ? "text-gray-700"
                    : "text-gray-900 font-medium"
                }
              >
                {v.label}
              </span>
              {v.hint && (
                <span className="text-gray-600 ml-1">— {v.hint}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {actie && (
        <div className={vereisten.length > 0 ? "mt-3" : ""}>{actie}</div>
      )}
    </div>
  );
}
