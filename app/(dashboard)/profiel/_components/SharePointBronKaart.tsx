"use client";
import { useCallback, useEffect, useState } from "react";

type Status = {
  beschikbaar: boolean;
  magBeheren?: boolean;
  toestemmingVereist?: boolean;
  bron?: { weergavenaam: string; site: string; bibliotheek: string; map: string; status: string; configuratieversie: number; laatstGecontroleerdOp: string | null; foutcategorie: string | null } | null;
};
type Kandidaat = { kandidaatId: string; weergavenaam: string; hostnaam: string; toegankelijk: boolean; foutcategorie: string | null };
type Drive = { driveId: string; weergavenaam: string };
type Map = { itemId: string; naam: string; aantalKinderen: number };
type Keuze = { kandidaat: Kandidaat; drive?: Drive; pad: Map[] };

const STATUS_LABEL: Record<string, string> = { actief: "Actief", fout: "Fout", toestemming_nodig: "Toestemming nodig", ontkoppeld: "Ontkoppeld" };

async function status(): Promise<Status> {
  try { const r = await fetch("/api/microsoft/sharepoint/status", { cache: "no-store" }); return r.ok ? r.json() : { beschikbaar: false }; }
  catch { return { beschikbaar: false }; }
}

export default function SharePointBronKaart() {
  const [waarde, setWaarde] = useState<Status | null>(null);
  const [kandidaten, setKandidaten] = useState<Kandidaat[] | null>(null);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [mappen, setMappen] = useState<Map[]>([]);
  const [keuze, setKeuze] = useState<Keuze | null>(null);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const laad = useCallback(async () => setWaarde(await status()), []);
  useEffect(() => {
    let actief = true;
    void status().then((resultaat) => { if (actief) setWaarde(resultaat); });
    return () => { actief = false; };
  }, []);
  if (!waarde?.beschikbaar) return null;

  const stopKiezen = () => { setKandidaten(null); setDrives([]); setMappen([]); setKeuze(null); };
  const haalKandidaten = async () => {
    setBezig(true); setMelding(null);
    try {
      const r = await fetch("/api/microsoft/sharepoint/kandidaten", { cache: "no-store" });
      const json = await r.json() as { kandidaten?: Kandidaat[]; error?: string };
      if (!r.ok) { setMelding(json.error ?? "Kandidaatsites kunnen niet worden geladen."); return; }
      setKandidaten(json.kandidaten ?? []);
      if ((json.kandidaten ?? []).length === 0) setMelding("Er is nog geen kandidaatsite geregistreerd. Laat de platformbeheerder een site aanwijzen.");
    } catch { setMelding("Kandidaatsites kunnen niet worden geladen."); } finally { setBezig(false); }
  };
  const kiesKandidaat = async (kandidaat: Kandidaat) => {
    setBezig(true); setMelding(null); setKeuze({ kandidaat, pad: [] }); setMappen([]);
    try {
      const r = await fetch(`/api/microsoft/sharepoint/drives?kandidaat=${encodeURIComponent(kandidaat.kandidaatId)}`, { cache: "no-store" });
      const json = await r.json() as { drives?: Drive[]; error?: string };
      if (!r.ok) { setMelding(json.error ?? "Documentbibliotheken kunnen niet worden geladen."); return; }
      setDrives(json.drives ?? []);
    } catch { setMelding("Documentbibliotheken kunnen niet worden geladen."); } finally { setBezig(false); }
  };
  const laadMappen = async (basis: Keuze) => {
    if (!basis.drive) return;
    setBezig(true); setMelding(null);
    try {
      const params = new URLSearchParams({ kandidaat: basis.kandidaat.kandidaatId, drive: basis.drive.driveId });
      for (const map of basis.pad) params.append("map", map.itemId);
      const r = await fetch(`/api/microsoft/sharepoint/mappen?${params.toString()}`, { cache: "no-store" });
      const json = await r.json() as { mappen?: Map[]; afgekapt?: boolean; error?: string };
      if (!r.ok) { setMelding(json.error ?? "Mappen kunnen niet worden geladen."); return; }
      setMappen(json.mappen ?? []);
      if (json.afgekapt) setMelding("Niet alle mappen konden worden getoond; kies een specifiekere map.");
    } catch { setMelding("Mappen kunnen niet worden geladen."); } finally { setBezig(false); }
  };
  const kiesDrive = async (drive: Drive) => { if (!keuze) return; const nieuw = { ...keuze, drive, pad: [] }; setKeuze(nieuw); await laadMappen(nieuw); };
  const openMap = async (map: Map) => { if (!keuze) return; const nieuw = { ...keuze, pad: [...keuze.pad, map] }; setKeuze(nieuw); await laadMappen(nieuw); };
  const naarNiveau = async (index: number) => { if (!keuze) return; const nieuw = { ...keuze, pad: keuze.pad.slice(0, index) }; setKeuze(nieuw); await laadMappen(nieuw); };
  const bevestig = async () => {
    if (!keuze?.drive) return;
    setBezig(true); setMelding(null);
    try {
      const r = await fetch("/api/microsoft/sharepoint/bron", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kandidaatId: keuze.kandidaat.kandidaatId, driveId: keuze.drive.driveId, mapItemIds: keuze.pad.map((x) => x.itemId) }) });
      const json = await r.json().catch(() => ({})) as { error?: string };
      setMelding(r.ok ? "SharePoint-bron gekozen. Documenten verschijnen na activering van de documentweergave in de bibliotheek." : (json.error ?? "Bron kiezen mislukt."));
      if (r.ok) { stopKiezen(); await laad(); }
    } catch { setMelding("Bron kiezen mislukt."); } finally { setBezig(false); }
  };
  const controleer = async () => {
    setBezig(true); setMelding(null);
    try { const r = await fetch("/api/microsoft/sharepoint/bron/controle", { method: "POST" }); const json = await r.json().catch(() => ({})) as { error?: string }; setMelding(r.ok ? "Bron bereikbaar met uw huidige Microsoft-rechten." : (json.error ?? "Controle mislukt.")); await laad(); }
    catch { setMelding("Controle mislukt."); } finally { setBezig(false); }
  };
  const ontkoppel = async () => {
    if (!confirm("SharePoint-bron lokaal ontkoppelen? Het portaal toont dan geen SharePoint-documenten meer; de site-toegang in Microsoft 365 blijft bestaan.")) return;
    setBezig(true); setMelding(null);
    try { const r = await fetch("/api/microsoft/sharepoint/bron", { method: "DELETE" }); setMelding(r.ok ? "Bron lokaal ontkoppeld." : "Ontkoppelen mislukt."); await laad(); }
    catch { setMelding("Ontkoppelen mislukt."); } finally { setBezig(false); }
  };

  return <section className="bg-white border border-line rounded-xl p-5 mb-6">
    <h2 className="font-bold text-ink mb-1">SharePoint-documenten</h2>
    <p className="text-sm text-muted mb-4">Read-only pilot. Documenten blijven in SharePoint; het portaal toont en previewt alleen wat u daar zelf mag zien en bewaart geen bestandskopie.</p>
    {waarde.bron && <p className="text-sm mb-3">Gekozen bron: <strong>{waarde.bron.weergavenaam}</strong> · Status: {STATUS_LABEL[waarde.bron.status] ?? waarde.bron.status}{waarde.bron.laatstGecontroleerdOp ? ` · Laatst gecontroleerd: ${new Date(waarde.bron.laatstGecontroleerdOp).toLocaleString("nl-NL")}` : ""}{waarde.bron.foutcategorie ? ` · Foutcategorie: ${waarde.bron.foutcategorie}` : ""}</p>}
    {waarde.toestemmingVereist
      ? <a href="/api/microsoft/sharepoint/toestemming?returnTo=/profiel" className="inline-flex bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg mb-3">SharePoint-toestemming verlenen</a>
      : <p className="text-sm text-ok-ink font-medium mb-3">SharePoint-toestemming verleend voor uw account.</p>}
    {waarde.magBeheren ? <div className="space-y-3">
      {!waarde.toestemmingVereist && <div className="flex flex-wrap gap-3">
        <button disabled={bezig} onClick={() => void (kandidaten ? stopKiezen() : haalKandidaten())} className="border border-app-line-strong text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">{kandidaten ? "Kiezen annuleren" : "Bron kiezen"}</button>
        {waarde.bron && <button disabled={bezig} onClick={() => void controleer()} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Bron controleren</button>}
        {waarde.bron && <button disabled={bezig} onClick={() => void ontkoppel()} className="border border-app-line-strong text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Bron ontkoppelen</button>}
      </div>}
      {kandidaten && !keuze && kandidaten.length > 0 && <div className="border border-line rounded-lg divide-y">
        {kandidaten.map((kandidaat) => <button key={kandidaat.kandidaatId} disabled={bezig || !kandidaat.toegankelijk} onClick={() => void kiesKandidaat(kandidaat)} className="block w-full text-left px-3 py-2 text-sm hover:bg-app-bg disabled:opacity-50">
          {kandidaat.weergavenaam} <span className="text-muted">· {kandidaat.hostnaam}</span>{!kandidaat.toegankelijk && <span className="text-muted"> · niet toegankelijk ({kandidaat.foutcategorie ?? "onbekend"})</span>}
        </button>)}
      </div>}
      {keuze && !keuze.drive && <div className="border border-line rounded-lg divide-y">
        <p className="px-3 py-2 text-xs text-muted">Documentbibliotheek in {keuze.kandidaat.weergavenaam}</p>
        {drives.map((drive) => <button key={drive.driveId} disabled={bezig} onClick={() => void kiesDrive(drive)} className="block w-full text-left px-3 py-2 text-sm hover:bg-app-bg disabled:opacity-50">{drive.weergavenaam}</button>)}
        {drives.length === 0 && !bezig && <p className="px-3 py-2 text-sm text-muted">Geen documentbibliotheek gevonden.</p>}
      </div>}
      {keuze?.drive && <div className="border border-line rounded-lg">
        <p className="px-3 py-2 text-xs text-muted flex flex-wrap gap-1">
          <button type="button" disabled={bezig} onClick={() => void naarNiveau(0)} className="underline disabled:opacity-50">{keuze.drive.weergavenaam}</button>
          {keuze.pad.map((map, index) => <span key={map.itemId}>/ <button type="button" disabled={bezig} onClick={() => void naarNiveau(index + 1)} className="underline disabled:opacity-50">{map.naam}</button></span>)}
        </p>
        <div className="divide-y border-t border-line">
          {mappen.map((map) => <button key={map.itemId} disabled={bezig} onClick={() => void openMap(map)} className="block w-full text-left px-3 py-2 text-sm hover:bg-app-bg disabled:opacity-50">{map.naam} <span className="text-muted">· {map.aantalKinderen} items</span></button>)}
          {mappen.length === 0 && !bezig && <p className="px-3 py-2 text-sm text-muted">Geen submappen.</p>}
        </div>
        <div className="px-3 py-2 border-t border-line">
          <button disabled={bezig} onClick={() => void bevestig()} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">{keuze.pad.length > 0 ? `Map "${keuze.pad[keuze.pad.length - 1].naam}" als bron gebruiken` : "Hele bibliotheek als bron gebruiken"}</button>
        </div>
      </div>}
    </div> : <p className="text-sm text-muted">Alleen een fondsbeheerder kan de SharePoint-bron kiezen, controleren of ontkoppelen.</p>}
    {melding && <p role="status" className="mt-4 text-sm text-muted">{melding}</p>}
  </section>;
}
