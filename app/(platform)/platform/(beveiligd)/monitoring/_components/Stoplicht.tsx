// ============================================================================
//  Stoplicht — statusweergave voor het monitoringdashboard (P4-light)
// ----------------------------------------------------------------------------
//  KLEUR IS NOOIT DE ENIGE DRAGER (besluiten 0097 en 0101). Elke status draagt
//  drie onafhankelijke signalen:
//    1. kleur   — via de bestaande ok/warn/err-tokens (nooit een named palette
//                 class; npm run lint:colors blokkeert die);
//    2. woord   — "In orde" / "Aandacht" / "Verstoord" / "Onbekend";
//    3. vorm    — vinkje / uitroepteken / kruis / vraagteken, elk in een eigen
//                 omtrek, zodat de statussen ook in grijstinten en voor
//                 kleurenblinde gebruikers uit elkaar te houden zijn.
//
//  "Onbekend" is geen restcategorie maar een volwaardige uitkomst: hij betekent
//  "hier is niet gemeten" (verouderde snapshot) of "hier mag niets getoond
//  worden" (n-drempel). Beide zijn nadrukkelijk géén groen.
// ============================================================================

import type { SignaalStatus } from "@/platform/lib/monitoring-signalen";

const WEERGAVE: Record<
  SignaalStatus,
  { woord: string; klassen: string; omschrijving: string }
> = {
  groen: {
    woord: "In orde",
    klassen: "bg-ok-tint text-ok-ink border-ok/30",
    omschrijving: "binnen de drempels",
  },
  oranje: {
    woord: "Aandacht",
    klassen: "bg-warn-tint text-warn-ink border-warn/30",
    omschrijving: "boven de oranje drempel",
  },
  rood: {
    woord: "Verstoord",
    klassen: "bg-err-tint text-err-ink border-err/30",
    omschrijving: "boven de rode drempel",
  },
  onbekend: {
    woord: "Onbekend",
    klassen: "bg-app-bg text-ink/70 border-line",
    omschrijving: "niet gemeten of onderdrukt",
  },
};

function Vorm({ status }: { status: SignaalStatus }) {
  // aria-hidden: het woord ernaast is de toegankelijke tekst; de vorm is de
  // visuele redundantie, geen aparte informatie.
  const gedeeld = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    "aria-hidden": true,
    className: "shrink-0",
  } as const;

  if (status === "groen") {
    return (
      <svg {...gedeeld}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M4.5 8.3 L7 10.8 L11.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === "oranje") {
    return (
      <svg {...gedeeld}>
        <path
          d="M8 1.5 L15 14 L1 14 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 6 V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (status === "rood") {
    return (
      <svg {...gedeeld}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5 5 L11 11 M11 5 L5 11"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg {...gedeeld}>
      <circle
        cx="8"
        cy="8"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.5 2"
      />
      <path d="M5 6 H11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 10 H11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function Stoplicht({
  status,
  toelichting,
}: {
  status: SignaalStatus;
  /** Vervangt de standaardomschrijving, bv. "onderdrukt (n<10)". */
  toelichting?: string | null;
}) {
  const weergave = WEERGAVE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${weergave.klassen}`}
      title={toelichting ?? weergave.omschrijving}
    >
      <Vorm status={status} />
      {weergave.woord}
    </span>
  );
}

/** Losse legenda, zodat de betekenis van de vormen niet hoeft te worden geraden. */
export function StoplichtLegenda() {
  const volgorde: SignaalStatus[] = ["groen", "oranje", "rood", "onbekend"];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink/60">
      {volgorde.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <Stoplicht status={status} />
          <span>{WEERGAVE[status].omschrijving}</span>
        </span>
      ))}
    </div>
  );
}
