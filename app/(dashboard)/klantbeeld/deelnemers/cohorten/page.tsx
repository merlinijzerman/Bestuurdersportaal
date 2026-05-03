import Link from "next/link";
import { COHORTEN, fmtEur, fmtEurShort, fmtPct } from "@/lib/klantbeeld-data";
import { KlantbeeldHeader } from "../../_components/KlantbeeldHeader";
import { DeelnemersSubTabs } from "../../_components/SubTabs";

const W = 1100;
const H = 360;
const PAD = { l: 60, r: 20, t: 30, b: 50 };

export default function CohortenPage() {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const colW = (innerW / COHORTEN.length) * 0.78;

  const maxV =
    Math.max(...COHORTEN.map((c) => Math.max(c.spreiding.p90, c.doelKapitaal, c.eindSaldo))) * 1.05;
  const yS = (v: number) => PAD.t + innerH - (v / maxV) * innerH;
  const yTicks = [0, maxV * 0.25, maxV * 0.5, maxV * 0.75, maxV];

  const aandacht = COHORTEN
    .filter((c) => Math.abs(c.afwijking) > 0.025)
    .sort((a, b) => Math.abs(b.afwijking) - Math.abs(a.afwijking));

  return (
    <div className="p-7">
      <KlantbeeldHeader />
      <div className="space-y-6">
        <DeelnemersSubTabs />

        {/* Hoofdvisual */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[#0F2744]">
              Cohorten naast elkaar — 18 t/m 68 jaar
            </h2>
            <p className="text-sm text-gray-600 mt-1 max-w-3xl">
              Huidig gemiddeld vermogen per leeftijdscohort, met spreidingsbanden en de verwachte stand
              (neutraal scenario) als gele referentiepunt. Afwijking versus verwacht stuurt de kleur:{" "}
              <span className="text-emerald-700">groen ≤2,5%</span>,{" "}
              <span className="text-amber-700">amber 2,5–5%</span>,{" "}
              <span className="text-red-700">rood &gt;5%</span>. Projectie naar pensioenleeftijd en
              pure afwijkings-views komen in een latere iteratie.
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
            {COHORTEN.map((c, i) => {
              const x = PAD.l + (i + 0.5) * (innerW / COHORTEN.length);
              const absDev = Math.abs(c.afwijking);
              const kleur =
                absDev <= 0.025 ? "#0F2744" : absDev <= 0.05 ? "#b45309" : "#b91c1c";
              return (
                <g key={c.age}>
                  <line
                    x1={x}
                    y1={yS(c.spreiding.p10)}
                    x2={x}
                    y2={yS(c.spreiding.p90)}
                    stroke="#cbd5e1"
                    strokeWidth={colW * 0.4}
                    strokeLinecap="round"
                    opacity={0.6}
                  />
                  <rect
                    x={x - colW / 2}
                    y={yS(c.eindSaldo)}
                    width={colW}
                    height={yS(0) - yS(c.eindSaldo)}
                    fill={kleur}
                  />
                  <circle
                    cx={x}
                    cy={yS(c.doelKapitaal)}
                    r={3}
                    fill="#C9A84C"
                    stroke="white"
                    strokeWidth={1}
                  />
                </g>
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
              Huidig gemiddeld vermogen + verwachte stand (neutraal scenario)
            </text>
          </svg>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-700">
            <Legend kleur="#0F2744" label="Huidig vermogen (gem.)" />
            <Legend kleur="#cbd5e1" label="Spreiding p10 — p90" />
            <Legend kleur="#C9A84C" label="Verwachte stand bij neutraal scenario" rond />
            <span className="text-gray-400">·</span>
            <span className="text-emerald-700">Op koers (≤2,5%)</span>
            <span className="text-amber-700">Aandacht (2,5–5%)</span>
            <span className="text-red-700">Achter (&gt;5%)</span>
          </div>
        </div>

        {/* Aandacht-tabel */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#0F2744]">Cohorten met aandacht</h3>
            <div className="text-xs text-gray-500">Cohorten met afwijking &gt;2,5% versus verwachte stand</div>
          </div>
          {aandacht.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              Geen cohorten met afwijking &gt;2,5% — alle cohorten op koers.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {aandacht.map((c) => {
                const absDev = Math.abs(c.afwijking);
                const tintBg = absDev <= 0.05 ? "bg-amber-50" : "bg-red-50";
                const tintText = absDev <= 0.05 ? "text-amber-700" : "text-red-700";
                const richting = c.afwijking >= 0 ? "voor" : "achter";
                return (
                  <Link
                    key={c.age}
                    href={`/klantbeeld/deelnemers?cohort=${c.age}`}
                    className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-gray-50 text-sm"
                  >
                    <div className="col-span-3">
                      <div className="font-medium text-[#0F2744]">{c.age}-jarigen</div>
                      <div className="text-xs text-gray-500">
                        {c.aantal.toLocaleString("nl-NL")} deelnemers
                      </div>
                    </div>
                    <div className="col-span-3 text-xs text-gray-600">
                      {Math.round(c.actiefP * 100)}% actief / {Math.round(c.slapendP * 100)}%
                      slapend / {Math.round(c.uitkerendP * 100)}% uitkerend
                    </div>
                    <div className="col-span-2 text-sm">
                      {fmtEur(c.eindSaldo)}
                      <div className="text-xs text-gray-500">huidig</div>
                    </div>
                    <div className="col-span-2 text-sm">
                      {fmtEur(c.doelKapitaal)}
                      <div className="text-xs text-gray-500">verwacht</div>
                    </div>
                    <div className="col-span-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tintBg} ${tintText}`}
                      >
                        {richting} {fmtPct(absDev, 0)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({ kleur, label, rond }: { kleur: string; label: string; rond?: boolean }) {
  return (
    <span className="inline-flex items-center">
      <span
        className="inline-block mr-1.5"
        style={{
          width: 10,
          height: 10,
          background: kleur,
          borderRadius: rond ? "50%" : 2,
        }}
      />
      {label}
    </span>
  );
}
