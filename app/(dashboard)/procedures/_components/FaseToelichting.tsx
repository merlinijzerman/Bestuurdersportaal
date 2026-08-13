"use client";

// Per-proces fase-toelichting (WO-2-vervolg). Zichtbaar bij het uitklappen van
// een fase, náást de gedeelde D8-fasebeschrijving. Bewerkbaar door
// voorzitter/beheerder (kanBeheren) — de harde gate zit server-side in
// app/api/procedures/[id]/fase-toelichting/route.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  procedureId: string;
  faseCode: string;
  initieel: string | null;
  kanBeheren: boolean;
}

export default function FaseToelichting({
  procedureId,
  faseCode,
  initieel,
  kanBeheren,
}: Props) {
  const router = useRouter();
  const [bewerken, setBewerken] = useState(false);
  const [tekst, setTekst] = useState(initieel ?? "");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Niets te tonen én niets te bewerken → render niets (voorkomt lege blokjes).
  if (!initieel && !kanBeheren && !bewerken) return null;

  async function opslaan() {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/fase-toelichting`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fase_code: faseCode,
            toelichting: tekst.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Opslaan mislukt");
      }
      setBewerken(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  if (bewerken) {
    return (
      <div className="rounded-lg bg-app-bg/60 border border-line px-3 py-2 space-y-2">
        <label className="block text-[9px] uppercase tracking-wide text-muted font-semibold">
          Toelichting dit proces
        </label>
        <textarea
          rows={3}
          maxLength={4000}
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          placeholder="Wat speelt er in dit traject bij deze fase?"
          className="w-full border border-line rounded px-2 py-1.5 text-xs bg-white focus:border-accent outline-none resize-none"
        />
        {fout && <div className="text-[11px] text-err-ink">{fout}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setBewerken(false);
              setTekst(initieel ?? "");
              setFout(null);
            }}
            className="text-[11px] px-2.5 py-1 border border-line rounded hover:border-accent bg-white"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={opslaan}
            disabled={bezig}
            className="text-[11px] px-2.5 py-1 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
          >
            {bezig ? "Bezig…" : "Opslaan"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-app-bg/60 border border-line px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-ink whitespace-pre-line flex-1 min-w-0">
          <span className="uppercase tracking-wide text-[9px] text-muted font-semibold block mb-0.5">
            Toelichting dit proces
          </span>
          {initieel ? (
            initieel
          ) : (
            <span className="text-muted italic">
              Nog geen toelichting voor dit proces.
            </span>
          )}
        </div>
        {kanBeheren && (
          <button
            type="button"
            onClick={() => {
              setTekst(initieel ?? "");
              setBewerken(true);
            }}
            className="text-[11px] text-accent hover:underline flex-shrink-0"
          >
            {initieel ? "Bewerk" : "+ Toelichting"}
          </button>
        )}
      </div>
    </div>
  );
}
