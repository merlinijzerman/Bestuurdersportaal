"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Preview = { url: string; naam: string; bestandstype: string; webUrl: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browserpreview van een SharePoint-document. De kortlevende URL wordt per
 * paginabezoek opgehaald, alleen als iframe-bron gebruikt en nooit in de
 * adresbalk, opslag of logging gezet. Deze route heeft een eigen CSP met
 * frame-src voor *.sharepoint.com (next.config.ts). */
export default function SharePointPreviewPagina() {
  const params = useParams<{ ref: string }>();
  const ref = typeof params?.ref === "string" && UUID.test(params.ref) ? params.ref : null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fout, setFout] = useState<string | null>(ref ? null : "Ongeldige documentreferentie.");

  useEffect(() => {
    if (!ref) return;
    let actief = true;
    void (async () => {
      try {
        const r = await fetch(`/api/microsoft/sharepoint/documenten/${ref}/preview`, { method: "POST", cache: "no-store" });
        const json = await r.json().catch(() => ({})) as Partial<Preview> & { error?: string };
        if (!actief) return;
        if (!r.ok || !json.url) { setFout(json.error ?? "Er is nu geen preview beschikbaar."); return; }
        setPreview({ url: json.url, naam: json.naam ?? "Document", bestandstype: json.bestandstype ?? "", webUrl: json.webUrl ?? null });
      } catch {
        if (actief) setFout("Er is nu geen preview beschikbaar.");
      }
    })();
    return () => { actief = false; };
  }, [ref]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-line bg-white">
        <div className="min-w-0 flex items-center gap-3">
          <Link href="/bibliotheek" className="text-sm text-muted hover:underline shrink-0">← Bibliotheek</Link>
          <span className="portal-status-pill border border-line bg-app-surface text-muted shrink-0">SharePoint</span>
          <h1 className="font-bold text-ink truncate">{preview?.naam ?? "Documentpreview"}</h1>
        </div>
        {preview?.webUrl && (
          <a href={preview.webUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent hover:underline shrink-0">Openen in Microsoft 365</a>
        )}
      </div>
      {fout ? (
        <div className="p-6 text-sm text-muted" role="status">{fout}</div>
      ) : preview ? (
        <iframe
          title={`Preview van ${preview.naam}`}
          src={preview.url}
          className="flex-1 w-full border-0 bg-app-bg"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          allow=""
        />
      ) : (
        <div className="p-6 text-sm text-muted" role="status">Preview wordt opgehaald…</div>
      )}
    </div>
  );
}
