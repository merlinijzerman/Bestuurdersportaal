"use client";

// ============================================================================
//  SignaalTabel — laag 2 (voorstel §4): één rij per signaal, filterbaar.
// ----------------------------------------------------------------------------
//  CLIENT component. De server leest ÉÉN keer (page.tsx, binnen withPlatformRead);
//  het fonds-, periode- en domeinfilter draaien hier, zonder server-navigatie en
//  dus ZONDER extra auditpaar per klik (architectuurpunt 1). De aggregatie- en
//  samenvattingslogica leeft in de pure module monitoring-signalen.ts, niet hier —
//  zo is elke waarborg programmatisch na te rekenen.
//
//  De ketenstatusbalk negeert het fondsfilter (altijd platformbreed) en de
//  periodekeuze (altijd "nu"). Kleur is nooit de enige drager: status komt overal
//  via Stoplicht (woord + vorm + kleur) en de verdeling draagt een tekst.
// ============================================================================

import { useId, useMemo, useState } from "react";
import type { SignaalWeergave, TrendPunt } from "@/platform/lib/monitoring-lees";
import {
  DOMEIN_VOLGORDE,
  SIGNAAL_VOLGORDE,
  aggregeerStatus,
  kiesSlechtsteMeting,
  samenvattingPerDomein,
  type Domein,
  type SignaalId,
  type SignaalStatus,
} from "@/platform/lib/monitoring-signalen";
import { formatteerWaarde } from "@/platform/lib/monitoring-format";
import Stoplicht from "./Stoplicht";
import Trendlijn from "./Trendlijn";
import Ketenstatus from "./Ketenstatus";
import SignaalDetail from "./SignaalDetail";
import type { Rij, Verdeling } from "./dashboard-types";

type Periode = "24u" | "7d";
type Sortering = "ernst" | "domein";

const ERNST_UI: Record<SignaalStatus, number> = { groen: 0, onbekend: 1, oranje: 2, rood: 3 };
const VOLGORDE_INDEX = new Map(SIGNAAL_VOLGORDE.map((id, i) => [id, i]));

const DOT: Record<SignaalStatus, string> = {
  groen: "bg-ok",
  oranje: "bg-warn",
  rood: "bg-err",
  onbekend: "bg-line",
};

export default function SignaalTabel({
  signalen,
  trendAfgekapt,
  gedekteDagen,
  leesfout,
}: {
  signalen: SignaalWeergave[];
  trendAfgekapt: boolean;
  gedekteDagen: number;
  leesfout: boolean;
}) {
  const [fonds, setFonds] = useState<string>("alle");
  const [periode, setPeriode] = useState<Periode>("7d");
  const [domein, setDomein] = useState<Domein | null>(null);
  const [alleenAfwijkingen, setAlleenAfwijkingen] = useState(false);
  const [sortering, setSortering] = useState<Sortering>("ernst");
  const [uitgeklapt, setUitgeklapt] = useState<Set<SignaalId>>(new Set());
  const basisId = useId();

  // De lijst fondsen voor het filter (per-fonds signalen).
  const fondsen = useMemo(() => {
    const kaart = new Map<string, string>();
    for (const s of signalen) {
      if (s.fondsId) kaart.set(s.fondsId, s.fondsNaam ?? "Onbekend fonds");
    }
    return [...kaart.entries()].sort((a, b) => a[1].localeCompare(b[1], "nl"));
  }, [signalen]);

  // Ketenstatusbalk: ALTIJD alle metingen, ongeacht het fondsfilter.
  const perDomein = useMemo(
    () =>
      samenvattingPerDomein(
        signalen.map((s) => ({ domein: s.config.domein, status: s.status }))
      ),
    [signalen]
  );
  const ketenStatus: SignaalStatus = leesfout
    ? "onbekend"
    : aggregeerStatus(signalen.map((s) => s.status));

  // Eén rij per signaal, afhankelijk van het fondsfilter.
  const rijen = useMemo(() => bouwRijen(signalen, fonds), [signalen, fonds]);

  const zichtbaar = useMemo(() => {
    let uit = rijen;
    if (domein) uit = uit.filter((r) => r.config.domein === domein);
    if (alleenAfwijkingen) uit = uit.filter((r) => r.status !== "groen");
    return [...uit].sort((a, b) => vergelijk(a, b, sortering));
  }, [rijen, domein, alleenAfwijkingen, sortering]);

  return (
    <div className="space-y-4">
      <Ketenstatus
        status={ketenStatus}
        perDomein={perDomein}
        actiefDomein={domein}
        onKiesDomein={setDomein}
      />

      {/* Bedieningsrij: fonds · periode · sortering · alleen afwijkingen */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-ink/60">Fonds</span>
          <select
            value={fonds}
            onChange={(e) => setFonds(e.target.value)}
            className="rounded border border-line bg-white px-2 py-1 text-sm"
          >
            <option value="alle">Alle fondsen</option>
            {fondsen.map(([id, naam]) => (
              <option key={id} value={id}>
                {naam}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-ink/60">Periode</span>
          <div className="inline-flex overflow-hidden rounded border border-line" role="group" aria-label="Periode">
            {(["24u", "7d"] as Periode[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={periode === p}
                onClick={() => setPeriode(p)}
                className={`px-2.5 py-1 text-sm ${
                  periode === p ? "bg-accent text-white" : "bg-white text-ink/70 hover:bg-app-bg"
                }`}
              >
                {p === "24u" ? "24 uur" : "7 dagen"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-ink/60">Sorteer</span>
          <div className="inline-flex overflow-hidden rounded border border-line" role="group" aria-label="Sortering">
            {(["ernst", "domein"] as Sortering[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sortering === s}
                onClick={() => setSortering(s)}
                className={`px-2.5 py-1 text-sm ${
                  sortering === s ? "bg-accent text-white" : "bg-white text-ink/70 hover:bg-app-bg"
                }`}
              >
                {s === "ernst" ? "Ernst" : "Domein"}
              </button>
            ))}
          </div>
        </div>

        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={alleenAfwijkingen}
            onChange={(e) => setAlleenAfwijkingen(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          <span className="text-ink/70">Alleen afwijkingen</span>
        </label>
      </div>

      {/* De tabel als lijst van uitklapbare rijen */}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {zichtbaar.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-ink/50">
            Geen signalen die aan het filter voldoen.
          </li>
        )}
        {zichtbaar.map((rij) => {
          const open = uitgeklapt.has(rij.signaal);
          const detailId = `${basisId}-${rij.signaal}`;
          const trendPeriode =
            periode === "24u" ? snijdLaatste24u(rij.trend, rij.laatsteMeting) : rij.trend;
          return (
            <li key={rij.signaal}>
              <RijKop
                rij={rij}
                open={open}
                detailId={detailId}
                trendPeriode={trendPeriode}
                onToggle={() =>
                  setUitgeklapt((prev) => {
                    const volgend = new Set(prev);
                    if (volgend.has(rij.signaal)) volgend.delete(rij.signaal);
                    else volgend.add(rij.signaal);
                    return volgend;
                  })
                }
              />
              {open && (
                <div id={detailId}>
                  <SignaalDetail
                    rij={rij}
                    trendPeriode={trendPeriode}
                    periodeLabel={periode === "24u" ? "24 uur" : "7 dagen"}
                    trendAfgekapt={trendAfgekapt}
                    gedekteDagen={gedekteDagen}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Rijkop (de klikbare regel) ───────────────────────────────────────────────

function RijKop({
  rij,
  open,
  detailId,
  trendPeriode,
  onToggle,
}: {
  rij: Rij;
  open: boolean;
  detailId: string;
  trendPeriode: TrendPunt[];
  onToggle: () => void;
}) {
  const { config } = rij;
  const kern =
    rij.status === "onbekend" ? "—" : formatteerWaarde(rij.waarde, config.eenheid, rij.onderdrukt);
  const reden = rij.onderdrukt
    ? `onderdrukt (n<${config.nDrempel})`
    : rij.verouderd
      ? "niet recent gemeten"
      : rij.status === "onbekend"
        ? "geen recente meting"
        : duding(rij.status);
  const context = tokenContext(rij);

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={detailId}
      onClick={onToggle}
      className="grid w-full grid-cols-1 items-center gap-3 px-4 py-3 text-left hover:bg-app-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:grid-cols-12"
    >
      {/* Signaal + betekenis */}
      <div className="md:col-span-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block transition-transform ${open ? "rotate-90" : ""} text-ink/40`}
          >
            ▸
          </span>
          <span className="font-serif text-sm font-bold text-ink">{config.label}</span>
        </div>
        <p className="mt-0.5 pl-5 text-xs text-ink/60">{config.betekenis}</p>
        {rij.fondsLabel && (
          <p className="pl-5 text-xs text-ink/45">
            {rij.platformbreed ? "Platformbreed" : rij.fondsLabel}
          </p>
        )}
      </div>

      {/* Status */}
      <div className="md:col-span-2">
        <Stoplicht status={rij.status} toelichting={reden} />
      </div>

      {/* Waarde + norm (regel 2) */}
      <div className="md:col-span-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif text-base font-bold text-ink">{kern}</span>
          <span className="text-xs text-ink/60">{reden}</span>
        </div>
        {context && <p className="text-xs text-ink/45">{context}</p>}
      </div>

      {/* Verdeling (alleen "Alle fondsen" + per-fonds signaal) + sparkline */}
      <div className="md:col-span-3">
        {rij.verdeling && <VerdelingIndicator v={rij.verdeling} />}
        <div className="mt-1">
          <Trendlijn
            punten={trendPeriode}
            status={rij.status}
            drempelOranje={rij.drempelOranje}
            drempelRood={rij.drempelRood}
            variant="sparkline"
          />
        </div>
      </div>

      {/* Laatst gemeten */}
      <div className="md:col-span-1 md:text-right">
        <span className="text-xs text-ink/50">{kortTijd(rij.laatsteMeting)}</span>
      </div>
    </button>
  );
}

function VerdelingIndicator({ v }: { v: Verdeling }) {
  const segmenten: Array<[SignaalStatus, number]> = [
    ["rood", v.rood],
    ["oranje", v.oranje],
    ["onbekend", v.onbekend],
    ["groen", v.groen],
  ];
  const tekst = beschrijfVerdeling(v);
  return (
    <span className="inline-flex items-center gap-1.5" title={tekst}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {segmenten.flatMap(([status, aantal]) =>
          Array.from({ length: aantal }, (_, i) => (
            <span key={`${status}-${i}`} className={`h-2.5 w-2.5 rounded-sm ${DOT[status]}`} />
          ))
        )}
      </span>
      <span className="text-xs text-ink/60">{tekst}</span>
    </span>
  );
}

// ── Pure hulpjes (weergave) ──────────────────────────────────────────────────

function bouwRijen(signalen: SignaalWeergave[], fonds: string): Rij[] {
  const perSignaal = new Map<SignaalId, SignaalWeergave[]>();
  for (const s of signalen) {
    const lijst = perSignaal.get(s.signaal) ?? [];
    lijst.push(s);
    perSignaal.set(s.signaal, lijst);
  }

  const rijen: Rij[] = [];
  for (const id of SIGNAAL_VOLGORDE) {
    const groep = perSignaal.get(id);
    if (!groep || groep.length === 0) continue;
    const config = groep[0]!.config;

    if (config.platformbreed) {
      rijen.push(rijVanMeting(groep[0]!, "Platformbreed", groep, null));
      continue;
    }

    if (fonds === "alle") {
      const slechtste = kiesSlechtsteMeting(groep) ?? groep[0]!;
      const status = aggregeerStatus(groep.map((g) => g.status));
      rijen.push({
        ...rijVanMeting(slechtste, slechtste.fondsNaam, groep, telVerdeling(groep)),
        status,
      });
    } else {
      const m = groep.find((g) => g.fondsId === fonds) ?? groep[0]!;
      rijen.push(rijVanMeting(m, m.fondsNaam ?? "—", [m], null));
    }
  }
  return rijen;
}

function rijVanMeting(
  m: SignaalWeergave,
  fondsLabel: string | null,
  metingen: SignaalWeergave[],
  verdeling: Verdeling | null
): Rij {
  return {
    signaal: m.signaal,
    config: m.config,
    status: m.status,
    waarde: m.waarde,
    onderdrukt: m.onderdrukt,
    n: m.n,
    drempelOranje: m.drempelOranje,
    drempelRood: m.drempelRood,
    trend: m.trend,
    laatsteMeting: m.laatsteMeting,
    verouderd: m.verouderd,
    meta: m.meta,
    fondsLabel,
    platformbreed: m.config.platformbreed,
    verdeling,
    metingen,
  };
}

function telVerdeling(groep: SignaalWeergave[]): Verdeling {
  const v: Verdeling = { groen: 0, oranje: 0, rood: 0, onbekend: 0, totaal: groep.length };
  for (const g of groep) v[g.status] += 1;
  return v;
}

function vergelijk(a: Rij, b: Rij, sortering: Sortering): number {
  if (sortering === "ernst") {
    const d = ERNST_UI[b.status] - ERNST_UI[a.status];
    if (d !== 0) return d;
    return volgordeIndex(a) - volgordeIndex(b);
  }
  const d = DOMEIN_VOLGORDE.indexOf(a.config.domein) - DOMEIN_VOLGORDE.indexOf(b.config.domein);
  if (d !== 0) return d;
  return volgordeIndex(a) - volgordeIndex(b);
}

function volgordeIndex(r: Rij): number {
  return VOLGORDE_INDEX.get(r.signaal) ?? 999;
}

function duding(status: SignaalStatus): string {
  if (status === "groen") return "binnen norm";
  if (status === "oranje") return "vraagt aandacht";
  if (status === "rood") return "boven norm";
  return "";
}

function beschrijfVerdeling(v: Verdeling): string {
  const delen: string[] = [];
  if (v.groen) delen.push(`${v.groen} in orde`);
  if (v.oranje) delen.push(`${v.oranje} aandacht`);
  if (v.rood) delen.push(`${v.rood} verstoord`);
  if (v.onbekend) delen.push(`${v.onbekend} onbekend`);
  return delen.join(", ") || "geen fondsen";
}

/** Absoluut verbruik naast het trendpercentage bij tokenverbruik (regel 3, acceptatie 15). */
function tokenContext(rij: Rij): string | null {
  if (rij.signaal !== "tokenverbruik" || !rij.meta) return null;
  const abs = rij.meta.tokens_laatste_24u;
  const gem = rij.meta.daggemiddelde_basisperiode;
  if (typeof abs !== "number") return null;
  const delen = [`${abs.toLocaleString("nl-NL")} tokens (24 u)`];
  if (typeof gem === "number") delen.push(`daggem. ${gem.toLocaleString("nl-NL")}`);
  return delen.join(" · ");
}

function snijdLaatste24u(trend: TrendPunt[], anker: string | null): TrendPunt[] {
  if (!anker) return trend;
  const grens = new Date(anker).getTime() - 24 * 60 * 60_000;
  if (!Number.isFinite(grens)) return trend;
  return trend.filter((p) => {
    const t = new Date(p.tijdstip).getTime();
    return Number.isFinite(t) && t >= grens;
  });
}

function kortTijd(iso: string | null): string {
  if (!iso) return "nooit";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "onbekend";
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}
