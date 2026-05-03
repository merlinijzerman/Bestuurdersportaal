"use client";

import { useMemo, useState } from "react";
import {
  Cohort,
  MaandRij,
  fmtEur,
  fmtEurShort,
  fmtPct,
  fmtPctSigned,
  MAANDLABEL_KORT,
} from "@/lib/klantbeeld-data";

interface Props {
  cohorten: Cohort[];
  initialAge?: number;
}

const COMPONENTEN = [
  { key: "premie",      kleur: "#16a34a", label: "Premie",          sign: 1 },
  { key: "toevoeging",  kleur: "#06b6d4", label: "Toevoegingen",    sign: 1 },
  { key: "kas",         kleur: "#0ea5e9", label: "Kasrendement",    sign: 1 },
  { key: "beschermRTS", kleur: "#C9A84C", label: "Bescherming RTS", sign: 1 },
  { key: "overRend",    kleur: "#7c3aed", label: "Overrendement",   sign: 1 },
  { key: "langleven",   kleur: "#14b8a6", label: "Micro-langleven", sign: 1 },
  { key: "onttrekking", kleur: "#ef4444", label: "Onttrekkingen",   sign: -1 },
] as const;

const PRESETS = [25, 35, 45, 55, 65];

export default function MaandOntwikkelingClient({ cohorten, initialAge = 45 }: Props) {
  const [age, setAge] = useState(initialAge);
  const [maandIdx, setMaandIdx] = useState(23);

  const cohort = useMemo(() => cohorten.find((c) => c.age === age) ?? cohorten[27], [cohorten, age]);

  return (
    <div className="space-y-6">
      {/* Cohortkiezer */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-[300px]">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Geselecteerd cohort</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-[#0F2744]">{cohort.age}-jarigen</span>
              <span className="text-sm text-gray-500">
                geboren rond {2026 - cohort.age}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <input
                type="range"
                min={18}
                max={68}
                value={age}
                onChange={(e) => {
                  setAge(parseInt(e.target.value, 10));
                  setMaandIdx(23);
                }}
                className="flex-1 max-w-md accent-[#0F2744]"
              />
              <div className="flex gap-1 text-xs">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setAge(p);
                      setMaandIdx(23);
                    }}
                    className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm flex-shrink-0">
            <Stat label="Aantal deelnemers" value={cohort.aantal.toLocaleString("nl-NL")} />
            <Stat
              label="Mix actief / slapend / uitkerend"
              value={`${Math.round(cohort.actiefP * 100)}% / ${Math.round(
                cohort.slapendP * 100
              )}% / ${Math.round(cohort.uitkerendP * 100)}%`}
            />
            <Stat label="Gemiddeld vermogen nu" value={fmtEur(cohort.eindSaldo)} />
            <Stat
              label="Lifecycle bescherm / over"
              value={`${Math.round(cohort.beschermWeight * 100)}% / ${Math.round(
                cohort.overWeight * 100
              )}%`}
            />
            <Stat
              label="Maandelijkse premie"
              value={cohort.maandPremie === 0 ? "— (geen actieven)" : `${fmtEur(cohort.maandPremie)} / mnd`}
            />
            <Stat
              label="Tot. groei sinds invaren"
              value={`${fmtPctSigned(
                (cohort.eindSaldo - cohort.invaarKapitaal) / Math.max(1, cohort.invaarKapitaal)
              )} (${fmtEur(cohort.eindSaldo - cohort.invaarKapitaal)})`}
            />
          </div>
        </div>
      </div>

      {/* Hoofdgrafiek: trajectory + maand-delta */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[#0F2744]">
              Ontwikkeling persoonlijk pensioenvermogen — laatste 24 maanden
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Boven: vermogen-traject (€). Onder: bouwstenen per maand. Klik een maand om de waterval te bekijken.
            </p>
          </div>
          <div className="text-xs text-gray-500 text-right">
            <div>mei 2024 — apr 2026</div>
            <div className="mt-0.5">Inclusief invaar-moment 1 jan 2026</div>
          </div>
        </div>

        <TrajectoryChart cohort={cohort} maandIdx={maandIdx} onSelect={setMaandIdx} />
        <MonthlyDeltaChart cohort={cohort} maandIdx={maandIdx} />

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-700">
          <Legend kleur="#94a3b8" label="Begin-saldo / invaarkapitaal" />
          <Legend kleur="#16a34a" label="Premie-instroom" />
          <Legend kleur="#06b6d4" label="Toevoegingen (overdracht in / FVP)" />
          <Legend kleur="#ef4444" label="Onttrekkingen (overdracht uit)" />
          <Legend kleur="#0ea5e9" label="Kasrendement" />
          <Legend kleur="#C9A84C" label="Beschermingsrendement RTS" />
          <Legend kleur="#7c3aed" label="Overrendement" />
          <Legend kleur="#14b8a6" label="Micro-langleven" />
        </div>
      </div>

      {/* Maand-detail (waterval) + Wat valt op */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wider">Maand-detail</h3>
            <div className="text-xs text-gray-500">{cohort.reeks[maandIdx].maandKort.replace("'", "20")}</div>
          </div>
          <Waterval rij={cohort.reeks[maandIdx]} />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wider mb-3">Wat valt op</h3>
          <Observaties cohort={cohort} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold text-[#0F2744]">{value}</div>
    </div>
  );
}

function Legend({ kleur, label }: { kleur: string; label: string }) {
  return (
    <span className="inline-flex items-center">
      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: kleur }} />
      {label}
    </span>
  );
}

// ─── Trajectory chart ────────────────────────────────────────
function TrajectoryChart({
  cohort,
  maandIdx,
  onSelect,
}: {
  cohort: Cohort;
  maandIdx: number;
  onSelect: (i: number) => void;
}) {
  const w = 1100;
  const h = 220;
  const pad = { l: 70, r: 30, t: 15, b: 25 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const reeks = cohort.reeks;
  const values = reeks.map((r) => r.eind);
  const minV = Math.min(cohort.invaarKapitaal, ...values) * 0.95;
  const maxV = Math.max(cohort.invaarKapitaal, ...values) * 1.05;
  const xS = (i: number) => pad.l + (i / (reeks.length - 1)) * innerW;
  const yS = (v: number) => pad.t + (1 - (v - minV) / (maxV - minV)) * innerH;
  const yTicks = [0, 1, 2, 3, 4].map((k) => {
    const v = minV + (maxV - minV) * (k / 4);
    return { v, y: yS(v) };
  });
  const linePath = reeks.map((r, i) => `${i === 0 ? "M" : "L"} ${xS(i)} ${yS(r.eind)}`).join(" ");
  const areaPath = `${linePath} L ${xS(reeks.length - 1)} ${yS(minV)} L ${xS(0)} ${yS(minV)} Z`;
  const invaarY = yS(cohort.invaarKapitaal);
  const last = reeks[reeks.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 220 }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={t.y} x2={w - pad.r} y2={t.y} stroke="#f1f5f9" />
          <text x={pad.l - 8} y={t.y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
            {fmtEurShort(t.v)}
          </text>
        </g>
      ))}
      {reeks.map((r, i) =>
        i % 3 === 0 || i === reeks.length - 1 ? (
          <text key={i} x={xS(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {r.maandKort}
          </text>
        ) : null
      )}
      <line
        x1={pad.l}
        y1={invaarY}
        x2={w - pad.r}
        y2={invaarY}
        stroke="#94a3b8"
        strokeDasharray="3 3"
      />
      <text x={w - pad.r - 4} y={invaarY - 4} textAnchor="end" fontSize={10} fill="#64748b">
        invaar-kapitaal · {fmtEurShort(cohort.invaarKapitaal)}
      </text>
      <path d={areaPath} fill="#0F2744" fillOpacity={0.06} />
      <path d={linePath} fill="none" stroke="#0F2744" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {reeks.map((r, i) => (
        <circle
          key={i}
          cx={xS(i)}
          cy={yS(r.eind)}
          r={i === maandIdx ? 5 : 3}
          fill={i === maandIdx ? "#C9A84C" : "#0F2744"}
          style={{ cursor: "pointer" }}
          onClick={() => onSelect(i)}
        />
      ))}
      <text
        x={xS(reeks.length - 1) + 8}
        y={yS(last.eind) + 4}
        fontSize={11}
        fill="#0F2744"
        fontWeight={600}
      >
        {fmtEur(last.eind)}
      </text>
    </svg>
  );
}

// ─── Monthly delta chart ────────────────────────────────────
function MonthlyDeltaChart({ cohort, maandIdx }: { cohort: Cohort; maandIdx: number }) {
  const w = 1100;
  const h = 160;
  const pad = { l: 70, r: 30, t: 10, b: 25 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const reeks = cohort.reeks;
  let maxPos = 0;
  let maxNeg = 0;
  reeks.forEach((r) => {
    let pos = 0;
    let neg = 0;
    COMPONENTEN.forEach((c) => {
      const v = (r[c.key as keyof MaandRij] as number) * c.sign;
      if (v > 0) pos += v;
      else if (v < 0) neg += v;
    });
    if (pos > maxPos) maxPos = pos;
    if (neg < maxNeg) maxNeg = neg;
  });
  const range = Math.max(maxPos, -maxNeg) * 1.15;
  const yS = (v: number) => pad.t + innerH / 2 - (v / range) * (innerH / 2);
  const xS = (i: number) => pad.l + (i + 0.5) * (innerW / reeks.length);
  const barW = (innerW / reeks.length) * 0.7;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full mt-2" style={{ maxHeight: 160 }}>
      <line x1={pad.l} y1={yS(0)} x2={w - pad.r} y2={yS(0)} stroke="#cbd5e1" />
      {[-range, -range / 2, range / 2, range].map((v, i) => (
        <text key={i} x={pad.l - 8} y={yS(v) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
          {fmtEurShort(v)}
        </text>
      ))}
      {reeks.map((r, i) => {
        let posOffset = 0;
        let negOffset = 0;
        return (
          <g key={i}>
            {COMPONENTEN.map((c) => {
              const v = (r[c.key as keyof MaandRij] as number) * c.sign;
              if (v > 0) {
                const yTop = yS(posOffset + v);
                const yBot = yS(posOffset);
                posOffset += v;
                return (
                  <rect
                    key={c.key}
                    x={xS(i) - barW / 2}
                    y={yTop}
                    width={barW}
                    height={yBot - yTop}
                    fill={c.kleur}
                  />
                );
              } else if (v < 0) {
                const yTop = yS(negOffset);
                const yBot = yS(negOffset + v);
                negOffset += v;
                return (
                  <rect
                    key={c.key}
                    x={xS(i) - barW / 2}
                    y={yTop}
                    width={barW}
                    height={yBot - yTop}
                    fill={c.kleur}
                  />
                );
              }
              return null;
            })}
            {i === maandIdx && (
              <rect
                x={xS(i) - barW / 2 - 2}
                y={pad.t}
                width={barW + 4}
                height={innerH}
                fill="none"
                stroke="#C9A84C"
                strokeWidth={1.5}
                rx={2}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Waterval ────────────────────────────────────────────────
interface WatervalStap {
  label: string;
  v: number;
  type: "base" | "add" | "sub" | "total";
}

function Waterval({ rij }: { rij: MaandRij }) {
  const teken = (v: number): "add" | "sub" => (v >= 0 ? "add" : "sub");
  const alle: WatervalStap[] = [
    { label: "Begin-saldo", v: rij.begin, type: "base" },
    { label: "Premie", v: rij.premie, type: "add" },
    { label: "Toevoegingen", v: rij.toevoeging, type: "add" },
    { label: "Onttrekkingen", v: -rij.onttrekking, type: "sub" },
    { label: "Kasrendement", v: rij.kas, type: teken(rij.kas) },
    { label: "Bescherming RTS", v: rij.beschermRTS, type: teken(rij.beschermRTS) },
    { label: "Overrendement", v: rij.overRend, type: teken(rij.overRend) },
    { label: "Bescherming langleven", v: rij.langleven, type: teken(rij.langleven) },
    { label: "Eind-saldo", v: rij.eind, type: "total" },
  ];
  const stappen = alle.filter(
    (s) => s.label === "Begin-saldo" || s.label === "Eind-saldo" || Math.abs(s.v) > 0.5
  );
  const max = Math.max(rij.begin, rij.eind);

  return (
    <div className="space-y-2 mt-4">
      {stappen.map((s, i) => {
        if (s.type === "base" || s.type === "total") {
          const pct = (s.v / max) * 100;
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="w-40 text-xs text-gray-700 font-medium">{s.label}</div>
              <div className="flex-1 relative h-7 bg-gray-100 rounded overflow-hidden">
                <div
                  className={`absolute left-0 top-0 bottom-0 ${
                    s.type === "total" ? "bg-[#0F2744]" : "bg-gray-400"
                  }`}
                  style={{ width: `${pct}%` }}
                />
                <div
                  className={`absolute inset-0 flex items-center px-2 text-xs ${
                    s.type === "total" ? "text-white font-semibold" : "text-white"
                  }`}
                >
                  {fmtEur(s.v)}
                </div>
              </div>
            </div>
          );
        }
        const isSub = s.type === "sub";
        const pct = (Math.abs(s.v) / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="w-40 text-xs text-gray-700">{s.label}</div>
            <div className="flex-1 relative h-5 bg-gray-50 rounded overflow-hidden">
              <div
                className={`absolute left-0 top-0 bottom-0 opacity-80 ${
                  isSub ? "bg-red-500" : "bg-emerald-500"
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className="absolute inset-0 flex items-center px-2 text-xs text-gray-800 font-medium">
                {isSub ? "−" : "+"} {fmtEur(Math.abs(s.v))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Observaties ─────────────────────────────────────────────
function Observaties({ cohort }: { cohort: Cohort }) {
  const obs: { kleur: string; titel: string; tekst: string }[] = [];
  const r = cohort.reeks;

  const maxRTS = r.reduce((a, b) => (Math.abs(b.beschermRTS) > Math.abs(a.beschermRTS) ? b : a));
  if (Math.abs(maxRTS.beschermRTS) > cohort.invaarKapitaal * 0.005) {
    obs.push({
      kleur: "border-amber-200",
      titel: `Bescherming RTS sterk in ${maxRTS.maandKort.replace("'", "20")}`,
      tekst: `${fmtEurShort(maxRTS.beschermRTS)} bijdrage door ${
        maxRTS.beschermRTS > 0 ? "rentedaling" : "rentestijging"
      }. Bij ${Math.round(cohort.beschermWeight * 100)}% beschermingsallocatie en duration ${cohort.duration.toFixed(
        1
      )} jaar voert dit op.`,
    });
  }

  const maxOver = r.reduce((a, b) => (b.overRend > a.overRend ? b : a));
  if (maxOver.overRend > cohort.invaarKapitaal * 0.01) {
    obs.push({
      kleur: "border-emerald-200",
      titel: `Overrendement piek in ${maxOver.maandKort.replace("'", "20")}`,
      tekst: `${fmtEurShort(maxOver.overRend)} extra rendement bovenop kas. Geldt voor ${Math.round(
        cohort.overWeight * 100
      )}% van het vermogen.`,
    });
  }

  const minOver = r.reduce((a, b) => (b.overRend < a.overRend ? b : a));
  if (minOver.overRend < -cohort.invaarKapitaal * 0.01) {
    obs.push({
      kleur: "border-red-200",
      titel: `Overrendement-dip in ${minOver.maandKort.replace("'", "20")}`,
      tekst: `${fmtEurShort(
        minOver.overRend
      )} verlies. Voor jonge cohorten met hoge over-allocatie raakt dit het hardst.`,
    });
  }

  const totPremie = r.reduce((s, x) => s + x.premie, 0);
  const totRend = r.reduce((s, x) => s + x.kas + x.beschermRTS + x.overRend + x.langleven, 0);
  const totToev = r.reduce((s, x) => s + x.toevoeging, 0);
  const totOntt = r.reduce((s, x) => s + x.onttrekking, 0);
  if (totToev > 0 || totOntt > 0) {
    const netto = totToev - totOntt;
    obs.push({
      kleur: "border-cyan-200",
      titel: `Cashflow restposten netto ${netto >= 0 ? "+" : ""}${fmtEurShort(netto)}`,
      tekst: `Toevoegingen ${fmtEurShort(totToev)} (waardeoverdracht in / FVP) en onttrekkingen ${fmtEurShort(
        totOntt
      )} (overdracht uit). Per persoon-event-gemiddelde over 24 maanden.`,
    });
  }

  obs.push({
    kleur: "border-gray-200",
    titel: `Bouwbron: ${
      totRend > totPremie ? "rendement dominant" : totPremie > 0 ? "premie dominant" : "alleen rendement"
    }`,
    tekst: `24-maands totaal: premie ${fmtEurShort(totPremie)}, rendement netto ${fmtEurShort(totRend)}. ${
      cohort.age >= 67
        ? "Gepensioneerd: geen actieven meer in dit cohort, vrijwel alleen rendement."
        : `Voor dit cohort weegt ${
            totRend > totPremie ? "het rendement" : "de premie"
          } zwaarder in de groei.`
    }`,
  });

  return (
    <div className="space-y-3 text-sm text-gray-700">
      {obs.map((o, i) => (
        <div key={i} className={`border-l-2 ${o.kleur} pl-3 py-1`}>
          <div className="font-medium text-[#0F2744]">{o.titel}</div>
          <div className="text-xs text-gray-600 mt-0.5 leading-snug">{o.tekst}</div>
        </div>
      ))}
    </div>
  );
}

export { MAANDLABEL_KORT, fmtPct };
