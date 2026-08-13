"use client";

// ============================================================================
//  VergelijkResultaatWeergave — de gedeelde resultaat-component van T5.
// ----------------------------------------------------------------------------
//  Rendert een VergelijkResultaat side-by-side per dimensie, met evidence-links en
//  een reflectie-hook per finding (T10). BEVAT GEEN vergelijk-logica: de service
//  levert de findings kant-en-klaar; deze component toont ze alleen. Zo blijft de
//  service-grens intact (acceptatiecriterium: geen vergelijk-logica in de UI).
//
//  GRENS (T5): toont uitsluitend RUWE verschillen. Geen materialiteits-/bestuurlijk
//  oordeel (dat is T9). Een expliciete voetregel maakt de reikwijdte zichtbaar:
//  alleen de getoonde dimensies zijn vergeleken (geen volledigheidsclaim).
//
//  Styling via de semantische designtokens (ink/muted/line, card/app-surface, ok/
//  warn) — geen rauwe Tailwind-kleuren.
// ============================================================================

import type {
  Finding,
  VergelijkMethode,
  VergelijkResultaat,
  VerschilTypeRuw,
} from "@/core/lib/vergelijk-types";

const VERSCHIL_LABEL: Record<VerschilTypeRuw, string> = {
  gelijk: "Gelijk",
  verschilt: "Verschilt",
  alleen_bron: "Alleen in bron",
  alleen_doel: "Alleen in doel",
};

const VERSCHIL_KLEUR: Record<VerschilTypeRuw, string> = {
  gelijk: "bg-ok-tint text-ok-ink border-ok/30",
  verschilt: "bg-warn-tint text-warn-ink border-warn/30",
  alleen_bron: "bg-app-surface text-muted border-line",
  alleen_doel: "bg-app-surface text-muted border-line",
};

const METHODE_LABEL: Record<VergelijkMethode, string> = {
  deterministisch: "deterministisch",
  llm: "AI-vergelijking",
};

function Zijde({
  titel,
  value,
  evidence,
  page,
}: {
  titel: string;
  value: string | null;
  evidence: string | null;
  page: number | null;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{titel}</div>
      <div className="mt-1 text-sm font-semibold text-ink break-words">
        {value ?? <span className="font-normal italic text-muted">niet aangetroffen</span>}
      </div>
      {evidence && (
        <blockquote className="mt-1.5 border-l-2 border-line pl-2 text-xs leading-snug text-muted">
          “{evidence}”
          {page != null && <span className="ml-1 whitespace-nowrap text-muted">— p. {page}</span>}
        </blockquote>
      )}
    </div>
  );
}

function FindingKaart({
  finding,
  label,
  onReageer,
}: {
  finding: Finding;
  label: string;
  onReageer?: (finding: Finding) => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${VERSCHIL_KLEUR[finding.verschil_type_ruw]}`}
        >
          {VERSCHIL_LABEL[finding.verschil_type_ruw]}
        </span>
        <span className="rounded-full border border-line bg-app-surface px-2 py-0.5 text-xs text-muted">
          {METHODE_LABEL[finding.method]}
        </span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <Zijde titel="Bron" value={finding.bron.value} evidence={finding.bron.evidence} page={finding.bron.page} />
        <div className="hidden w-px self-stretch bg-line sm:block" aria-hidden />
        <Zijde titel="Doel" value={finding.doel.value} evidence={finding.doel.evidence} page={finding.doel.page} />
      </div>
      {onReageer && (
        // T10-hook: de bestuurder reageert per finding (oordeel volgt in T10). T5
        // levert alleen de ingang; het opslaan van het oordeel is buiten scope.
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => onReageer(finding)}
            className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Reageer op deze bevinding
          </button>
        </div>
      )}
    </div>
  );
}

export default function VergelijkResultaatWeergave({
  resultaat,
  onReageer,
}: {
  resultaat: VergelijkResultaat;
  onReageer?: (finding: Finding) => void;
}) {
  const { findings, dimensies } = resultaat;
  // Label per dimensie-key (val terug op de key als er geen dimensie-record is).
  const labelVoor = (key: string) => dimensies.find((d) => d.key === key)?.label ?? key;

  return (
    <div className="rounded-xl border border-line bg-app-surface p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Vergelijking per dimensie</h3>
        <span className="text-xs text-muted">
          {findings.length} bevinding{findings.length === 1 ? "" : "en"}
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="text-sm text-muted">
          Geen vergelijkbare waarden aangetroffen op de onderzochte dimensies.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {findings.map((f) => (
            <FindingKaart key={f.finding_key} finding={f} label={labelVoor(f.dimensie)} onReageer={onReageer} />
          ))}
        </div>
      )}

      {/* Reikwijdte-voetregel: expliciete grens (geen volledigheids-/materialiteitsclaim). */}
      <p className="mt-3 border-t border-line pt-2 text-xs leading-snug text-muted">
        Vergeleken dimensies: {dimensies.map((d) => d.label).join(", ") || "geen"}. Dit overzicht toont
        alleen feitelijke verschillen op deze dimensies — geen weging of oordeel over de betekenis ervan.
      </p>
    </div>
  );
}
