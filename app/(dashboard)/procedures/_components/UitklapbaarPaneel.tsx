"use client";

// Generieke uitklapbare paneel-wrapper voor secundaire dossier-blokken
// op de procedure-detailpagina. Default ingeklapt; in de header een
// titel, optioneel een count-badge en een status-pill (groen vinkje
// als alles op orde, amber waarschuwingspuntje als er aandacht nodig
// is). Klik op de header klapt in of uit.
//
// Gebruik:
//   <UitklapbaarPaneel
//     titel="Aannames"
//     count={3}
//     status="aandacht"        // 'voldoet' | 'aandacht' | 'neutraal'
//     samenvatting="2 gevalideerd, 1 in concept"
//   >
//     <AannamesPaneel … />
//   </UitklapbaarPaneel>

import { useState, type ReactNode } from "react";

export type PaneelStatus = "voldoet" | "aandacht" | "neutraal";

interface Props {
  titel: string;
  /** Aantal items in dit paneel (toont een grijze pill naast de titel). */
  count?: number;
  /** Status-indicator rechts in de header. */
  status?: PaneelStatus;
  /** Korte samenvattingstekst onder de titel als het paneel ingeklapt is. */
  samenvatting?: string;
  /** Default open of dicht (default: dicht). */
  defaultOpen?: boolean;
  /** Pad-binnen-de-zone — gebruikt door page als 'id' voor scrolling. */
  ankerId?: string;
  children: ReactNode;
}

function statusKleur(s: PaneelStatus | undefined): string {
  switch (s) {
    case "voldoet":
      return "bg-emerald-500 text-white";
    case "aandacht":
      return "bg-amber-500 text-white";
    default:
      return "bg-gray-200 text-gray-600";
  }
}

function statusIcoon(s: PaneelStatus | undefined): string {
  switch (s) {
    case "voldoet":
      return "✓";
    case "aandacht":
      return "!";
    default:
      return "·";
  }
}

export default function UitklapbaarPaneel({
  titel,
  count,
  status,
  samenvatting,
  defaultOpen = false,
  ankerId,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id={ankerId}>
      {/* Header is een stand-alone klikbare bar. Geen outer container
          rond het kind, om dubbele borders met de bestaande paneel-
          componenten (die hun eigen bg/border/rounded meebrengen) te
          voorkomen. Wanneer open, verschijnt het kind als een los
          aansluitend blok met klein verticaal aanloopje. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-3 px-5 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-left ${
          open ? "rounded-t-xl" : "rounded-xl"
        }`}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className={`flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${statusKleur(
              status
            )}`}
          >
            {statusIcoon(status)}
          </span>
          <h3 className="text-sm font-semibold text-[#0F2744] truncate">
            {titel}
          </h3>
          {typeof count === "number" && (
            <span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
              {count}
            </span>
          )}
          {samenvatting && !open && (
            <span className="text-xs text-gray-500 truncate hidden sm:inline">
              — {samenvatting}
            </span>
          )}
        </div>
        <span
          aria-hidden
          className={`flex-shrink-0 text-gray-400 text-xs transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="[&>*]:!rounded-t-none [&>*]:!border-t-0">
          {children}
        </div>
      )}
    </div>
  );
}
