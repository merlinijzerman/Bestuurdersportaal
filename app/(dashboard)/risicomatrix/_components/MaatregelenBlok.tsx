"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MaatregelStatus,
  MAATREGEL_STATUS_LABEL,
} from "@/lib/risico-config";

export interface MaatregelDTO {
  id: string;
  beschrijving: string;
  status: MaatregelStatus;
  verantwoordelijke: string | null;
  volgorde: number;
  aangemaakt: string;
}

interface Props {
  risicoId: string;
  initieel: MaatregelDTO[];
  readonly?: boolean;
}

const STATUS_KLEUR: Record<
  MaatregelStatus,
  { dot: string; pillBg: string; pillText: string; border: string; bg: string }
> = {
  genomen: {
    dot: "text-emerald-600",
    pillBg: "bg-emerald-100",
    pillText: "text-emerald-800",
    border: "border-emerald-200",
    bg: "bg-emerald-50/30",
  },
  in_voorbereiding: {
    dot: "text-amber-600",
    pillBg: "bg-amber-100",
    pillText: "text-amber-800",
    border: "border-amber-200",
    bg: "bg-amber-50/30",
  },
  open: {
    dot: "text-gray-400",
    pillBg: "bg-gray-100",
    pillText: "text-gray-700",
    border: "border-gray-200",
    bg: "bg-white",
  },
};

const STATUS_ICOON: Record<MaatregelStatus, string> = {
  genomen: "✓",
  in_voorbereiding: "○",
  open: "○",
};

export default function MaatregelenBlok({
  risicoId,
  initieel,
  readonly,
}: Props) {
  const router = useRouter();
  const [maatregelen, setMaatregelen] = useState<MaatregelDTO[]>(initieel);
  const [toonForm, setToonForm] = useState(false);
  const [beschrijving, setBeschrijving] = useState("");
  const [verantwoordelijke, setVerantwoordelijke] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function maatregelToevoegen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    if (!beschrijving.trim()) {
      setFout("Beschrijving is verplicht.");
      return;
    }
    setBezig(true);
    try {
      const res = await fetch(`/api/risicos/${risicoId}/maatregelen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beschrijving: beschrijving.trim(),
          verantwoordelijke: verantwoordelijke.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Toevoegen mislukt");
      }
      const data = await res.json();
      setMaatregelen([...maatregelen, data.maatregel as MaatregelDTO]);
      setBeschrijving("");
      setVerantwoordelijke("");
      setToonForm(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function statusWijzigen(maatregelId: string, nieuwe: MaatregelStatus) {
    const oude = maatregelen.find((m) => m.id === maatregelId);
    if (!oude || oude.status === nieuwe) return;

    // Optimistic update
    setMaatregelen((huidig) =>
      huidig.map((m) => (m.id === maatregelId ? { ...m, status: nieuwe } : m))
    );

    try {
      const res = await fetch(
        `/api/risicos/${risicoId}/maatregelen/${maatregelId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nieuwe }),
        }
      );
      if (!res.ok) throw new Error("Wijzigen mislukt");
      router.refresh();
    } catch {
      // Rollback bij fout
      setMaatregelen((huidig) =>
        huidig.map((m) =>
          m.id === maatregelId ? { ...m, status: oude.status } : m
        )
      );
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#0F2744]">
          Getroffen maatregelen
        </h3>
        {!readonly && (
          <button
            onClick={() => setToonForm(!toonForm)}
            className="text-xs text-[#0F2744] hover:underline"
          >
            {toonForm ? "Annuleren" : "+ Maatregel toevoegen"}
          </button>
        )}
      </div>

      {toonForm && !readonly && (
        <form
          onSubmit={maatregelToevoegen}
          className="mb-3 p-3 border border-gray-200 rounded-lg bg-gray-50 space-y-2"
        >
          <input
            type="text"
            value={beschrijving}
            onChange={(e) => setBeschrijving(e.target.value)}
            placeholder="Beschrijving van de maatregel"
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none"
          />
          <input
            type="text"
            value={verantwoordelijke}
            onChange={(e) => setVerantwoordelijke(e.target.value)}
            placeholder="Verantwoordelijke (optioneel)"
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none"
          />
          {fout && (
            <div className="text-xs text-red-700">{fout}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setToonForm(false);
                setFout(null);
              }}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:border-[#0F2744]"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={bezig}
              className="text-xs px-3 py-1.5 bg-[#0F2744] text-white rounded hover:bg-[#1a3858] disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Toevoegen"}
            </button>
          </div>
        </form>
      )}

      {maatregelen.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-2">
          Nog geen maatregelen vastgelegd.
        </div>
      ) : (
        <div className="space-y-2">
          {maatregelen.map((m) => {
            const kleur = STATUS_KLEUR[m.status];
            return (
              <div
                key={m.id}
                className={`flex items-start gap-3 p-3 border rounded-lg ${kleur.border} ${kleur.bg}`}
              >
                <span className={`mt-0.5 text-base ${kleur.dot}`}>
                  {STATUS_ICOON[m.status]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {m.beschrijving}
                  </div>
                  {m.verantwoordelijke && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      Verantwoordelijke: {m.verantwoordelijke}
                    </div>
                  )}
                </div>
                {readonly ? (
                  <span
                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${kleur.pillBg} ${kleur.pillText}`}
                  >
                    {MAATREGEL_STATUS_LABEL[m.status]}
                  </span>
                ) : (
                  <select
                    value={m.status}
                    onChange={(e) =>
                      statusWijzigen(m.id, e.target.value as MaatregelStatus)
                    }
                    className={`text-[11px] uppercase tracking-wide font-medium px-2 py-1 rounded border ${kleur.pillBg} ${kleur.pillText} ${kleur.border}`}
                  >
                    <option value="open">Open</option>
                    <option value="in_voorbereiding">In voorbereiding</option>
                    <option value="genomen">Genomen</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
