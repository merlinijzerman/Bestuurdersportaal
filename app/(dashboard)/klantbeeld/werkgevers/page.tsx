import {
  WERKGEVERS_REEKS,
  WG_SEGMENTEN,
  INNING_REEKS,
  INNING_AGGREGAAT,
  fmtEur,
  fmtEurShort,
  fmtPct,
  fmtPctSigned,
} from "@/lib/klantbeeld-data";
import { KlantbeeldHeader } from "../_components/KlantbeeldHeader";

export default function WerkgeversPage() {
  const last = WERKGEVERS_REEKS[WERKGEVERS_REEKS.length - 1];
  const first12 = WERKGEVERS_REEKS[WERKGEVERS_REEKS.length - 13];

  const wnDelta = last.werknemers - first12.werknemers;
  const salarisGroei = (last.gemSalaris - first12.gemSalaris) / first12.gemSalaris;
  const premieGroei = (last.premieTotaal - first12.premieTotaal) / first12.premieTotaal;

  const indexReeks = WERKGEVERS_REEKS.map(
    (r) => (r.gemSalaris / WERKGEVERS_REEKS[0].gemSalaris) * 100
  );
  const cumulatiefSalaris = indexReeks[indexReeks.length - 1] - 100;

  return (
    <div className="p-7">
      <KlantbeeldHeader />

      {/* KPI-strook */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Aangesloten werkgevers" value={last.werkgevers.toLocaleString("nl-NL")} delta={`${last.werkgevers - first12.werkgevers >= 0 ? "+" : ""}${last.werkgevers - first12.werkgevers}`} sub="12-maands mutatie" />
        <Kpi label="Actieve werknemers" value={last.werknemers.toLocaleString("nl-NL")} delta={`${wnDelta >= 0 ? "+" : ""}${wnDelta.toLocaleString("nl-NL")}`} deltaKleur={wnDelta >= 0 ? "emerald" : "red"} sub="via aangesloten werkgevers" />
        <Kpi label="Gem. pensioengevend salaris" value={fmtEur(last.gemSalaris)} delta={fmtPctSigned(salarisGroei, 1)} sub="12-maands ontwikkeling (CAO)" />
        <Kpi label="Totale premie / mnd" value={fmtEurShort(last.premieTotaal)} delta={fmtPctSigned(premieGroei, 1)} sub="werkgevers- + werknemersdeel" />
      </div>

      {/* Drie trend-grafieken */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wider">
              Pensioengrondslag totaal
            </h3>
            <span className="text-[11px] text-gray-500">€/maand</span>
          </div>
          <Trendlijn values={WERKGEVERS_REEKS.map((r) => r.pgTotaalMaand)} kleur="#0F2744" fmt={fmtEurShort} />
          <div className="mt-2 text-xs text-gray-600 leading-snug">
            Stand mei 2024: <strong>{fmtEurShort(WERKGEVERS_REEKS[0].pgTotaalMaand)}</strong>/mnd · nu:{" "}
            <strong>{fmtEurShort(last.pgTotaalMaand)}</strong>/mnd. Groei volgt salarisontwikkeling
            en netto in/uit-stroom werknemers.
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wider">Premie totaal</h3>
            <span className="text-[11px] text-gray-500">werkgever / werknemer</span>
          </div>
          <PremieStaaf reeks={WERKGEVERS_REEKS} />
          <div className="mt-2 flex gap-3 text-xs text-gray-700">
            <Legend kleur="#0F2744" label="Werkgeversdeel (2/3)" />
            <Legend kleur="#C9A84C" label="Werknemersdeel (1/3)" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wider">
              Gem. salarisontwikkeling
            </h3>
            <span className="text-[11px] text-gray-500">indexcijfer (mei &apos;24 = 100)</span>
          </div>
          <Trendlijn values={indexReeks} kleur="#7c3aed" fmt={(v) => v.toFixed(1).replace(".", ",")} />
          <div className="mt-2 text-xs text-gray-600 leading-snug">
            Cumulatieve CAO-stijging over 24 maanden:{" "}
            <strong>{cumulatiefSalaris.toFixed(1).replace(".", ",")}%</strong>. Twee zichtbare CAO-stappen
            (oktober &apos;24 en oktober &apos;25). Indicator voor sectorale loonontwikkeling.
          </div>
        </div>
      </div>

      {/* Werkgever-grootte-segmentatie */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[#0F2744]">Werkgever-grootte — concentratie</h2>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Verdeling van aangesloten werkgevers over drie groottesegmenten. Bestuurlijk relevant:
            hoeveel premie-instroom is afhankelijk van een klein aantal grote werkgevers? Een hoog
            aandeel premie bij weinig werkgevers betekent concentratierisico.
          </p>
        </div>
        <div className="space-y-4">
          {WG_SEGMENTEN.map((s) => (
            <div key={s.naam}>
              <div className="flex items-baseline justify-between text-sm mb-1.5">
                <span className="font-medium text-[#0F2744]">
                  {s.naam}{" "}
                  <span className="text-xs text-gray-500 font-normal">· {s.toelichting}</span>
                </span>
                <span className="text-xs text-gray-600">
                  {s.werkgeversAantal} werkgevers · {s.werknemersAantal.toLocaleString("nl-NL")} werknemers ·{" "}
                  {fmtEurShort(s.premieAantal)} premie/mnd
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <SegmentBar pct={s.werkgeversAandeel} kleur={s.kleur} label="van werkgevers" />
                <SegmentBar pct={s.werknemersAandeel} kleur={s.kleur} label="van werknemers" />
                <SegmentBar pct={s.premieAandeel} kleur={s.kleur} label="van premie" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Premie-inning */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[#0F2744]">Premie-inning-discipline</h2>
          <p className="text-sm text-gray-600 mt-1">
            Aandeel van premie-afdrachten dat op tijd, te laat of in achterstand binnenkomt — per maand.
            KPI voor service-niveau van de uitvoerder. Norm op-tijd: ≥90%.
          </p>
        </div>

        <InningChart />
        <div className="mt-2 mb-5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-700">
          <Legend kleur="#10b981" label="Op tijd (≤14 dagen)" />
          <Legend kleur="#f59e0b" label="Te laat (14–30 dagen)" />
          <Legend kleur="#ef4444" label="Achterstand (>30 dagen / dispuut)" />
          <span className="text-gray-400">·</span>
          <span className="inline-flex items-center">
            <span className="inline-block mr-1.5" style={{ width: 14, height: 2, background: "#0F2744" }} />
            Norm op-tijd 90%
          </span>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wider">
              12-maands gemiddelde
            </h3>
            <span className="text-[11px] text-gray-500">mei 2025 — apr 2026</span>
          </div>
          <div className="flex h-8 rounded-lg overflow-hidden mb-3">
            <div
              className="bg-emerald-500 flex items-center justify-center text-xs text-white font-medium"
              style={{ width: `${INNING_AGGREGAAT.opTijd * 100}%` }}
            >
              {fmtPct(INNING_AGGREGAAT.opTijd, 1)}
            </div>
            <div
              className="bg-amber-500 flex items-center justify-center text-xs text-white font-medium"
              style={{ width: `${INNING_AGGREGAAT.teLaat * 100}%` }}
            >
              {fmtPct(INNING_AGGREGAAT.teLaat, 1)}
            </div>
            <div
              className="bg-red-500 flex items-center justify-center text-xs text-white font-medium"
              style={{ width: `${INNING_AGGREGAAT.achterstand * 100}%` }}
            >
              {fmtPct(INNING_AGGREGAAT.achterstand, 1)}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <InningTegel
              kleur="emerald"
              label="Op tijd"
              waarde={fmtPct(INNING_AGGREGAAT.opTijd, 1)}
              tekst={`Premie binnen 14 dagen. Norm ≥90% — ${
                INNING_AGGREGAAT.maandenOnderNorm.length === 0
                  ? "alle 12 maanden boven norm."
                  : `${INNING_AGGREGAAT.maandenOnderNorm.length} van 12 maanden onder norm (${INNING_AGGREGAAT.maandenOnderNorm.join(", ")}).`
              }`}
            />
            <InningTegel
              kleur="amber"
              label="Te laat"
              waarde={fmtPct(INNING_AGGREGAAT.teLaat, 1)}
              tekst="Tussen 14 en 30 dagen. Geen escalatie nodig, wel monitoren."
            />
            <InningTegel
              kleur="red"
              label="Achterstand"
              waarde={fmtPct(INNING_AGGREGAAT.achterstand, 1)}
              tekst=">30 dagen of dispuut. Per geval een procedure inning-handhaving."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componenten ─────────────────────────────────────────
function Kpi({
  label,
  value,
  delta,
  deltaKleur = "emerald",
  sub,
}: {
  label: string;
  value: string;
  delta: string;
  deltaKleur?: "emerald" | "red";
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-[#0F2744]">{value}</span>
        <span className={`text-xs ${deltaKleur === "emerald" ? "text-emerald-700" : "text-red-700"}`}>
          {delta}
        </span>
      </div>
      <div className="text-[11px] text-gray-500 mt-1">{sub}</div>
    </div>
  );
}

function Legend({ kleur, label }: { kleur: string; label: string }) {
  return (
    <span className="inline-flex items-center">
      <span
        className="inline-block mr-1.5"
        style={{ width: 10, height: 10, background: kleur, borderRadius: 2 }}
      />
      {label}
    </span>
  );
}

function SegmentBar({ pct, kleur, label }: { pct: number; kleur: string; label: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-1">
        {Math.round(pct * 100)}% {label}
      </div>
      <div className="h-2 rounded bg-gray-100 overflow-hidden">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: kleur }} />
      </div>
    </div>
  );
}

function InningTegel({
  kleur,
  label,
  waarde,
  tekst,
}: {
  kleur: "emerald" | "amber" | "red";
  label: string;
  waarde: string;
  tekst: string;
}) {
  const borderClass =
    kleur === "emerald" ? "border-emerald-500" : kleur === "amber" ? "border-amber-500" : "border-red-500";
  return (
    <div className={`border-l-2 ${borderClass} pl-3`}>
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-semibold text-[#0F2744]">{waarde}</div>
      <div className="text-xs text-gray-600 mt-0.5">{tekst}</div>
    </div>
  );
}

// ─── SVG-charts ──────────────────────────────────────────────
function Trendlijn({
  values,
  kleur,
  fmt,
}: {
  values: number[];
  kleur: string;
  fmt: (v: number) => string;
}) {
  const w = 320;
  const h = 120;
  const pad = { l: 38, r: 8, t: 8, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const min = Math.min(...values) * 0.98;
  const max = Math.max(...values) * 1.02;
  const xS = (i: number) => pad.l + (i / (values.length - 1)) * innerW;
  const yS = (v: number) => pad.t + (1 - (v - min) / (max - min)) * innerH;
  const ticks = [min, (min + max) / 2, max];
  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"} ${xS(i)} ${yS(v)}`).join(" ");
  const areaPath = `${linePath} L ${xS(values.length - 1)} ${yS(min)} L ${xS(0)} ${yS(min)} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 120 }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={yS(t)} x2={w - pad.r} y2={yS(t)} stroke="#f1f5f9" />
          <text x={pad.l - 4} y={yS(t) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
            {fmt(t)}
          </text>
        </g>
      ))}
      {[0, Math.floor(values.length / 2), values.length - 1].map((i) => {
        const labels = ["mei '24", "mei '25", "apr '26"];
        const idx = i === 0 ? 0 : i === values.length - 1 ? 2 : 1;
        return (
          <text key={i} x={xS(i)} y={h - 6} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {labels[idx]}
          </text>
        );
      })}
      <path d={areaPath} fill={kleur} fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke={kleur} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xS(values.length - 1)} cy={yS(values[values.length - 1])} r={3} fill={kleur} />
    </svg>
  );
}

function PremieStaaf({ reeks }: { reeks: typeof WERKGEVERS_REEKS }) {
  const w = 320;
  const h = 120;
  const pad = { l: 38, r: 8, t: 8, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(...reeks.map((r) => r.premieTotaal)) * 1.05;
  const xS = (i: number) => pad.l + (i + 0.5) * (innerW / reeks.length);
  const yS = (v: number) => pad.t + (1 - v / max) * innerH;
  const barW = (innerW / reeks.length) * 0.78;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 120 }}>
      {[0, max / 2, max].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={yS(t)} x2={w - pad.r} y2={yS(t)} stroke="#f1f5f9" />
          <text x={pad.l - 4} y={yS(t) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
            {fmtEurShort(t)}
          </text>
        </g>
      ))}
      {[0, Math.floor(reeks.length / 2), reeks.length - 1].map((i) => {
        const labels = ["mei '24", "mei '25", "apr '26"];
        const idx = i === 0 ? 0 : i === reeks.length - 1 ? 2 : 1;
        return (
          <text key={i} x={xS(i)} y={h - 6} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {labels[idx]}
          </text>
        );
      })}
      {reeks.map((r, i) => {
        const yWg = yS(r.premieWg);
        const yTotaal = yS(r.premieTotaal);
        return (
          <g key={i}>
            <rect x={xS(i) - barW / 2} y={yWg} width={barW} height={yS(0) - yWg} fill="#0F2744" />
            <rect
              x={xS(i) - barW / 2}
              y={yTotaal}
              width={barW}
              height={yWg - yTotaal}
              fill="#C9A84C"
            />
          </g>
        );
      })}
    </svg>
  );
}

function InningChart() {
  const w = 1100;
  const h = 220;
  const pad = { l: 50, r: 30, t: 18, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const reeks = INNING_REEKS;
  const xS = (i: number) => pad.l + (i + 0.5) * (innerW / reeks.length);
  const yS = (pct: number) => pad.t + (1 - pct) * innerH;
  const barW = (innerW / reeks.length) * 0.78;
  const ticks = [0, 0.5, 0.9, 1.0];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 220 }}>
      {ticks.map((p) => {
        const isNorm = p === 0.9;
        return (
          <g key={p}>
            <line
              x1={pad.l}
              y1={yS(p)}
              x2={w - pad.r}
              y2={yS(p)}
              stroke={isNorm ? "#0F2744" : "#f1f5f9"}
              strokeWidth={isNorm ? 1.2 : 1}
              strokeDasharray={isNorm ? "4 3" : undefined}
            />
            <text
              x={pad.l - 8}
              y={yS(p) + 3}
              textAnchor="end"
              fontSize={10}
              fill={isNorm ? "#0F2744" : "#94a3b8"}
              fontWeight={isNorm ? 600 : 400}
            >
              {`${(p * 100).toFixed(0)}%`}
            </text>
          </g>
        );
      })}
      <text x={w - pad.r + 4} y={yS(0.9) + 3} fontSize={10} fill="#0F2744" fontWeight={600}>
        norm
      </text>
      {reeks.map((r, i) => {
        const x0 = xS(i) - barW / 2;
        const yTopOp = yS(r.opTijd);
        const yTopLaat = yS(r.opTijd + r.teLaat);
        const yTopAch = yS(1.0);
        return (
          <g key={i}>
            <rect x={x0} y={yTopOp} width={barW} height={yS(0) - yTopOp} fill="#10b981" />
            <rect x={x0} y={yTopLaat} width={barW} height={yTopOp - yTopLaat} fill="#f59e0b" />
            <rect x={x0} y={yTopAch} width={barW} height={yTopLaat - yTopAch} fill="#ef4444" />
            {r.opTijd < 0.9 && (
              <text
                x={xS(i)}
                y={yTopOp - 4}
                textAnchor="middle"
                fontSize={9}
                fill="#b91c1c"
                fontWeight={600}
              >
                {fmtPct(r.opTijd, 1)}
              </text>
            )}
          </g>
        );
      })}
      {reeks.map((r, i) =>
        i % 3 === 0 || i === reeks.length - 1 ? (
          <text key={i} x={xS(i)} y={h - 10} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {r.maandKort}
          </text>
        ) : null
      )}
    </svg>
  );
}
