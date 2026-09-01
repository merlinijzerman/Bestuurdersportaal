"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Snapshot = { stappen: number; kritiek: number; vereist: number; optioneel: number };
type Beëindiging = { motivering: string | null; actor: string | null; tijdstip: string | null } | null;

export default function ProcedureEindstatusActie({
  procedureId,
  isBeeindigd,
  kanBeeindigen,
  kanHeropenen,
  snapshot,
  beeindiging,
}: {
  procedureId: string;
  isBeeindigd: boolean;
  kanBeeindigen: boolean;
  kanHeropenen: boolean;
  snapshot: Snapshot;
  beeindiging: Beëindiging;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivering, setMotivering] = useState("");
  const [redenType, setRedenType] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const heropen = isBeeindigd;
  const mag = heropen ? kanHeropenen : kanBeeindigen;
  if (!mag && !beeindiging) return null;

  async function verstuur() {
    if (motivering.trim().length < 10) {
      setFout(`Dit proces ${heropen ? "heropenen" : "beëindigen"} vereist een motivering van minimaal 10 tekens.`);
      return;
    }
    if (heropen && !redenType) {
      setFout("Kies een reden om dit proces te heropenen.");
      return;
    }
    setBezig(true); setFout(null);
    try {
      const res = await fetch(`/api/procedures/${procedureId}/${heropen ? "heropenen" : "beeindigen"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(heropen ? { motivering: motivering.trim(), reden_type: redenType } : { motivering: motivering.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOpen(false); setMotivering(""); setRedenType(""); router.refresh();
    } catch (e) { setFout(e instanceof Error ? e.message : "De statuswijziging is niet gelukt."); }
    finally { setBezig(false); }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {beeindiging && (
        <span className="text-xs text-warn-ink bg-warn-tint border border-warn/30 rounded-md px-2 py-1">
          Dit proces is beëindigd{beeindiging.actor ? ` door ${beeindiging.actor}` : ""}. {beeindiging.motivering ?? "Motivering in audit-trail."}
        </span>
      )}
      {mag && <button type="button" onClick={() => { setFout(null); setOpen(true); }} className="text-xs text-muted hover:text-ink border border-line hover:border-accent rounded-md px-2 py-1">
        {heropen ? "Dit proces heropenen" : "Dit proces beëindigen"}
      </button>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-20" role="dialog" aria-modal="true" onClick={() => !bezig && setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-ink font-semibold text-lg">{heropen ? "Dit proces heropenen" : "Dit proces beëindigen"}</h2>
            {heropen ? <p className="text-sm text-muted mt-2">Dit proces wordt hervat. Kies waarom; deze handeling is iets anders dan een besluit heropenen.</p> : <>
              <p className="text-sm text-muted mt-2">Het proces stopt hier. Openstaande stappen vervallen en blijven zichtbaar in het dossier. Uw motivering en uw naam worden vastgelegd en zijn daarna niet meer te wijzigen.</p>
              <div className="mt-4 rounded-lg border border-line bg-app-bg p-3 text-sm text-ink"><b>Wat vervalt</b><div className="mt-1 text-muted">{snapshot.stappen} openstaande stap{snapshot.stappen === 1 ? "" : "pen"} · {snapshot.kritiek} kritiek · {snapshot.vereist} vereist · {snapshot.optioneel} optioneel</div></div>
            </>}
            <div className="mt-4 space-y-3">
              {heropen && <label className="block text-xs font-medium text-muted">Reden <select value={redenType} onChange={(e) => setRedenType(e.target.value)} disabled={bezig} className="mt-1 w-full border border-line rounded-md px-3 py-2 text-sm bg-white"><option value="">Kies een reden…</option><option value="ten_onrechte_beeindigd">Ten onrechte beëindigd</option><option value="hervat_na_gewijzigde_omstandigheden">Hervat na gewijzigde omstandigheden</option></select></label>}
              <label className="block text-xs font-medium text-muted">Motivering <span className="text-err-ink">*</span><textarea value={motivering} onChange={(e) => setMotivering(e.target.value)} rows={3} disabled={bezig} placeholder={heropen ? "Waarom wordt dit proces hervat?" : "Waarom stopt dit proces, en wat gebeurt er met wat nog openstond?"} className="mt-1 w-full border border-line rounded-md px-3 py-2 text-sm resize-y" /></label>
              <p className="text-xs text-muted">Wordt vastgelegd met uw naam en datum als onderdeel van dit dossier.</p>
              {fout && <div className="bg-err-tint border border-err/30 rounded-md p-2.5 text-xs text-err-ink">{fout}</div>}
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} disabled={bezig} className="text-sm text-muted px-3 py-1.5">Annuleer</button><button type="button" onClick={verstuur} disabled={bezig || motivering.trim().length < 10 || (heropen && !redenType)} className="text-sm bg-accent text-white rounded-md px-3 py-1.5 disabled:opacity-50">{bezig ? "Bezig…" : heropen ? "Dit proces heropenen" : "Dit proces beëindigen"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
