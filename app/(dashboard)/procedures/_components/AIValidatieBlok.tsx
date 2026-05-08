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
  concept: "bg-gray-100 text-gray-700 border-gray-200",
  gevalideerd: "bg-emerald-50 text-emerald-800 border-emerald-200",
  aangepast: "bg-amber-50 text-amber-800 border-amber-200",
  afgekeurd: "bg-rose-50 text-rose-800 border-rose-200",
  gearchiveerd: "bg-gray-100 text-gray-600 border-gray-200",
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
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          {TYPE_LABEL[ai.type] ?? ai.type}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
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
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-800 border border-blue-200">
            in dossier
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto text-xs text-[#0F2744] hover:underline"
        >
          {open ? "Inklappen" : "Uitklappen"}
        </button>
      </div>

      <div className="text-sm text-gray-900 whitespace-pre-line line-clamp-3">
        {huidigeOutput}
      </div>

      {open && (
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
              Volledige output
            </summary>
            <div className="mt-2 text-sm text-gray-900 whitespace-pre-line bg-gray-50 rounded p-3">
              {huidigeOutput}
            </div>
          </details>

          {ai.bronnen && ai.bronnen.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                Bronnen ({ai.bronnen.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {ai.bronnen.map((b, i) => (
                  <li key={i} className="text-xs text-gray-700">
                    {b.titel ?? b.document_id ?? "Bron"}
                    {b.paragraaf && (
                      <span className="text-gray-500"> · {b.paragraaf}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">
              Aangepaste output (optioneel)
            </label>
            <textarea
              value={aangepast}
              onChange={(e) => setAangepast(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Vul aan met eigen woorden waar de AI niet helemaal correct was."
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">
              Gebruik in dossier (optioneel)
            </label>
            <input
              value={gebruikContext}
              onChange={(e) => setGebruikContext(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Bv. 'samenvatting voor board review' of 'input besluittekst'"
            />
          </div>
          {ai.validatiestatus === "afgekeurd" && (
            <div>
              <label className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">
                Reden van afkeuring
              </label>
              <textarea
                value={verworpenReden}
                onChange={(e) => setVerworpenReden(e.target.value)}
                rows={2}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              />
            </div>
          )}

          {fout && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
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
              className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50"
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
              className="bg-amber-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-amber-700 disabled:opacity-50"
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
              className="bg-rose-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-rose-700 disabled:opacity-50"
            >
              Afkeuren
            </button>
            <button
              type="button"
              disabled={bezig}
              onClick={() =>
                patch({ gebruikt_in_dossier: !ai.gebruikt_in_dossier })
              }
              className="bg-white text-[#0F2744] text-xs px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              {ai.gebruikt_in_dossier
                ? "Niet meer gebruiken in dossier"
                : "Gebruiken in dossier"}
            </button>
          </div>

          {ai.validatie_domein !== "algemeen" && (
            <div className="text-[11px] text-gray-500 italic">
              Domein <strong>{DOMEIN_LABEL[ai.validatie_domein]}</strong> — alleen
              voorzitter of beheerder mag valideren.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
