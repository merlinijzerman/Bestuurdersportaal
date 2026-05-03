import { COHORTEN, fmtEur, fmtEurShort } from "@/lib/klantbeeld-data";
import { KlantbeeldHeader } from "../../_components/KlantbeeldHeader";
import { DeelnemersSubTabs } from "../../_components/SubTabs";

const W = 1100;
const H = 380;
const PAD = { l: 70, r: 20, t: 30, b: 50 };

export default function CohortenPage() {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const colW = (innerW / COHORTEN.length) * 0.78;

  // Totale vermogen per cohort = aantal deelnemers × gemiddeld eind-saldo
  const totaalPerCohort = COHORTEN.map((c) => ({
    age: c.age,
    aantal: c.aantal,
    gemiddeld: c.eindSaldo,
    totaal: c.aantal * c.eindSaldo,
  }));

  const totaalFonds = totaalPerCohort.reduce((s, c) => s + c.totaal, 0);
  const topCohort = totaalPerCohort.reduce((a, b) => (b.totaal > a.totaal ? b : a));
  const totaalDeelnemers = totaalPerCohort.reduce((s, c) => s + c.aantal, 0);
  const gemPerDeelnemer = totaalFonds / totaalDeelnemers;

  const maxV = Math.max(...totaalPerCohort.map((c) => c.totaal)) * 1.05;
  const yS = (v: number) => PAD.t + innerH - (v / maxV) * innerH;
  const yTicks = [0, maxV * 0.25, maxV * 0.5, maxV * 0.75, maxV];

  return (
    <div className="p-7">
      <KlantbeeldHeader />
      <div className="space-y-6">
        <DeelnemersSubTabs />

        {/* KPI-strook */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi label="Totaal fondsvermogen" value={fmtEur(totaalFonds)} sub={`${totaalDeelnemers.toLocaleString("nl-NL")} deelnemers`} />
          <Kpi
            label="Top-cohort"
            value={`${topCohort.age} jr`}
            sub={`${fmtEurShort(topCohort.totaal)} totaal · ${topCohort.aantal.toLocaleString("nl-NL")} deelnemers`}
          />
          <Kpi label="Gem. per deelnemer" value={fmtEur(gemPerDeelnemer)} sub="over alle cohorten" />
        </div>

        {/* Hoofdvisual */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[#0F2744]">
              Cohorten naast elkaar — 18 t/m 68 jaar
            </h2>
            <p className="text-sm text-gray-600 mt-1 max-w-3xl">
              Totaal pensioenvermogen per leeftijdscohort: aantal deelnemers ×
              gemiddeld persoonlijk vermogen. Toont waar het fondsvermogen geconcentreerd is
              over de leeftijdsverdeling.
            </p>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
            {yTicks.map((t, i) => (
              <g key={i}>
                <line x1={PAD.l} y1={yS(t)} x2={W - PAD.r} y2={yS(t)} stroke="#f1f5f9" />
                <text x={PAD.l - 8} y={yS(t) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
                  {fmtEurShort(t)}
                </text>
              </g>
            ))}
            {totaalPerCohort.map((c, i) => {
              const x = PAD.l + (i + 0.5) * (innerW / COHORTEN.length);
              return (
                <rect
                  key={c.age}
                  x={x - colW / 2}
                  y={yS(c.totaal)}
                  width={colW}
                  height={yS(0) - yS(c.totaal)}
                  fill="#0F2744"
                />
              );
            })}
            {[18, 25, 35, 45, 55, 65, 68].map((age) => {
              const i = age - 18;
              const x = PAD.l + (i + 0.5) * (innerW / COHORTEN.length);
              return (
                <text key={age} x={x} y={H - 25} textAnchor="middle" fontSize={10} fill="#475569">
                  {age}
                </text>
              );
            })}
            <text
              x={PAD.l + innerW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              fill="#64748b"
            >
              Leeftijd
            </text>
            <text x={20} y={PAD.t - 12} fontSize={11} fill="#64748b">
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
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-[#0F2744] mt-1">{value}</div>
      <div className="text-[11px] text-gray-500 mt-1">{sub}</div>
    </div>
  );
}
