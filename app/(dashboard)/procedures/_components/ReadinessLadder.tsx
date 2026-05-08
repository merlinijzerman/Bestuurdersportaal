"use client";

// Client-component met de zes readiness-niveaus als ladder. Per niveau:
// een vinkje of waarschuwingsdriehoek, het label, en uitklapbaar de
// lijst van ontbrekende requirements (gegroepeerd op stap).

import { useState } from "react";
import {
  type ReadinessOntbrekend,
  type ReadinessOverview,
  type ReadinessTarget,
  READINESS_LABEL,
  READINESS_VOLGORDE,
} from "@/lib/decision-view";

interface Props {
  readiness: ReadinessOverview;
}

const REQUIREMENT_LABELS: Record<string, string> = {
  document: "Document",
  field: "Veld",
  assumption: "Aanname",
  risk: "Risico",
  ai_validation: "AI-validatie",
  approval: "Goedkeuring",
  mandate_check: "Mandaatcheck",
  kpi: "KPI",
  evaluation: "Evaluatie",
  dissent_review: "Dissent-review",
};

export default function ReadinessLadder({ readiness }: Props) {
  const [openTarget, setOpenTarget] = useState<ReadinessTarget | null>(null);

  // Eerste niet-voldoende readiness bepaalt waar de "actieve" cursor staat.
  const eersteOnvolledig = READINESS_VOLGORDE.find(
    (t) => !readiness[t].voldoet
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#0F2744]">
          Readiness-ladder
        </h3>
        <span className="text-xs text-gray-500">
          {eersteOnvolledig
            ? `Volgende horde: ${READINESS_LABEL[eersteOnvolledig]}`
            : "Alle niveaus voldoen"}
        </span>
      </div>

      <ol className="space-y-1">
        {READINESS_VOLGORDE.map((target, idx) => {
          const r = readiness[target];
          const isActief = target === eersteOnvolledig;
          const isOpen = openTarget === target;
          const ontbrekend = (r.ontbrekend ?? []) as ReadinessOntbrekend[];
          const isLast = idx === READINESS_VOLGORDE.length - 1;

          return (
            <li
              key={target}
              className={`relative pl-9 py-2 ${
                isActief ? "bg-amber-50/40 -mx-3 px-3 rounded-lg" : ""
              }`}
            >
              {/* Verbindingslijn */}
              {!isLast && (
                <div className="absolute left-3 top-8 bottom-0 w-px bg-gray-200" />
              )}

              {/* Status-icoon */}
              <div
                className={`absolute left-0 top-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  r.voldoet
                    ? "bg-emerald-500 text-white"
                    : isActief
                      ? "bg-[#C9A84C] text-[#0F2744] ring-4 ring-amber-100"
                      : "bg-gray-100 text-gray-400 border-2 border-gray-200"
                }`}
              >
                {r.voldoet ? "✓" : idx + 1}
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setOpenTarget(isOpen ? null : (target as ReadinessTarget))
                  }
                  className="text-left flex-1 group"
                  disabled={ontbrekend.length === 0}
                >
                  <div
                    className={`text-sm font-medium ${
                      r.voldoet
                        ? "text-gray-900"
                        : isActief
                          ? "text-[#0F2744]"
                          : "text-gray-500"
                    }`}
                  >
                    {READINESS_LABEL[target as ReadinessTarget]}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {r.voldoet
                      ? "Voldoet"
                      : `${ontbrekend.length} ontbrekend${
                          ontbrekend.length === 1 ? "" : "e items"
                        }${r.blokkerend ? " · blokkerend" : ""}`}
                  </div>
                </button>
                {ontbrekend.length > 0 && (
                  <span className="text-xs text-gray-400">
                    {isOpen ? "▴" : "▾"}
                  </span>
                )}
              </div>

              {isOpen && ontbrekend.length > 0 && (
                <ul className="mt-2 ml-1 space-y-1.5 text-xs">
                  {ontbrekend.map((o, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-gray-700 border-l-2 border-amber-200 pl-2"
                    >
                      <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mt-px shrink-0">
                        Stap {o.stap_volgorde}
                      </span>
                      <span className="flex-1">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mr-1">
                          {REQUIREMENT_LABELS[o.requirement_type] ??
                            o.requirement_type}
                        </span>
                        {o.label}
                        {o.documenttype && (
                          <span className="text-gray-500"> · {o.documenttype}</span>
                        )}
                        {!o.blokkerend && (
                          <span className="ml-1 text-[10px] text-gray-400">
                            (niet blokkerend)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-500">
        Override door voorzitter of beheerder mogelijk; iedere override wordt
        gelogd in de audit-trail.
      </div>
    </div>
  );
}
