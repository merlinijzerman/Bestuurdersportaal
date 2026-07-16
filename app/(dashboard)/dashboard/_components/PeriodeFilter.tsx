"use client";
import { usePathname, useRouter } from "next/navigation";
import type { PeriodeOptie } from "@/core/lib/stuurinfo-bron";

// ============================================================
//  Paginabrede periodefilter (T13) — enige client-state op de Balans-tab.
//  De keuze gaat als ?periode=… de URL in; de server-leeslaag valideert de
//  waarde tegen de eigen periode-registry (onbekend → nieuwste periode).
//  De parameter stuurt dus alleen WELKE periode van het EIGEN fonds wordt
//  getoond — nooit het fonds (fonds_id blijft server-side, RLS).
// ============================================================

export function PeriodeFilter({ periodes, gekozen }: { periodes: PeriodeOptie[]; gekozen: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (periodes.length === 0) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted">Rapportageperiode</span>
      <select
        value={gekozen}
        onChange={(e) => router.push(`${pathname}?periode=${encodeURIComponent(e.target.value)}`)}
        className="text-sm text-ink bg-white border border-line rounded-lg px-3 py-1.5 pr-8"
      >
        {periodes.map((p) => (
          <option key={p.periode} value={p.periode}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
