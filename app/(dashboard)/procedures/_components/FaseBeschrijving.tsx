// Fasekop voor de procesfasen-rail (WO-2, §7.1) — pure presentatie.
//
// Toont per fase: fase-code + titel, een afgeleide status-pill, een
// bewijslast-dekkingsmeter en de (per fonds overschrijfbare) fasebeschrijving.
// De aandachtsstip is een orthogonaal signaal (zegt niets over voortgang).
//
// Status = kleur ÉN woord ÉN vorm (besluit 0097/0101): de pill draagt kleur +
// woord, de stip kleur + vorm, de meter kleur + waarde.

import {
  type FaseStatus,
  type AandachtNiveau,
  type Dekking,
  FASE_STATUS_LABEL,
} from "@/core/lib/procedure-fase-status";

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

interface Props {
  faseCode: string;
  titel: string;
  beschrijving: string | null;
  isOverride: boolean;
  status: FaseStatus;
  dekking: Dekking;
  aandacht: AandachtNiveau;
}

export default function FaseBeschrijving({
  faseCode,
  titel,
  beschrijving,
  isOverride,
  status,
  dekking,
  aandacht,
}: Props) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted font-bold flex items-center gap-1.5 min-w-0">
          {aandacht !== "geen" && (
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                aandacht === "rood" ? "bg-err" : "bg-warn"
              }`}
              title={
                aandacht === "rood"
                  ? "Aandacht: verplichte blokkerende bewijslast ontbreekt"
                  : "Aandacht: heropend of verplichte bewijslast ontbreekt"
              }
            />
          )}
          <span className="truncate">
            {faseCode} · {titel}
          </span>
        </div>
        <span
          className={`text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0 ${STATUS_PILL[status]}`}
        >
          {FASE_STATUS_LABEL[status]}
        </span>
      </div>

      {beschrijving && (
        <p className="text-[11px] text-muted mt-0.5 leading-snug">
          {beschrijving}
          {isOverride && (
            <span
              className="ml-1 text-[9px] uppercase tracking-wide text-phase-ink"
              title="Fondsspecifieke beschrijving (override op de generieke default)"
            >
              · fonds-variant
            </span>
          )}
        </p>
      )}

      {dekking.verplicht > 0 && (
        <div
          className="mt-1 flex items-center gap-2"
          title={`${dekking.sluitend} van ${dekking.verplicht} verplichte vereisten sluitend`}
        >
          <div className="flex-1 h-1 bg-app-bg rounded-full overflow-hidden">
            <div
              className={`h-full ${meterKleur(dekking.pct)}`}
              style={{ width: `${dekking.pct}%` }}
            />
          </div>
          <span className="text-[9px] text-muted whitespace-nowrap">
            {dekking.pct}% bewijslast
          </span>
        </div>
      )}
    </div>
  );
}
