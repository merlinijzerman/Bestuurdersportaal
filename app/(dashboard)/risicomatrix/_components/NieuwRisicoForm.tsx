"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORIEEN,
  KANS_LABELS,
  IMPACT_LABELS,
  NIVEAU_KLEUREN,
  NIVEAU_LABEL,
  CategorieSlug,
  NiveauSlug,
  TypeRisicoSlug,
  leidNiveauAf,
} from "@/lib/risico-config";

export default function NieuwRisicoForm() {
  const router = useRouter();
  const [titel, setTitel] = useState("");
  const [categorie, setCategorie] = useState<CategorieSlug | "">("");
  const [toelichting, setToelichting] = useState("");
  const [kans, setKans] = useState<number>(3);
  const [impact, setImpact] = useState<number>(3);
  const [type, setType] = useState<TypeRisicoSlug>("structureel");
  const [handmatigNiveau, setHandmatigNiveau] = useState<NiveauSlug | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const afgeleidNiveau = useMemo(() => leidNiveauAf(kans, impact), [kans, impact]);
  const niveau = handmatigNiveau ?? afgeleidNiveau;
  const niveauKleur = NIVEAU_KLEUREN[niveau];

  async function indienen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    if (!titel.trim()) {
      setFout("Titel is verplicht.");
      return;
    }
    if (!categorie) {
      setFout("Kies een categorie.");
      return;
    }
    setBezig(true);
    try {
      const res = await fetch("/api/risicos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titel: titel.trim(),
          categorie,
          toelichting: toelichting.trim() || null,
          kans,
          impact,
          niveau,
          niveau_handmatig: handmatigNiveau !== null,
          type_risico: type,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Aanmaken mislukt");
      }
      const data = await res.json();
      router.push(`/risicomatrix/${data.risico.id}`);
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
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Titel
        </label>
        <input
          type="text"
          value={titel}
          onChange={(e) => setTitel(e.target.value)}
          placeholder="bv. Concentratierisico vastgoedportefeuille"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Categorie
        </label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIEEN.map((c) => (
            <label
              key={c.slug}
              className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 cursor-pointer hover:border-[#0F2744] ${
                categorie === c.slug
                  ? "border-[#0F2744] bg-[#0F2744]/5"
                  : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="categorie"
                checked={categorie === c.slug}
                onChange={() => setCategorie(c.slug)}
                className="accent-[#C9A84C] mt-0.5"
              />
              <div>
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-gray-500 leading-tight">
                  {c.korteOmschrijving}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Toelichting
        </label>
        <textarea
          rows={4}
          value={toelichting}
          onChange={(e) => setToelichting(e.target.value)}
          placeholder="Beschrijf het risico, oorzaken en mogelijke gevolgen."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#C9A84C] outline-none resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Kans
          </label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={`k-${n}`}
                type="button"
                onClick={() => setKans(n)}
                className={`flex-1 py-2 text-xs rounded transition ${
                  kans === n
                    ? "border-2 border-[#0F2744] bg-[#0F2744] text-white font-semibold"
                    : "border border-gray-200 hover:border-[#0F2744]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500 mt-1.5">
            {KANS_LABELS[kans]}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Impact
          </label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={`i-${n}`}
                type="button"
                onClick={() => setImpact(n)}
                className={`flex-1 py-2 text-xs rounded transition ${
                  impact === n
                    ? "border-2 border-[#0F2744] bg-[#0F2744] text-white font-semibold"
                    : "border border-gray-200 hover:border-[#0F2744]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500 mt-1.5">
            {IMPACT_LABELS[impact]}
          </div>
        </div>
      </div>

      <div
        className={`border rounded-lg p-3 flex items-center gap-3 ${niveauKleur.cellBg} ${niveauKleur.cellBorder}`}
      >
        <div className={`w-3 h-3 rounded-full ${niveauKleur.dot}`} />
        <div className="text-sm">
          <span className="text-gray-700">
            {handmatigNiveau ? "Handmatig niveau:" : "Afgeleid risiconiveau:"}
          </span>{" "}
          <span className={`font-semibold ${niveauKleur.pillText}`}>
            {NIVEAU_LABEL[niveau]}
          </span>
          <span className="text-xs text-gray-500 ml-2">
            (K{kans} + I{impact} = {kans + impact})
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {handmatigNiveau && (
            <button
              type="button"
              onClick={() => setHandmatigNiveau(null)}
              className="text-xs text-gray-500 hover:text-[#0F2744]"
            >
              Reset
            </button>
          )}
          <select
            value={handmatigNiveau ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") setHandmatigNiveau(null);
              else setHandmatigNiveau(v as NiveauSlug);
            }}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
          >
            <option value="">Handmatig overschrijven…</option>
            <option value="laag">Laag</option>
            <option value="middel">Middel</option>
            <option value="hoog">Hoog</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Type
        </label>
        <div className="flex gap-2">
          <label
            className={`flex-1 flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer ${
              type === "structureel"
                ? "border-2 border-[#0F2744] bg-[#0F2744]/5"
                : "border border-gray-200 hover:border-[#0F2744]"
            }`}
          >
            <input
              type="radio"
              name="type"
              checked={type === "structureel"}
              onChange={() => setType("structureel")}
              className="accent-[#C9A84C]"
            />
            <div>
              <div className="text-sm font-medium">Structureel</div>
              <div className="text-xs text-gray-500">
                Inherent aan bedrijfsvoering
              </div>
            </div>
          </label>
          <label
            className={`flex-1 flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer ${
              type === "tijdelijk"
                ? "border-2 border-[#0F2744] bg-[#0F2744]/5"
                : "border border-gray-200 hover:border-[#0F2744]"
            }`}
          >
            <input
              type="radio"
              name="type"
              checked={type === "tijdelijk"}
              onChange={() => setType("tijdelijk")}
              className="accent-[#C9A84C]"
            />
            <div>
              <div className="text-sm font-medium">Tijdelijk</div>
              <div className="text-xs text-gray-500">
                Gebonden aan project of gebeurtenis
              </div>
            </div>
          </label>
        </div>
      </div>

      {fout && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
        <a
          href="/risicomatrix"
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:border-[#0F2744] text-gray-700"
        >
          Annuleren
        </a>
        <button
          type="submit"
          disabled={bezig}
          className="px-4 py-2 text-sm bg-[#0F2744] text-white rounded-lg hover:bg-[#1a3858] disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Risico vastleggen"}
        </button>
      </div>
    </form>
  );
}
