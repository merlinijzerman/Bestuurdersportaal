"use client";

// Procesfasen-accordeon (WO-3) — schone, neutrale fase-accordeon in het
// linkerpaneel, in de neutrale app-tokens (muted/line/accent).
//
// T3 (besluit 0202): dit paneel gebruikte de NAV-tokens omdat het "de kleuren
// van het hoofdmenu" wilde. Dat was al fout vóór de donkere chrome: nav-rgb,
// nav-line-rgb, nav-text-rgb, nav-text-active-rgb en nav-accent-rgb staan alle
// vijf in THEMABARE_TOKENS, dus een fonds dat zijn navigatie donker brandde,
// kreeg hier lichte navtekst op een licht vlak — onleesbaar, zonder dat iets
// het meldde. De chrome-tokens horen bij de chrome; dit paneel staat op een
// licht oppervlak en gebruikt daarom de neutrale tokens.
//
// Bewust rustig: geen statuskleur op elke stap en géén aandacht-indicator op de
// fasen (bewust weggehaald om de rail rustig te houden; de aandacht-afleiding
// blijft in de data bestaan voor het portfolio-overzicht). De accordeon is
// neutraal; alléén de GESELECTEERDE stap (of fase) wordt gehighlight met de
// selectie-highlight (phase-tint + teal zijlijn en omlijnde stapbadge).
// GEEN beschrijvings-/toelichtingsblokken in het linkerpaneel; die staan in de
// fase-weergave rechts. Klik op een fasekop → fase-weergave (`?fase=`); klik op
// een stap → het stapscherm (`?stap=`). Parallel-by-default.

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

// Neutrale status-pill; alleen 'afgerond' krijgt een subtiele
// tint zodat de afgeronde staat leesbaar blijft (status = woord + subtiele vorm).
const STATUS_PILL: Record<FaseStatus, string> = {
  afgerond: "bg-ok-tint text-ok-ink border border-ok/20",
  in_behandeling: "bg-app-bg text-muted border border-line",
  nog_niet_begonnen: "bg-app-bg text-muted border border-line",
  vervallen: "bg-app-bg text-muted border border-line opacity-60",
};

// Neutrale romeins-badge; de status leest af aan de afgerond-
// pill, niet aan de badgekleur.
const BADGE = "bg-app-bg text-muted border border-line";

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
          geselecteerd
            ? "bg-phase-tint shadow-[inset_3px_0_0_var(--phase)]"
            : "hover:bg-app-line/50"
        }`}
      >
        {/* Neutrale cirkel; de geselecteerde stap krijgt een teal omlijning. */}
        <div
          className={`absolute left-3 top-2.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
            geselecteerd
              ? "border border-phase bg-app-surface text-phase-ink"
              : "bg-app-bg border border-line text-muted"
          }`}
        >
          {isAfgerond ? "✓" : s.volgorde}
        </div>
        {!isLaatste && (
          <div className="absolute left-6 top-8 bottom-0 w-px bg-app-line" />
        )}
        <div className="ml-6">
          <div
            className={`text-sm ${
              geselecteerd
                ? "font-semibold text-ink"
                : isAfgerond || isActief
                  ? "text-ink"
                  : "text-muted"
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
            <div className="text-xs text-muted mt-0.5">
              {isHeropend ? "Heropend" : "Actief"}
              {s.deadline ? ` — deadline ${formatDatumKort(s.deadline)}` : ""}
            </div>
          )}
          {isGeblokkeerd && (
            <div className="text-xs text-muted mt-0.5">Wacht op eerdere stap</div>
          )}
          {s.status === "open" && s.vereist_besluit && (
            <div className="text-xs text-muted mt-0.5">
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
  // Standaard ingeklapt — het scherm opent rustig (werkopdracht). Alleen de fase
  // die rechts in fase-weergave staat, staat open. Manueel togglen blijft daarna
  // leidend.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (geselecteerdeFaseCode) s.add(geselecteerdeFaseCode);
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
        return (
          <div
            key={f.fase_code}
            className="rounded-lg overflow-hidden"
          >
            <button
              type="button"
              onClick={() => openFase(f.fase_code)}
              aria-expanded={isOpen}
              className={`w-full text-left px-2.5 py-2.5 flex items-center gap-2.5 transition-colors ${
                isGeselecteerd
                  ? "bg-phase-tint shadow-[inset_3px_0_0_var(--phase)]"
                  : "hover:bg-app-line/50"
              }`}
            >
              <span
                className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${BADGE}`}
              >
                {f.fase_code}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink leading-tight">
                  {f.titel}
                </span>
                <span className="block text-[11px] text-muted mt-0.5">
                  {f.stappen.length} stap{f.stappen.length === 1 ? "" : "pen"}
                </span>
              </span>
              {/* Alleen de afgeronde staat als pill; 'In behandeling' en de
                  aandachtsvlag laten we bewust weg voor een rustige rail. De
                  aandacht-afleiding blijft wel bestaan (portfolio-overzicht). */}
              {f.status === "afgerond" && (
                <span
                  className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap ${
                    STATUS_PILL.afgerond
                  }`}
                >
                  {FASE_STATUS_LABEL.afgerond}
                </span>
              )}
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
