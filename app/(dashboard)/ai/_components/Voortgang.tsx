// ============================================================================
//  Voortgang — gedeelde statusweergave tijdens het wachten op een AI-antwoord
//  (besluit 0087). Gebruikt door de volledige assistent (/ai, AssistentClient)
//  én de agenda-voorbereiding (AgendapuntChat), zodat de statussen niet opnieuw
//  uiteenlopen: één afgeronde regel per bereikte serverfase (met uitkomst) + de
//  actieve fase als lopende regel; bij brede documentanalyse een batch-teller.
// ============================================================================

export interface VoortgangKlaarRegel {
  fase: string;
  label: string;
  uitkomst?: string;
}

export interface VoortgangUI {
  actieveFase: string | null;
  actiefLabel: string | null;
  analyse: { batch: number; totaal: number } | null;
  klaar: VoortgangKlaarRegel[];
}

// Een progress-event zoals /api/chat het stuurt (subset; extra velden op het
// event worden genegeerd).
export interface VoortgangEvent {
  fase?: string;
  status?: string;
  label?: string;
  uitkomst?: string;
  batch?: number;
  totaal?: number;
}

// Pure reducer: verwerkt één progress-event tot de nieuwe voortgangsstaat. Zelfde
// logica die de assistent (/ai) sinds besluit 0087 hanteert, nu gedeeld.
export function pasVoortgangToe(
  v: VoortgangUI | null,
  evt: VoortgangEvent,
): VoortgangUI | null {
  const fase = evt.fase;
  if (!fase) return v; // onbekende progress zonder fase → ongewijzigd
  if (fase === "analyse") {
    const batch = typeof evt.batch === "number" ? evt.batch : 0;
    const totaal = typeof evt.totaal === "number" ? evt.totaal : 0;
    return {
      actieveFase: "analyse",
      actiefLabel: evt.label || "Document wordt geanalyseerd",
      analyse: { batch, totaal },
      klaar: v?.klaar ?? [],
    };
  }
  if (evt.status === "klaar") {
    const klaar = [
      ...(v?.klaar ?? []),
      { fase, label: evt.label || fase, uitkomst: evt.uitkomst },
    ];
    // De actieve regel wist als deze fase 'm bezette (bv. retrieval).
    const actiefWeg = v?.actieveFase === fase;
    return {
      actieveFase: actiefWeg ? null : v?.actieveFase ?? null,
      actiefLabel: actiefWeg ? null : v?.actiefLabel ?? null,
      analyse: v?.analyse ?? null,
      klaar,
    };
  }
  // status "bezig" (of onbekend) → lopende regel.
  return {
    actieveFase: fase,
    actiefLabel: evt.label || fase,
    analyse: null,
    klaar: v?.klaar ?? [],
  };
}

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
      <div className="space-y-1.5">
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
    <div className="flex gap-1.5 items-center">
      <span className="typing-dot"></span>
      <span className="typing-dot"></span>
      <span className="typing-dot"></span>
    </div>
  );
}
