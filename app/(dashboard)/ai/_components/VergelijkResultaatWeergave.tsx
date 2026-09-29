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
  VergelijkJuridischeDuiding,
  VergelijkMethode,
  VergelijkResultaat,
  VergelijkZijdeRol,
  VerschilTypeRuw,
} from "@/core/lib/vergelijk-types";
import { formatteerDossiernummer, WETTELIJK_REGIME_LABEL, isWettelijkRegime } from "@/core/lib/wetsgeschiedenis";

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
  rol,
  value,
  evidence,
  page,
}: {
  titel: string;
  rol?: VergelijkZijdeRol;
  value: string | null;
  evidence: string | null;
  page: number | null;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{titel}</div>
      {rol && <div className="mt-0.5 text-xs text-muted">{rol.label}</div>}
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
  juridisch,
  onReageer,
}: {
  finding: Finding;
  label: string;
  juridisch?: VergelijkJuridischeDuiding;
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
        <Zijde titel="Bron" rol={juridisch?.bron} value={finding.bron.value} evidence={finding.bron.evidence} page={finding.bron.page} />
        <div className="hidden w-px self-stretch bg-line sm:block" aria-hidden />
        <Zijde titel="Doel" rol={juridisch?.doel} value={finding.doel.value} evidence={finding.doel.evidence} page={finding.doel.page} />
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

// V-1 — servergeschreven juridische kop per document, vóór de bevindingen. De
// component leidt zelf niets af: rol, label en duiding komen kant-en-klaar uit
// de service (geen vergelijk- of juridische logica in de UI).
function metaRegel(z: VergelijkZijdeRol): string {
  const delen: string[] = [];
  if (z.dossiernummer) delen.push(`Kamerstuk ${formatteerDossiernummer(z.dossiernummer)}`);
  if (z.documentdatum) delen.push(z.documentdatum);
  if (z.wettelijk_regime && isWettelijkRegime(z.wettelijk_regime)) delen.push(WETTELIJK_REGIME_LABEL[z.wettelijk_regime]);
  if (z.normgewicht) delen.push(`normgewicht: ${z.normgewicht}`);
  return delen.join(" · ");
}

function JuridischeKop({ duiding }: { duiding: VergelijkJuridischeDuiding }) {
  const zijden = [["Bron", duiding.bron], ["Doel", duiding.doel]] as const;
  return (
    <div className="mb-3 rounded-lg border border-line bg-card p-3" data-testid="vergelijk-juridische-kop">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        {zijden.map(([naam, z]) => (
          <div key={naam} className="flex-1 min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">{naam}</div>
            <div className="mt-1 text-sm font-semibold text-ink break-words">{z.label}</div>
            {z.titel && <div className="mt-0.5 text-xs text-muted break-words">{z.titel}</div>}
            {metaRegel(z) && <div className="mt-0.5 text-xs text-muted">{metaRegel(z)}</div>}
          </div>
        ))}
      </div>
      <p className="mt-2 border-t border-line pt-2 text-xs leading-snug text-ink">{duiding.toelichting}</p>
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

      {resultaat.juridische_duiding && <JuridischeKop duiding={resultaat.juridische_duiding} />}

      {findings.length === 0 ? (
        <p className="text-sm text-muted">
          Geen vergelijkbare waarden aangetroffen op de onderzochte dimensies.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {findings.map((f) => (
            <FindingKaart
              key={f.finding_key}
              finding={f}
              label={labelVoor(f.dimensie)}
              juridisch={resultaat.juridische_duiding}
              onReageer={onReageer}
            />
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
