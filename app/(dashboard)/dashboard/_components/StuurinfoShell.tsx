import type { ReactNode } from "react";
import type { PeriodeOptie } from "@/core/lib/stuurinfo-bron";
import { StuurinfoTabs, type StuurinfoTabKey } from "./StuurinfoTabs";
import { PeriodeFilter } from "./PeriodeFilter";
import { formatteerPeriode } from "@/core/lib/stuurinfo-balans";

// ============================================================
//  Gedeelde shell van het bestuurdersdashboard (T13) — server component.
//  Header (titel + demo-badge + fonds/regeling/rapportagedatum + FG-pill +
//  periodefilter) en de tab-navigatie; de tab-inhoud komt als children.
//  Gebruikt door de Balans-tab (page.tsx) én de placeholders ([tab]/page.tsx).
// ============================================================

const fmtPct = (n: number) =>
  `${n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function StuurinfoShell({
  actieveTab,
  fondsNaam,
  regelingLabel,
  gekozenPeriode,
  periodes,
  financieringsgraad,
  periodeParam,
  children,
}: {
  actieveTab: StuurinfoTabKey;
  fondsNaam: string;
  regelingLabel?: string;
  gekozenPeriode?: PeriodeOptie | null;
  periodes?: PeriodeOptie[];
  financieringsgraad?: number | null;
  /** ?periode=… doorgeven in de tab-links zonder eigen registry-lezing (placeholders). */
  periodeParam?: string;
  children: ReactNode;
}) {
  const subtitel = [
    fondsNaam,
    regelingLabel || null,
    gekozenPeriode
      ? `rapportagedatum ${gekozenPeriode.peildatum} (${formatteerPeriode(gekozenPeriode.periode)})`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-ink text-xl font-bold">Stuurinformatie</h1>
            <span className="text-[11px] uppercase tracking-wider text-muted bg-app-bg px-2 py-1 rounded-md">
              Demo-data
            </span>
          </div>
          {subtitel && <div className="text-muted text-sm mt-0.5">{subtitel}</div>}
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          {financieringsgraad !== null && financieringsgraad !== undefined && (
            <span className="inline-flex items-center gap-2 text-xs text-ink bg-white border border-line rounded-full px-3 py-1.5 mb-0.5">
              <span
                className={`w-2 h-2 rounded-full ${financieringsgraad >= 100 ? "bg-ok" : "bg-warn"}`}
              />
              Financieringsgraad {fmtPct(financieringsgraad)}
            </span>
          )}
          {periodes && periodes.length > 0 && gekozenPeriode && (
            <PeriodeFilter periodes={periodes} gekozen={gekozenPeriode.periode} />
          )}
        </div>
      </div>

      {/* Tab-navigatie */}
      <StuurinfoTabs actief={actieveTab} periode={gekozenPeriode?.periode ?? periodeParam} />

      {children}
    </div>
  );
}
