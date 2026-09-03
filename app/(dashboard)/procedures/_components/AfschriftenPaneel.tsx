"use client";

// T6 E1–E4 — Afschriften-paneel op de procespagina. Toont de vastgelegde
// auditbundels, laat een nieuw afschrift aanmaken (async: pollt tot 'gereed'),
// downloaden (redirect naar kortlevende signed URL), en intrekken (geen delete).
// De bureau-rol ziet de rijen wél, maar zonder downloadknop (met reden).

import { useCallback, useEffect, useRef, useState } from "react";
import { maakIdempotentVerzoek } from "@/core/lib/idempotency-key";

interface Afschrift {
  id: string;
  versie: "actueel" | "besluitmoment";
  aanleiding: string | null;
  status: "bezig" | "gereed" | "mislukt";
  bytes: number | null;
  bestandsaantal: number | null;
  sha256Prefix: string | null;
  bevatStemgedrag: boolean;
  aangemaaktOp: string;
  aangemaaktDoorNaam: string | null;
  ingetrokken: boolean;
  ingetrokkenReden: string | null;
  ingetrokkenDoorNaam: string | null;
  verouderd: boolean;
  verouderdSindsdien: number;
  magDownloaden: boolean;
  nietDownloadbaarReden: string | null;
}

function formatDatumTijd(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function formatMB(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AfschriftenPaneel({
  procedureId,
  currentUserIsBureau,
}: {
  procedureId: string;
  currentUserIsBureau: boolean;
}) {
  const [afschriften, setAfschriften] = useState<Afschrift[]>([]);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [aanleiding, setAanleiding] = useState("");
  const [versie, setVersie] = useState<"actueel" | "besluitmoment">("actueel");
  const [bezig, setBezig] = useState(false);
  // Fase 2: conceptleeswijzer-tussenscherm.
  const [concept, setConcept] = useState<{ hoeVerlopen: string; watVastgelegd: string; bijzonderheden: string } | null>(null);
  const [conceptMeta, setConceptMeta] = useState<{ aiGebruikt: boolean; model: string | null; promptversie: string | null; reden?: string } | null>(null);
  const [conceptBezig, setConceptBezig] = useState(false);
  const [intrekId, setIntrekId] = useState<string | null>(null);
  const [intrekReden, setIntrekReden] = useState("");
  const [traag, setTraag] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const pollCount = useRef(0);
  // ~5 minuten pollen (75 × 4s); daarna stoppen i.p.v. eeuwig doorgaan als de
  // worker down is of een rij vastloopt (code-review M6/L8).
  const MAX_POLLS = 75;

  const laadLijst = useCallback(async () => {
    try {
      const res = await fetch(`/api/procedures/${procedureId}/afschriften`, { cache: "no-store" });
      if (!res.ok) throw new Error("Kon afschriften niet laden.");
      const data = (await res.json()) as { afschriften: Afschrift[] };
      if (!mounted.current) return;
      setAfschriften(data.afschriften);
      if (data.afschriften.some((a) => a.status === "bezig")) {
        if (pollCount.current < MAX_POLLS) {
          pollCount.current += 1;
          if (pollTimer.current) clearTimeout(pollTimer.current);
          pollTimer.current = setTimeout(laadLijst, 4000);
        } else {
          setTraag(true);
        }
      } else {
        pollCount.current = 0;
        setTraag(false);
      }
    } catch (e) {
      if (mounted.current) setFout(e instanceof Error ? e.message : "Laden mislukt.");
    } finally {
      if (mounted.current) setLaden(false);
    }
  }, [procedureId]);

  useEffect(() => {
    mounted.current = true;
    laadLijst();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [laadLijst]);

  // Stap 1: conceptleeswijzer opstellen (AI op de feitenkaart, of sjabloon).
  async function conceptOpstellen() {
    setConceptBezig(true);
    setFout(null);
    try {
      const verzoek = maakIdempotentVerzoek();
      const res = await fetch(`/api/procedures/${procedureId}/afschrift/concept`, {
        method: "POST",
        headers: verzoek.headers(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Concept opstellen mislukt.");
      }
      const data = (await res.json()) as {
        tekst: { hoeVerlopen: string; watVastgelegd: string; bijzonderheden: string };
        aiGebruikt: boolean;
        model: string | null;
        promptversie: string | null;
        reden?: string;
      };
      setConcept(data.tekst);
      setConceptMeta({ aiGebruikt: data.aiGebruikt, model: data.model, promptversie: data.promptversie, reden: data.reden });
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Concept opstellen mislukt.");
    } finally {
      setConceptBezig(false);
    }
  }

  // Stap 2: de (geredigeerde) leeswijzer vaststellen en het afschrift bouwen.
  async function vaststellenEnAanmaken() {
    if (!concept || !conceptMeta) return;
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/procedures/${procedureId}/afschrift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aanleiding: aanleiding.trim() || null,
          versie,
          leeswijzerTekst: concept,
          // aiLeeswijzer geeft door dat AI de basis was; model/promptversie leidt
          // de server zelf af (provenance niet client-gestuurd).
          aiLeeswijzer: conceptMeta.aiGebruikt,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Aanmaken mislukt.");
      }
      setAanleiding("");
      setConcept(null);
      setConceptMeta(null);
      pollCount.current = 0;
      setTraag(false);
      await laadLijst();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Aanmaken mislukt.");
    } finally {
      setBezig(false);
    }
  }

  async function intrekken(id: string) {
    if (!intrekReden.trim()) {
      setFout("Een reden voor het intrekken is verplicht.");
      return;
    }
    try {
      const res = await fetch(`/api/procedures/${procedureId}/afschriften/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reden: intrekReden.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Intrekken mislukt.");
      }
      setIntrekId(null);
      setIntrekReden("");
      await laadLijst();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Intrekken mislukt.");
    }
  }

  return (
    <div className="bg-white border border-line rounded-xl p-5 space-y-4">
      {/* Genereerflow — tweetraps: invoer → conceptleeswijzer → vaststellen */}
      {!currentUserIsBureau && concept === null && (
        <div className="border border-line rounded-lg p-3 bg-app-bg space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Nieuw afschrift
          </div>
          <input
            type="text"
            value={aanleiding}
            onChange={(e) => setAanleiding(e.target.value)}
            placeholder="Aanleiding (bv. t.b.v. jaarrekeningcontrole 2026)"
            className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={versie}
              onChange={(e) => setVersie(e.target.value as "actueel" | "besluitmoment")}
              className="border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
            >
              <option value="actueel">Huidige stand</option>
              <option value="besluitmoment">Besluitmoment (bevroren snapshot)</option>
            </select>
            <button
              onClick={conceptOpstellen}
              disabled={conceptBezig}
              className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
            >
              {conceptBezig ? "Concept opstellen…" : "Concept leeswijzer opstellen →"}
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Je stelt eerst de begeleidende leeswijzer op, bekijkt en redigeert die, en stelt hem
            dan vast. Daarna wordt het afschrift op de achtergrond gebouwd.
          </p>
        </div>
      )}

      {/* Conceptleeswijzer — bewerkbaar tussenscherm (fase 2, G4) */}
      {!currentUserIsBureau && concept !== null && conceptMeta !== null && (
        <div className="border border-accent/40 rounded-lg p-3 bg-white space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-wide text-accent-ink font-semibold">
              Conceptleeswijzer — bekijk en redigeer
            </div>
            <span
              className={`text-[11px] px-2 py-0.5 rounded ${
                conceptMeta.aiGebruikt
                  ? "bg-accent-tint text-accent-ink"
                  : "bg-app-bg border border-line text-muted"
              }`}
            >
              {conceptMeta.aiGebruikt ? "Voorbereid met AI" : "Deterministisch sjabloon"}
            </span>
          </div>
          {conceptMeta.reden && (
            <p className="text-[11px] text-muted italic">{conceptMeta.reden}</p>
          )}
          <p className="text-[11px] text-muted">
            Deze tekst is <strong>toelichtend en niet-authoritatief</strong>. Leidend blijven de
            brondocumenten en het auditdossier. Wat je hier vaststelt, komt in de bundel.
          </p>

          {([
            ["hoeVerlopen", "2. Hoe het proces is verlopen"],
            ["watVastgelegd", "3. Wat is vastgelegd"],
            ["bijzonderheden", "4. Bijzonderheden en afwijkingen"],
          ] as const).map(([veld, label]) => (
            <div key={veld}>
              <label className="block text-[11px] font-semibold text-ink mb-1">{label}</label>
              <textarea
                rows={4}
                value={concept[veld]}
                onChange={(e) => setConcept({ ...concept, [veld]: e.target.value })}
                className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-y"
              />
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => { setConcept(null); setConceptMeta(null); }}
              disabled={bezig}
              className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent disabled:opacity-50"
            >
              Opnieuw
            </button>
            <button
              onClick={vaststellenEnAanmaken}
              disabled={bezig}
              className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Vaststellen en afschrift aanmaken"}
            </button>
          </div>
        </div>
      )}

      {fout && (
        <div className="text-sm text-err-ink bg-err-tint border border-err/30 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      {traag && (
        <div className="text-xs text-warn-ink bg-warn-tint border border-warn/30 rounded-lg px-3 py-2">
          Een afschrift wordt nog gebouwd, maar dat duurt langer dan verwacht. Ververs de
          pagina later om de status te zien.
        </div>
      )}

      {/* Lijst */}
      {laden ? (
        <div className="text-sm text-muted italic">Laden…</div>
      ) : afschriften.length === 0 ? (
        <div className="text-sm text-muted italic">Nog geen afschriften van dit proces.</div>
      ) : (
        <ul className="space-y-2">
          {afschriften.map((a) => (
            <li
              key={a.id}
              className={`border border-line rounded-lg p-3 ${a.ingetrokken ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium text-ink ${a.ingetrokken ? "line-through" : ""}`}>
                    Afschrift · {a.versie === "besluitmoment" ? "besluitmoment" : "actueel"} ·{" "}
                    {formatDatumTijd(a.aangemaaktOp)}
                    {a.aangemaaktDoorNaam ? ` · door ${a.aangemaaktDoorNaam}` : ""}
                  </div>
                  {a.aanleiding && (
                    <div className="text-xs text-muted mt-0.5 italic">&ldquo;{a.aanleiding}&rdquo;</div>
                  )}
                  <div className="text-xs text-muted mt-1">
                    {a.status === "gereed" ? (
                      <>
                        {a.bestandsaantal ?? "—"} bestanden · {formatMB(a.bytes)}
                        {a.sha256Prefix ? ` · sha256 ${a.sha256Prefix}…` : ""}
                      </>
                    ) : a.status === "bezig" ? (
                      <span className="text-warn-ink">Wordt gegenereerd…</span>
                    ) : (
                      <span className="text-err-ink">Genereren is mislukt.</span>
                    )}
                  </div>
                  {/* Badges */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {a.verouderd && (
                      <span className="text-[11px] text-warn-ink bg-warn-tint px-2 py-0.5 rounded font-medium">
                        Verouderd — sindsdien {a.verouderdSindsdien} gebeurtenis
                        {a.verouderdSindsdien === 1 ? "" : "sen"}
                      </span>
                    )}
                    {a.bevatStemgedrag && (
                      <span className="text-[11px] text-muted bg-app-bg border border-line px-2 py-0.5 rounded">
                        bevat stemgedrag
                      </span>
                    )}
                    {a.ingetrokken && (
                      <span className="text-[11px] text-err-ink">
                        Ingetrokken{a.ingetrokkenDoorNaam ? ` door ${a.ingetrokkenDoorNaam}` : ""}
                        {a.ingetrokkenReden ? ` — ${a.ingetrokkenReden}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                  {a.magDownloaden ? (
                    <a
                      href={`/api/procedures/${procedureId}/afschriften/${a.id}/download`}
                      className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink"
                    >
                      Downloaden
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted text-right max-w-[10rem]">
                      {a.nietDownloadbaarReden}
                    </span>
                  )}
                  {!currentUserIsBureau && !a.ingetrokken && a.status === "gereed" && (
                    <button
                      onClick={() => setIntrekId(intrekId === a.id ? null : a.id)}
                      className="text-[11px] text-err-ink hover:underline"
                    >
                      {intrekId === a.id ? "Annuleren" : "Intrekken"}
                    </button>
                  )}
                </div>
              </div>

              {/* Intrekken-formulier */}
              {intrekId === a.id && (
                <div className="mt-2 pt-2 border-t border-line flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={intrekReden}
                    onChange={(e) => setIntrekReden(e.target.value)}
                    placeholder="Reden voor intrekken (verplicht)"
                    className="flex-1 min-w-[12rem] border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
                  />
                  <button
                    onClick={() => intrekken(a.id)}
                    className="text-xs px-3 py-1.5 bg-err text-white rounded hover:opacity-90"
                  >
                    Bevestig intrekken
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
