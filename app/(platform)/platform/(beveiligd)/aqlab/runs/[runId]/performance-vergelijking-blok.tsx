// ============================================================================
//  Scherm 6 — Performance vergelijkend (AQL-5). Latency, tokens/kosten en
//  uitkomsten van de BASELINE naast de CHALLENGER. Server-rendered (geen
//  client-state). Alleen platform-console (nooit de fonds-assurance-view).
// ============================================================================

import type { RunPerformance } from "@/platform/lib/aqlab/console-lees";

export interface PerfKolom {
  naam: string | null;
  performance: RunPerformance | undefined;
  totale_kosten: number | null;
}

function ms(v: number | null | undefined): string {
  return v != null ? `${v} ms` : "—";
}
function dollar(v: number | null | undefined): string {
  return v != null ? `± $${Number(v).toFixed(4)}` : "—";
}

export default function PerformanceVergelijkingBlok({
  baseline,
  challenger,
}: {
  baseline: PerfKolom;
  challenger: PerfKolom;
}) {
  const b = baseline.performance;
  const c = challenger.performance;
  const rijen: { label: string; b: string; c: string; nadruk?: "err" | "warn" }[] = [
    { label: "Latency gemiddeld", b: ms(b?.latency_gemiddeld), c: ms(c?.latency_gemiddeld) },
    { label: "Latency mediaan", b: ms(b?.latency_mediaan), c: ms(c?.latency_mediaan) },
    { label: "Latency P95", b: ms(b?.latency_p95), c: ms(c?.latency_p95) },
    {
      label: "Tokens in/out",
      b: b ? `${b.tokens_in ?? 0}/${b.tokens_out ?? 0}` : "—",
      c: c ? `${c.tokens_in ?? 0}/${c.tokens_out ?? 0}` : "—",
    },
    { label: "Kosten (schatting)", b: dollar(baseline.totale_kosten), c: dollar(challenger.totale_kosten) },
    { label: "Outputs", b: String(b?.outputs ?? "—"), c: String(c?.outputs ?? "—") },
    { label: "Geblokkeerd", b: String(b?.aantal_geblokkeerd ?? "—"), c: String(c?.aantal_geblokkeerd ?? "—"), nadruk: "err" },
    { label: "Review vereist", b: String(b?.aantal_review_vereist ?? "—"), c: String(c?.aantal_review_vereist ?? "—"), nadruk: "warn" },
  ];

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Performance — baseline vs challenger</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-ink/50">
              <th className="py-1 pr-4" />
              <th className="py-1 pr-4">Baseline{baseline.naam ? ` · ${baseline.naam}` : ""}</th>
              <th className="py-1 pr-4">Challenger{challenger.naam ? ` · ${challenger.naam}` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {rijen.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-1 pr-4 text-xs text-ink/60">{r.label}</td>
                <td className="py-1 pr-4">{r.b}</td>
                <td
                  className={`py-1 pr-4 ${
                    r.nadruk === "err" ? "text-err-ink" : r.nadruk === "warn" ? "text-warn-ink" : ""
                  }`}
                >
                  {r.c}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink/50">
        Een hogere kwaliteit weegt niet automatisch op tegen extra kosten, latency of nieuwe blokkades — dat blijft
        een menselijke afweging (human-in-the-loop).
      </p>
    </section>
  );
}
