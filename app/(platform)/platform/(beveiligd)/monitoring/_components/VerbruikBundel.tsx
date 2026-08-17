"use client";
// ============================================================================
//  VerbruikBundel — weergave "Verbruik & bundel" binnen de monitoringtab (P5)
// ----------------------------------------------------------------------------
//  Rendert UITSLUITEND vooraf berekende aggregaten (verbruik-bundel-lees.ts):
//  de client rekent niets bij, hij filtert/sorteert en wisselt periode. Zo blijft
//  de governance-logica server-side (CLAUDE.md-guardrail) en veroorzaakt een
//  klik géén extra auditpaar (architectuur monitoring page.tsx).
//
//  Statusdrager = kleur + woord + vorm (besluiten 0097/0101), net als Stoplicht.
//  "Doorbelasting" is ALLEEN WEERGAVE/SIGNAAL (besluit 0178, B-5) — de copy
//  vermijdt bewust de indruk van een factuur. Dekking is indicatief (B-4).
// ============================================================================

import { useMemo, useState } from "react";
import {
  euro,
  euroCent,
  mln,
  WOORDEN_JAAR,
  WOORDEN_MAAND,
  type Status,
} from "@/core/lib/verbruik-bundel-core";
import type {
  FondsVerbruik,
  VerbruikBundelOverzicht,
} from "@/platform/lib/verbruik-bundel-lees";

const MND_LANG = [
  "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December",
];

const RANG: Record<Status | "nvt", number> = { rood: 0, oranje: 1, groen: 2, nvt: 3 };

// ── Statuschip (kleur + woord + vorm) ───────────────────────────────────────
function Vorm({ status }: { status: Status | "nvt" }) {
  const g = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true, className: "shrink-0" } as const;
  if (status === "groen")
    return (
      <svg {...g}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.5 8.3 L7 10.8 L11.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === "oranje")
    return (
      <svg {...g}>
        <path d="M8 1.5 L15 14 L1 14 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6 V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
      </svg>
    );
  if (status === "rood")
    return (
      <svg {...g}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 5 L11 11 M11 5 L5 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...g}>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" />
      <path d="M5 8 H11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const CHIP_KLASSEN: Record<Status | "nvt", string> = {
  groen: "bg-ok-tint text-ok-ink border-ok/30",
  oranje: "bg-warn-tint text-warn-ink border-warn/30",
  rood: "bg-err-tint text-err-ink border-err/30",
  nvt: "bg-app-bg text-ink/60 border-line",
};

function StatusChip({ status, maandMode }: { status: Status | "nvt"; maandMode: boolean }) {
  const woord =
    status === "nvt" ? "n.v.t." : (maandMode ? WOORDEN_MAAND : WOORDEN_JAAR)[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${CHIP_KLASSEN[status]}`}>
      <Vorm status={status} />
      {woord}
    </span>
  );
}

// ── Meter (aandeel t.o.v. bundel/maandbudget) ───────────────────────────────
function Meter({ aandeel, status, wat }: { aandeel: number; status: Status; wat: string }) {
  const pct = Math.min(aandeel, 1) * 100;
  const over = aandeel > 1;
  const fill = { groen: "bg-ok", oranje: "bg-warn", rood: "bg-err" }[status];
  return (
    <div className="w-[150px]">
      <div className="relative h-3 overflow-hidden rounded-md bg-ink/[0.07]">
        <div className={`absolute inset-y-0 left-0 rounded-md ${fill}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-[-2px] left-full w-0.5 bg-ink/50" />
      </div>
      <div className="mt-1 text-[11.5px] text-ink/60">
        {Math.round(aandeel * 100)}% van {wat}
        {over && <strong className="text-err-ink"> · boven</strong>}
      </div>
    </div>
  );
}

function SplitBar({ kostIn, kostUit }: { kostIn: number; kostUit: number }) {
  const tot = kostIn + kostUit;
  if (tot <= 0) {
    return (
      <div
        className="mt-1.5 h-[9px] w-[150px] rounded-[3px] bg-ink/[0.07]"
        role="img"
        aria-label="Geen gemeten input- of outputverbruik"
      />
    );
  }
  const pin = (kostIn / tot) * 100;
  return (
    <div className="mt-1.5 flex h-[9px] w-[150px] gap-0.5 overflow-hidden rounded-[3px]">
      <div className="h-full rounded-[2px] bg-accent/50" style={{ width: `${pin}%` }} />
      <div className="h-full rounded-[2px] bg-accent" style={{ width: `${100 - pin}%` }} />
    </div>
  );
}

// ── Sparkline over de maand-euro (null = n.v.t.) ────────────────────────────
function Spark({ punten, status, hi }: { punten: (number | null)[]; status: Status; hi: number }) {
  const W = 120, H = 32, P = 3;
  const geldig = punten.filter((p): p is number => p != null);
  if (geldig.length < 2)
    return <div className="flex h-8 items-center text-[11px] text-ink/50">te weinig data</div>;
  let min = Math.min(...geldig, 0);
  let max = Math.max(...geldig);
  if (max === min) max = min + 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (punten.length - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const kleur = { groen: "var(--ok)", oranje: "var(--warn)", rood: "var(--err)" }[status];
  const segmenten: [number, number][][] = [];
  let cur: [number, number][] = [];
  punten.forEach((p, i) => {
    if (p == null) { if (cur.length > 1) segmenten.push(cur); cur = []; }
    else cur.push([x(i), y(p)]);
  });
  if (cur.length > 1) segmenten.push(cur);
  const laatste = punten.map((p, i) => [p, i] as const).filter(([p]) => p != null).pop();
  return (
    <svg width={W} height={H} role="img" aria-label="Maandtrend van het verbruik">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--line)" strokeWidth="1" />
      {segmenten.map((s, i) => (
        <polyline key={i} fill="none" stroke={kleur} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={s.map((p) => p.join(",")).join(" ")} />
      ))}
      {laatste && <circle cx={x(laatste[1])} cy={y(laatste[0]!)} r="3" fill={kleur} stroke="#fff" strokeWidth="2" />}
      {hi >= 0 && punten[hi] != null && (
        <circle cx={x(hi)} cy={y(punten[hi]!)} r="5" fill="none" stroke={kleur} strokeWidth="2" />
      )}
    </svg>
  );
}

// ── Hoofdcomponent ──────────────────────────────────────────────────────────
export default function VerbruikBundel({ overzicht }: { overzicht: VerbruikBundelOverzicht }) {
  const { jaar, peilIdx, fondsen, platform, afgekapt } = overzicht;
  const [filterFonds, setFilterFonds] = useState<string>("alle");
  const [periode, setPeriode] = useState<string>("jaar");
  const [alleen, setAlleen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const maandMode = periode.startsWith("m");
  const m = maandMode ? parseInt(periode.slice(1), 10) : -1;
  const maandNaam = maandMode ? MND_LANG[m] : "";

  // Fondsen met een licentie doen mee in de berekende weergave; zonder licentie
  // tonen we een expliciete regel (geen stille nul).
  const metLicentie = useMemo(() => fondsen.filter((f) => f.jaar !== null), [fondsen]);
  const zonderLicentie = useMemo(() => fondsen.filter((f) => f.jaar === null), [fondsen]);

  const tegels = useMemo(() => {
    const totaal = metLicentie.reduce((a, f) => a + (f.jaar?.ytd ?? 0), 0);
    const tok = metLicentie.reduce((a, f) => a + (f.jaar?.tokTot ?? 0), 0);
    const binnen = metLicentie.filter((f) => f.jaar?.status === "groen").length;
    const nadertBoven = metLicentie.filter((f) => f.jaar && f.jaar.status !== "groen").length;
    const doorbelast = metLicentie.reduce((a, f) => a + (f.jaar?.doorbelast ?? 0), 0);
    return { totaal, tok, binnen, nadertBoven, doorbelast };
  }, [metLicentie]);

  const statusVan = (f: FondsVerbruik): Status | "nvt" => {
    if (!f.jaar) return "nvt";
    if (!maandMode) return f.jaar.status;
    const mb = f.maanden[m];
    return mb ? mb.status : "nvt";
  };
  const waardeVan = (f: FondsVerbruik): number => {
    if (!f.jaar) return -1;
    if (!maandMode) return f.jaar.ytd;
    return f.maanden[m]?.maandKost ?? -1;
  };

  const lijst = useMemo(() => {
    let l = metLicentie;
    if (filterFonds !== "alle") l = l.filter((f) => f.fondsId === filterFonds);
    if (alleen) l = l.filter((f) => statusVan(f) !== "groen" && statusVan(f) !== "nvt");
    return [...l].sort((a, b) => RANG[statusVan(a)] - RANG[statusVan(b)] || waardeVan(b) - waardeVan(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metLicentie, filterFonds, alleen, maandMode, m]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const maandBudget = (f: FondsVerbruik) => (f.licentie ? f.licentie.bundelEurJaar / 12 : 0);
  const toewijsbaarPeriode = maandMode
    ? metLicentie.reduce((a, f) => a + (f.maanden[m]?.maandKost ?? 0), 0)
    : tegels.totaal;
  const platformEurPeriode = maandMode ? platform.eurPerMaand[m] ?? 0 : platform.ytdEur;
  const platformTokPeriode = maandMode
    ? (platform.inMlnPerMaand[m] ?? 0) + (platform.uitMlnPerMaand[m] ?? 0)
    : platform.ytdInMln + platform.ytdUitMln;
  const ratioPlatform =
    platformEurPeriode + toewijsbaarPeriode > 0
      ? toewijsbaarPeriode / (toewijsbaarPeriode + platformEurPeriode)
      : 0;

  return (
    <div className="space-y-4">
      {/* Kop + tegels */}
      <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl font-bold">Verbruik &amp; bundel — {jaar}</h2>
            <p className="mt-1 max-w-[66ch] text-[12.5px] text-ink/60">
              AI-verbruik per fonds afgezet tegen de licentiebundel, pro rata vanaf de
              contract-ingangsdatum. Bedragen zijn een <strong>signalering</strong> voor prijsstelling en
              klantgesprek — geen factuur.
            </p>
          </div>
          <div className="text-right text-xs text-ink/60">
            <b className="block text-[13px] text-ink">Stand: t/m {MND_LANG[peilIdx]} {jaar}</b>
            maandelijkse monitoring
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Tegel naam="Verbruik dit jaar · toewijsbaar" groot={euro(tegels.totaal)} klein={`≈ ${mln(tegels.tok)} tokens over ${metLicentie.length} ${metLicentie.length === 1 ? "fonds" : "fondsen"}`} />
          <Tegel naam="Prognose binnen bundel" groot={`${tegels.binnen} van ${metLicentie.length}`} klein="blijven onder hun pro-rata bundel" />
          <Tegel naam="Nadert of boven bundel" groot={`${tegels.nadertBoven} van ${metLicentie.length}`} klein="signaleer vóór overschrijding" />
          <Tegel naam="Boven pro-rata bundel (signaal)" groot={euro(tegels.doorbelast)} klein="verbruik boven de bundel, niet gefactureerd" />
        </div>
      </section>

      {/* Bediening */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2 rounded-lg border border-ink/30 bg-white px-2.5 py-1.5 text-xs">
          <span className="text-ink/60">Fonds</span>
          <select className="bg-transparent text-[13px] text-ink outline-none" value={filterFonds} onChange={(e) => setFilterFonds(e.target.value)}>
            <option value="alle">Alle fondsen</option>
            {metLicentie.map((f) => (
              <option key={f.fondsId} value={f.fondsId}>{f.fondsNaam}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-ink/30 bg-white px-2.5 py-1.5 text-xs">
          <span className="text-ink/60">Periode</span>
          <select className="bg-transparent text-[13px] text-ink outline-none" value={periode} onChange={(e) => setPeriode(e.target.value)}>
            <option value="jaar">Heel jaar (cumulatief)</option>
            {Array.from({ length: peilIdx + 1 }, (_, i) => (
              <option key={i} value={`m${i}`}>{MND_LANG[i]} {jaar}</option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink/30 bg-white px-2.5 py-1.5 text-[13px]">
          <input type="checkbox" checked={alleen} onChange={(e) => setAlleen(e.target.checked)} />
          Alleen nadert of boven bundel
        </label>
        <span className="ml-auto text-xs text-ink/60">
          {lijst.length} {lijst.length === 1 ? "fonds" : "fondsen"} ·{" "}
          {maandMode ? `${maandNaam} ${jaar}` : "bundel pro rata per fonds"}
        </span>
      </div>

      {afgekapt && (
        <div className="rounded-lg border border-warn/30 bg-warn-tint px-4 py-2.5 text-xs text-warn-ink">
          De leeslimiet is geraakt; de getoonde euro&apos;s zijn hierdoor een <strong>ondergrens</strong> (undercount).
          Voor een volledig jaar is een maand-aggregatie (materialisatie) nodig — bewust buiten V0.2.
        </div>
      )}

      {/* Tabel */}
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink/60">
              <th className="px-3 py-2.5 font-semibold">Fonds</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">{maandMode ? `Verbruik in ${maandNaam}` : "Verbruik dit jaar"}</th>
              <th className="px-3 py-2.5 font-semibold">{maandMode ? "Aandeel van maandbudget" : "Aandeel van jaarbundel"}</th>
              <th className="px-3 py-2.5 font-semibold">{maandMode ? `Cumulatief t/m ${maandNaam}` : "Prognose einde jaar"}</th>
              <th className="px-3 py-2.5 font-semibold">Boven bundel · trend</th>
            </tr>
          </thead>
          <tbody>
            {lijst.map((f) => {
              const isOpen = open.has(f.fondsId);
              const st = statusVan(f);
              const mb = maandMode ? f.maanden[m] : null;
              const jr = f.jaar!;
              return (
                <FragmentRij
                  key={f.fondsId}
                  f={f}
                  isOpen={isOpen}
                  status={st}
                  maandMode={maandMode}
                  m={m}
                  mb={mb}
                  jr={jr}
                  maandBudget={maandBudget(f)}
                  onToggle={() => toggle(f.fondsId)}
                />
              );
            })}
            {lijst.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-ink/50">Geen fondsen voor deze selectie.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Fondsen zonder licentie */}
      {zonderLicentie.length > 0 && (
        <div className="rounded-lg border border-line bg-app-bg px-4 py-3 text-xs text-ink/70">
          <strong>{zonderLicentie.length}</strong>{" "}
          {zonderLicentie.length === 1 ? "fonds heeft" : "fondsen hebben"} nog geen licentie in{" "}
          <code className="font-mono">fonds_licentie</code>: {zonderLicentie.map((f) => f.fondsNaam).join(", ")}.
          Bundel, tarief en contract-ingangsdatum ontbreken, dus er valt niets af te zetten.
        </div>
      )}

      {/* Platformbreed / niet toewijsbaar */}
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="font-serif text-[15px] font-bold">Niet toewijsbaar aan een fonds — platformbreed</h3>
        <p className="mt-1 max-w-[88ch] text-[12.5px] text-ink/60">
          Verbruik zonder fonds-id: gedeelde bronnen, systeem en overhead. Dit is <strong>leverancierskost en
          wordt niet doorbelast</strong>. In het governance-log staan deze aanroepen met{" "}
          <code className="font-mono">fonds_id = null</code>. De euro is indicatief (referentietarief).{" "}
          De cijfers hieronder gelden voor {maandMode ? `${maandNaam} ${jaar}` : `januari t/m ${MND_LANG[peilIdx]} ${jaar}`}.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <span className="text-ink/60">Toewijsbaar aan fondsen</span>
            <span className="text-right font-serif font-bold tabular-nums">{euro(toewijsbaarPeriode)}</span>
            <span className="text-ink/60">Niet toewijsbaar (indicatief)</span>
            <span className="text-right tabular-nums">{euro(platformEurPeriode)}</span>
            <span className="text-ink/60">Volume platformbreed</span>
            <span className="text-right tabular-nums">≈ {mln(platformTokPeriode)} tokens</span>
          </div>
          <div className="rounded-lg border border-line bg-app-bg p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink/60">Aandeel toewijsbaar</div>
            <Meter aandeel={ratioPlatform} status="groen" wat="is toewijsbaar" />
            <p className="mt-2 text-[11.5px] text-ink/60">
              {((1 - ratioPlatform) * 100).toFixed(1).replace(".", ",")}% van het gemeten verbruik is platformbreed.
            </p>
          </div>
        </div>
      </section>

      {/* Legenda + dekkingsvoorbehoud */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink/60">
        <StatusChip status="groen" maandMode={false} />
        <StatusChip status="oranje" maandMode={false} />
        <StatusChip status="rood" maandMode={false} />
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-[2px] bg-accent/50" /> input</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-[2px] bg-accent" /> output</span>
        </span>
      </div>

      <div className="rounded-lg border border-line bg-app-bg px-4 py-3 text-[11.5px] text-ink/60">
        <span className="mr-1 inline-block rounded border border-line bg-app-bg px-1.5 py-0.5 font-semibold text-ink/70">Indicatief</span>
        Meting per fonds komt uit het append-only governance-/AI-gebruikslog (input-, output- en cache-tokens,
        met fonds-id). Aanroepen zonder fonds-id tellen platformbreed en worden niet doorbelast. Ondergrens: de
        routes <em>voorbereiding</em> en <em>besluit-concept</em> schrijven nog geen gebruikslog-regel, en
        reranker/query-reformulatie/web_search tellen niet mee — de bedragen zijn dus structureel eerder te laag
        dan te hoog. Cache-tokens zitten in het input-tarief (niet apart beprijsd). De prognose annualiseert
        lineair over de verstreken contractmaanden: een indicatie, geen budget.
      </div>
    </div>
  );
}

function Tegel({ naam, groot, klein }: { naam: string; groot: string; klein: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-3">
      <span className="mb-1 block text-[11.5px] text-ink/60">{naam}</span>
      <span className="font-serif text-[22px] font-bold leading-tight">{groot}</span>
      <span className="mt-1 block text-[11.5px] text-ink/60">{klein}</span>
    </div>
  );
}

function FragmentRij({
  f, isOpen, status, maandMode, m, mb, jr, maandBudget, onToggle,
}: {
  f: FondsVerbruik;
  isOpen: boolean;
  status: Status | "nvt";
  maandMode: boolean;
  m: number;
  mb: import("@/core/lib/verbruik-bundel-core").MaandBerekening | null;
  jr: import("@/core/lib/verbruik-bundel-core").JaarBerekening;
  maandBudget: number;
  onToggle: () => void;
}) {
  const voorIngang = maandMode && !mb;
  return (
    <>
      <tr className={`border-b border-line hover:bg-app-bg/70 ${isOpen ? "bg-accent-tint" : ""}`}>
        <td className="px-3 py-3 align-top">
          <button
            type="button"
            className="text-left font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-expanded={isOpen}
            aria-controls={`verbruik-detail-${f.fondsId}`}
            onClick={onToggle}
          >
            {f.fondsNaam}
          </button>
          <div className="mt-0.5 text-[11.5px] text-ink/60">
            sinds {f.licentie?.contractStart ?? "onbekend"}
          </div>
        </td>
        <td className="px-3 py-3 align-top"><StatusChip status={status} maandMode={maandMode} /></td>
        {voorIngang ? (
          <>
            <td className="px-3 py-3 align-top"><div className="text-[11.5px] text-ink/60">vóór ingangsdatum</div></td>
            <td className="px-3 py-3 align-top"><div className="text-[11.5px] text-ink/60">—</div></td>
            <td className="px-3 py-3 align-top"><div className="text-[11.5px] text-ink/60">—</div></td>
          </>
        ) : maandMode && mb ? (
          <>
            <td className="px-3 py-3 align-top">
              <div className="font-serif text-base font-bold tabular-nums">{euro(mb.maandKost)}</div>
              <div className="text-[11.5px] text-ink/60">{mln(mb.tokTot)} tokens</div>
              <SplitBar kostIn={mb.kostIn} kostUit={mb.kostUit} />
            </td>
            <td className="px-3 py-3 align-top"><Meter aandeel={mb.aandeel} status={mb.status} wat="maandbudget" /></td>
            <td className="px-3 py-3 align-top">
              <div className="font-serif text-base font-bold tabular-nums">{euro(mb.cum)}</div>
              <div className="text-[11.5px] text-ink/60">{Math.round(mb.cumPct * 100)}% van jaarbundel</div>
            </td>
          </>
        ) : (
          <>
            <td className="px-3 py-3 align-top">
              <div className="font-serif text-base font-bold tabular-nums">{euro(jr.ytd)}</div>
              <div className="text-[11.5px] text-ink/60">{mln(jr.tokTot)} tokens</div>
              <SplitBar kostIn={jr.kostIn} kostUit={jr.kostUit} />
            </td>
            <td className="px-3 py-3 align-top"><Meter aandeel={jr.aandeel} status={jr.status} wat="bundel" /></td>
            <td className="px-3 py-3 align-top">
              <div className="font-serif text-base font-bold tabular-nums">{euro(jr.prognose)}</div>
              <div className="text-[11.5px] text-ink/60">{Math.round(jr.prognosePct * 100)}% van bundel</div>
            </td>
          </>
        )}
        <td className="px-3 py-3 align-top">
          <div className="font-serif text-sm font-bold tabular-nums">{jr.doorbelast > 0 ? euro(jr.doorbelast) : "—"}</div>
          <Spark punten={f.maandKosten} status={status === "nvt" ? "groen" : status} hi={maandMode ? m : -1} />
        </td>
      </tr>
      {isOpen && (
        <tr id={`verbruik-detail-${f.fondsId}`}>
          <td colSpan={6} className="border-b border-line bg-accent-tint p-0">
            <Detail f={f} jr={jr} maandBudget={maandBudget} />
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({
  f, jr, maandBudget,
}: {
  f: FondsVerbruik;
  jr: import("@/core/lib/verbruik-bundel-core").JaarBerekening;
  maandBudget: number;
}) {
  const lic = f.licentie!;
  const advies =
    jr.status === "rood"
      ? "Fonds zit boven de bundel of stevent daar structureel op af. Klantgesprek: verbruik toelichten, sturen op contextomvang en modelkeuze."
      : jr.status === "oranje"
      ? "Fonds nadert de bundel. Nu signaleren, niet pas bij overschrijding — zo blijft het gesprek voorspelbaar."
      : "Geen actie nodig. Bij structureel laag verbruik: adoptie bespreken.";
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
      <div className="rounded-lg border border-line bg-white p-3.5">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/60">Input tegenover output</h4>
        <SplitBar kostIn={jr.kostIn} kostUit={jr.kostUit} />
        <div className="mt-3 space-y-1.5 text-[12.5px]">
          <div className="flex justify-between border-b border-line pb-1.5"><span>Input-tokens</span><span className="tabular-nums">{mln(jr.tokIn)}</span><span className="font-serif font-bold tabular-nums">{euro(jr.kostIn)}</span></div>
          <div className="flex justify-between border-b border-line pb-1.5"><span>Output-tokens</span><span className="tabular-nums">{mln(jr.tokUit)}</span><span className="font-serif font-bold tabular-nums">{euro(jr.kostUit)}</span></div>
          <div className="flex justify-between"><span className="font-semibold">Totaal</span><span className="tabular-nums">{mln(jr.tokTot)}</span><span className="font-serif font-bold tabular-nums">{euro(jr.ytd)}</span></div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="rounded-lg border border-line bg-white p-3.5">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/60">Wat betekent dit — en wat doe je</h4>
          <p className="text-[13px]">{advies}</p>
          <p className="mt-2 text-[12.5px] text-ink/60"><strong>Eigenaar:</strong> Platform-/leveranciersbeheer · <strong>Frequentie:</strong> maandelijkse rapportage</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-3.5">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/60">Contract, tarief en meting</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-ink/60">Contract sinds</dt><dd className="text-right tabular-nums">{lic.contractStart}</dd>
            <dt className="text-ink/60">Bundel dit jaar</dt><dd className="text-right tabular-nums">{euro(jr.bundel)} ({jr.actief}/12 mnd pro rata)</dd>
            <dt className="text-ink/60">Verstreken</dt><dd className="text-right tabular-nums">{jr.verstreken} van {jr.actief} contractmaanden</dd>
            <dt className="text-ink/60">Maandbudget</dt><dd className="text-right tabular-nums">{euro(maandBudget)}</dd>
            <dt className="text-ink/60">Input-tarief</dt><dd className="text-right tabular-nums">{euroCent(lic.tariefInEurMln)}/mln</dd>
            <dt className="text-ink/60">Output-tarief</dt><dd className="text-right tabular-nums">{euroCent(lic.tariefUitEurMln)}/mln</dd>
            <dt className="text-ink/60">Meetbron</dt><dd className="text-right">governance-/AI-gebruikslog</dd>
          </dl>
          <div className="mt-2 rounded-md border border-line bg-app-bg px-2.5 py-2 text-[11.5px] text-ink/60">
            Dekking <strong>indicatief</strong>: verbruik van de routes <em>voorbereiding</em> en <em>besluit-concept</em> ontbreekt tot die als gebruikslog-tranche zijn gebouwd. Bedragen zijn signalering, geen factuur.
          </div>
        </div>
      </div>
    </div>
  );
}
