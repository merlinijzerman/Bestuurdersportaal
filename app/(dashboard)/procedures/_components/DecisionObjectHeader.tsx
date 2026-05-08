// Server-component: Decision Object-header bovenaan de procedure-detail
// pagina. Toont besluitcode, titel-banner, status-badge en classificatie-
// pills. Geeft een korte indicatie als het dossier zojuist via auto-
// upgrade is aangemaakt.

import {
  type DecisionObject,
  DECISION_STATUS_LABEL,
  COMPLEXITEIT_LABEL,
  RISICONIVEAU_LABEL,
} from "@/lib/decision-view";

interface Props {
  decision: DecisionObject;
  autoUpgraded: boolean;
}

const STATUS_KLEUREN: Record<string, string> = {
  concept: "bg-gray-100 text-gray-700",
  in_onderbouwing: "bg-amber-50 text-amber-800",
  in_validatie: "bg-amber-50 text-amber-800",
  in_review: "bg-blue-50 text-blue-700",
  geagendeerd: "bg-blue-50 text-blue-700",
  in_bespreking: "bg-blue-50 text-blue-700",
  besloten: "bg-emerald-50 text-emerald-800",
  voorwaardelijk_besloten: "bg-emerald-50 text-emerald-800",
  in_uitvoering: "bg-emerald-50 text-emerald-800",
  in_evaluatie: "bg-purple-50 text-purple-800",
  afgesloten: "bg-gray-100 text-gray-700",
  afgewezen: "bg-rose-50 text-rose-800",
  geannuleerd: "bg-gray-100 text-gray-500",
  aangehouden: "bg-amber-50 text-amber-800",
  geescaleerd: "bg-rose-50 text-rose-800",
  teruggezet: "bg-rose-50 text-rose-800",
  heropend: "bg-amber-50 text-amber-800",
};

const RISICO_KLEUREN: Record<string, string> = {
  laag: "bg-emerald-50 text-emerald-800 border-emerald-200",
  middel: "bg-amber-50 text-amber-800 border-amber-200",
  hoog: "bg-rose-50 text-rose-800 border-rose-200",
};

export default function DecisionObjectHeader({ decision, autoUpgraded }: Props) {
  const statusKlasse =
    STATUS_KLEUREN[decision.status] ?? "bg-gray-100 text-gray-700";
  const isPlaceholder =
    decision.besluitvraag.startsWith("Aanvullen na auto-upgrade");

  return (
    <div className="bg-gradient-to-r from-[#0F2744] to-[#1a3a5e] text-white rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-[11px] font-medium uppercase tracking-wide">
            <span className="text-[#C9A84C]">{decision.besluit_code}</span>
            <span className="text-white/40">·</span>
            <span
              className={`px-2 py-0.5 rounded ${statusKlasse} text-[11px] font-medium normal-case`}
            >
              {DECISION_STATUS_LABEL[decision.status]}
            </span>
            <span className="text-white/40">·</span>
            <span className="text-white/70">Decision Object</span>
          </div>
          <div className="mt-1 text-xs text-white/70">
            {isPlaceholder ? (
              <span className="text-amber-200">
                ⚠ Besluitvraag nog aan te vullen — placeholder-tekst staat in dossier
              </span>
            ) : (
              <span className="line-clamp-2">{decision.besluitvraag}</span>
            )}
          </div>
        </div>
      </div>

      {autoUpgraded && (
        <div className="bg-amber-50/10 border border-amber-200/30 rounded-lg px-3 py-2 text-xs text-amber-100">
          <strong className="font-semibold">Net aangemaakt</strong> — dit Decision Object
          is automatisch gegenereerd op basis van de bestaande procedure. Vul de
          besluitvraag, scope en classificatie aan om het dossier compleet te maken.
        </div>
      )}

      {/* Classificatie-pills */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <span className="text-[10px] uppercase tracking-wide text-white/50 font-semibold">
          Classificatie
        </span>
        <span className="px-2 py-1 rounded text-xs font-medium bg-white/10 border border-white/20">
          {COMPLEXITEIT_LABEL[decision.complexiteit]}
        </span>
        <span
          className={`px-2 py-1 rounded text-xs font-medium border ${
            RISICO_KLEUREN[decision.risiconiveau]
          }`}
        >
          Risico {RISICONIVEAU_LABEL[decision.risiconiveau]}
        </span>
        {decision.mandaatgevoelig && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-900 border border-purple-200">
            Mandaatgevoelig
          </span>
        )}
        {decision.toezichtgevoelig && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-rose-100 text-rose-900 border border-rose-200">
            Toezichtgevoelig
          </span>
        )}
        {decision.beleidsafwijking && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-900 border border-orange-200">
            Beleidsafwijking
          </span>
        )}
        <span
          className={`px-2 py-1 rounded text-xs font-medium border ${
            RISICO_KLEUREN[decision.ai_risicoklasse]
          }`}
        >
          AI-risico {RISICONIVEAU_LABEL[decision.ai_risicoklasse]}
        </span>
      </div>
    </div>
  );
}
