"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIEEN: { value: string; label: string }[] = [
  { value: "beeldvorming", label: "Beeldvorming" },
  { value: "discussie", label: "Discussie" },
  { value: "besluitvorming", label: "Besluitvorming" },
  { value: "informatie", label: "Informatie" },
];

export default function NieuwAgendapuntForm({ vergaderingId }: { vergaderingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const [titel, setTitel] = useState("");
  const [beschrijving, setBeschrijving] = useState("");
  const [categorie, setCategorie] = useState("informatie");
  const [tijdsduur, setTijdsduur] = useState("");
  const [verantwoordelijke, setVerantwoordelijke] = useState("");

  async function indienen(e: React.FormEvent) {
    e.preventDefault();
    if (!titel.trim()) {
      setFout("Titel is verplicht.");
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch("/api/agendapunten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vergadering_id: vergaderingId,
          titel: titel.trim(),
          beschrijving: beschrijving.trim() || undefined,
          categorie,
          tijdsduur_minuten: tijdsduur ? parseInt(tijdsduur, 10) : undefined,
          verantwoordelijke: verantwoordelijke.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFout(data.error || "Er is een fout opgetreden.");
        return;
      }
      setTitel("");
      setBeschrijving("");
      setCategorie("informatie");
      setTijdsduur("");
      setVerantwoordelijke("");
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
        className="text-sm text-[#0F2744] border border-gray-300 rounded-lg px-3 py-1.5 hover:border-[#C9A84C] transition-colors"
      >
        + Agendapunt toevoegen
      </button>
    );
  }

  return (
    <form
      onSubmit={indienen}
      className="bg-white border border-gray-200 rounded-xl p-4 w-full"
    >
      <div className="text-sm font-semibold text-[#0F2744] mb-3">Nieuw agendapunt</div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Titel</label>
          <input
            type="text"
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
            placeholder="Bijv. Concept jaarverslag 2025 vaststellen"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Categorie</label>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
            >
              {CATEGORIEEN.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Tijdsduur (min)</label>
            <input
              type="number"
              value={tijdsduur}
              onChange={(e) => setTijdsduur(e.target.value)}
              placeholder="30"
              min={5}
              max={300}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Verantwoordelijke</label>
            <input
              type="text"
              value={verantwoordelijke}
              onChange={(e) => setVerantwoordelijke(e.target.value)}
              placeholder="Bijv. Voorzitter"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C]"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Korte beschrijving</label>
          <textarea
            value={beschrijving}
            onChange={(e) => setBeschrijving(e.target.value)}
            rows={2}
            placeholder="Optionele toelichting voor het bestuur."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C] resize-none"
          />
        </div>

        {fout && <div className="text-sm text-red-600">{fout}</div>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={bezig}
            className="bg-[#0F2744] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#C9A84C] hover:text-[#0F2744] transition-colors disabled:opacity-50"
          >
            {bezig ? "Bezig..." : "Toevoegen"}
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
