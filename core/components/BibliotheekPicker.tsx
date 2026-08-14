"use client";

// ============================================================
//  BibliotheekPicker — gedeelde documentkiezer (verplaatst naar core, 2026-08-14)
//
//  Generieke modal waarin de gebruiker een BESTAAND document uit de
//  bibliotheek zoekt en selecteert, zonder duplicaat aan te maken.
//  Roept onSelect(id, titel) aan en sluit daarna. De AANROEPER bepaalt
//  wat de koppeling doet (bewijsstuk bij een proces, of een agendapunt
//  bij een vergadering) — deze component is contextvrij.
//
//  Oorspronkelijk procedures/_components/BibliotheekPicker (iteratie 3-D,
//  2026-05-18); naar core verplaatst zodat ook de vergaderkant hem hergebruikt.
//
//  Gebruikt /api/documents/upload als list-endpoint (de GET-variant geeft
//  de fonds-documenten terug, gefilterd via RLS). Zoeken is client-side op
//  titel; server-side search is een latere uitbreiding.
// ============================================================

import { useEffect, useState } from "react";

type Doc = {
  id: string;
  titel: string;
  bron: string | null;
  bibliotheek: string | null;
  bestandstype: string | null;
  aangemaakt: string;
};

type Props = {
  /** Wordt aangeroepen met (id, titel) wanneer de gebruiker kiest. */
  onSelect: (id: string, titel: string) => void;
  /** Sluit-knop. */
  onClose: () => void;
};

export default function BibliotheekPicker({ onSelect, onClose }: Props) {
  const [documenten, setDocumenten] = useState<Doc[] | null>(null);
  const [zoek, setZoek] = useState("");
  const [bibliotheekFilter, setBibliotheekFilter] = useState<"alle" | "fonds" | "generiek">(
    "alle"
  );
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    let geannuleerd = false;
    async function laad() {
      try {
        // /api/documents/upload met GET retourneert alle documenten in het
        // fonds (zie route-bestand). Geen apart endpoint nodig.
        const res = await fetch("/api/documents/upload");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { documenten?: Doc[] };
        if (geannuleerd) return;
        setDocumenten(data.documenten ?? []);
      } catch (e) {
        if (!geannuleerd) {
          setFout(e instanceof Error ? e.message : "Documenten ophalen mislukt");
        }
      }
    }
    void laad();
    return () => {
      geannuleerd = true;
    };
  }, []);

  // Filter + zoek lokaal in-memory — voor honderden documenten ruim snel
  // genoeg. Bij doorgroei kunnen we hier paginatie + server-side search
  // op aansluiten.
  const zichtbaar = (documenten ?? []).filter((d) => {
    if (bibliotheekFilter !== "alle" && d.bibliotheek !== bibliotheekFilter) {
      return false;
    }
    if (zoek.trim().length > 0) {
      return d.titel.toLowerCase().includes(zoek.trim().toLowerCase());
    }
    return true;
  });

  function typeBadge(type: string | null): { label: string; kleur: string } {
    switch (type) {
      case "pdf":
        return { label: "PDF", kleur: "bg-err-tint text-err-ink border-err/30" };
      case "docx":
        return { label: "Word", kleur: "bg-accent-tint text-accent-ink border-accent/30" };
      case "xlsx":
        return {
          label: "Excel",
          kleur: "bg-ok-tint text-ok-ink border-ok/30",
        };
      default:
        return {
          label: type ?? "?",
          kleur: "bg-app-bg text-muted border-line",
        };
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-line">
          <div>
            <h2 className="text-ink font-semibold text-lg">
              Kies een bestaand document
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Selecteer een stuk uit de bibliotheek om als bewijs te koppelen.
              Geen duplicatie — het origineel blijft in de bibliotheek.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink text-xl leading-none"
            aria-label="Sluiten"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-line flex items-center gap-3">
          <input
            type="text"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek op titel…"
            className="flex-1 text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:border-accent"
            autoFocus
          />
          <select
            value={bibliotheekFilter}
            onChange={(e) =>
              setBibliotheekFilter(e.target.value as "alle" | "fonds" | "generiek")
            }
            className="text-sm border border-app-line-strong rounded-md px-2 py-2 bg-white"
          >
            <option value="alle">Alle bibliotheken</option>
            <option value="fonds">Fonds</option>
            <option value="generiek">Generiek</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {fout ? (
            <div className="text-sm text-err-ink bg-err-tint border border-err/30 rounded-md p-3">
              {fout}
            </div>
          ) : documenten === null ? (
            <div className="text-sm text-muted italic py-6 text-center">
              Documenten laden…
            </div>
          ) : zichtbaar.length === 0 ? (
            <div className="text-sm text-muted italic py-6 text-center">
              {zoek
                ? `Geen documenten gevonden voor "${zoek}".`
                : "Geen documenten in de bibliotheek."}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {zichtbaar.map((d) => {
                const badge = typeBadge(d.bestandstype);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(d.id, d.titel);
                        onClose();
                      }}
                      className="w-full text-left flex items-center gap-3 p-2.5 border border-line hover:border-accent rounded-lg transition-colors group"
                    >
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5 flex-shrink-0 ${badge.kleur}`}
                      >
                        {badge.label}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate group-hover:text-accent">
                          {d.titel}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {d.bron ? `${d.bron} · ` : ""}
                          {d.bibliotheek}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted hover:text-ink px-3 py-1.5"
          >
            Annuleer
          </button>
        </div>
      </div>
    </div>
  );
}
