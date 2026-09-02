"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProcessTemplate } from "@/core/lib/proces-templates";

/** Lid van het eigen fonds, aangeleverd door de serverpagina uit vw_fondsleden. */
export interface Lid {
  id: string;
  naam: string;
  rol: string | null;
}

interface Props {
  templates: ProcessTemplate[];
  /** Kiesbare co-eigenaars: de fondsleden behalve de ingelogde gebruiker. */
  leden: Lid[];
}

export default function NieuweProcedureForm({ templates, leden }: Props) {
  const router = useRouter();
  const [templateCode, setTemplateCode] = useState<string>("");
  const [titel, setTitel] = useState("");
  const [beschrijving, setBeschrijving] = useState("");
  const [deadline, setDeadline] = useState("");
  // Besluit 0102: co-eigenaars worden GEKOZEN uit de fondsleden. Voorheen was dit
  // een vrij tekstveld, waardoor er e-mailadressen als "naam" in dossiers
  // belandden die daarna niet meer te corrigeren waren.
  const [eigenaarIds, setEigenaarIds] = useState<string[]>([]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  function eigenaarWissel(id: string) {
    setEigenaarIds((huidig) =>
      huidig.includes(id) ? huidig.filter((x) => x !== id) : [...huidig, id]
    );
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
          eigenaar_ids: eigenaarIds,
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
      className="bg-white border border-line rounded-xl p-6 space-y-5"
    >
      <div>
        <label className="block text-sm font-medium text-ink mb-2">
          Template
        </label>
        <div className="grid gap-2">
          {templates.map((t) => (
            <label
              key={t.code}
              className={`flex items-start gap-3 border rounded-lg px-4 py-3 cursor-pointer hover:border-accent ${
                templateCode === t.code
                  ? "border-accent bg-accent/5"
                  : "border-line"
              }`}
            >
              <input
                type="radio"
                name="template"
                checked={templateCode === t.code}
                onChange={() => setTemplateCode(t.code)}
                className="accent-accent mt-0.5"
              />
              <div className="flex-1">
                <div className="font-semibold text-ink text-sm">
                  {t.naam}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {t.korte_omschrijving}
                </div>
                <div className="text-xs text-muted mt-1">
                  {t.stappen.length} stappen · doorlooptijd ~
                  {t.geschat_aantal_dagen} dagen
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1.5">
          Titel
        </label>
        <input
          type="text"
          value={titel}
          onChange={(e) => setTitel(e.target.value)}
          placeholder="bv. Aanpassing strategisch beleggingsplan 2026"
          className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:border-accent outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1.5">
          Beschrijving
        </label>
        <textarea
          rows={3}
          value={beschrijving}
          onChange={(e) => setBeschrijving(e.target.value)}
          placeholder="Korte omschrijving van wat deze procedure betreft."
          className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:border-accent outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1.5">
          Co-eigenaren
        </label>
        {leden.length === 0 ? (
          <p className="text-sm text-muted border border-line rounded-lg px-3 py-2.5">
            Er zijn geen andere leden van dit fonds beschikbaar om te kiezen. U
            bent zelf al eigenaar van deze procedure.
          </p>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line max-h-56 overflow-y-auto">
            {leden.map((lid) => {
              const gekozen = eigenaarIds.includes(lid.id);
              return (
                <label
                  key={lid.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer text-sm ${
                    gekozen ? "bg-accent-tint" : "hover:bg-app-zebra"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={gekozen}
                    onChange={() => eigenaarWissel(lid.id)}
                    className="accent-accent"
                  />
                  <span className="flex-1 text-ink">{lid.naam}</span>
                  {lid.rol && (
                    <span className="text-xs text-muted capitalize">{lid.rol}</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted mt-1">
          Optioneel: bestuursleden die samen met u verantwoordelijk zijn voor
          deze procedure. U staat er zelf altijd bij.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1.5">
          Gewenste deadline (optioneel)
        </label>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm focus:border-accent outline-none"
        />
      </div>

      {fout && (
        <div className="text-sm text-err-ink bg-err-tint border border-err/30 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-line">
        <Link
          href="/procedures"
          className="px-4 py-2 text-sm border border-line rounded-lg hover:border-accent text-ink"
        >
          Annuleren
        </Link>
        <button
          type="submit"
          disabled={bezig}
          className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Procedure starten"}
        </button>
      </div>
    </form>
  );
}
