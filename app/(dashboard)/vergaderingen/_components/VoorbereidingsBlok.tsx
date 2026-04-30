"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export interface VoorbereidingLens {
  naam: string;
  analyse: string;
  vraag: string;
}

export interface VoorbereidingAIOutput {
  lenzen?: VoorbereidingLens[];
  ontbrekend?: string[];
  vergadervragen?: string[];
  samenvatting?: string;
}

export interface BronnenMeta {
  documenten?: { id: string; titel: string; bron: string }[];
  risicos?: { id: string; titel: string; niveau: string }[];
  procedures?: { id: string; titel: string; status: string }[];
}

export interface Voorbereiding {
  id: string;
  agendapunt_id: string;
  diepte: "snel" | "grondig";
  ai_output: VoorbereidingAIOutput;
  eigen_notities: Record<string, string>;
  bronnen_meta: BronnenMeta;
  gegenereerd_op: string;
  bijgewerkt_op: string;
}

interface Props {
  agendapuntId: string;
  initieel: Voorbereiding | null;
  onVulInbreng?: (tekst: string) => void;
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const NIVEAU_KLEUR: Record<string, string> = {
  hoog: "text-red-700 bg-red-50",
  middel: "text-amber-700 bg-amber-50",
  laag: "text-emerald-700 bg-emerald-50",
};

export default function VoorbereidingsBlok({
  agendapuntId,
  initieel,
  onVulInbreng,
}: Props) {
  const router = useRouter();
  const [voorbereiding, setVoorbereiding] = useState<Voorbereiding | null>(initieel);
  const [bezig, setBezig] = useState<"genereer" | "verdiep" | "notities" | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [notities, setNotities] = useState<Record<string, string>>(
    initieel?.eigen_notities || {}
  );
  const [notitiesGewijzigd, setNotitiesGewijzigd] = useState(false);

  useEffect(() => {
    if (initieel) {
      setVoorbereiding(initieel);
      setNotities(initieel.eigen_notities || {});
      setNotitiesGewijzigd(false);
    }
  }, [initieel]);

  async function genereer(diepte: "snel" | "grondig") {
    setFout(null);
    setBezig(diepte === "grondig" ? "verdiep" : "genereer");
    try {
      const res = await fetch(
        `/api/agendapunten/${agendapuntId}/voorbereiding`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diepte }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Genereren mislukt");
      }
      const data = await res.json();
      setVoorbereiding(data.voorbereiding as Voorbereiding);
      setNotities((data.voorbereiding.eigen_notities || {}) as Record<string, string>);
      setNotitiesGewijzigd(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Genereren mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function notitiesOpslaan() {
    setFout(null);
    setBezig("notities");
    try {
      const res = await fetch(
        `/api/agendapunten/${agendapuntId}/voorbereiding/notities`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eigen_notities: notities }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Opslaan mislukt");
      }
      const data = await res.json();
      setVoorbereiding(data.voorbereiding as Voorbereiding);
      setNotitiesGewijzigd(false);
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(null);
    }
  }

  function vulInbreng() {
    if (!voorbereiding || !onVulInbreng) return;
    const ai = voorbereiding.ai_output;
    const stukken: string[] = [];
    // Eerst eigen notities (geordend per lens), dan vergadervragen
    if (ai.lenzen) {
      for (const lens of ai.lenzen) {
        const notitie = notities[slug(lens.naam)];
        if (notitie && notitie.trim()) {
          stukken.push(`Wat ${lens.naam.toLowerCase()} betreft: ${notitie.trim()}`);
        }
      }
    }
    if (ai.vergadervragen && ai.vergadervragen.length > 0) {
      stukken.push(
        `Vragen die ik graag in de vergadering wil stellen:\n${ai.vergadervragen.map((v, i) => `${i + 1}. ${v}`).join("\n")}`
      );
    }
    if (stukken.length === 0) {
      // Niets om over te nemen — geef hint
      onVulInbreng(
        "(Tip: voeg eigen notities of de AI-vergadervragen toe aan deze inbreng.)"
      );
      return;
    }
    onVulInbreng(stukken.join("\n\n"));
  }

  // Geen voorbereiding nog — toon CTA
  if (!voorbereiding) {
    return (
      <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-base">🔒</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-[#0F2744]">
              Mijn voorbereiding
            </div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Laat de AI helpen scherper na te denken over dit punt — kritische
              vragen, blinde vlekken en perspectieven die ertoe doen. Persoonlijk
              en alleen voor u zichtbaar.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => genereer("snel")}
                disabled={bezig !== null}
                className="bg-[#0F2744] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#1a3858] disabled:opacity-50"
              >
                {bezig === "genereer"
                  ? "Bezig met opstellen…"
                  : "Genereer voorbereiding"}
              </button>
              <button
                onClick={() => genereer("grondig")}
                disabled={bezig !== null}
                className="text-xs text-[#0F2744] hover:underline disabled:opacity-50"
                title="Doorzoekt ook de bibliotheek, risicomatrix en lopende procedures"
              >
                {bezig === "verdiep"
                  ? "Bezig…"
                  : "Of meteen grondig (zoekt in bibliotheek + modules)"}
              </button>
            </div>
            {fout && <div className="text-xs text-red-700 mt-2">{fout}</div>}
          </div>
        </div>
      </div>
    );
  }

  const ai = voorbereiding.ai_output;
  const lenzen = ai.lenzen || [];
  const ontbrekend = ai.ontbrekend || [];
  const vergadervragen = ai.vergadervragen || [];
  const bronnen = voorbereiding.bronnen_meta || {};

  return (
    <div className="bg-amber-50/30 border border-amber-200 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          <span className="text-base mt-0.5">🔒</span>
          <div>
            <div className="text-sm font-semibold text-[#0F2744]">
              Mijn voorbereiding
              <span className="text-[10px] uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded ml-2 font-medium">
                {voorbereiding.diepte === "grondig" ? "Grondig" : "Snel"}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Privé · gegenereerd {formatDatumKort(voorbereiding.gegenereerd_op)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {voorbereiding.diepte === "snel" && (
            <button
              onClick={() => genereer("grondig")}
              disabled={bezig !== null}
              className="text-xs text-[#0F2744] hover:underline disabled:opacity-50"
            >
              {bezig === "verdiep"
                ? "Bezig…"
                : "↗ Verdiep (bibliotheek + modules)"}
            </button>
          )}
          <button
            onClick={() => genereer(voorbereiding.diepte)}
            disabled={bezig !== null}
            className="text-xs text-gray-500 hover:text-[#0F2744] disabled:opacity-50"
            title="Genereer opnieuw"
          >
            ↻ Vernieuwen
          </button>
        </div>
      </div>

      {/* Samenvatting (één zin) */}
      {ai.samenvatting && (
        <div className="text-sm text-gray-800 italic border-l-2 border-amber-400 pl-3">
          {ai.samenvatting}
        </div>
      )}

      {/* Lenzen */}
      {lenzen.length > 0 && (
        <div className="space-y-3">
          {lenzen.map((lens, idx) => {
            const sleutel = slug(lens.naam);
            const huidigeNotitie = notities[sleutel] ?? "";
            return (
              <div
                key={idx}
                className="bg-white border border-amber-200 rounded-lg p-3"
              >
                <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide">
                  {lens.naam}
                </div>
                <p className="text-sm text-gray-800 mt-1.5 leading-relaxed">
                  {lens.analyse}
                </p>
                <div className="mt-2 text-sm text-amber-900 bg-amber-50/60 border border-amber-200 rounded px-2.5 py-1.5">
                  <span className="font-medium">Open vraag:</span> {lens.vraag}
                </div>
                <textarea
                  rows={2}
                  value={huidigeNotitie}
                  onChange={(e) => {
                    setNotities({ ...notities, [sleutel]: e.target.value });
                    setNotitiesGewijzigd(true);
                  }}
                  placeholder="Uw notitie bij deze lens (alleen voor u zichtbaar)…"
                  className="mt-2 w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:border-[#C9A84C] outline-none resize-none bg-gray-50"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Ontbrekend */}
      {ontbrekend.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-2">
            Wat staat hier níet
          </div>
          <ul className="space-y-1.5">
            {ontbrekend.map((o, idx) => (
              <li key={idx} className="text-sm text-gray-800 flex gap-2">
                <span className="text-amber-700 mt-0.5">·</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Vergadervragen */}
      {vergadervragen.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-2">
            Vragen voor in de vergadering
          </div>
          <ol className="space-y-1.5">
            {vergadervragen.map((v, idx) => (
              <li key={idx} className="text-sm text-gray-800 flex gap-2">
                <span className="text-[#0F2744] font-semibold tabular-nums w-5 flex-shrink-0">
                  {idx + 1}.
                </span>
                <span className="leading-relaxed">{v}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Bronvermelding */}
      {(bronnen.documenten?.length ||
        bronnen.risicos?.length ||
        bronnen.procedures?.length) && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer font-medium hover:text-[#0F2744]">
            Geraadpleegde bronnen
          </summary>
          <div className="mt-2 space-y-1.5 ml-2">
            {(bronnen.documenten?.length || 0) > 0 && (
              <div>
                <span className="font-semibold">Documenten:</span>{" "}
                {bronnen.documenten!.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 ? ", " : ""}
                    {d.titel}{" "}
                    <span className="text-gray-400">({d.bron})</span>
                  </span>
                ))}
              </div>
            )}
            {(bronnen.risicos?.length || 0) > 0 && (
              <div>
                <span className="font-semibold">Risico&apos;s:</span>{" "}
                {bronnen.risicos!.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 ? ", " : ""}
                    {r.titel}{" "}
                    <span
                      className={`px-1 py-0.5 rounded ${NIVEAU_KLEUR[r.niveau] || ""}`}
                    >
                      {r.niveau}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {(bronnen.procedures?.length || 0) > 0 && (
              <div>
                <span className="font-semibold">Procedures:</span>{" "}
                {bronnen.procedures!.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 ? ", " : ""}
                    {p.titel}
                  </span>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {/* Acties */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-amber-200">
        <div className="flex items-center gap-3 text-xs">
          {notitiesGewijzigd && (
            <button
              onClick={notitiesOpslaan}
              disabled={bezig !== null}
              className="text-[#0F2744] font-medium hover:underline disabled:opacity-50"
            >
              {bezig === "notities" ? "Opslaan…" : "Notities opslaan"}
            </button>
          )}
          {!notitiesGewijzigd && voorbereiding.bijgewerkt_op && (
            <span className="text-gray-400">
              Notities opgeslagen {formatDatumKort(voorbereiding.bijgewerkt_op)}
            </span>
          )}
        </div>
        {onVulInbreng && (
          <button
            onClick={vulInbreng}
            className="text-xs text-[#0F2744] hover:text-[#C9A84C] font-medium"
          >
            ↓ Gebruik dit als startpunt voor mijn inbreng
          </button>
        )}
      </div>

      {fout && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
