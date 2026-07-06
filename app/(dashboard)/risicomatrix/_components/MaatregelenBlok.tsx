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
    dot: "text-ok-ink",
    pillBg: "bg-ok-tint",
    pillText: "text-ok-ink",
    border: "border-ok/30",
    bg: "bg-ok-tint",
  },
  in_voorbereiding: {
    dot: "text-warn-ink",
    pillBg: "bg-warn-tint",
    pillText: "text-warn-ink",
    border: "border-warn/30",
    bg: "bg-warn-tint",
  },
  open: {
    dot: "text-muted",
    pillBg: "bg-app-bg",
    pillText: "text-ink",
    border: "border-line",
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
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">
          Getroffen maatregelen
        </h3>
        {!readonly && (
          <button
            onClick={() => setToonForm(!toonForm)}
            className="text-xs text-ink hover:underline"
          >
            {toonForm ? "Annuleren" : "+ Maatregel toevoegen"}
          </button>
        )}
      </div>

      {toonForm && !readonly && (
        <form
          onSubmit={maatregelToevoegen}
          className="mb-3 p-3 border border-line rounded-lg bg-app-bg space-y-2"
        >
          <input
            type="text"
            value={beschrijving}
            onChange={(e) => setBeschrijving(e.target.value)}
            placeholder="Beschrijving van de maatregel"
            className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
          />
          <input
            type="text"
            value={verantwoordelijke}
            onChange={(e) => setVerantwoordelijke(e.target.value)}
            placeholder="Verantwoordelijke (optioneel)"
            className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
          />
          {fout && (
            <div className="text-xs text-err-ink">{fout}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setToonForm(false);
                setFout(null);
              }}
              className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
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
      )}

      {maatregelen.length === 0 ? (
        <div className="text-sm text-muted italic py-2">
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
                  <div className="text-sm font-medium text-ink">
                    {m.beschrijving}
                  </div>
                  {m.verantwoordelijke && (
                    <div className="text-xs text-muted mt-0.5">
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
