"use client";

import { useState } from "react";

export type Koppeling =
  | {
      koppelingId: string;
      agendapuntId: string;
      toegankelijk: false;
      label: "Gekoppelde SharePoint-bron";
    }
  | {
      koppelingId: string;
      agendapuntId: string;
      toegankelijk: true;
      soort: "document" | "map";
      naam: string;
      mappad: string;
      bestandstype: string | null;
      previewHref: string | null;
      microsoft365Url: string | null;
    };

export default function AgendapuntSharePointBronnen({
  agendapuntId,
  magBeheren,
  initieleKoppelingen,
}: {
  agendapuntId: string;
  magBeheren: boolean;
  initieleKoppelingen: Koppeling[];
}) {
  const [verwijderdeIds, setVerwijderdeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [fout, setFout] = useState<string | null>(null);
  const [bezigId, setBezigId] = useState<string | null>(null);
  // Een router.refresh na koppelen levert nieuwe serverprops uit één batch voor
  // de hele vergadering. Alleen succesvol ontkoppelde ids worden lokaal
  // optimistisch verborgen; zo spiegelen we props niet via een effect.
  const koppelingen = initieleKoppelingen.filter(
    (koppeling) => !verwijderdeIds.has(koppeling.koppelingId)
  );

  async function ontkoppel(koppelingId: string) {
    if (!confirm("Deze SharePoint-bron ontkoppelen? Er wordt niets in SharePoint gewijzigd.")) return;
    setBezigId(koppelingId);
    try {
      const response = await fetch(`/api/agendapunten/${agendapuntId}/sharepoint`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ koppeling_id: koppelingId }),
      });
      if (!response.ok) throw new Error();
      setVerwijderdeIds((huidig) => {
        const volgend = new Set(huidig);
        volgend.add(koppelingId);
        return volgend;
      });
    } catch {
      setFout("Ontkoppelen mislukt.");
    } finally {
      setBezigId(null);
    }
  }

  if (koppelingen.length === 0 && !fout) return null;

  return (
    <div className="space-y-2" aria-label="Gekoppelde SharePoint-bronnen">
      {koppelingen.map((koppeling) => (
        <div key={koppeling.koppelingId} className="rounded-lg border border-line bg-app-bg p-3">
          {!koppeling.toegankelijk ? (
            <div className="text-sm font-medium text-ink">{koppeling.label}</div>
          ) : (
            <div className="flex items-start gap-3">
              <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-semibold text-accent-ink">SharePoint</span>
              <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{koppeling.naam}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">
                    {koppeling.soort === "map" ? "Map" : (koppeling.bestandstype?.toUpperCase() ?? "Document")}
                    {koppeling.mappad ? ` · ${koppeling.mappad}` : ""}
                  </div>
              </div>
              <details className="relative">
                <summary className="list-none cursor-pointer rounded px-2 py-0.5 text-lg leading-none text-muted hover:bg-white hover:text-ink" aria-label="Acties">⋯</summary>
                <div className="absolute right-0 z-10 mt-1 min-w-48 rounded-lg border border-line bg-white p-1 shadow-lg">
                  {koppeling.previewHref && (
                    <a href={koppeling.previewHref} className="block rounded px-3 py-2 text-xs text-ink hover:bg-app-bg">
                      {koppeling.soort === "map" ? "Bekijk in bibliotheek" : "Bekijken"}
                    </a>
                  )}
                  {koppeling.microsoft365Url && (
                    <a href={koppeling.microsoft365Url} target="_blank" rel="noopener noreferrer" className="block rounded px-3 py-2 text-xs text-ink hover:bg-app-bg">
                      Openen in Microsoft 365
                    </a>
                  )}
                  {magBeheren && (
                    <button type="button" disabled={bezigId === koppeling.koppelingId} onClick={() => void ontkoppel(koppeling.koppelingId)} className="block w-full rounded px-3 py-2 text-left text-xs text-err-ink hover:bg-err-tint disabled:opacity-50">
                      Ontkoppelen
                    </button>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      ))}
      {fout && <p className="text-xs text-muted" role="status">{fout}</p>}
    </div>
  );
}
