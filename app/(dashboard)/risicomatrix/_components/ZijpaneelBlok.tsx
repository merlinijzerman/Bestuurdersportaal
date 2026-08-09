"use client";

import { useState } from "react";

// ============================================================================
//  ZijpaneelBlok — besluit 0145
// ----------------------------------------------------------------------------
//  Uitklapbaar paneel voor de legenda en de verdeling naast de heatmap. Die
//  twee blokken zijn naslag: je leest ze één keer en daarna nemen ze permanent
//  ruimte in naast de visual die je wél elke keer bekijkt.
//
//  De KOP blijft altijd staan — inklappen mag niet betekenen dat je niet meer
//  weet dát er een legenda is. Bij de verdeling staat er bovendien een korte
//  samenvatting in de kop (bv. "2 hoog"), zodat het ingeklapte blok nog steeds
//  het belangrijkste getal toont. Zonder dat zou inklappen informatie kosten in
//  plaats van ruimte besparen.
//
//  `standaardOpen` is een prop en geen vaste waarde: de legenda mag dicht
//  (uitleg), de verdeling open (cijfers).
// ============================================================================

export default function ZijpaneelBlok({
  titel,
  samenvatting,
  standaardOpen = false,
  children,
}: {
  titel: string;
  /** Korte tekst die ook ZICHTBAAR blijft als het blok is ingeklapt. */
  samenvatting?: React.ReactNode;
  standaardOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(standaardOpen);

  return (
    <div className="rounded-xl border border-line bg-app-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-4 text-left transition-colors hover:bg-app-zebra"
      >
        <span
          className={`text-[9px] text-muted transition-transform ${open ? "" : "-rotate-90"}`}
        >
          ▼
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{titel}</h3>
        {samenvatting && !open && (
          <span className="ml-auto text-[11.5px] text-muted">{samenvatting}</span>
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
