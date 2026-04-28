"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NieuweVergaderingForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const [titel, setTitel] = useState("");
  const [datum, setDatum] = useState("");
  const [locatie, setLocatie] = useState("");

  async function indienen(e: React.FormEvent) {
    e.preventDefault();
    if (!titel.trim() || !datum) {
      setFout("Titel en datum zijn verplicht.");
      return;
    }
    setBezig(true);
    setFout(null);

    try {
      const res = await fetch("/api/vergaderingen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titel: titel.trim(),
          datum: new Date(datum).toISOString(),
          locatie: locatie.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFout(data.error || "Er is een fout opgetreden.");
        return;
      }
      // Reset
      setTitel("");
      setDatum("");
      setLocatie("");
      setOpen(false);
      router.refresh();
    } catch {
      setFout("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setBezig(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-[#0F2744] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#C9A84C] hover:text-[#0F2744] transition-colors"
      >
        + Nieuwe vergadering
      </button>
    );
  }

  return (
    <form
      onSubmit={indienen}
      className="bg-white border border-gray-200 rounded-xl p-4 w-full max-w-xl"
    >
      <div className="text-sm font-semibold text-[#0F2744] mb-3">Nieuwe vergadering</div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Titel</label>
          <input
            type="text"
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
            placeholder="Bijv. Bestuursvergadering Q3 2026"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Datum &amp; tijd</label>
            <input
              type="datetime-local"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Locatie</label>
            <input
              type="text"
              value={locatie}
              onChange={(e) => setLocatie(e.target.value)}
              placeholder="Optioneel"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
            />
          </div>
        </div>

        {fout && <div className="text-sm text-red-600">{fout}</div>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={bezig}
            className="bg-[#0F2744] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#C9A84C] hover:text-[#0F2744] transition-colors disabled:opacity-50"
          >
            {bezig ? "Bezig..." : "Aanmaken"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setFout(null);
            }}
            className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2"
          >
            Annuleren
          </button>
        </div>
      </div>
    </form>
  );
}
