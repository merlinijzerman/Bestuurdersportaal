import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalCohorten } from "@/core/lib/klantbeeld-bron";
import { fmtEur, fmtEurShort } from "@/core/lib/klantbeeld-data";
import { SUPPRESSIE_MASKER } from "@/core/lib/suppressie";
import { KlantbeeldHeader } from "../../_components/KlantbeeldHeader";
import { DeelnemersSubTabs } from "../../_components/SubTabs";

const W = 1100;
const H = 380;
const PAD = { l: 70, r: 20, t: 30, b: 50 };

export default async function CohortenPage() {
  const { fondsId } = await vereisModuleToegang("klantbeeld", "klantbeeld.view");
  const { cohorten, onderdrukteCohorten } = await haalCohorten(fondsId);

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = Math.max(cohorten.length, 1);
  const colW = (innerW / n) * 0.78;

  // Totale vermogen per cohort = aantal deelnemers × gemiddeld eind-saldo
  const totaalPerCohort = cohorten.map((c) => ({
    age: c.age,
    aantal: c.aantal,
    gemiddeld: c.eindSaldo,
    totaal: c.aantal * c.eindSaldo,
  }));

  const totaalFonds = totaalPerCohort.reduce((s, c) => s + c.totaal, 0);
  const totaalDeelnemers = totaalPerCohort.reduce((s, c) => s + c.aantal, 0);
  const topCohort =
    totaalPerCohort.length > 0
      ? totaalPerCohort.reduce((a, b) => (b.totaal > a.totaal ? b : a))
      : null;
  const gemPerDeelnemer = totaalDeelnemers > 0 ? totaalFonds / totaalDeelnemers : 0;

  const maxV = Math.max(...totaalPerCohort.map((c) => c.totaal), 1) * 1.05;
  const yS = (v: number) => PAD.t + innerH - (v / maxV) * innerH;
  const yTicks = [0, maxV * 0.25, maxV * 0.5, maxV * 0.75, maxV];
  const idxVanAge = new Map(cohorten.map((c, i) => [c.age, i]));

  return (
    <div className="p-4 sm:p-6 lg:p-7">
      <KlantbeeldHeader />
      <div className="space-y-6">
        <DeelnemersSubTabs />

        {/* KPI-strook */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi
            label="Totaal fondsvermogen"
            value={fmtEur(totaalFonds)}
            sub={`${totaalDeelnemers.toLocaleString("nl-NL")} deelnemers`}
          />
          <Kpi
            label="Top-cohort"
            value={topCohort ? `${topCohort.age} jr` : SUPPRESSIE_MASKER}
            sub={
              topCohort
                ? `${fmtEurShort(topCohort.totaal)} totaal · ${topCohort.aantal.toLocaleString("nl-NL")} deelnemers`
                : "geen zichtbare cohorten"
            }
          />
          <Kpi label="Gem. per deelnemer" value={fmtEur(gemPerDeelnemer)} sub="over alle cohorten" />
        </div>

        {onderdrukteCohorten > 0 && (
          <div className="text-xs text-muted">
            {onderdrukteCohorten} cohort(en) onderdrukt wegens kleine populatie (n&lt;10,
            privacy-by-design).
          </div>
        )}

        {/* Hoofdvisual */}
        <div className="bg-white rounded-xl border border-line p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Cohorten naast elkaar — 18 t/m 68 jaar</h2>
            <p className="text-sm text-muted mt-1 max-w-3xl">
              Totaal pensioenvermogen per leeftijdscohort: aantal deelnemers × gemiddeld persoonlijk
              vermogen. Toont waar het fondsvermogen geconcentreerd is over de leeftijdsverdeling.
            </p>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
            {yTicks.map((t, i) => (
              <g key={i}>
                <line x1={PAD.l} y1={yS(t)} x2={W - PAD.r} y2={yS(t)} stroke="var(--line)" />
                <text x={PAD.l - 8} y={yS(t) + 4} textAnchor="end" fontSize={9} fill="var(--muted)">
                  {fmtEurShort(t)}
                </text>
              </g>
            ))}
            {totaalPerCohort.map((c, i) => {
              const x = PAD.l + (i + 0.5) * (innerW / n);
              return (
                <rect
                  key={c.age}
                  x={x - colW / 2}
                  y={yS(c.totaal)}
                  width={colW}
                  height={yS(0) - yS(c.totaal)}
                  fill="var(--accent)"
                />
              );
            })}
            {[18, 25, 35, 45, 55, 65, 68].map((age) => {
              const i = idxVanAge.get(age);
              if (i === undefined) return null;
              const x = PAD.l + (i + 0.5) * (innerW / n);
              return (
                <text key={age} x={x} y={H - 25} textAnchor="middle" fontSize={10} fill="#475569">
                  {age}
                </text>
              );
            })}
            <text x={PAD.l + innerW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
              Leeftijd
            </text>
            <text x={20} y={PAD.t - 12} fontSize={11} fill="var(--muted)">
              Totaal pensioenvermogen per cohort (€)
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-line p-5">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="text-2xl font-semibold text-ink mt-1">{value}</div>
      <div className="text-[11px] text-muted mt-1">{sub}</div>
    </div>
  );
}
