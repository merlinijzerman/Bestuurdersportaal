// ============================================================================
//  Voortgang — gedeelde statusweergave tijdens het wachten op een AI-antwoord
//  (besluit 0087). Gebruikt door de volledige assistent (/ai, AssistentClient)
//  én de agenda-voorbereiding (sinds T1: VoorbereidingKaart, die alleen de
//  meta/delta/done-stroom van de voorbereidingsroute consumeert), zodat de statussen niet opnieuw
//  uiteenlopen: één afgeronde regel per bereikte serverfase (met uitkomst) + de
//  actieve fase als lopende regel; bij brede documentanalyse een batch-teller.
// ============================================================================

// P1a — de types en de pure reducer wonen sinds de laagsplitsing in
// `core/lib/voortgang.ts`, naast de fase-labels waar ze bij horen (besluit
// 0087). Hier ongewijzigd doorgegeven; deze module houdt de wéérgave.
export {
  pasVoortgangToe,
  type VoortgangKlaarRegel,
  type VoortgangUI,
  type VoortgangEvent,
} from "@/core/lib/voortgang";
import type { VoortgangUI } from "@/core/lib/voortgang";

// Weergave: afgeronde fasen (✓ + uitkomst) + de actieve fase als lopende regel;
// valt terug op de typ-indicator zolang er nog geen fase-informatie is.
export function VoortgangWeergave({
  voortgang,
}: {
  voortgang: VoortgangUI | null;
}) {
  if (
    voortgang &&
    (voortgang.klaar.length > 0 || voortgang.actiefLabel || voortgang.analyse)
  ) {
    return (
      <div role="status" aria-live="polite" className="space-y-1.5">
        {/* Afgeronde fasen met hun uitkomst. */}
        {voortgang.klaar.map((k, idx) => (
          <div
            key={`${k.fase}-${idx}`}
            className="text-xs text-muted flex items-start gap-1.5"
          >
            <span className="text-ok-ink flex-shrink-0" aria-hidden>
              ✓
            </span>
            <span>
              {k.label}
              {k.uitkomst ? ` — ${k.uitkomst}` : ""}
            </span>
          </div>
        ))}
        {/* Actieve fase als lopende regel. */}
        {voortgang.analyse ? (
          <div className="text-sm text-muted">
            {voortgang.actiefLabel}… (deel {voortgang.analyse.batch} van{" "}
            {voortgang.analyse.totaal})
          </div>
        ) : voortgang.actiefLabel ? (
          <div className="text-sm text-muted flex items-center gap-2">
            <span className="flex gap-1 items-center" aria-hidden>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </span>
            {voortgang.actiefLabel}…
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div role="status" aria-label="Antwoord wordt voorbereid" className="flex gap-1.5 items-center">
      <span className="typing-dot"></span>
      <span className="typing-dot"></span>
      <span className="typing-dot"></span>
    </div>
  );
}
