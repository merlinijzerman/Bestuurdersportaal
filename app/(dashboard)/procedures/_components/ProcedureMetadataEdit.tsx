"use client";

// ============================================================
//  ProcedureMetadataEdit — Iteratie 3-B (2026-05-18)
//
//  Edit-modal voor procedure-titel/beschrijving/deadline met
//  verplicht motivering-veld. Modal opent vanuit een pen-icoon
//  naast de procedure-titel in de header. Bij Bewaren wordt
//  PATCH /api/procedures/[id] aangeroepen en de pagina gerefresht.
//
//  Verbergt zichzelf voor afgeronde procedures — die zijn historisch
//  en de backend weigert mutaties (consistent met §"Bekende
//  beperkingen" — afgerond = onveranderlijk).
// ============================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  procedureId: string;
  titel: string;
  beschrijving: string | null;
  deadline: string | null;
  status: string;
};

export default function ProcedureMetadataEdit({
  procedureId,
  titel,
  beschrijving,
  deadline,
  status,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [titelInput, setTitelInput] = useState(titel);
  const [beschrijvingInput, setBeschrijvingInput] = useState(beschrijving ?? "");
  const [deadlineInput, setDeadlineInput] = useState(deadline ?? "");
  const [motivering, setMotivering] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Afgeronde procedures: knop verbergen.
  if (status === "afgerond") return null;

  function reset() {
    setTitelInput(titel);
    setBeschrijvingInput(beschrijving ?? "");
    setDeadlineInput(deadline ?? "");
    setMotivering("");
    setFout(null);
  }

  function openModal() {
    reset();
    setOpen(true);
  }

  function sluit() {
    if (bezig) return;
    setOpen(false);
  }

  async function bewaar() {
    setFout(null);

    // Lichte client-side validatie zodat we niet voor een 400-fout
    // naar de server hoeven.
    if (!titelInput.trim()) {
      setFout("Titel mag niet leeg zijn");
      return;
    }
    if (motivering.trim().length < 3) {
      setFout("Geef kort aan waarom u dit wijzigt (min. 3 tekens)");
      return;
    }

    // Bouw payload: alleen velden meesturen die werkelijk veranderd zijn.
    // De backend doet hetzelfde, maar dit voorkomt onnodige log-events.
    const payload: Record<string, unknown> = { motivering: motivering.trim() };
    if (titelInput.trim() !== titel) payload.titel = titelInput.trim();
    const beschrijvingNieuw = beschrijvingInput.trim() || null;
    if (beschrijvingNieuw !== beschrijving) payload.beschrijving = beschrijvingNieuw;
    const deadlineNieuw = deadlineInput.trim() || null;
    if (deadlineNieuw !== deadline) payload.deadline = deadlineNieuw;

    // Alleen motivering meegestuurd? Niets te bewaren.
    if (Object.keys(payload).length === 1) {
      setFout("Geen wijzigingen om te bewaren");
      return;
    }

    setBezig(true);
    try {
      const res = await fetch(`/api/procedures/${procedureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Bewaren mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink border border-line hover:border-accent rounded-md px-2 py-1 transition-colors"
        aria-label="Procedure bewerken"
        title="Procedure-titel, beschrijving of deadline bewerken"
      >
        <span aria-hidden>✎</span>
        Bewerken
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-20"
          onClick={sluit}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-ink font-semibold text-lg">Procedure bewerken</h2>
              <button
                type="button"
                onClick={sluit}
                className="text-muted hover:text-ink text-xl leading-none"
                aria-label="Sluiten"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Titel
                </label>
                <input
                  type="text"
                  value={titelInput}
                  onChange={(e) => setTitelInput(e.target.value)}
                  className="w-full border border-app-line-strong rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  disabled={bezig}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Beschrijving
                </label>
                <textarea
                  value={beschrijvingInput}
                  onChange={(e) => setBeschrijvingInput(e.target.value)}
                  rows={4}
                  className="w-full border border-app-line-strong rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y"
                  placeholder="Optioneel — context, doel, scope…"
                  disabled={bezig}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Deadline (optioneel)
                </label>
                <input
                  type="date"
                  value={deadlineInput}
                  onChange={(e) => setDeadlineInput(e.target.value)}
                  className="border border-app-line-strong rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  disabled={bezig}
                />
              </div>

              <div className="pt-2 border-t border-line">
                <label className="block text-xs font-medium text-muted mb-1">
                  Motivering <span className="text-err-ink">*</span>
                </label>
                <textarea
                  value={motivering}
                  onChange={(e) => setMotivering(e.target.value)}
                  rows={2}
                  className="w-full border border-app-line-strong rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y"
                  placeholder="Waarom past u dit aan? — landt in de audit-trail."
                  disabled={bezig}
                />
              </div>

              {fout && (
                <div className="bg-err-tint border border-err/30 rounded-md p-2.5 text-xs text-err-ink">
                  {fout}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={sluit}
                disabled={bezig}
                className="text-sm text-muted hover:text-ink px-3 py-1.5 disabled:opacity-50"
              >
                Annuleer
              </button>
              <button
                type="button"
                onClick={bewaar}
                disabled={bezig}
                className="bg-accent text-white text-sm font-medium px-4 py-1.5 rounded-md hover:bg-accent-ink disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bezig ? "Bewaren…" : "Bewaar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
