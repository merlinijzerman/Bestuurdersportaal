"use client";

// ============================================================================
//  Reserves-invoer (T14) — vrije reservestanden.
//  De gedeelde standen (solidariteitsreserve, MVEV-, operationele reserve,
//  compensatiedepot) worden bij Balans ingevoerd en hier alleen benoemd als
//  "gekoppeld" — één bron per bedrag, geen dubbele invoer. De band van de
//  solidariteitsreserve wordt sinds T15 bij Solidariteit (tab 5) ingevoerd —
//  één bron, dezelfde reserve-rij die het tab 1-stoplicht voedt.
// ============================================================================

import { RESERVE_DEFINITIES, VRIJE_RESERVE_KEYS } from "@/core/lib/stuurinfo-invoer";
import type { Snapshot, VeldState } from "./StuurinfoInvoer";

type Props = {
  velden: VeldState;
  referentie: Snapshot | null;
  zetVeld: (key: string, waarde: string) => void;
  uitgeschakeld: boolean;
};

const fmt = (v: number | null): string =>
  v === null ? "—" : v.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

export default function ReservesInvoer({ velden, referentie, zetVeld, uitgeschakeld }: Props) {
  const labelVan = (key: string) => RESERVE_DEFINITIES.find((d) => d.key === key)?.label ?? key;

  return (
    <section id="reserves" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">Reserves — standen &amp; grenzen</h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 1</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Standen in € mln. Het reservepercentage wordt bij opslaan berekend (stand ÷ technische
        voorziening).
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {VRIJE_RESERVE_KEYS.map((key) => (
          <div key={key}>
            <label className="block text-xs font-medium text-muted mb-1">
              {labelVan(key)} (€ mln)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={velden.reserves[key]}
                onChange={(e) => zetVeld(key, e.target.value)}
                disabled={uitgeschakeld}
                inputMode="decimal"
                className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50"
              />
              <span className="shrink-0 text-xs text-muted">
                vorige: {fmt(referentie?.reserves[key] ?? null)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-app-bg p-3 text-xs text-muted">
        <strong className="text-ink">Gekoppeld (ingevoerd bij Balans):</strong> solidariteitsreserve,
        MVEV-reserve, operationele reserve, compensatiedepot. Alleen de solidariteitsreserve heeft een
        formele band — de <strong className="text-ink">bandbreedte wordt bij Solidariteit (tab 5)</strong>{" "}
        ingevoerd (één bron); de rest is monitoring. MVEV en operationele reserve: grens{" "}
        <strong>nog te valideren</strong>.
      </p>
    </section>
  );
}
