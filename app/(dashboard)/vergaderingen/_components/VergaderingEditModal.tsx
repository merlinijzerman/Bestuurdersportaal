"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface VergaderingEditData {
  id: string;
  titel: string;
  datum: string; // ISO-string
  locatie: string | null;
}

interface Props {
  vergadering: VergaderingEditData;
}

/** ISO-string → waarde voor <input type="datetime-local"> in lokale tijd. */
function naarLokaleInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/**
 * Bewerken-knop + modal voor de vergaderkop (titel, datum, locatie).
 * Patroon en styling volgen AgendapuntEditModal. De server (PATCH
 * /api/vergaderingen/[id]) dwingt de rechten af (aanmaker +
 * voorzitter/beheerder) en blokkeert afgeronde vergaderingen; deze
 * component wordt alleen gerenderd als de pagina bewerken toestaat.
 */
export default function VergaderingEditModal({ vergadering }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [titel, setTitel] = useState(vergadering.titel);
  const [datum, setDatum] = useState(naarLokaleInput(vergadering.datum));
  const [locatie, setLocatie] = useState(vergadering.locatie ?? "");

  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const huidigeTitel = titel.trim();
  const huidigeLocatie = locatie.trim() || null;
  const origineleDatumLokaal = naarLokaleInput(vergadering.datum);

  const heeftWijziging =
    huidigeTitel !== vergadering.titel ||
    huidigeLocatie !== (vergadering.locatie ?? null) ||
    datum !== origineleDatumLokaal;

  function openModal() {
    // Reset naar actuele waarden bij elk openen (na eerdere annulering).
    setTitel(vergadering.titel);
    setDatum(naarLokaleInput(vergadering.datum));
    setLocatie(vergadering.locatie ?? "");
    setFout(null);
    setOpen(true);
  }

  async function opslaan() {
    if (!heeftWijziging || bezig) return;
    if (!huidigeTitel) {
      setFout("Titel mag niet leeg zijn");
      return;
    }
    if (!datum) {
      setFout("Datum is verplicht");
      return;
    }
    setFout(null);
    setBezig(true);
    try {
      const body: Record<string, unknown> = {};
      if (huidigeTitel !== vergadering.titel) body.titel = huidigeTitel;
      if (huidigeLocatie !== (vergadering.locatie ?? null)) body.locatie = huidigeLocatie;
      if (datum !== origineleDatumLokaal) body.datum = new Date(datum).toISOString();

      const res = await fetch(`/api/vergaderingen/${vergadering.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Wijzigen mislukt");
      }
      setOpen(false);
      router.refresh();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Wijzigen mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs text-muted hover:text-ink font-medium border border-line rounded-lg px-2.5 py-1.5 hover:border-accent transition-colors"
      >
        Bewerken
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-4 my-8">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-ink">
                Vergadering bewerken
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted text-sm hover:text-ink"
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <Veld label="Titel">
                <input
                  type="text"
                  value={titel}
                  onChange={(e) => setTitel(e.target.value)}
                  className="w-full text-sm border border-line rounded px-3 py-2 focus:border-accent outline-none"
                />
              </Veld>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Veld label="Datum & tijd">
                  <input
                    type="datetime-local"
                    value={datum}
                    onChange={(e) => setDatum(e.target.value)}
                    className="w-full text-sm border border-line rounded px-3 py-2 focus:border-accent outline-none"
                  />
                </Veld>

                <Veld label="Locatie">
                  <input
                    type="text"
                    value={locatie}
                    onChange={(e) => setLocatie(e.target.value)}
                    placeholder="Optioneel"
                    className="w-full text-sm border border-line rounded px-3 py-2 focus:border-accent outline-none"
                  />
                </Veld>
              </div>
            </div>

            {fout && <div className="text-xs text-err-ink">{fout}</div>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-muted hover:text-ink px-3 py-1.5"
              >
                Annuleren
              </button>
              <button
                onClick={opslaan}
                disabled={!heeftWijziging || bezig}
                className="bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-accent-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bezig ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Veld({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
