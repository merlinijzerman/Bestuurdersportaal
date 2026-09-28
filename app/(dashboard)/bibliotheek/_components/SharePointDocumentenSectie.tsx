"use client";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AssistentIngang from "@/core/components/assistent/AssistentIngang";

type SharePointDocument = {
  ref: string; naam: string; bestandstype: string | null; grootte: number | null; gewijzigdOp: string | null;
  mappad: string; previewMogelijk: boolean; webUrl: string | null;
};
type SharePointMapRef = { ref: string; naam: string; mappad: string };
type Antwoord = {
  beschikbaar: boolean; error?: string; foutcategorie?: string;
  aiContextBeschikbaar?: boolean;
  bron?: { weergavenaam: string; site: string; bibliotheek: string; map: string } | null;
  documenten?: SharePointDocument[]; mappen?: string[]; mapRefs?: SharePointMapRef[]; afgekapt?: boolean;
};

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", docx: "Word", doc: "Word", pptx: "PowerPoint", ppt: "PowerPoint", xlsx: "Excel", xls: "Excel" };
const AI_TYPES = new Set(["pdf", "docx", "pptx", "xlsx"]);
const TYPE_BLOK = "inline-flex items-center justify-center min-w-[46px] h-5 rounded border border-line bg-app-surface px-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted";

function grootteLabel(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Actiemenu({ label, children }: { label: string; children: (sluit: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [positie, setPositie] = useState<{ left: number; top: number | null; bottom: number | null } | null>(null);
  const sluit = () => setOpen(false);

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        aria-label={`Acties voor ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-muted hover:bg-app-bg"
        onClick={(event) => {
          if (open) return sluit();
          const rect = event.currentTarget.getBoundingClientRect();
          const menuBreedte = 230;
          const geschatteHoogte = 180;
          const marge = 8;
          const left = Math.max(marge, Math.min(rect.right - menuBreedte, window.innerWidth - menuBreedte - marge));
          const naarBoven = rect.bottom + geschatteHoogte > window.innerHeight && rect.top > geschatteHoogte;
          setPositie(naarBoven
            ? { left, top: null, bottom: window.innerHeight - rect.top + 4 }
            : { left, top: rect.bottom + 4, bottom: null });
          setOpen(true);
        }}
      >
        ⋮
      </button>
      {open && positie && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={sluit} />
          <div
            role="menu"
            aria-label={`Acties voor ${label}`}
            className="fixed z-50 min-w-[220px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-line bg-app-surface py-1 text-left shadow-lg"
            style={{ left: positie.left, top: positie.top ?? undefined, bottom: positie.bottom ?? undefined, maxHeight: "calc(100vh - 24px)" }}
          >
            {children(sluit)}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/** SharePoint-documenten in de fondsbibliotheek (Microsoft 365 fase 3, #321).
 * Rendert niets zolang de fondsvlag uit staat, zodat de eigen variant exact
 * gelijk blijft. De lijst is live per gebruiker; de browser ziet alleen lokale
 * referenties. */
export default function SharePointDocumentenSectie() {
  const [antwoord, setAntwoord] = useState<Antwoord | null>(null);
  const [bezig, setBezig] = useState(false);
  const [pad, setPad] = useState<string>("");

  const laad = useCallback(async () => {
    setBezig(true);
    try {
      const r = await fetch("/api/microsoft/sharepoint/documenten", { cache: "no-store" });
      const json = await r.json().catch(() => ({ beschikbaar: false })) as Antwoord;
      setAntwoord(r.ok || json.beschikbaar ? json : { beschikbaar: false });
    } catch {
      setAntwoord({ beschikbaar: false });
    } finally {
      setBezig(false);
    }
  }, []);

  useEffect(() => {
    let actief = true;
    void (async () => {
      try {
        const r = await fetch("/api/microsoft/sharepoint/documenten", { cache: "no-store" });
        const json = await r.json().catch(() => ({ beschikbaar: false })) as Antwoord;
        if (actief) setAntwoord(r.ok || json.beschikbaar ? json : { beschikbaar: false });
      } catch {
        if (actief) setAntwoord({ beschikbaar: false });
      }
    })();
    return () => { actief = false; };
  }, []);

  const documenten = useMemo(() => antwoord?.documenten ?? [], [antwoord]);
  const mapRefVanPad = useMemo(
    () => new Map((antwoord?.mapRefs ?? []).map((map) => [map.mappad, map])),
    [antwoord]
  );
  const submappen = useMemo(() => {
    const direct = new Set<string>();
    const prefix = pad ? `${pad}/` : "";
    for (const map of antwoord?.mappen ?? []) {
      if (!map.startsWith(prefix) || map === pad) continue;
      const rest = map.slice(prefix.length);
      if (rest) direct.add(rest.split("/")[0]);
    }
    return [...direct].sort((a, b) => a.localeCompare(b, "nl"));
  }, [antwoord, pad]);
  const zichtbaar = useMemo(() => documenten.filter((d) => d.mappad === pad), [documenten, pad]);
  const kruimels = pad ? pad.split("/") : [];

  if (!antwoord?.beschikbaar) return null;
  if (!antwoord.bron && !antwoord.error) return null;

  return (
    <div className="portal-card overflow-hidden mt-6">
      <div className="portal-card-header">
        <h2 className="portal-card-title flex items-center gap-2">
          <span className="portal-status-pill border border-line bg-app-surface text-muted">SharePoint</span>
          {antwoord.bron?.weergavenaam ?? "SharePoint-documenten"}
        </h2>
        <div className="flex items-center gap-3">
          <span className="portal-status-pill border border-line bg-app-surface text-muted">
            {documenten.length} {documenten.length === 1 ? "document" : "documenten"}
          </span>
          <button type="button" disabled={bezig} onClick={() => void laad()} className="text-xs font-semibold text-accent hover:underline disabled:opacity-50">
            {bezig ? "Vernieuwen…" : "Vernieuwen"}
          </button>
        </div>
      </div>
      {antwoord.error ? (
        <p className="px-4 py-3 text-sm text-muted" role="status">{antwoord.error}</p>
      ) : (
        <>
          <p className="px-4 py-2 text-xs text-muted flex flex-wrap items-center gap-1 border-b border-line">
            <span>Live uit SharePoint met uw eigen rechten; geen kopie in het portaal.</span>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => setPad("")} className="underline">{antwoord.bron?.map || antwoord.bron?.bibliotheek || "Hoofdmap"}</button>
            {kruimels.map((naam, index) => (
              <span key={`${index}-${naam}`}>/ <button type="button" onClick={() => setPad(kruimels.slice(0, index + 1).join("/"))} className="underline">{naam}</button></span>
            ))}
          </p>
          {antwoord.afgekapt && (
            <p className="px-4 py-2 text-xs text-muted border-b border-line" role="status">Niet alle documenten konden worden getoond: de bron is groter dan het maximum voor één weergave.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed text-[13px]">
              <thead>
                <tr className="bg-app-zebra text-left align-middle text-[10.5px] font-bold uppercase tracking-wider text-muted">
                  <th className="w-[72px] px-4 py-2">Type</th>
                  <th className="px-2 py-2">Document</th>
                  <th className="w-[90px] px-2 py-2">Omvang</th>
                  <th className="w-[120px] px-2 py-2">Gewijzigd</th>
                  <th className="w-[72px] px-2 py-2 text-center">Acties</th>
                </tr>
              </thead>
              <tbody>
                {submappen.map((naam) => {
                  const volgendPad = pad ? `${pad}/${naam}` : naam;
                  const mapRef = mapRefVanPad.get(volgendPad);
                  return (
                    <tr key={`map-${naam}`} className="border-t border-line">
                      <td className="px-4 py-2"><span className={TYPE_BLOK}>Map</span></td>
                      <td className="px-2 py-2 truncate" colSpan={3}>
                        <button type="button" onClick={() => setPad(volgendPad)} className="font-medium text-ink hover:underline">{naam}</button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Actiemenu label={naam}>{(sluit) => (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => { sluit(); setPad(volgendPad); }}
                              className="w-full px-4 py-2 text-left text-sm text-ink hover:bg-app-bg"
                            >
                              Map openen
                            </button>
                            {antwoord.aiContextBeschikbaar === true && mapRef && (
                              <AssistentIngang
                                ingangen={[{ soort: "sharepoint", objectsoort: "map", ref: mapRef.ref }]}
                                module="bibliotheek"
                                role="menuitem"
                                onClick={sluit}
                                className="block px-4 py-2 text-sm font-medium text-ink hover:bg-warn-tint"
                                title="Open de assistent met deze SharePoint-map als context"
                              >
                                Vraag de AI over deze map
                              </AssistentIngang>
                            )}
                          </>
                        )}</Actiemenu>
                      </td>
                    </tr>
                  );
                })}
                {zichtbaar.map((doc) => (
                  <tr key={doc.ref} className="border-t border-line">
                    <td className="px-4 py-2"><span className={TYPE_BLOK}>{doc.bestandstype ? TYPE_LABEL[doc.bestandstype] ?? doc.bestandstype : "—"}</span></td>
                    <td className="px-2 py-2 truncate">
                      {doc.previewMogelijk
                        ? <Link href={`/bibliotheek/sharepoint/${doc.ref}`} className="font-medium text-ink hover:underline">{doc.naam}</Link>
                        : <span className="font-medium text-ink">{doc.naam}</span>}
                    </td>
                    <td className="px-2 py-2 text-muted">{grootteLabel(doc.grootte)}</td>
                    <td className="px-2 py-2 text-muted">{doc.gewijzigdOp ? new Date(doc.gewijzigdOp).toLocaleDateString("nl-NL") : "—"}</td>
                    <td className="px-2 py-2 text-center">
                      <Actiemenu label={doc.naam}>{(sluit) => (
                        <>
                          {doc.previewMogelijk && (
                            <Link
                              role="menuitem"
                              href={`/bibliotheek/sharepoint/${doc.ref}`}
                              onClick={sluit}
                              className="block px-4 py-2 text-sm text-ink hover:bg-app-bg"
                            >
                              Bekijken
                            </Link>
                          )}
                          {antwoord.aiContextBeschikbaar === true && doc.bestandstype && AI_TYPES.has(doc.bestandstype) && (
                            <AssistentIngang
                              ingangen={[{ soort: "sharepoint", objectsoort: "document", ref: doc.ref }]}
                              module="bibliotheek"
                              role="menuitem"
                              onClick={sluit}
                              className="block px-4 py-2 text-sm font-medium text-ink hover:bg-warn-tint"
                              title="Open de assistent met dit SharePoint-document als context"
                            >
                              Vraag de AI over dit document
                            </AssistentIngang>
                          )}
                          {doc.webUrl && (
                            <a
                              role="menuitem"
                              href={doc.webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={sluit}
                              className="block px-4 py-2 text-sm text-ink hover:bg-app-bg"
                            >
                              Openen in Microsoft 365
                            </a>
                          )}
                          {!doc.previewMogelijk && !doc.webUrl && (
                            <span className="block px-4 py-2 text-sm text-muted">Geen acties beschikbaar</span>
                          )}
                        </>
                      )}</Actiemenu>
                    </td>
                  </tr>
                ))}
                {submappen.length === 0 && zichtbaar.length === 0 && (
                  <tr className="border-t border-line"><td colSpan={5} className="px-4 py-3 text-sm text-muted">Geen documenten in deze map.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
