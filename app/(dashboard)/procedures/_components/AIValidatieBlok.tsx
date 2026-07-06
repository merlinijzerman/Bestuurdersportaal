"use client";

// Client-component voor één AI-output. Toont prompt, output, bronnen en
// de huidige validatiestatus, met knoppen om te valideren / aanpassen /
// afkeuren / als gebruikt-in-dossier te markeren. Roept
// PATCH /api/decisions/[id]/ai-interactions/[aiid] aan.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AIInteraction,
  AIValidatieDomein,
} from "@/lib/decision-view";

interface Props {
  decisionId: string;
  ai: AIInteraction;
}

const STATUS_KLEUREN: Record<string, string> = {
  concept: "bg-app-bg text-ink border-line",
  gevalideerd: "bg-ok-tint text-ok-ink border-ok/30",
  aangepast: "bg-warn-tint text-warn-ink border-warn/30",
  afgekeurd: "bg-err-tint text-err-ink border-err/30",
  gearchiveerd: "bg-app-bg text-muted border-line",
};

const DOMEIN_LABEL: Record<AIValidatieDomein, string> = {
  algemeen: "Algemeen",
  risk: "Risk",
  compliance: "Compliance",
  beleggingen: "Beleggingen",
  governance: "Governance",
};

const TYPE_LABEL: Record<string, string> = {
  samenvatting: "Samenvatting",
  aannamedetectie: "Aannamedetectie",
  scenario: "Scenario",
  kritische_vraag: "Kritische vraag",
  vergelijking: "Vergelijking",
};

export default function AIValidatieBlok({ decisionId, ai }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [aangepast, setAangepast] = useState(ai.aangepaste_output ?? "");
  const [gebruikContext, setGebruikContext] = useState(ai.gebruik_context ?? "");
  const [verworpenReden, setVerworpenReden] = useState(ai.verworpen_reden ?? "");

  async function patch(payload: Record<string, unknown>) {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(
        `/api/decisions/${decisionId}/ai-interactions/${ai.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Mislukt");
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(false);
    }
  }

  const huidigeOutput = ai.aangepaste_output || ai.output;

  return (
    <div className="border border-line rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">
          {TYPE_LABEL[ai.type] ?? ai.type}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          domein: {DOMEIN_LABEL[ai.validatie_domein]}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
            STATUS_KLEUREN[ai.validatiestatus]
          }`}
        >
          {ai.validatiestatus}
        </span>
        {ai.gebruikt_in_dossier && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-accent-tint text-accent-ink border border-accent/30">
            in dossier
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto text-xs text-ink hover:underline"
        >
          {open ? "Inklappen" : "Uitklappen"}
        </button>
      </div>

      <div className="text-sm text-ink whitespace-pre-line line-clamp-3">
        {huidigeOutput}
      </div>

      {open && (
        <div className="space-y-3 pt-2 border-t border-line">
          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-ink">
              Volledige output
            </summary>
            <div className="mt-2 text-sm text-ink whitespace-pre-line bg-app-bg rounded p-3">
              {huidigeOutput}
            </div>
          </details>

          {ai.bronnen && ai.bronnen.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted hover:text-ink">
                Bronnen ({ai.bronnen.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {ai.bronnen.map((b, i) => (
                  <li key={i} className="text-xs text-ink">
                    {b.titel ?? b.document_id ?? "Bron"}
                    {b.paragraaf && (
                      <span className="text-muted"> · {b.paragraaf}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted font-semibold block mb-1">
              Aangepaste output (optioneel)
            </label>
            <textarea
              value={aangepast}
              onChange={(e) => setAangepast(e.target.value)}
              rows={3}
              className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Vul aan met eigen woorden waar de AI niet helemaal correct was."
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted font-semibold block mb-1">
              Gebruik in dossier (optioneel)
            </label>
            <input
              value={gebruikContext}
              onChange={(e) => setGebruikContext(e.target.value)}
              className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Bv. 'samenvatting voor board review' of 'input besluittekst'"
            />
          </div>
          {ai.validatiestatus === "afgekeurd" && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted font-semibold block mb-1">
                Reden van afkeuring
              </label>
              <textarea
                value={verworpenReden}
                onChange={(e) => setVerworpenReden(e.target.value)}
                rows={2}
                className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          )}

          {fout && (
            <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded-md px-3 py-2">
              {fout}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={bezig}
              onClick={() =>
                patch({
                  validatiestatus: "gevalideerd",
                  aangepaste_output: aangepast || null,
                  gebruik_context: gebruikContext || null,
                })
              }
              className="bg-ok text-white text-xs px-3 py-1.5 rounded-md hover:bg-ok disabled:opacity-50"
            >
              Valideren
            </button>
            <button
              type="button"
              disabled={bezig || !aangepast.trim()}
              onClick={() =>
                patch({
                  validatiestatus: "aangepast",
                  aangepaste_output: aangepast,
                  gebruik_context: gebruikContext || null,
                })
              }
              title={!aangepast.trim() ? "Vul eerst aangepaste output in" : ""}
              className="bg-warn text-white text-xs px-3 py-1.5 rounded-md hover:bg-warn disabled:opacity-50"
            >
              Aangepast bewaren
            </button>
            <button
              type="button"
              disabled={bezig}
              onClick={() =>
                patch({
                  validatiestatus: "afgekeurd",
                  verworpen_reden: verworpenReden || null,
                })
              }
              className="bg-err text-white text-xs px-3 py-1.5 rounded-md hover:bg-err disabled:opacity-50"
            >
              Afkeuren
            </button>
            <button
              type="button"
              disabled={bezig}
              onClick={() =>
                patch({ gebruikt_in_dossier: !ai.gebruikt_in_dossier })
              }
              className="bg-white text-ink text-xs px-3 py-1.5 rounded-md border border-app-line-strong hover:bg-app-bg disabled:opacity-50"
            >
              {ai.gebruikt_in_dossier
                ? "Niet meer gebruiken in dossier"
                : "Gebruiken in dossier"}
            </button>
          </div>

          {ai.validatie_domein !== "algemeen" && (
            <div className="text-[11px] text-muted italic">
              Domein <strong>{DOMEIN_LABEL[ai.validatie_domein]}</strong> — alleen
              voorzitter of beheerder mag valideren.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
