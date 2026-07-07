// Client-component: Decision Object-header bovenaan de procedure-detail
// pagina. Toont besluitcode, titel-banner, klikbare status-pill en
// classificatie-pills. Klik op de status-pill scrolt naar het
// statusovergang-paneel onderaan de pagina en geeft kort een accent-puls
// als visuele bevestiging.
//
// MVP-2A: status-pill omgezet van statische <span> naar klikbare
// <button>. Functionaliteit verder ongewijzigd.

"use client";

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
  concept: "bg-app-bg text-ink",
  in_onderbouwing: "bg-warn-tint text-warn-ink",
  in_validatie: "bg-warn-tint text-warn-ink",
  in_review: "bg-accent-tint text-accent-ink",
  geagendeerd: "bg-accent-tint text-accent-ink",
  in_bespreking: "bg-accent-tint text-accent-ink",
  besloten: "bg-ok-tint text-ok-ink",
  voorwaardelijk_besloten: "bg-ok-tint text-ok-ink",
  in_uitvoering: "bg-ok-tint text-ok-ink",
  in_evaluatie: "bg-phase-tint text-phase-ink",
  afgesloten: "bg-app-bg text-ink",
  afgewezen: "bg-err-tint text-err-ink",
  geannuleerd: "bg-app-bg text-muted",
  aangehouden: "bg-warn-tint text-warn-ink",
  geescaleerd: "bg-err-tint text-err-ink",
  teruggezet: "bg-err-tint text-err-ink",
  heropend: "bg-warn-tint text-warn-ink",
};

const RISICO_KLEUREN: Record<string, string> = {
  laag: "bg-ok-tint text-ok-ink border-ok/30",
  middel: "bg-warn-tint text-warn-ink border-warn/30",
  hoog: "bg-err-tint text-err-ink border-err/30",
};

// Scrolt naar de StatusOvergangPaneel-anker en geeft een korte
// accent-puls om de gebruiker visueel te bevestigen dat we daar zijn
// beland. De anker-id "status-overgang" is gezet op de
// UitklapbaarPaneel-wrapper rond StatusOvergangPaneel in page.tsx.
function scrollNaarStatusOvergang() {
  if (typeof window === "undefined") return;
  const el = document.getElementById("status-overgang");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("status-puls");
  // Force reflow zodat de animatie opnieuw start als er al een puls liep.
  void el.offsetWidth;
  el.classList.add("status-puls");
  window.setTimeout(() => el.classList.remove("status-puls"), 1700);
}

export default function DecisionObjectHeader({ decision, autoUpgraded }: Props) {
  const statusKlasse =
    STATUS_KLEUREN[decision.status] ?? "bg-app-bg text-ink";
  const isPlaceholder =
    decision.besluitvraag.startsWith("Aanvullen na auto-upgrade");

  return (
    <div className="bg-gradient-to-r from-accent to-accent-ink text-white rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-[11px] font-medium uppercase tracking-wide">
            <span className="text-accent">{decision.besluit_code}</span>
            <span className="text-white/40">·</span>
            <button
              type="button"
              onClick={scrollNaarStatusOvergang}
              className={`px-2 py-0.5 rounded ${statusKlasse} text-[11px] font-medium normal-case hover:brightness-110 hover:ring-2 hover:ring-accent/40 transition cursor-pointer`}
              title="Klik om naar statusovergang te gaan"
              aria-label={`Status: ${DECISION_STATUS_LABEL[decision.status]} — klik voor statusovergang`}
            >
              {DECISION_STATUS_LABEL[decision.status]}
              <span className="ml-1 text-[9px] opacity-70" aria-hidden>
                ▾
              </span>
            </button>
            <span className="text-white/40">·</span>
            <span className="text-white/70">Decision Object</span>
          </div>
          <div className="mt-1 text-xs text-white/70">
            {isPlaceholder ? (
              <span className="text-warn-ink">
                ⚠ Besluitvraag nog aan te vullen — placeholder-tekst staat in dossier
              </span>
            ) : (
              <span className="line-clamp-2">{decision.besluitvraag}</span>
            )}
          </div>
        </div>
      </div>

      {autoUpgraded && (
        <div className="bg-warn-tint border border-warn/30 rounded-lg px-3 py-2 text-xs text-warn-ink">
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
          <span className="px-2 py-1 rounded text-xs font-medium bg-phase-tint text-phase-ink border border-phase/30">
            Mandaatgevoelig
          </span>
        )}
        {decision.toezichtgevoelig && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-err-tint text-err-ink border border-err/30">
            Toezichtgevoelig
          </span>
        )}
        {decision.beleidsafwijking && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-warn-tint text-warn-ink border border-warn/30">
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
