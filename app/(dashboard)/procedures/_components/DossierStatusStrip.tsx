"use client";

// Compacte status-strip onder de Decision Object banner. Toont in één
// regel: huidige status, eerstvolgende readiness-horde + aantal
// ontbrekende items, en een knop die naar het status-overgang-paneel
// scrolt zodat de gebruiker daar direct mee aan de slag kan.

import {
  type DecisionObject,
  type ReadinessOverview,
  type ReadinessTarget,
  DECISION_STATUS_LABEL,
  READINESS_LABEL,
  READINESS_VOLGORDE,
} from "@/lib/decision-view";
import AuditExportKnop from "./AuditExportKnop";

interface Props {
  decision: DecisionObject;
  readiness: ReadinessOverview;
  /** Anker-id van het status-overgang-paneel, voor de scroll-knop. */
  statusOvergangAnker?: string;
  /** Of er minstens één audit-snapshot is — bepaalt of de
      'snapshot besluitmoment'-optie in het exportmenu zichtbaar is. */
  heeftSnapshot?: boolean;
}

function statusKleur(status: DecisionObject["status"]): string {
  if (
    status === "besloten" ||
    status === "voorwaardelijk_besloten" ||
    status === "in_uitvoering" ||
    status === "in_evaluatie" ||
    status === "afgesloten"
  ) {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (status === "afgewezen" || status === "geannuleerd") {
    return "bg-rose-50 text-rose-800 border-rose-200";
  }
  if (
    status === "aangehouden" ||
    status === "teruggezet" ||
    status === "geescaleerd"
  ) {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  return "bg-blue-50 text-blue-800 border-blue-200";
}

export default function DossierStatusStrip({
  decision,
  readiness,
  statusOvergangAnker = "status-overgang",
  heeftSnapshot = true,
}: Props) {
  // Eerste readiness-target waaraan nog niet wordt voldaan.
  const eersteOnvolledig: ReadinessTarget | undefined =
    READINESS_VOLGORDE.find((t) => !readiness[t].voldoet);
  const ontbrekendCount = eersteOnvolledig
    ? readiness[eersteOnvolledig].ontbrekend.length
    : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
          Status
        </span>
        <span
          className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
            decision.status
          )}`}
        >
          {DECISION_STATUS_LABEL[decision.status]}
        </span>
        <span aria-hidden className="text-gray-300">
          ·
        </span>
        {eersteOnvolledig ? (
          <>
            <span className="text-xs text-gray-700">
              <span className="text-gray-500">Volgende horde:</span>{" "}
              <span className="font-medium text-[#0F2744]">
                {READINESS_LABEL[eersteOnvolledig]}
              </span>
            </span>
            {ontbrekendCount > 0 && (
              <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                {ontbrekendCount} ontbrekend
                {ontbrekendCount === 1 ? "" : "e items"}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-emerald-700 font-medium">
            Alle readiness-niveaus voldoen
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <AuditExportKnop
          decisionId={decision.id}
          heeftSnapshot={heeftSnapshot}
        />
        <a
          href={`#${statusOvergangAnker}`}
          className="text-xs font-medium text-white bg-[#0F2744] hover:bg-[#1a3a5e] px-3 py-1.5 rounded-md whitespace-nowrap"
        >
          Statusovergang →
        </a>
      </div>
    </div>
  );
}
