"use client";

// Procesfasen-accordeon (WO-3) — schone fase-accordeon in het linkerpaneel.
//
// De rail toont per hoofdfase (D8) een rustige kop: romeins cijfer-badge,
// naam + aantal stappen, status-pill, chevron, en een linkerrand-accent voor de
// aandachtsvlag. GEEN beschrijvings-/toelichtingsblokken in het linkerpaneel —
// die verhuizen naar de fase-weergave rechts (WO-3). Klik op een fasekop → klapt
// de fase open én toont rechts de fasebeschrijving (`?fase=`); klik op een stap →
// het stapscherm (`?stap=`). Parallel-by-default: meerdere stappen kunnen tegelijk
// 'actief'/'heropend' zijn.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Stap } from "../[id]/page";
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
  in_behandeling: "bg-warn-tint text-warn-ink border border-warn/30",
  nog_niet_begonnen: "bg-app-bg text-muted border border-line",
};

const BADGE_KLEUR: Record<FaseStatus, string> = {
  afgerond: "bg-ok-tint text-ok-ink",
  in_behandeling: "bg-warn-tint text-warn-ink",
  nog_niet_begonnen: "bg-app-bg text-muted",
};

// Linkerrand-accent: aandacht wint (rood/oranje), anders duidt de rand de
// fase-status (in behandeling = accent). Zo blijft status = kleur én woord
// (de pill) én vorm (de rand), conform besluit 0097/0101.
function randKleur(status: FaseStatus, aandacht: AandachtNiveau): string {
  if (aandacht === "rood") return "border-err";
  if (aandacht === "oranje") return "border-warn";
  if (status === "in_behandeling") return "border-accent";
  return "border-line";
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
  geselecteerdeFaseCode,
}: {
  fasen: FaseGroep[];
  geselecteerdeStapId: string | null;
  /** Code van de fase die rechts in fase-weergave staat (of null). */
  geselecteerdeFaseCode: string | null;
}) {
  const router = useRouter();
  // Standaard open: fasen met een actieve/heropende stap, met de geselecteerde
  // stap, of de fase die rechts in fase-weergave staat. De rest ingeklapt.
  // Manueel togglen blijft daarna leidend.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const f of fasen) {
      const heeftActief = f.stappen.some(isActiefAchtig);
      const heeftSelectie =
        geselecteerdeStapId != null &&
        f.stappen.some((st) => st.id === geselecteerdeStapId);
      if (heeftActief || heeftSelectie || f.fase_code === geselecteerdeFaseCode)
        s.add(f.fase_code);
    }
    return s;
  });

  // Klik op de fasekop: klap de fase open/dicht én toon rechts de
  // fasebeschrijving (matcht de mockup: één klik doet beide).
  const openFase = (code: string) => {
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
    // replace (niet push) — consistent met de stap-links (<Link replace>); zo
    // vervuilt het heen-en-weer klikken tussen fasen de history niet.
    router.replace(`?fase=${code}`, { scroll: false });
  };

  return (
    <div className="space-y-1">
      {fasen.map((f) => {
        const isOpen = open.has(f.fase_code);
        const isGeselecteerd = f.fase_code === geselecteerdeFaseCode;
        const actiefCount = f.stappen.filter(isActiefAchtig).length;
        return (
          <div
            key={f.fase_code}
            className={`rounded-lg overflow-hidden border-l-[3px] ${randKleur(
              f.status,
              f.aandacht
            )}`}
          >
            <button
              type="button"
              onClick={() => openFase(f.fase_code)}
              aria-expanded={isOpen}
              className={`w-full text-left px-2.5 py-2.5 flex items-center gap-2.5 transition-colors ${
                isGeselecteerd ? "bg-accent-tint" : "hover:bg-app-bg/60"
              }`}
            >
              <span
                className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  BADGE_KLEUR[f.status]
                }`}
              >
                {f.fase_code}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
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
                  <span className="block text-sm font-semibold text-ink leading-tight truncate">
                    {f.titel}
                  </span>
                </span>
                <span className="block text-[11px] text-muted mt-0.5">
                  {f.stappen.length} stap{f.stappen.length === 1 ? "" : "pen"}
                  {actiefCount > 0 ? ` · ${actiefCount} actief` : ""}
                </span>
              </span>
              <span
                className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap ${
                  STATUS_PILL[f.status]
                }`}
              >
                {FASE_STATUS_LABEL[f.status]}
              </span>
              <span
                aria-hidden
                className={`text-muted text-xs shrink-0 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-1">
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
