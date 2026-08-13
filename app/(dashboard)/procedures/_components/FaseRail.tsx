"use client";

// Procesfasen-rail (WO-2, §7) — accordion van de hoofdfasen (D8).
//
// De rail toont compact de hoofdfasen; per fase een kop met status-pill +
// bewijslast-dekkingsmeter + aandachtsstip. Uitklappen toont de fase-
// beschrijving (toelichting) en de stappen. Parallel-by-default: meerdere
// stappen kunnen tegelijk 'actief'/'heropend' zijn. Fasen met werk-in-uitvoering
// (of met de geselecteerde stap) staan standaard open; de rest ingeklapt zodat
// de rail rustig blijft.

import { useState } from "react";
import Link from "next/link";
import type { Stap } from "../[id]/page";
import FaseBeschrijving from "./FaseBeschrijving";
import FaseToelichting from "./FaseToelichting";
import {
  FASE_STATUS_LABEL,
  type FaseStatus,
  type AandachtNiveau,
  type Dekking,
} from "@/core/lib/procedure-fase-status";

export interface FaseGroep {
  fase_code: string;
  titel: string;
  beschrijving: string | null;
  is_override: boolean;
  /** Per-proces bestuurlijke toelichting (los van de gedeelde D8-beschrijving). */
  toelichting: string | null;
  status: FaseStatus;
  dekking: Dekking;
  aandacht: AandachtNiveau;
  stappen: Stap[];
}

const STATUS_PILL: Record<FaseStatus, string> = {
  afgerond: "bg-ok-tint text-ok-ink border border-ok/30",
  in_behandeling: "bg-accent-tint text-accent-ink border border-accent/30",
  nog_niet_begonnen: "bg-app-bg text-muted border border-line",
};

function meterKleur(pct: number): string {
  if (pct >= 100) return "bg-ok";
  if (pct <= 0) return "bg-err";
  return "bg-warn";
}

function isActiefAchtig(s: Stap): boolean {
  return s.status === "actief" || s.status === "heropend";
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}

function StapItem({
  s,
  isLaatste,
  geselecteerd,
}: {
  s: Stap;
  isLaatste: boolean;
  geselecteerd: boolean;
}) {
  const isAfgerond = s.status === "afgerond";
  const isActief = isActiefAchtig(s);
  const isHeropend = s.status === "heropend";
  const isGeblokkeerd = s.status === "geblokkeerd";

  return (
    <li>
      <Link
        href={`?stap=${s.id}`}
        scroll={false}
        replace
        aria-current={geselecteerd ? "step" : undefined}
        className={`relative block -mx-3 px-3 pl-9 py-2 rounded-lg transition-colors ${
          isActief
            ? "bg-warn-tint"
            : geselecteerd
              ? "bg-app-bg ring-1 ring-app-line-strong"
              : "hover:bg-app-bg/70"
        }`}
      >
        {isAfgerond ? (
          <div className="absolute left-3 top-2.5 w-6 h-6 rounded-full bg-ok text-white flex items-center justify-center text-xs font-bold">
            ✓
          </div>
        ) : isActief ? (
          <div className="absolute left-3 top-2.5 w-6 h-6 rounded-full bg-accent border-2 border-accent text-white flex items-center justify-center text-xs font-bold ring-4 ring-warn/30">
            {s.volgorde}
          </div>
        ) : (
          <div className="absolute left-3 top-2.5 w-6 h-6 rounded-full bg-app-bg border-2 border-app-line-strong text-muted flex items-center justify-center text-xs font-medium">
            {s.volgorde}
          </div>
        )}
        {!isLaatste && (
          <div
            className={`absolute left-6 top-8 bottom-0 w-px ${
              isAfgerond ? "bg-ok" : "bg-app-line"
            }`}
          />
        )}
        <div className="ml-6">
          <div
            className={`text-sm ${
              isActief
                ? "font-semibold text-ink"
                : isAfgerond
                  ? "font-medium text-ink"
                  : "font-medium text-muted"
            }`}
          >
            {s.naam}
          </div>

          {s.herbevestiging_nodig && (
            <span className="inline-block mt-1 text-[10px] font-medium uppercase tracking-wide text-warn-ink bg-warn-tint border border-warn/30 px-1.5 py-0.5 rounded">
              Herbevestiging nodig
            </span>
          )}

          {isAfgerond && (
            <div className="text-xs text-muted mt-0.5">
              {s.voltooid_op
                ? `Afgerond ${formatDatumKort(s.voltooid_op)}`
                : "Afgerond"}
            </div>
          )}
          {isActief && (
            <div className="text-xs text-warn-ink font-medium mt-0.5">
              {isHeropend ? "Heropend" : "Actief"}
              {s.deadline ? ` — deadline ${formatDatumKort(s.deadline)}` : ""}
            </div>
          )}
          {isGeblokkeerd && (
            <div className="text-xs text-muted mt-0.5">Wacht op eerdere stap</div>
          )}
          {s.status === "open" && s.vereist_besluit && (
            <div className="text-xs text-warn-ink mt-0.5">
              Vereist formeel besluit
            </div>
          )}
          {s.status === "open" && !s.vereist_besluit && s.geschatte_dagen && (
            <div className="text-xs text-muted mt-0.5">
              Geschat {s.geschatte_dagen} dagen
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function FaseRail({
  fasen,
  geselecteerdeStapId,
  procedureId,
  kanBeheren,
}: {
  fasen: FaseGroep[];
  geselecteerdeStapId: string | null;
  procedureId: string;
  kanBeheren: boolean;
}) {
  // Standaard open: fasen met een actieve/heropende stap of met de
  // geselecteerde stap. De rest ingeklapt. Manueel togglen blijft daarna leidend.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const f of fasen) {
      const heeftActief = f.stappen.some(isActiefAchtig);
      const heeftSelectie =
        geselecteerdeStapId != null &&
        f.stappen.some((st) => st.id === geselecteerdeStapId);
      if (heeftActief || heeftSelectie) s.add(f.fase_code);
    }
    return s;
  });

  const toggle = (code: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  return (
    <div className="space-y-2">
      {fasen.map((f) => {
        const isOpen = open.has(f.fase_code);
        const actiefCount = f.stappen.filter(isActiefAchtig).length;
        return (
          <div
            key={f.fase_code}
            className="border border-line rounded-lg overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggle(f.fase_code)}
              aria-expanded={isOpen}
              className="w-full text-left px-3 py-2.5 hover:bg-app-bg/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-widest text-muted font-bold flex items-center gap-1.5 min-w-0">
                  {f.aandacht !== "geen" && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        f.aandacht === "rood" ? "bg-err" : "bg-warn"
                      }`}
                      title={
                        f.aandacht === "rood"
                          ? "Aandacht: verplichte blokkerende bewijslast ontbreekt"
                          : "Aandacht: heropend of verplichte bewijslast ontbreekt"
                      }
                    />
                  )}
                  <span className="truncate">
                    {f.fase_code} · {f.titel}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_PILL[f.status]}`}
                  >
                    {FASE_STATUS_LABEL[f.status]}
                  </span>
                  <span
                    aria-hidden
                    className={`text-muted text-xs transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    ▾
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                {f.dekking.verplicht > 0 && (
                  <div
                    className="flex-1 h-1 bg-app-bg rounded-full overflow-hidden"
                    title={`${f.dekking.sluitend} van ${f.dekking.verplicht} verplichte vereisten sluitend`}
                  >
                    <div
                      className={`h-full ${meterKleur(f.dekking.pct)}`}
                      style={{ width: `${f.dekking.pct}%` }}
                    />
                  </div>
                )}
                <span className="text-[9px] text-muted whitespace-nowrap">
                  {f.stappen.length} stap{f.stappen.length === 1 ? "" : "pen"}
                  {actiefCount > 0 ? ` · ${actiefCount} actief` : ""}
                  {f.dekking.verplicht > 0 ? ` · ${f.dekking.pct}% bewijslast` : ""}
                </span>
              </div>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-2 border-t border-line space-y-2">
                <FaseBeschrijving
                  beschrijving={f.beschrijving}
                  isOverride={f.is_override}
                />
                <FaseToelichting
                  procedureId={procedureId}
                  faseCode={f.fase_code}
                  initieel={f.toelichting}
                  kanBeheren={kanBeheren}
                />
                <ol className="space-y-1">
                  {f.stappen.map((s, idx) => (
                    <StapItem
                      key={s.id}
                      s={s}
                      isLaatste={idx === f.stappen.length - 1}
                      geselecteerd={s.id === geselecteerdeStapId}
                    />
                  ))}
                </ol>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
