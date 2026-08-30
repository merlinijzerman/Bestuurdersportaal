"use client";

import { useEffect, useState } from "react";

type Notitie = {
  id: string;
  tekst: string;
  auteur: string;
  auteur_naam: string;
  aangemaakt_op: string;
  bewerkt_op: string | null;
};

const HINT = "Een aantekening is werkverkeer, geen verantwoording. Wat een besluit, vervulling of afwijking raakt hoort in de motivering of bij de vereiste. Deze aantekening verschijnt niet in het afschrift, maar is wél opvraagbaar bij een geschil of toezichtsvraag.";

function datum(iso: string) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export default function AantekeningenBlok({
  procedureId,
  stapId,
  kanBeheren,
  alleenLezen,
  currentUserId,
}: {
  procedureId: string;
  stapId: string;
  kanBeheren: boolean;
  alleenLezen: boolean;
  currentUserId: string;
}) {
  const basis = `/api/procedures/${procedureId}/stappen/${stapId}/notities`;
  const [notities, setNotities] = useState<Notitie[]>([]);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [nieuw, setNieuw] = useState(false);
  const [tekst, setTekst] = useState("");
  const [bewerkId, setBewerkId] = useState<string | null>(null);
  const [alles, setAlles] = useState(false);
  const [bezig, setBezig] = useState(false);

  async function laad() {
    const res = await fetch(basis);
    const body = (await res.json().catch(() => ({}))) as { notities?: Notitie[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? "Aantekeningen laden mislukt");
    setNotities(body.notities ?? []);
  }

  useEffect(() => {
    let actief = true;
    // De state volgt hier uitsluitend het afgeronde externe fetch-resultaat; de
    // cleanup voorkomt een update wanneer intussen een andere stap is geopend.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    laad()
      .catch((error: unknown) => actief && setFout(error instanceof Error ? error.message : "Aantekeningen laden mislukt"))
      .finally(() => actief && setLaden(false));
    return () => { actief = false; };
  // basis verandert uitsluitend als er een andere stap in het paneel staat.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  async function bewaar(method: "POST" | "PATCH", id?: string) {
    const inhoud = tekst.trim();
    if (!inhoud) return;
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(id ? `${basis}/${id}` : basis, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tekst: inhoud }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Opslaan mislukt");
      setTekst("");
      setNieuw(false);
      setBewerkId(null);
      await laad();
    } catch (error) {
      setFout(error instanceof Error ? error.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function verwijderen(id: string) {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`${basis}/${id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Verwijderen mislukt");
      await laad();
    } catch (error) {
      setFout(error instanceof Error ? error.message : "Verwijderen mislukt");
    } finally {
      setBezig(false);
    }
  }

  const zichtbareNotities = alles ? notities : notities.slice(0, 3);
  const magToevoegen = kanBeheren && !alleenLezen;

  return (
    <section className="mt-6 pt-5 border-t border-line" aria-label="Aantekeningen">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[11px] uppercase tracking-wide text-muted font-semibold">Aantekeningen</h3>
        {magToevoegen && !nieuw && (
          <button type="button" onClick={() => setNieuw(true)} className="text-xs text-accent hover:underline">+ Aantekening</button>
        )}
      </div>
      {fout && <p className="mb-2 px-2.5 py-1.5 rounded border border-err/30 bg-err-tint text-xs text-err-ink">{fout}</p>}
      {nieuw && (
        <NotitieForm
          tekst={tekst}
          setTekst={setTekst}
          bezig={bezig}
          onAnnuleer={() => { setNieuw(false); setTekst(""); }}
          onOpslaan={() => bewaar("POST")}
        />
      )}
      {laden ? (
        <p className="text-sm text-muted italic">Aantekeningen laden…</p>
      ) : notities.length === 0 ? (
        <p className="text-sm text-muted italic">Nog geen aantekeningen bij deze stap.</p>
      ) : (
        <div className="space-y-2">
          {zichtbareNotities.map((notitie) => (
            <div key={notitie.id} className="border border-line rounded-lg p-2.5">
              {bewerkId === notitie.id ? (
                <NotitieForm
                  tekst={tekst}
                  setTekst={setTekst}
                  bezig={bezig}
                  onAnnuleer={() => { setBewerkId(null); setTekst(""); }}
                  onOpslaan={() => bewaar("PATCH", notitie.id)}
                />
              ) : (
                <>
                  <p className="text-[13px] text-ink whitespace-pre-line">{notitie.tekst}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">{notitie.auteur_naam} · {datum(notitie.aangemaakt_op)}{notitie.bewerkt_op ? " · bewerkt" : ""}</span>
                    {magToevoegen && notitie.auteur === currentUserId && (
                      <span className="flex gap-2 shrink-0">
                        <button type="button" onClick={() => { setBewerkId(notitie.id); setTekst(notitie.tekst); }} className="text-[11px] text-accent hover:underline">Bewerken</button>
                        <button type="button" disabled={bezig} onClick={() => verwijderen(notitie.id)} className="text-[11px] text-err-ink hover:underline disabled:opacity-50">Verwijderen</button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          {notities.length > 3 && (
            <button type="button" onClick={() => setAlles((waarde) => !waarde)} className="text-xs text-accent hover:underline">
              {alles ? "Toon minder" : `Toon alle ${notities.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function NotitieForm({ tekst, setTekst, bezig, onAnnuleer, onOpslaan }: {
  tekst: string;
  setTekst: (waarde: string) => void;
  bezig: boolean;
  onAnnuleer: () => void;
  onOpslaan: () => void;
}) {
  return (
    <div className="mb-3 p-3 border border-accent/40 bg-accent-tint rounded-lg space-y-2">
      <textarea rows={3} value={tekst} onChange={(event) => setTekst(event.target.value)} placeholder="Bijv. gebeld met de actuaris, cijfers volgen volgende week." className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none bg-white" />
      <p className="text-[11px] text-muted leading-snug">{HINT}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnuleer} className="text-xs px-3 py-1.5 border border-line rounded bg-white hover:border-accent">Annuleren</button>
        <button type="button" disabled={bezig || !tekst.trim()} onClick={onOpslaan} className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50">{bezig ? "Bezig…" : "Opslaan"}</button>
      </div>
    </div>
  );
}
