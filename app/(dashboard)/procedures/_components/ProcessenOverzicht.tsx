"use client";

// Interactief procesoverzicht (P1a, #165) — één lijst met werkbalk, ingeklapte
// filterrail, chips en zoek. Vervangt de vier portfolio-tegels + de twee vaste
// secties (Lopend/Afgerond) uit de vorige inrichting; de tellingen leven nu als
// filter i.p.v. als losse tegel.
//
// De server (page.tsx) doet alle afleiding en levert een serialiseerbaar
// view-model per proces; dit component bezit alleen de interactie. Geen data-
// fetch, geen API-aanroep — puur presentatie + clientstate.
//
// Leidend ontwerp: prototypes/MOCKUP-processen-v0.7-overzicht-en-detail.html
// (scherm 1). Readiness/Besluitrijp is bewust uit het overzicht (de ladder in
// het dossier blijft, tot #168). "Met afwijking" volgt in #168 zodra de kolom
// `afgerond_met_afwijking` bestaat — SIGNAAL_OPTIES is daarom een geordende
// array met vaste prioriteitsvolgorde waar een derde signaal bij kan.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AandachtNiveau } from "@/core/lib/procedure-fase-status";
import FaseStrip, { type FaseSegment } from "./FaseStrip";

export interface Aandachtspunt {
  niveau: AandachtNiveau;
  tekst: string;
}

/** Serialiseerbaar view-model per proces (server → client). Geen functies of
 *  klasse-instanties: alles moet de server/client-grens over kunnen. */
export interface ProcesKaartVM {
  id: string;
  templateCode: string;
  templateLabel: string;
  titel: string;
  beschrijving: string | null;
  statusLabel: string;
  /** Kleurklasse uit dossierStatusKleur() — server-side bepaald. */
  statusKleur: string;
  sublabel: string | null;
  periodeLabel: string | null;
  isAfgerond: boolean;
  fasen: FaseSegment[];
  stappenAfgerond: number;
  stappenTotaal: number;
  deadlineIso: string | null;
  deadlineLabel: string | null;
  gestartLabel: string;
  heeftAandacht: boolean;
  heeftRood: boolean;
  /** P3: een afgeronde stap met afwijking vraagt zichtbare opvolging. */
  heeftAfwijkingOpvolging: boolean;
  aandachtspunten: Aandachtspunt[];
}

type StatusId = "lopend" | "afgerond" | "alle";
type SorteerId = "deadline" | "aandacht" | "voortgang" | "titel";

interface Optie {
  id: string;
  label: string;
  /** Streepkleur-klasse in de filterrail (leeg = geen streep). */
  streep: string;
  test: (p: ProcesKaartVM) => boolean;
}

const STATUS_OPTIES: { id: StatusId; label: string; test: (p: ProcesKaartVM) => boolean }[] = [
  { id: "lopend", label: "Lopend", test: (p) => !p.isAfgerond },
  { id: "afgerond", label: "Afgerond", test: (p) => p.isAfgerond },
  { id: "alle", label: "Alle", test: () => true },
];

// Vaste prioriteitsvolgorde. Signalen filteren bovenop de statuskeuze; ze zijn
// deelverzamelingen (kritiek ⊂ aandacht), daarom losse vinkjes en geen radio.
// De P3-afwijking is een eigen signaal: afronden met afwijking is niet hetzelfde
// als ontbrekende bewijslast, en moet ook in het overzicht zichtbaar blijven.
const SIGNAAL_OPTIES: Optie[] = [
  { id: "aandacht", label: "Met aandacht", streep: "bg-warn", test: (p) => p.heeftAandacht },
  { id: "kritiek", label: "Kritieke vereisten", streep: "bg-err", test: (p) => p.heeftRood },
  {
    id: "afwijking",
    label: "Afwijking opvolgen",
    streep: "bg-warn",
    test: (p) => p.heeftAfwijkingOpvolging,
  },
];

const SORTEER_OPTIES: { id: SorteerId; label: string }[] = [
  { id: "deadline", label: "Deadline" },
  { id: "aandacht", label: "Aandacht eerst" },
  { id: "voortgang", label: "Voortgang" },
  { id: "titel", label: "Titel" },
];

const STIP_KLEUR: Record<AandachtNiveau, string> = {
  rood: "bg-err",
  oranje: "bg-warn",
  geen: "bg-app-line",
};
const TEKST_KLEUR: Record<AandachtNiveau, string> = {
  rood: "text-err-ink font-medium",
  oranje: "text-warn-ink",
  geen: "text-muted",
};

function deadlineWaarde(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY; // zonder deadline achteraan
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
function aandachtRang(p: ProcesKaartVM): number {
  return p.heeftRood ? 0 : p.heeftAandacht ? 1 : 2;
}

/** Markeert de zoektreffer in platte tekst, React-veilig (geen innerHTML). */
function markeer(tekst: string, naald: string): ReactNode {
  const q = naald.trim();
  if (!q) return tekst;
  const stukken: ReactNode[] = [];
  const lower = tekst.toLowerCase();
  const naaldLower = q.toLowerCase();
  let i = 0;
  let sleutel = 0;
  while (i < tekst.length) {
    const idx = lower.indexOf(naaldLower, i);
    if (idx === -1) {
      stukken.push(tekst.slice(i));
      break;
    }
    if (idx > i) stukken.push(tekst.slice(i, idx));
    stukken.push(
      <mark key={sleutel++} className="bg-mark text-ink rounded-sm">
        {tekst.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return stukken;
}

export default function ProcessenOverzicht({
  processen,
}: {
  processen: ProcesKaartVM[];
}) {
  const [status, setStatus] = useState<StatusId>("lopend");
  const [signaal, setSignaal] = useState<Set<string>>(() => new Set());
  const [type, setType] = useState<Set<string>>(() => new Set());
  const [zoek, setZoek] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [sortering, setSortering] = useState<SorteerId>("deadline");
  const zoekRef = useRef<HTMLInputElement>(null);

  // Sneltoetsen: "/" springt naar het zoekveld, Esc wist de zoekterm.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const doel = e.target as HTMLElement | null;
      const typt =
        doel &&
        (doel.tagName === "INPUT" ||
          doel.tagName === "TEXTAREA" ||
          doel.isContentEditable);
      if (e.key === "/" && !typt) {
        e.preventDefault();
        zoekRef.current?.focus();
      } else if (e.key === "Escape" && zoek) {
        setZoek("");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoek]);

  const inStatus = useMemo(() => {
    const statusTest =
      STATUS_OPTIES.find((o) => o.id === status)?.test ?? (() => true);
    return processen.filter(statusTest);
  }, [processen, status]);

  // Procestypen binnen de huidige status (voor de filterrail + tellingen).
  const typen = useMemo(() => {
    const uniek: { code: string; label: string }[] = [];
    for (const p of inStatus) {
      if (!uniek.some((t) => t.code === p.templateCode)) {
        uniek.push({ code: p.templateCode, label: p.templateLabel });
      }
    }
    return uniek;
  }, [inStatus]);

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    const l = inStatus.filter((p) => {
      const s =
        signaal.size === 0 ||
        SIGNAAL_OPTIES.some((o) => signaal.has(o.id) && o.test(p));
      const t = type.size === 0 || type.has(p.templateCode);
      const z =
        q === "" ||
        `${p.titel} ${p.beschrijving ?? ""} ${p.templateLabel}`
          .toLowerCase()
          .includes(q);
      return s && t && z;
    });
    const gesorteerd = [...l];
    gesorteerd.sort((a, b) => {
      if (sortering === "deadline")
        return deadlineWaarde(a.deadlineIso) - deadlineWaarde(b.deadlineIso);
      if (sortering === "aandacht")
        return (
          aandachtRang(a) - aandachtRang(b) ||
          deadlineWaarde(a.deadlineIso) - deadlineWaarde(b.deadlineIso)
        );
      if (sortering === "voortgang")
        return (
          b.stappenAfgerond / Math.max(1, b.stappenTotaal) -
          a.stappenAfgerond / Math.max(1, a.stappenTotaal)
        );
      return a.titel.localeCompare(b.titel, "nl");
    });
    return gesorteerd;
  }, [inStatus, signaal, type, zoek, sortering]);

  // Chips voor wat er in de ingeklapte rail (en het zoekveld) aan staat.
  const chips: { groep: "zoek" | "signaal" | "type"; waarde: string; label: string }[] = [];
  if (zoek.trim())
    chips.push({ groep: "zoek", waarde: zoek, label: `Zoek: ${zoek.trim()}` });
  for (const id of signaal)
    chips.push({
      groep: "signaal",
      waarde: id,
      label: SIGNAAL_OPTIES.find((o) => o.id === id)?.label ?? id,
    });
  for (const code of type)
    chips.push({
      groep: "type",
      waarde: code,
      label: typen.find((t) => t.code === code)?.label ?? code,
    });

  function toggleSet(
    set: Set<string>,
    waarde: string,
    zet: (s: Set<string>) => void
  ) {
    const volgend = new Set(set);
    if (volgend.has(waarde)) volgend.delete(waarde);
    else volgend.add(waarde);
    zet(volgend);
  }
  function chipWeg(c: { groep: "zoek" | "signaal" | "type"; waarde: string }) {
    if (c.groep === "zoek") setZoek("");
    else if (c.groep === "signaal") toggleSet(signaal, c.waarde, setSignaal);
    else toggleSet(type, c.waarde, setType);
  }
  function wisFilters() {
    setStatus("lopend");
    setSignaal(new Set());
    setType(new Set());
    setZoek("");
  }
  function zoekInAlle() {
    // Verbreedt de filters en houdt de zoekterm juist vást — dat is de bedoeling.
    setStatus("alle");
    setSignaal(new Set());
    setType(new Set());
  }

  const statusLabel =
    STATUS_OPTIES.find((o) => o.id === status)?.label ?? "Alle";
  const extraFilters = signaal.size + type.size;
  const filterUitleg =
    `· ${statusLabel.toLowerCase()}` +
    (extraFilters
      ? ` · ${extraFilters} extra filter${extraFilters === 1 ? "" : "s"}`
      : "") +
    (zoek.trim() ? ` · zoek: “${zoek.trim()}”` : "") +
    ` · ${processen.length} in totaal`;

  return (
    <div className="space-y-5">
      {/* ── Werkbalk: status altijd bij de hand, de rest achter één knop ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-app-line-control overflow-hidden bg-white">
          {STATUS_OPTIES.map((o, i) => {
            const aan = status === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setStatus(o.id)}
                className={`px-3.5 py-1.5 text-[13px] inline-flex items-center gap-1.5 ${
                  i < STATUS_OPTIES.length - 1 ? "border-r border-line" : ""
                } ${
                  aan
                    ? "bg-accent-tint text-accent font-semibold"
                    : "text-muted hover:bg-app-zebra hover:text-ink"
                }`}
              >
                {o.label}
                <span
                  className={`text-[11px] tabular-nums ${
                    aan ? "text-accent" : "text-muted"
                  }`}
                >
                  {processen.filter(o.test).length}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          aria-expanded={railOpen}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-lg border ${
            railOpen
              ? "border-accent text-accent bg-accent-tint"
              : "border-app-line-control text-muted hover:text-ink bg-white"
          }`}
        >
          <span aria-hidden>☰</span> Filters
          {chips.length > 0 && (
            <span className="text-[11px] tabular-nums bg-accent text-white rounded-full px-1.5">
              {chips.length}
            </span>
          )}
        </button>

        <div className="relative flex items-center">
          <span
            aria-hidden
            className="absolute left-2.5 text-muted text-sm pointer-events-none"
          >
            ⌕
          </span>
          <input
            ref={zoekRef}
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek op naam of omschrijving   /"
            aria-label="Zoek in processen"
            className="w-[250px] max-w-full text-[13px] pl-8 pr-7 py-2 rounded-lg border border-line bg-white placeholder:text-muted focus:outline-2 focus:outline-accent"
          />
          {zoek && (
            <button
              type="button"
              onClick={() => setZoek("")}
              aria-label="Zoekterm wissen"
              className="absolute right-2 text-muted hover:text-ink text-sm"
            >
              ×
            </button>
          )}
        </div>

        {chips.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {chips.map((c) => (
              <button
                key={`${c.groep}:${c.waarde}`}
                type="button"
                onClick={() => chipWeg(c)}
                className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-md bg-app-zebra border border-line text-ink hover:border-app-line-control"
              >
                {c.label}
                <span aria-hidden className="text-muted">
                  ×
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={wisFilters}
              className="text-[12px] px-2 py-1 rounded-md text-muted hover:text-ink underline"
            >
              Wis filters
            </button>
          </div>
        )}

        <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-muted">
          Sorteer op:
          <select
            value={sortering}
            onChange={(e) => setSortering(e.target.value as SorteerId)}
            className="text-[13px] rounded-lg border border-app-line-control px-2.5 py-1.5 bg-white text-ink"
          >
            {SORTEER_OPTIES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* ── Ingeklapte filterrail ── */}
        {railOpen && (
          <div className="col-span-12 lg:col-span-3">
            <div className="bg-white border border-line rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-muted uppercase tracking-wider">
                  Filters
                </div>
                <button
                  type="button"
                  onClick={wisFilters}
                  className="text-[12px] text-accent hover:text-accent-ink"
                >
                  Wis filters
                </button>
              </div>

              <FilterGroep titel="Signalen" hint="binnen status">
                {SIGNAAL_OPTIES.map((o) => (
                  <FilterKnop
                    key={o.id}
                    aan={signaal.has(o.id)}
                    streep={o.streep}
                    label={o.label}
                    aantal={inStatus.filter(o.test).length}
                    onClick={() => toggleSet(signaal, o.id, setSignaal)}
                  />
                ))}
              </FilterGroep>

              <FilterGroep titel="Procestype">
                {typen.map((t) => (
                  <FilterKnop
                    key={t.code}
                    aan={type.has(t.code)}
                    label={t.label}
                    aantal={inStatus.filter((p) => p.templateCode === t.code).length}
                    onClick={() => toggleSet(type, t.code, setType)}
                  />
                ))}
              </FilterGroep>
            </div>
          </div>
        )}

        {/* ── Lijst ── */}
        <div className={railOpen ? "col-span-12 lg:col-span-9" : "col-span-12"}>
          <div className="flex items-end justify-between flex-wrap gap-3 mb-3">
            <div className="text-sm">
              <b className="text-ink">Processen ({zichtbaar.length})</b>{" "}
              <span className="text-muted text-xs">{filterUitleg}</span>
            </div>
            <FaseLegenda />
          </div>

          {zichtbaar.length > 0 ? (
            <div className="space-y-2">
              {zichtbaar.map((p) => (
                <ProcesKaart key={p.id} p={p} zoek={zoek} />
              ))}
            </div>
          ) : zoek.trim() ? (
            <div className="bg-white border border-dashed border-app-line-strong rounded-xl p-8 text-center text-sm text-muted">
              Geen processen gevonden voor “{zoek.trim()}” binnen de huidige
              filters.
              <div className="mt-2">
                <button
                  type="button"
                  onClick={zoekInAlle}
                  className="text-accent hover:text-accent-ink font-semibold"
                >
                  Zoek in alle processen
                </button>{" "}
                of{" "}
                <button
                  type="button"
                  onClick={() => setZoek("")}
                  className="text-accent hover:text-accent-ink font-semibold"
                >
                  wis de zoekterm
                </button>
                .
              </div>
            </div>
          ) : (
            <div className="bg-white border border-dashed border-app-line-strong rounded-xl p-8 text-center text-sm text-muted">
              Geen processen die aan deze filters voldoen. Pas de filters aan of
              wis ze.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterGroep({
  titel,
  hint,
  children,
}: {
  titel: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted flex items-center gap-2">
        {titel}
        {hint && <span className="font-normal normal-case">{hint}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function FilterKnop({
  aan,
  streep,
  label,
  aantal,
  onClick,
}: {
  aan: boolean;
  streep?: string;
  label: string;
  aantal: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 text-left text-[13px] px-2 py-1.5 rounded-md border ${
        aan
          ? "border-accent bg-accent-tint text-ink"
          : "border-transparent hover:bg-app-zebra text-ink"
      } ${aantal === 0 ? "opacity-50" : ""}`}
    >
      <span
        className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0 ${
          aan ? "border-accent text-accent" : "border-app-line-control text-transparent"
        }`}
      >
        ✓
      </span>
      {streep && <span className={`w-1 h-3.5 rounded-sm ${streep}`} />}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="text-[11px] tabular-nums text-muted">{aantal}</span>
    </button>
  );
}

function FaseLegenda() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted">
      <span className="uppercase tracking-wide font-semibold">Fase-status:</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-ok" /> Afgerond
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-accent" /> In behandeling
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-app-bg border border-line" /> Nog
        niet begonnen
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="relative w-3 h-2 rounded-sm bg-accent">
          <span className="absolute -top-1 right-0 w-2 h-2 rounded-full bg-warn ring-1 ring-white" />
        </span>
        Aandacht
      </span>
    </div>
  );
}

function ProcesKaart({ p, zoek }: { p: ProcesKaartVM; zoek: string }) {
  return (
    <Link
      href={`/procedures/${p.id}`}
      className={`block bg-white border border-line rounded-xl p-4 hover:border-accent transition-colors ${
        p.isAfgerond ? "opacity-80" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wide text-phase-ink bg-phase-tint px-2 py-0.5 rounded">
              {p.templateLabel}
            </span>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${p.statusKleur}`}
            >
              {p.statusLabel}
            </span>
            {p.sublabel && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-warn-tint text-warn-ink border border-warn/30">
                {p.sublabel}
              </span>
            )}
            {p.periodeLabel && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-app-bg text-ink border border-line">
                {p.periodeLabel}
              </span>
            )}
          </div>
          <div className="font-semibold text-ink text-sm">
            {markeer(p.titel, zoek)}
          </div>
          {p.beschrijving && (
            <p className="text-xs text-muted mt-0.5 line-clamp-1">
              {markeer(p.beschrijving, zoek)}
            </p>
          )}
        </div>
        <span aria-hidden className="text-muted text-lg leading-none flex-shrink-0">
          ›
        </span>
      </div>

      {/* Twee kolommen: Voortgang (met fasestrip) en Deadline. */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-4 sm:gap-8">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">
            Voortgang
          </div>
          <div className="text-xs text-ink mb-2">
            <b>
              {p.stappenAfgerond}/{p.stappenTotaal}
            </b>{" "}
            stappen afgerond
          </div>
          {p.fasen.length > 0 && <FaseStrip fasen={p.fasen} />}
        </div>
        <div className="sm:text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold">
            Deadline
          </div>
          <div className="text-xs text-ink">
            {p.deadlineLabel ?? "geen deadline"}
          </div>
          <div className="text-xs text-muted">Gestart {p.gestartLabel}</div>
        </div>
      </div>

      {/* Aandachtspunten als aparte strook onderaan. */}
      {p.aandachtspunten.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line flex items-center gap-4 flex-wrap text-xs">
          {p.aandachtspunten.map((a) => (
            <span
              key={`${a.niveau}-${a.tekst}`}
              className="inline-flex items-center gap-1.5"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  STIP_KLEUR[a.niveau]
                }`}
              />
              <span className={TEKST_KLEUR[a.niveau]}>{a.tekst}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
