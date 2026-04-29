"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProcessTemplate } from "@/lib/proces-templates";

interface Props {
  templates: ProcessTemplate[];
}

export default function NieuweProcedureForm({ templates }: Props) {
  const router = useRouter();
  const [templateCode, setTemplateCode] = useState<string>("");
  const [titel, setTitel] = useState("");
  const [beschrijving, setBeschrijving] = useState("");
  const [deadline, setDeadline] = useState("");
  const [eigenaarInput, setEigenaarInput] = useState("");
  const [eigenaren, setEigenaren] = useState<string[]>([]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  function eigenaarToevoegen() {
    const naam = eigenaarInput.trim();
    if (!naam) return;
    if (eigenaren.includes(naam)) {
      setEigenaarInput("");
      return;
    }
    setEigenaren([...eigenaren, naam]);
    setEigenaarInput("");
  }

  function eigenaarVerwijderen(naam: string) {
    setEigenaren(eigenaren.filter((e) => e !== naam));
  }

  async function indienen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    if (!templateCode) {
      setFout("Kies een template.");
      return;
    }
    if (!titel.trim()) {
      setFout("Titel is verplicht.");
      return;
    }
    setBezig(true);
    try {
      const res = await fetch("/api/procedures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_code: templateCode,
          titel: titel.trim(),
          beschrijving: beschrijving.trim() || null,
          deadline: deadline || null,
          eigenaren,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Aanmaken mislukt");
      }
      const data = await res.json();
      router.push(`/procedures/${data.procedure.id}`);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Aanmaken mislukt");
      setBezig(false);
    }
  }

  return (
    <form
      onSubmit={indienen}
      className="bg-white border border-gray-200 rounded-xl p-6 space-y-5"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Template
        </label>
        <div className="grid gap-2">
          {templates.map((t) => (
            <label
              key={t.code}
              className={`flex items-start gap-3 border rounded-lg px-4 py-3 cursor-pointer hover:border-[#0F2744] ${
                templateCode === t.code
                  ? "border-[#0F2744] bg-[#0F2744]/5"
                  : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="template"
                checked={templateCode === t.code}
                onChange={() => setTemplateCode(t.code)}
                className="accent-[#C9A84C] mt-0.5"
              />
              <div className="flex-1">
                <div className="font-semibold text-[#0F2744] text-sm">
                  {t.naam}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {t.korte_omschrijving}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {t.stappen.length} stappen · doorlooptijd ~
                  {t.geschat_aantal_dagen} dagen
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Titel
        </label>
        <input
          type="text"
          value={titel}
          onChange={(e) => setTitel(e.target.value)}
          placeholder="bv. Aanpassing strategisch beleggingsplan 2026"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Beschrijving
        </label>
        <textarea
          rows={3}
          value={beschrijving}
          onChange={(e) => setBeschrijving(e.target.value)}
          placeholder="Korte omschrijving van wat deze procedure betreft."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Co-eigenaren
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={eigenaarInput}
            onChange={(e) => setEigenaarInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                eigenaarToevoegen();
              }
            }}
            placeholder="Naam toevoegen en op Enter drukken"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none"
          />
          <button
            type="button"
            onClick={eigenaarToevoegen}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-[#0F2744] text-gray-700"
          >
            Toevoegen
          </button>
        </div>
        {eigenaren.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {eigenaren.map((n) => (
              <span
                key={n}
                className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-800 text-xs px-2 py-1 rounded"
              >
                {n}
                <button
                  type="button"
                  onClick={() => eigenaarVerwijderen(n)}
                  className="text-purple-500 hover:text-purple-800"
                  aria-label={`Verwijder ${n}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Optioneel: meerdere bestuursleden die samen verantwoordelijk zijn voor
          deze procedure.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Gewenste deadline (optioneel)
        </label>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none"
        />
      </div>

      {fout && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
        <a
          href="/procedures"
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:border-[#0F2744] text-gray-700"
        >
          Annuleren
        </a>
        <button
          type="submit"
          disabled={bezig}
          className="px-4 py-2 text-sm bg-[#0F2744] text-white rounded-lg hover:bg-[#1a3858] disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Procedure starten"}
        </button>
      </div>
    </form>
  );
}
