"use client";

// WO-2 (D7 / §5.2) — affordance "bewijslasttype toevoegen" op een lopende
// stap. Een bevoegde rol (voorzitter/beheerder) voegt een instantie-vereiste
// toe die meetelt in de readiness (unie template + instantie, D7c).
//
// ⚠ Dit is UI. De harde autorisatie zit server-side in
// app/api/procedures/[id]/requirements/route.ts (rol-check + governance-event).
// De component rendert niets als de gebruiker de capability mist — puur om de
// affordance niet te tonen, niet als beveiliging.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REQUIREMENT_TYPES } from "@/core/lib/procedure-definitie";

// Labels voor de 12 requirement-types (D7a). Bewust hier expliciet — de andere
// labelmaps (StapRequirementsPaneel/ReadinessLadder) dekken external_submission
// en consultation nog niet.
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
  external_submission: "Externe indiening (DNB/AFM)",
  consultation: "Consultatie",
};

interface Props {
  procedureId: string;
  stapVolgorde: number;
  /** Alleen voorzitter/beheerder. UI-signaal; server gate blijft leidend. */
  kanBeheren: boolean;
}

export default function VereisteToevoegen({
  procedureId,
  stapVolgorde,
  kanBeheren,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("document");
  const [label, setLabel] = useState("");
  const [documenttype, setDocumenttype] = useState("");
  const [verplicht, setVerplicht] = useState(true);
  const [blokkerend, setBlokkerend] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  if (!kanBeheren) return null;

  async function toevoegen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    const omschrijving = label.trim();
    if (!omschrijving) {
      setFout("Omschrijving is verplicht.");
      return;
    }
    setBezig(true);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/requirements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stap_volgorde: stapVolgorde,
            requirement_type: type,
            label: omschrijving,
            documenttype: documenttype.trim() || null,
            verplicht,
            blokkerend,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Toevoegen mislukt");
      }
      setLabel("");
      setDocumenttype("");
      setType("document");
      setVerplicht(true);
      setBlokkerend(false);
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setBezig(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink hover:underline"
      >
        + Bewijslasttype toevoegen
      </button>
    );
  }

  return (
    <form
      onSubmit={toevoegen}
      className="p-3 border border-accent/40 bg-accent-tint rounded-lg space-y-2"
    >
      <div className="text-xs uppercase tracking-wide text-muted font-semibold">
        Nieuw bewijslasttype toevoegen
      </div>
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
      >
        {REQUIREMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {REQUIREMENT_LABELS[t] ?? t}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Omschrijving, bv. 'Compensatie-onderbouwing'"
        className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
      />
      <input
        type="text"
        value={documenttype}
        onChange={(e) => setDocumenttype(e.target.value)}
        placeholder="Documenttype-tag (optioneel, bv. ALM_analyse)"
        className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
      />
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={verplicht}
            onChange={(e) => setVerplicht(e.target.checked)}
            className="accent-accent w-4 h-4 rounded"
          />
          Verplicht
        </label>
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={blokkerend}
            onChange={(e) => setBlokkerend(e.target.checked)}
            className="accent-accent w-4 h-4 rounded"
          />
          Blokkerend
        </label>
      </div>
      <p className="text-[11px] text-muted">
        Toevoegen is voorbehouden aan beheerder of voorzitter; elke wijziging
        wordt gelogd in de audit-trail. Een blokkerende vereiste kan later alleen
        met motivering worden overschreven.
      </p>
      {fout && (
        <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded px-2 py-1.5">
          {fout}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFout(null);
          }}
          className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent bg-white"
        >
          Annuleren
        </button>
        <button
          type="submit"
          disabled={bezig}
          className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Toevoegen"}
        </button>
      </div>
    </form>
  );
}
