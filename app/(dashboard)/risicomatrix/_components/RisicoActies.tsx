"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import RisicoEditModal, { type RisicoBewerkbaar } from "./RisicoEditModal";

interface Props {
  risicoId: string;
  /** Besluit 0145 — de huidige waarden, voor de bewerkmodal. */
  risico: RisicoBewerkbaar;
}

export default function RisicoActies({ risicoId, risico }: Props) {
  const router = useRouter();
  const [toonBewerken, setToonBewerken] = useState(false);
  const [toonSluiten, setToonSluiten] = useState(false);
  const [motivering, setMotivering] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function risicoSluiten() {
    if (!motivering.trim()) {
      setFout("Motivering is verplicht bij sluiten.");
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/risicos/${risicoId}/sluiten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivering: motivering.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Sluiten mislukt");
      }
      router.push("/risicomatrix/archief");
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Sluiten mislukt");
      setBezig(false);
    }
  }

  if (!toonSluiten) {
    return (
      <>
        <div className="flex items-center gap-2">
          {/* Besluit 0145 — tot dan kon een risico alleen worden aangemaakt en
              gesloten. Een verkeerd ingeschatte kans was daarmee onherstelbaar:
              sluiten en opnieuw aanmaken knipt de geschiedenis in tweeën. */}
          <button
            onClick={() => setToonBewerken(true)}
            className="px-3 py-2 text-sm border border-app-line-control rounded-lg hover:border-accent text-accent-ink font-semibold"
          >
            Bewerken
          </button>
          <button
            onClick={() => setToonSluiten(true)}
            className="px-3 py-2 text-sm border border-line rounded-lg hover:border-err/30 text-err-ink"
          >
            Risico sluiten
          </button>
        </div>
        {toonBewerken && (
          <RisicoEditModal risico={risico} onSluiten={() => setToonBewerken(false)} />
        )}
      </>
    );
  }

  return (
    <div className="bg-white border border-err/30 rounded-xl p-4 max-w-md">
      <div className="text-sm font-semibold text-ink mb-1">
        Risico sluiten
      </div>
      <div className="text-xs text-muted mb-3">
        Geef een korte motivering. Het risico verhuist naar het archief en
        blijft daar onbeperkt raadpleegbaar.
      </div>
      <textarea
        rows={3}
        value={motivering}
        onChange={(e) => setMotivering(e.target.value)}
        placeholder="Bijv.: Maatregelen geïmplementeerd, restrisico binnen tolerantie."
        className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:border-accent outline-none resize-none"
      />
      {fout && (
        <div className="text-xs text-err-ink mt-2">{fout}</div>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => {
            setToonSluiten(false);
            setFout(null);
            setMotivering("");
          }}
          className="px-3 py-1.5 text-xs border border-line rounded hover:border-accent"
        >
          Annuleren
        </button>
        <button
          onClick={risicoSluiten}
          disabled={bezig}
          className="px-3 py-1.5 text-xs bg-err text-white rounded hover:bg-err disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Bevestig sluiten"}
        </button>
      </div>
    </div>
  );
}
