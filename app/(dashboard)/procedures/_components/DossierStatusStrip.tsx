"use client";

// Compacte status-strip. Regel 1: huidige status, de openstaande vereisten boven
// optioneel (per zwaarte — de besluitmoment-telling die de readiness-horde
// vervangt, §7/0187), en knoppen (export + statusovergang). Regel 2: een compacte
// classificatie-strook + een eventuele "besluitvraag nog aan te vullen"-nudge.

import {
  type DecisionObject,
  type EvidenceItem,
  DECISION_STATUS_LABEL,
  COMPLEXITEIT_LABEL,
  RISICONIVEAU_LABEL,
} from "@/core/lib/decision-view";
import { besluitmomentSignaal } from "@/core/lib/besluitmoment-telling";
import AuditExportKnop from "./AuditExportKnop";

interface Props {
  decision: DecisionObject;
  /** De evidence-lijst; hieruit komt de besluitmoment-telling (open per zwaarte). */
  evidence: EvidenceItem[];
  /** Volgordes van de besluitmoment-stappen (`vereist_besluit`) — de signalering is
   *  besluitmoment-scoped, niet dossierbreed (Q1, besluit 0193). */
  besluitmomentStappen: number[];
  /** Signaal 3 (§12): dit besluit is genomen terwijl er vereisten openstonden.
   *  Afgeleid uit het append-only besluit_genomen_met_openstaande_vereisten-event;
   *  null = niet van toepassing. */
  beslotenMetOpenstaand?: { actorNaam: string | null; actorRol: string | null } | null;
  /** Anker-id van het status-overgang-paneel, voor de scroll-knop. */
  statusOvergangAnker?: string;
  /** Of er minstens één audit-snapshot is — bepaalt of de
      'snapshot besluitmoment'-optie in het exportmenu zichtbaar is. */
  heeftSnapshot?: boolean;
}

const RISICO_KLEUREN: Record<string, string> = {
  laag: "bg-ok-tint text-ok-ink border-ok/30",
  middel: "bg-warn-tint text-warn-ink border-warn/30",
  hoog: "bg-err-tint text-err-ink border-err/30",
};

function statusKleur(status: DecisionObject["status"]): string {
  if (
    status === "besloten" ||
    status === "voorwaardelijk_besloten" ||
    status === "in_uitvoering" ||
    status === "in_evaluatie" ||
    status === "afgesloten"
  ) {
    return "bg-ok-tint text-ok-ink border-ok/30";
  }
  if (status === "afgewezen" || status === "geannuleerd") {
    return "bg-err-tint text-err-ink border-err/30";
  }
  if (
    status === "aangehouden" ||
    status === "teruggezet" ||
    status === "geescaleerd"
  ) {
    return "bg-warn-tint text-warn-ink border-warn/30";
  }
  return "bg-accent-tint text-accent-ink border-accent/30";
}

export default function DossierStatusStrip({
  decision,
  evidence,
  besluitmomentStappen,
  beslotenMetOpenstaand = null,
  statusOvergangAnker = "status-overgang",
  heeftSnapshot = true,
}: Props) {
  // Besluitmoment-signaal (§7 r434): drieweg zodat een leeg besluitmoment niet als
  // vals groen leest. `geen-vereisten` ≠ `alle-vervuld` (Q1, besluit 0193).
  const signaal = besluitmomentSignaal(evidence, besluitmomentStappen);
  const isPlaceholder = decision.besluitvraag.startsWith(
    "Aanvullen na auto-upgrade"
  );

  return (
    <div className="bg-white border border-line rounded-xl px-5 py-3 space-y-2">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            Status
          </span>
          <span
            className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
              decision.status
            )}`}
          >
            {DECISION_STATUS_LABEL[decision.status]}
          </span>
          <span aria-hidden className="text-muted">
            ·
          </span>
          {signaal.soort === "open" ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted">Besluitmoment:</span>
              {signaal.open.kritiek.length > 0 && (
                <span className="text-[11px] text-err-ink bg-err-tint border border-err/30 px-2 py-0.5 rounded">
                  {signaal.open.kritiek.length} kritiek
                </span>
              )}
              {signaal.open.vereist.length > 0 && (
                <span className="text-[11px] text-warn-ink bg-warn-tint border border-warn/30 px-2 py-0.5 rounded">
                  {signaal.open.vereist.length} vereist
                </span>
              )}
              {signaal.open.kritiek.length === 0 &&
                signaal.open.vereist.length === 0 && (
                  <span className="text-[11px] text-muted bg-app-bg border border-line px-2 py-0.5 rounded">
                    {signaal.open.optioneel.length} optioneel
                  </span>
                )}
            </span>
          ) : signaal.soort === "alle-vervuld" ? (
            <span className="text-xs text-ok-ink font-medium">
              Alle vereisten voor dit besluitmoment zijn vervuld
            </span>
          ) : (
            // geen-vereisten: bewust NEUTRAAL, geen groen vinkje (§7 r434) — niets
            // gekoppeld is niet hetzelfde als "alles rond".
            <span className="text-xs text-muted">
              Aan dit besluitmoment zijn geen vereisten gekoppeld
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AuditExportKnop
            decisionId={decision.id}
            heeftSnapshot={heeftSnapshot}
            afschriftAnker="afschriften"
          />
          <a
            href={`#${statusOvergangAnker}`}
            className="text-xs font-medium text-white bg-accent hover:bg-accent-ink px-3 py-1.5 rounded-md whitespace-nowrap"
          >
            Statusovergang →
          </a>
        </div>
      </div>

      {/* Signaal 3 (§12): dit besluit is genomen terwijl er vereisten openstonden.
          Bij een brede bevoegdheid (elke decisions.manage-houder mag, mits motivering)
          is zichtbaarheid achteraf het tegenwicht dat vooraf ontbreekt (Q2, 0193). */}
      {beslotenMetOpenstaand && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line">
          <span className="text-[11px] text-warn-ink bg-warn-tint border border-warn/30 px-2 py-0.5 rounded font-medium">
            ⚠ Besloten met openstaande vereisten
          </span>
          <span className="text-[11px] text-muted">
            vastgelegd
            {beslotenMetOpenstaand.actorNaam ? ` door ${beslotenMetOpenstaand.actorNaam}` : ""}
            {beslotenMetOpenstaand.actorRol ? ` (${beslotenMetOpenstaand.actorRol})` : ""}
            {" "}— zie het dossier voor de motivering
          </span>
        </div>
      )}

      {/* Compacte classificatie + evt. nudge (verplaatst uit de verwijderde
          Decision Object-header, zodat deze sturing zichtbaar blijft). */}
      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line">
        <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">
          Classificatie
        </span>
        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-app-bg border border-line text-ink">
          {COMPLEXITEIT_LABEL[decision.complexiteit]}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
            RISICO_KLEUREN[decision.risiconiveau]
          }`}
        >
          Risico {RISICONIVEAU_LABEL[decision.risiconiveau]}
        </span>
        {decision.mandaatgevoelig && (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-phase-tint text-phase-ink border border-phase/30">
            Mandaatgevoelig
          </span>
        )}
        {decision.toezichtgevoelig && (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-err-tint text-err-ink border border-err/30">
            Toezichtgevoelig
          </span>
        )}
        {decision.beleidsafwijking && (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-warn-tint text-warn-ink border border-warn/30">
            Beleidsafwijking
          </span>
        )}
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
            RISICO_KLEUREN[decision.ai_risicoklasse]
          }`}
        >
          AI-risico {RISICONIVEAU_LABEL[decision.ai_risicoklasse]}
        </span>
        {isPlaceholder && (
          <span className="ml-auto text-[11px] text-warn-ink bg-warn-tint border border-warn/30 px-2 py-0.5 rounded font-medium">
            ⚠ Besluitvraag nog aan te vullen
          </span>
        )}
      </div>
    </div>
  );
}
