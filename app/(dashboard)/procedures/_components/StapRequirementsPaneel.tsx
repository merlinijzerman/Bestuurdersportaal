// Server-component: per actieve stap zichtbaar maken welke
// procedure_requirements vervuld zijn en welke ontbreken. Per
// requirement een rij met vinkje of waarschuwingsdriehoek + bron-info.
//
// Het paneel wordt naast het bestaande ActieveStapPaneel getoond — niet
// in plaats daarvan, want dat regelt nog steeds de checklist + bewijs +
// agendapunt-koppeling.

import type {
  AIInteraction,
  EvidenceItem,
  ProcedureStep,
} from "@/core/lib/decision-view";
import AIValidatieBlok from "./AIValidatieBlok";

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

interface Props {
  decisionId: string;
  step: ProcedureStep;
  evidence: EvidenceItem[];
  aiOutputs: AIInteraction[];
}

export default function StapRequirementsPaneel({
  decisionId,
  step,
  evidence,
  aiOutputs,
}: Props) {
  const stapRequirements = evidence.filter(
    (e) => e.stap_volgorde === step.volgorde
  );
  const stapAi = aiOutputs.filter((ai) => ai.procedure_stap_id === step.id);

  if (stapRequirements.length === 0 && stapAi.length === 0) {
    return null;
  }

  const aantalVervuld = stapRequirements.filter((r) => r.vervuld).length;

  return (
    <div className="bg-white border border-line rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          Vereisten voor deze stap
        </h3>
        {stapRequirements.length > 0 && (
          <span className="text-xs text-muted">
            {aantalVervuld} van {stapRequirements.length} voldaan
          </span>
        )}
      </div>

      {stapRequirements.length > 0 ? (
        <ul className="space-y-2">
          {stapRequirements.map((r, i) => (
            <li
              key={`${r.requirement_type}-${r.label}-${i}`}
              className="flex items-start gap-3 border border-line rounded-lg px-3 py-2"
            >
              <div
                aria-hidden="true"
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold mt-px shrink-0 ${
                  r.vervuld
                    ? "bg-ok text-white"
                    : r.blokkerend
                      ? "bg-err-tint text-err-ink border border-err/30"
                      : "bg-warn-tint text-warn-ink border border-warn/30"
                }`}
              >
                {r.vervuld ? "✓" : "!"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">
                    {REQUIREMENT_LABELS[r.requirement_type] ?? r.requirement_type}
                  </span>
                  <span className="text-sm text-ink">{r.label}</span>
                </div>
                {r.bron_titel && (
                  <div
                    className={`text-xs mt-0.5 ${
                      r.vervuld ? "text-ok-ink" : "text-muted"
                    }`}
                  >
                    {r.bron_titel}
                  </div>
                )}
                {!r.vervuld && r.documenttype && (
                  <div className="text-xs text-muted mt-0.5">
                    Vereist documenttype:{" "}
                    <span className="font-mono text-ink">
                      {r.documenttype}
                    </span>
                  </div>
                )}
              </div>
              {!r.vervuld && r.blokkerend && (
                <span className="text-[10px] uppercase tracking-wide text-err-ink font-semibold shrink-0">
                  Blokkerend
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted italic">
          Geen formele vereisten gedefinieerd voor deze stap.
        </div>
      )}

      {stapAi.length > 0 && (
        <div className="pt-3 border-t border-line space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            AI-output ter validatie ({stapAi.length})
          </div>
          {stapAi.map((ai) => (
            <AIValidatieBlok key={ai.id} decisionId={decisionId} ai={ai} />
          ))}
        </div>
      )}
    </div>
  );
}
