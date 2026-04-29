"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  risicoId: string;
}

export default function RisicoActies({ risicoId }: Props) {
  const router = useRouter();
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
      <div className="flex items-center gap-2">
        <button
          onClick={() => setToonSluiten(true)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-red-400 text-red-600"
        >
          Risico sluiten
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-red-200 rounded-xl p-4 max-w-md">
      <div className="text-sm font-semibold text-[#0F2744] mb-1">
        Risico sluiten
      </div>
      <div className="text-xs text-gray-600 mb-3">
        Geef een korte motivering. Het risico verhuist naar het archief en
        blijft daar onbeperkt raadpleegbaar.
      </div>
      <textarea
        rows={3}
        value={motivering}
        onChange={(e) => setMotivering(e.target.value)}
        placeholder="Bijv.: Maatregelen geïmplementeerd, restrisico binnen tolerantie."
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none resize-none"
      />
      {fout && (
        <div className="text-xs text-red-700 mt-2">{fout}</div>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => {
            setToonSluiten(false);
            setFout(null);
            setMotivering("");
          }}
          className="px-3 py-1.5 text-xs border border-gray-200 rounded hover:border-[#0F2744]"
        >
          Annuleren
        </button>
        <button
          onClick={risicoSluiten}
          disabled={bezig}
          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Bevestig sluiten"}
        </button>
      </div>
    </div>
  );
}
