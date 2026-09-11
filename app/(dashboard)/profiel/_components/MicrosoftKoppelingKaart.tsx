"use client";
import { useCallback, useEffect, useState } from "react";

type Status = {
  beschikbaar: boolean;
  gekoppeld?: boolean;
  verbinding?: {
    status: string;
    weergavenaam: string | null;
    gebruikersnaam: string | null;
    tenantReferentie: string;
    laatstGetestOp: string | null;
  } | null;
};

async function haalStatus(): Promise<Status> {
  try {
    const response = await fetch("/api/microsoft/status", { cache: "no-store" });
    return response.ok ? await response.json() : { beschikbaar: false };
  } catch {
    return { beschikbaar: false };
  }
}

export default function MicrosoftKoppelingKaart() {
  const [status, setStatus] = useState<Status | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => setStatus(await haalStatus()), []);

  useEffect(() => {
    let actief = true;
    void haalStatus().then((resultaat) => {
      if (actief) setStatus(resultaat);
    });
    return () => { actief = false; };
  }, []);
  if (!status?.beschikbaar) return null;

  const test = async () => {
    setBezig(true);
    setMelding(null);
    try {
      const response = await fetch("/api/microsoft/test", { method: "POST" });
      setMelding(response.ok
        ? "Verbinding succesvol getest."
        : "Test mislukt. Koppel opnieuw om te herstellen.");
      await laad();
    } catch {
      setMelding("Test mislukt. Controleer de verbinding en probeer opnieuw.");
    } finally {
      setBezig(false);
    }
  };

  const ontkoppel = async () => {
    if (!confirm("Lokaal ontkoppelen? Het portaal verwijdert zijn tokenmateriaal; Microsoft-consent kan afzonderlijk blijven bestaan.")) return;
    setBezig(true);
    setMelding(null);
    try {
      const response = await fetch("/api/microsoft/connectie", { method: "DELETE" });
      setMelding(response.ok
        ? "Lokaal ontkoppeld. Microsoft-consent is niet automatisch ingetrokken."
        : "Ontkoppelen mislukt.");
      await laad();
    } catch {
      setMelding("Ontkoppelen mislukt. Controleer de verbinding en probeer opnieuw.");
    } finally {
      setBezig(false);
    }
  };

  return (
    <section className="bg-white border border-line rounded-xl p-5 mb-6">
      <h2 className="font-bold text-ink mb-1">Microsoft 365-koppeling</h2>
      <p className="text-sm text-muted mb-4">
        Beveiligde accountkoppeling voor Microsoft 365-functies. Beschikbaarheid van Outlook en SharePoint wordt afzonderlijk per fonds ingesteld.
      </p>
      {status.gekoppeld && status.verbinding ? (
        <div className="space-y-3 text-sm">
          <p className="text-ok-ink font-medium">Gekoppeld</p>
          <p>
            {status.verbinding.weergavenaam ?? "Microsoft-account"}
            {status.verbinding.gebruikersnaam ? ` · ${status.verbinding.gebruikersnaam}` : ""}
          </p>
          <p className="text-xs text-muted">
            Tenantreferentie: {status.verbinding.tenantReferentie} · Laatst gecontroleerd:{" "}
            {status.verbinding.laatstGetestOp
              ? new Date(status.verbinding.laatstGetestOp).toLocaleString("nl-NL")
              : "nog niet"}
          </p>
          <div className="flex gap-3">
            <button disabled={bezig} onClick={() => void test()} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
              Verbinding testen
            </button>
            <button disabled={bezig} onClick={() => void ontkoppel()} className="border border-app-line-strong text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
              Lokaal ontkoppelen
            </button>
          </div>
        </div>
      ) : (
        <a href="/api/microsoft/connect?returnTo=/profiel" className="inline-flex bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg">
          Microsoft-account koppelen
        </a>
      )}
      {melding && <p className="mt-4 text-sm text-muted" role="status">{melding}</p>}
    </section>
  );
}
