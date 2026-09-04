"use client";
import { useCallback, useEffect, useState } from "react";

type Status = { beschikbaar: boolean; magBeheren?: boolean; toestemmingVereist?: boolean; configuratie?: { agenda: string; status: string; laatstGeluktOp: string | null; foutcategorie: string | null } | null };
type Agenda = { id: string; naam: string };
async function status(): Promise<Status> { const r = await fetch("/api/microsoft/outlook/status", { cache: "no-store" }); return r.ok ? r.json() : { beschikbaar: false }; }

export default function OutlookAgendaKaart() {
  const [waarde, setWaarde] = useState<Status | null>(null);
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const laad = useCallback(async () => setWaarde(await status()), []);
  useEffect(() => { void laad(); }, [laad]);
  if (!waarde?.beschikbaar) return null;
  const haalAgendas = async () => { setBezig(true); setMelding(null); try { const r = await fetch("/api/microsoft/outlook/agendas", { cache: "no-store" }); const json = await r.json() as { agendas?: Agenda[]; error?: string }; setAgendas(json.agendas ?? []); if (!r.ok) setMelding(json.error ?? "Agenda's kunnen niet worden geladen."); } catch { setMelding("Agenda's kunnen niet worden geladen."); } finally { setBezig(false); } };
  const kies = async (calendarId: string) => { setBezig(true); setMelding(null); try { const r = await fetch("/api/microsoft/outlook/agendas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calendarId }) }); setMelding(r.ok ? "Agenda gekozen. U kunt nu handmatig synchroniseren." : "Agenda kiezen mislukt."); if (r.ok) { setAgendas([]); await laad(); } } catch { setMelding("Agenda kiezen mislukt."); } finally { setBezig(false); } };
  const sync = async () => { setBezig(true); setMelding(null); try { const r = await fetch("/api/microsoft/outlook/sync", { method: "POST" }); const json = await r.json() as { gelezen?: number; aangemaakt?: number; bijgewerkt?: number; overgeslagen?: number; error?: string }; setMelding(r.ok ? `Synchronisatie gelukt: ${json.aangemaakt ?? 0} nieuw, ${json.bijgewerkt ?? 0} bijgewerkt, ${json.overgeslagen ?? 0} overgeslagen.` : (json.error ?? "Synchronisatie mislukt.")); await laad(); } catch { setMelding("Synchronisatie mislukt."); } finally { setBezig(false); } };
  return <section className="bg-white border border-line rounded-xl p-5 mb-6">
    <h2 className="font-bold text-ink mb-1">Outlook-agenda</h2>
    <p className="text-sm text-muted mb-4">Read-only pilot. Outlook blijft bron voor afspraakgegevens; portaalinhoud wordt niet verwijderd of overschreven.</p>
    {waarde.configuratie && <p className="text-sm mb-3">Gekozen agenda: <strong>{waarde.configuratie.agenda}</strong> · Status: {waarde.configuratie.status}{waarde.configuratie.laatstGeluktOp ? ` · Laatst gelukt: ${new Date(waarde.configuratie.laatstGeluktOp).toLocaleString("nl-NL")}` : ""}</p>}
    {waarde.magBeheren ? <div className="space-y-3">
      {waarde.toestemmingVereist ? <a href="/api/microsoft/outlook/toestemming?returnTo=/profiel" className="inline-flex bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg">Outlook-toestemming uitbreiden</a> : <>
        <div className="flex gap-3"><button disabled={bezig} onClick={() => void haalAgendas()} className="border border-app-line-strong text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Agenda kiezen</button>{waarde.configuratie && <button disabled={bezig} onClick={() => void sync()} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Nu synchroniseren</button>}</div>
        {agendas.length > 0 && <div className="border border-line rounded-lg divide-y">{agendas.map((agenda) => <button key={agenda.id} disabled={bezig} onClick={() => void kies(agenda.id)} className="block w-full text-left px-3 py-2 text-sm hover:bg-app-bg disabled:opacity-50">{agenda.naam}</button>)}</div>}
      </>}
    </div> : <p className="text-sm text-muted">Alleen een fondsbeheerder kan Outlook-toestemming, agenda en synchronisatie beheren.</p>}
    {melding && <p role="status" className="mt-4 text-sm text-muted">{melding}</p>}
  </section>;
}
