"use client";

import { useEffect, useMemo, useState } from "react";

type PortaalDocument = {
  id: string;
  titel: string;
  bron: string | null;
  bibliotheek: string | null;
  bestandstype: string | null;
};

type SharePointDocument = {
  ref: string;
  naam: string;
  mappad: string;
  bestandstype: string | null;
};

type SharePointMap = {
  ref: string;
  naam: string;
  mappad: string;
};

export type GekozenSharePointBron = {
  soort: "document" | "map";
  ref: string;
};

type Props = {
  onSelectPortaal: (id: string) => void;
  onSelectSharePoint: (bronnen: GekozenSharePointBron[]) => Promise<boolean>;
  onClose: () => void;
};

function typeLabel(type: string | null) {
  if (type === "docx" || type === "doc") return "Word";
  if (type === "xlsx" || type === "xls") return "Excel";
  if (type === "pptx" || type === "ppt") return "PowerPoint";
  return type?.toUpperCase() ?? "Bestand";
}

export default function AgendapuntBronPicker({
  onSelectPortaal,
  onSelectSharePoint,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"portaal" | "sharepoint">("portaal");
  const [zoek, setZoek] = useState("");
  const [bibliotheekFilter, setBibliotheekFilter] = useState<
    "alle" | "fonds" | "generiek"
  >("alle");
  const [portaal, setPortaal] = useState<PortaalDocument[] | null>(null);
  const [sharepoint, setSharepoint] = useState<{
    beschikbaar: boolean;
    documenten: SharePointDocument[];
    mapRefs: SharePointMap[];
  } | null>(null);
  const [geselecteerd, setGeselecteerd] = useState<Set<string>>(new Set());
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    let actief = true;
    void Promise.all([
      fetch("/api/documents/upload", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error("Portaalbibliotheek ophalen mislukt");
          return res.json() as Promise<{ documenten?: PortaalDocument[] }>;
        })
        .then((data) => { if (actief) setPortaal(data.documenten ?? []); }),
      fetch("/api/microsoft/sharepoint/documenten", { cache: "no-store" })
        .then(async (res) => {
          const data = await res.json().catch(() => ({})) as {
            beschikbaar?: boolean;
            documenten?: SharePointDocument[];
            mapRefs?: SharePointMap[];
          };
          if (!res.ok && data.beschikbaar !== true) throw new Error("SharePoint ophalen mislukt");
          return data;
        })
        .then((data) => {
          if (actief) setSharepoint({
            beschikbaar: data.beschikbaar === true,
            documenten: data.documenten ?? [],
            mapRefs: data.mapRefs ?? [],
          });
        }),
    ]).catch((error) => {
      if (actief) setFout(error instanceof Error ? error.message : "Bronnen ophalen mislukt");
    });
    return () => { actief = false; };
  }, []);

  const term = zoek.trim().toLocaleLowerCase("nl-NL");
  const portaalZichtbaar = useMemo(
    () => (portaal ?? []).filter((document) => {
      if (
        bibliotheekFilter !== "alle" &&
        document.bibliotheek !== bibliotheekFilter
      ) return false;
      return !term || `${document.titel} ${document.bron ?? ""}`
        .toLocaleLowerCase("nl-NL")
        .includes(term);
    }),
    [bibliotheekFilter, portaal, term]
  );
  const sharepointZichtbaar = useMemo(() => [
    ...(sharepoint?.mapRefs ?? []).map((map) => ({
      soort: "map" as const,
      ref: map.ref,
      naam: map.naam,
      mappad: map.mappad,
      bestandstype: null,
    })),
    ...(sharepoint?.documenten ?? []).map((document) => ({
      soort: "document" as const,
      ...document,
    })),
  ].filter((bron) =>
    !term || `${bron.naam} ${bron.mappad} ${bron.bestandstype ?? ""}`.toLocaleLowerCase("nl-NL").includes(term)
  ), [sharepoint, term]);

  function wissel(bron: GekozenSharePointBron) {
    const sleutel = `${bron.soort}:${bron.ref}`;
    setGeselecteerd((huidig) => {
      const volgend = new Set(huidig);
      if (volgend.has(sleutel)) volgend.delete(sleutel);
      else volgend.add(sleutel);
      return volgend;
    });
  }

  async function koppelSelectie() {
    const bronnen = [...geselecteerd].map((sleutel) => {
      const [soort, ref] = sleutel.split(":", 2);
      return { soort: soort as "document" | "map", ref };
    });
    if (bronnen.length === 0) return;
    setBezig(true);
    setFout(null);
    try {
      if (await onSelectSharePoint(bronnen)) onClose();
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16" onClick={onClose} role="dialog" aria-modal="true" aria-label="Koppel bestaand stuk">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-line p-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">Koppel bestaand stuk</h2>
            <p className="mt-0.5 text-xs text-muted">Koppel zonder kopie uit het portaal of live uit SharePoint.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl leading-none text-muted hover:text-ink" aria-label="Sluiten">×</button>
        </div>
        <div className="flex gap-1 border-b border-line px-5 pt-3" role="tablist" aria-label="Bronkeuze">
          {(["portaal", "sharepoint"] as const).map((waarde) => (
            <button
              key={waarde}
              type="button"
              role="tab"
              aria-selected={tab === waarde}
              onClick={() => { setTab(waarde); setZoek(""); setFout(null); }}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === waarde ? "bg-accent-tint text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {waarde === "portaal" ? "Portaalbibliotheek" : "SharePoint"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <input value={zoek} onChange={(event) => setZoek(event.target.value)} placeholder={tab === "portaal" ? "Zoek op titel…" : "Zoek op naam of map…"} className="min-w-0 flex-1 rounded-md border border-app-line-strong px-3 py-2 text-sm focus:border-accent focus:outline-none" autoFocus />
          {tab === "portaal" && (
            <select
              aria-label="Filter bibliotheek"
              value={bibliotheekFilter}
              onChange={(event) => setBibliotheekFilter(
                event.target.value as "alle" | "fonds" | "generiek"
              )}
              className="rounded-md border border-app-line-strong bg-white px-2 py-2 text-sm"
            >
              <option value="alle">Alle bibliotheken</option>
              <option value="fonds">Fonds</option>
              <option value="generiek">Generiek</option>
            </select>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {fout && <p className="rounded-md border border-err/30 bg-err-tint p-3 text-sm text-err-ink" role="alert">{fout}</p>}
          {tab === "portaal" && !fout && (portaal === null ? (
            <p className="py-6 text-center text-sm italic text-muted">Documenten laden…</p>
          ) : portaalZichtbaar.length === 0 ? (
            <p className="py-6 text-center text-sm italic text-muted">Geen portaalstukken gevonden.</p>
          ) : (
            <ul className="space-y-1.5">
              {portaalZichtbaar.map((document) => (
                <li key={document.id}>
                  <button type="button" onClick={() => { onSelectPortaal(document.id); onClose(); }} className="flex w-full items-center gap-3 rounded-lg border border-line p-2.5 text-left hover:border-accent">
                    <span className="min-w-[48px] rounded border border-line px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase text-muted">{typeLabel(document.bestandstype)}</span>
                    <span className="min-w-0"><span className="block truncate text-sm text-ink">{document.titel}</span><span className="block text-[11px] text-muted">{document.bron ?? document.bibliotheek ?? "Portaal"}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
          {tab === "sharepoint" && !fout && (sharepoint === null ? (
            <p className="py-6 text-center text-sm italic text-muted">SharePoint laden…</p>
          ) : !sharepoint.beschikbaar ? (
            <p className="py-6 text-center text-sm text-muted">SharePoint is voor dit fonds niet beschikbaar.</p>
          ) : sharepointZichtbaar.length === 0 ? (
            <p className="py-6 text-center text-sm italic text-muted">Geen SharePoint-bronnen gevonden.</p>
          ) : (
            <ul className="space-y-1.5">
              {sharepointZichtbaar.map((bron) => {
                const sleutel = `${bron.soort}:${bron.ref}`;
                return (
                  <li key={sleutel}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-2.5 hover:border-accent">
                      <input type="checkbox" checked={geselecteerd.has(sleutel)} onChange={() => wissel(bron)} aria-label={`Selecteer ${bron.naam}`} />
                      <span className="min-w-[48px] rounded border border-line px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase text-muted">{bron.soort === "map" ? "Map" : typeLabel(bron.bestandstype)}</span>
                      <span className="min-w-0"><span className="block truncate text-sm text-ink">{bron.naam}</span><span className="block truncate text-[11px] text-muted">{bron.mappad || "Hoofdmap"}</span></span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-xs text-muted">{tab === "sharepoint" && geselecteerd.size > 0 ? `${geselecteerd.size} geselecteerd` : ""}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-muted hover:text-ink">Annuleer</button>
            {tab === "sharepoint" && (
              <button type="button" disabled={geselecteerd.size === 0 || bezig} onClick={() => void koppelSelectie()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {bezig ? "Koppelen…" : "Koppel selectie"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
