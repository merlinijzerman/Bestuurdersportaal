"use client";
// ============================================================
//  AgendapuntChat — inline AI-assistent per agendapunt
// ============================================================
// Bestuurders hoeven niet meer naar /ai te schakelen: de assistent is direct
// beschikbaar binnen "Mijn voorbereiding" (sinds 05-07 geïntegreerd in
// VoorbereidingsBlok, zodat de agendapuntkaart één AI-plek kent).
// - Hergebruikt de bestaande chat-backend (/api/chat) in agendapunt-modus
//   (ADR 0028): agendapunt_context + gekoppelde stukken als retrieval-scope.
// - Gesprekken worden per agendapunt opgeslagen in `gesprekken` met hetzelfde
//   document_scope-payload als de AI-pagina, zodat een gesprek dat hier start
//   ook in de historie van /ai terugkomt (en andersom hervat kan worden).
// - Compacte weergave: inline [Bron N]-pills met een uitklapbaar
//   "Onderbouwing en bronnen"-blok per antwoord (herleidbaarheid).
// De marker-rendering is geconsolideerd in de gedeelde component CitatieTekst
// (was hier eerst een eigen renderer — geaccepteerde schuld ADR 0036, opgelost).
// - Sinds 06-07 (herziening FO duiding, na toetsing externe bestuurder): de
//   chat is HET enige instappunt. De losse knop "Genereer voorbereiding" is
//   vervallen; de rijke voorbereiding (route met risicomatrix, procedures,
//   profielsturing) zit als eerste startchip "Stel mijn voorbereiding op" in
//   dit gesprek. De route levert { tekst, bronnen } in dezelfde vorm als de
//   chat, zodat pills en onderbouwing identiek renderen. Het gebruikersbericht
//   gaat vóór het AI-antwoord het gesprek in, zodat de init-logica
//   (welkomstbericht-slice) het antwoord niet wegsnijdt.

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/core/lib/supabase";
import type { InlineMelding } from "@/core/lib/vraagtype";
import CitatieTekst from "./CitatieTekst";

interface Bron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
}

interface Verduidelijking {
  vraag: string;
  opties: { intent: "fonds" | "algemeen"; label: string }[];
  origineleVraag: string;
}

interface Bericht {
  rol: "gebruiker" | "ai";
  tekst: string;
  bronnen?: Bron[];
  inlineMeldingen?: InlineMelding[];
  verduidelijking?: Verduidelijking;
}

// Startvragen die het stuk bestuurlijke betekenis geven. De voorbereiding-chip
// (hieronder apart) gaat via de rijke voorbereiding-route; deze drie via /api/chat.
const STARTVRAGEN = [
  "Welke risico's en aandachtspunten zitten er voor het fonds in dit voorstel?",
  "Welk besluit wordt gevraagd en is dit stuk daarvoor besluitrijp?",
  "Wat betekent dit voorstel voor de deelnemers?",
];

// Het gebruikersbericht dat de voorbereiding in het gesprek opent. Bewust een
// gewone gebruiker-beurt: zo overleeft het AI-antwoord de welkomst-slice bij
// init en leest het gesprek terug als een natuurlijke dialoog.
const VOORBEREIDING_VRAAG = "Stel mijn voorbereiding op voor dit agendapunt.";

export default function AgendapuntChat({
  agendapuntId,
  titel,
  stukken,
}: {
  agendapuntId: string;
  titel: string;
  stukken: { id: string; titel: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [berichten, setBerichten] = useState<Bericht[]>([]);
  const [invoer, setInvoer] = useState("");
  const [laden, setLaden] = useState(false);
  const [antwoordGestart, setAntwoordGestart] = useState(false);
  const [analyseVoortgang, setAnalyseVoortgang] = useState<{
    batch: number;
    totaal: number;
  } | null>(null);
  const [openBronnen, setOpenBronnen] = useState<Set<number>>(new Set());
  const [initGedaan, setInitGedaan] = useState(false);

  const fondsIdRef = useRef<string>("");
  const userIdRef = useRef<string | null>(null);
  const gesprekId = useRef<string | null>(null);
  const eindRef = useRef<HTMLDivElement>(null);
  // Spiegel van `berichten` voor imperatieve callers (genereerVoorbereiding):
  // die lopen buiten de render-cyclus en mogen niet op een verouderde state-
  // closure bouwen.
  const berichtenRef = useRef<Bericht[]>([]);
  const initPromise = useRef<Promise<void> | null>(null);
  const supabase = createClient();

  useEffect(() => {
    berichtenRef.current = berichten;
  }, [berichten]);

  // Init: profiel (fonds_id) + eventueel eerder gesprek over dit agendapunt
  // (meest recente, niet gearchiveerd). Best-effort; als promise zodat ook
  // genereerVoorbereiding() erop kan wachten vóór hij berichten toevoegt.
  function zorgInit(): Promise<void> {
    if (!initPromise.current) {
      initPromise.current = (async () => {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) return;
          userIdRef.current = user.id;
          const { data: profiel } = await supabase
            .from("profielen")
            .select("fonds_id")
            .eq("id", user.id)
            .single();
          if (profiel?.fonds_id) fondsIdRef.current = profiel.fonds_id as string;

          const { data: bestaand } = await supabase
            .from("gesprekken")
            .select("id, berichten")
            .eq("gebruiker_id", user.id)
            .eq("gearchiveerd", false)
            .eq("document_scope->agendapunt_context->>id", agendapuntId)
            .order("bijgewerkt", { ascending: false })
            .limit(1);
          const item = bestaand?.[0];
          if (item && Array.isArray(item.berichten) && item.berichten.length > 0) {
            gesprekId.current = item.id as string;
            // Welkomstbericht van de AI-pagina (index 0, rol ai) is puur UI.
            const b = item.berichten as Bericht[];
            const zonderWelkomst =
              b.length > 0 && b[0].rol === "ai" ? b.slice(1) : b;
            berichtenRef.current = zonderWelkomst;
            setBerichten(zonderWelkomst);
          }
        } catch (e) {
          console.error("AgendapuntChat init mislukt:", e);
        } finally {
          setInitGedaan(true);
        }
      })();
    }
    return initPromise.current;
  }

  useEffect(() => {
    if (!open || initGedaan) return;
    zorgInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initGedaan, agendapuntId]);

  // Voorbereiding als gespreksopener: de startchip "Stel mijn voorbereiding op"
  // gaat via de rijke voorbereiding-route (risicomatrix, procedures,
  // profielsturing) en plaatst vraag + antwoord (bronnen in chat-vorm) als
  // beurten in dit gesprek.
  async function genereerVoorbereiding() {
    if (laden) return;
    setOpen(true);
    await zorgInit();
    const conversatie: Bericht[] = [
      ...berichtenRef.current,
      { rol: "gebruiker", tekst: VOORBEREIDING_VRAAG },
    ];
    berichtenRef.current = conversatie;
    setBerichten(conversatie);
    setLaden(true);
    setAntwoordGestart(false);
    try {
      const res = await fetch(`/api/agendapunten/${agendapuntId}/voorbereiding`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      const aiBericht: Bericht =
        res.ok && data?.tekst
          ? { rol: "ai", tekst: data.tekst, bronnen: data.bronnen }
          : {
              rol: "ai",
              tekst:
                data?.error ||
                "De voorbereiding kon niet worden opgesteld. Probeer het opnieuw.",
            };
      const finale = [...conversatie, aiBericht];
      berichtenRef.current = finale;
      setBerichten(finale);
      if (res.ok && data?.tekst) bewaarGesprek(finale);
    } catch {
      const finale: Bericht[] = [
        ...conversatie,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ];
      berichtenRef.current = finale;
      setBerichten(finale);
    } finally {
      setLaden(false);
    }
  }

  useEffect(() => {
    if (laden) eindRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [berichten, laden]);

  // Opslag — zelfde payload-vorm als de AI-pagina (Fase B2 + ADR 0028), zodat
  // gesprekken uitwisselbaar blijven tussen beide instappunten.
  async function bewaarGesprek(finale: Bericht[]) {
    try {
      const uid = userIdRef.current;
      if (!uid || !fondsIdRef.current || finale.length === 0) return;
      const eersteVraag = finale.find((b) => b.rol === "gebruiker")?.tekst || "Gesprek";
      const scopePayload = {
        type: "single",
        document_ids: stukken.map((s) => s.id),
        titels: stukken.map((s) => s.titel),
        algemene_kennis: false,
        agendapunt_context: { id: agendapuntId, titel },
        gezet_op: new Date().toISOString(),
      };
      if (gesprekId.current) {
        await supabase
          .from("gesprekken")
          .update({
            berichten: finale,
            document_scope: scopePayload,
            bijgewerkt: new Date().toISOString(),
          })
          .eq("id", gesprekId.current);
      } else {
        const { data } = await supabase
          .from("gesprekken")
          .insert({
            gebruiker_id: uid,
            fonds_id: fondsIdRef.current,
            titel: eersteVraag.slice(0, 80),
            berichten: finale,
            document_scope: scopePayload,
          })
          .select("id")
          .single();
        if (data?.id) gesprekId.current = data.id as string;
      }
    } catch (e) {
      console.error("Gesprek opslaan mislukt:", e);
    }
  }

  interface StuurOpties {
    bronIntentOverride?: "fonds" | "algemeen";
    geenNieuweVraag?: boolean;
    basisBerichten?: Bericht[];
  }

  async function stuurBericht(vraag?: string, opties?: StuurOpties) {
    const tekst = (vraag ?? invoer).trim();
    if (!tekst || laden) return;
    setInvoer("");
    setLaden(true);
    setAntwoordGestart(false);

    const basis = opties?.basisBerichten ?? berichten;
    const conversatie = opties?.geenNieuweVraag
      ? basis
      : [...basis, { rol: "gebruiker", tekst } as Bericht];
    setBerichten(conversatie);

    const messages = conversatie
      .filter((b) => !b.verduidelijking)
      .map((b) => ({
        role: b.rol === "gebruiker" ? ("user" as const) : ("assistant" as const),
        content: b.tekst,
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          fonds_id: fondsIdRef.current,
          bron_intent_override: opties?.bronIntentOverride,
          // Gekoppelde stukken als retrieval-scope; in agendapunt-modus behandelt
          // de route dit als agendapunt-scope (niet strikt), zie route.ts.
          document_scope:
            stukken.length > 0
              ? { document_ids: stukken.map((s) => s.id), algemene_kennis: false }
              : undefined,
          actieve_antwoordmodus: null,
          // ADR 0028 — de route haalt de toelichting zelf op onder RLS.
          agendapunt_context: { id: agendapuntId, titel },
        }),
      });

      if (!res.ok || !res.body) {
        const fout = await res.json().catch(() => null);
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: fout?.error || "Er is een fout opgetreden." },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aiToegevoegd = false;
      let volledig = "";
      let bronnenData: Bron[] | undefined;
      let inlineMeldingenData: InlineMelding[] | undefined;
      let verduidelijkingActief = false;

      const schrijfAi = () => {
        setBerichten((prev) => {
          if (!aiToegevoegd) return prev;
          const kopie = [...prev];
          kopie[kopie.length - 1] = {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            inlineMeldingen: inlineMeldingenData,
          };
          return kopie;
        });
      };

      const verwerkEvent = (raw: string) => {
        const regel = raw.replace(/^data: ?/, "").trim();
        if (!regel) return;
        let evt: {
          type: string;
          text?: string;
          bronnen?: Bron[];
          error?: string;
          batch?: number;
          totaal?: number;
          inline_meldingen?: InlineMelding[];
          vraag?: string;
          opties?: { intent: "fonds" | "algemeen"; label: string }[];
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }

        if (evt.type === "verduidelijking") {
          verduidelijkingActief = true;
          aiToegevoegd = true;
          setAnalyseVoortgang(null);
          setBerichten((prev) => [
            ...prev,
            {
              rol: "ai",
              tekst:
                evt.vraag || "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?",
              verduidelijking: {
                vraag: evt.vraag || "",
                opties: evt.opties ?? [],
                origineleVraag: tekst,
              },
            },
          ]);
        } else if (evt.type === "meta") {
          bronnenData = evt.bronnen;
          inlineMeldingenData = evt.inline_meldingen ?? [];
        } else if (evt.type === "progress") {
          if (typeof evt.batch === "number" && typeof evt.totaal === "number") {
            setAnalyseVoortgang({ batch: evt.batch, totaal: evt.totaal });
          }
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setAnalyseVoortgang(null);
            setAntwoordGestart(true);
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: volledig, bronnen: bronnenData, inlineMeldingen: inlineMeldingenData },
            ]);
          } else {
            schrijfAi();
          }
        } else if (evt.type === "done") {
          if (verduidelijkingActief) return;
          if (evt.inline_meldingen) inlineMeldingenData = evt.inline_meldingen;
          schrijfAi();
        } else if (evt.type === "error") {
          if (!aiToegevoegd) {
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: evt.error || "Er is een fout opgetreden." },
            ]);
            aiToegevoegd = true;
          }
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const delen = buffer.split("\n\n");
        buffer = delen.pop() || "";
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      if (!aiToegevoegd) {
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ]);
      } else if (volledig.trim()) {
        const finale: Bericht[] = [
          ...conversatie,
          { rol: "ai", tekst: volledig, bronnen: bronnenData, inlineMeldingen: inlineMeldingenData },
        ];
        setBerichten(finale);
        bewaarGesprek(finale);
      }
    } catch {
      setBerichten((prev) => [
        ...prev,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ]);
    } finally {
      setLaden(false);
      setAnalyseVoortgang(null);
    }
  }

  // Chipkeuze na een verduidelijkingsvraag: verwijder de verduidelijkingsbubbel
  // en stuur de originele vraag opnieuw met bevestigde bron-intentie.
  function kiesVerduidelijking(b: Bericht, intent: "fonds" | "algemeen") {
    const zonder = berichten.filter((x) => x !== b);
    stuurBericht(b.verduidelijking!.origineleVraag, {
      bronIntentOverride: intent,
      geenNieuweVraag: true,
      basisBerichten: zonder,
    });
  }

  function toggleBronnen(idx: number) {
    setOpenBronnen((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }

  const heeftGesprek = berichten.length > 0;

  return (
    <div className="border border-warn/30 rounded-lg bg-warn-tint">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 text-left"
      >
        <span className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
            ✨ Vraag door over dit agendapunt
            {heeftGesprek && !open && (
              <span className="text-[10px] font-normal text-muted">
                — eerder gesprek beschikbaar
              </span>
            )}
          </span>
          <span className="text-muted text-xs">{open ? "▾" : "▸"}</span>
        </span>
        <span className="block text-xs text-muted mt-1 leading-relaxed font-normal">
          Laat de AI helpen scherper na te denken over dit punt — wat het stuk
          betekent, welk besluit wordt gevraagd, blinde vlekken en vragen voor
          de vergadering. Persoonlijk en alleen voor u zichtbaar.
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Contextregel: waarop is de assistent hier gescoped? */}
          <div className="text-[11px] text-muted">
            Context: dit agendapunt
            {stukken.length > 0
              ? ` en ${stukken.length} gekoppeld${stukken.length === 1 ? " stuk" : "e stukken"}`
              : " (geen stukken gekoppeld)"}
            .{" "}
            <a
              href={`/ai?agendapunt=${agendapuntId}`}
              className="underline hover:text-ink"
              title="Zelfde gesprek met alle opties in de volledige assistent"
            >
              Openen in volledige assistent
            </a>
          </div>

          {/* Berichten */}
          {heeftGesprek && (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {berichten.map((b, idx) =>
                b.rol === "gebruiker" ? (
                  <div key={idx} className="flex justify-end">
                    <div className="bg-accent text-white text-sm rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap">
                      {b.tekst}
                    </div>
                  </div>
                ) : (
                  <div key={idx} className="bg-white border border-line rounded-lg px-3 py-2">
                    {b.inlineMeldingen && b.inlineMeldingen.length > 0 && (
                      <div className="mb-1.5 space-y-1">
                        {b.inlineMeldingen.map((m, i) => (
                          <div key={i} className="text-[11px] text-warn-ink bg-warn-tint border border-warn/30 rounded px-2 py-1">
                            {m.tekst}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-sm text-ink leading-relaxed">
                      <CitatieTekst
                        tekst={b.tekst}
                        bronnen={b.bronnen}
                        onBronKlik={() => toggleBronnen(idx)}
                      />
                    </div>
                    {b.verduidelijking && b.verduidelijking.opties.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {b.verduidelijking.opties.map((o) => (
                          <button
                            key={o.intent}
                            onClick={() => kiesVerduidelijking(b, o.intent)}
                            disabled={laden}
                            className="text-xs border border-app-line-strong rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-50"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {b.bronnen && b.bronnen.length > 0 && (
                      <div className="mt-2 border-t border-line pt-1.5">
                        <button
                          onClick={() => toggleBronnen(idx)}
                          className="text-[11px] font-medium text-muted hover:text-ink"
                        >
                          {openBronnen.has(idx) ? "▾" : "▸"} Onderbouwing en bronnen (
                          {b.bronnen.length})
                        </button>
                        {openBronnen.has(idx) && (
                          <div className="mt-1.5 space-y-1.5">
                            {b.bronnen.map((bron, i) => (
                              <div
                                key={i}
                                className="text-[11px] bg-app-bg border border-line rounded px-2 py-1.5"
                              >
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[9px] font-semibold mr-1.5">
                                  {i + 1}
                                </span>
                                <span className="font-medium text-ink">{bron.titel}</span>
                                {bron.pagina != null && (
                                  <span className="text-muted"> · p. {bron.pagina}</span>
                                )}
                                {bron.paragraaf && (
                                  <span className="text-muted"> · {bron.paragraaf}</span>
                                )}
                                {bron.fragment && (
                                  <div className="text-muted mt-0.5 line-clamp-2">
                                    “{bron.fragment}”
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
              {laden && !antwoordGestart && (
                <div className="text-xs text-muted italic px-1">
                  {analyseVoortgang
                    ? `Analyseert stukken (${analyseVoortgang.batch}/${analyseVoortgang.totaal})…`
                    : "De assistent denkt na…"}
                </div>
              )}
              <div ref={eindRef} />
            </div>
          )}

          {/* De voorbereiding-chip is er altijd (rijke voorbereiding-route,
              ook midden in een gesprek opnieuw op te stellen); de start-
              vragen alleen zolang er nog geen gesprek is (gewone chat-route). */}
          {initGedaan && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => genereerVoorbereiding()}
                disabled={laden}
                className="text-xs text-left bg-accent text-white rounded-full px-3 py-1.5 hover:bg-accent-ink transition-colors disabled:opacity-50 font-medium"
              >
                {heeftGesprek
                  ? "Stel mijn voorbereiding (opnieuw) op"
                  : "Stel mijn voorbereiding op"}
              </button>
              {!heeftGesprek &&
                STARTVRAGEN.map((v) => (
                  <button
                    key={v}
                    onClick={() => stuurBericht(v)}
                    disabled={laden}
                    className="text-xs text-left border border-app-line-strong bg-white rounded-full px-3 py-1.5 hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-50"
                  >
                    {v}
                  </button>
                ))}
            </div>
          )}

          {/* Invoer */}
          <div className="flex gap-2 items-end">
            <textarea
              value={invoer}
              onChange={(e) => setInvoer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  stuurBericht();
                }
              }}
              placeholder={`Stel een vraag over "${titel}"…`}
              rows={2}
              className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-accent resize-none"
            />
            <button
              onClick={() => stuurBericht()}
              disabled={laden || !invoer.trim()}
              className="bg-accent text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-accent hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
            >
              {laden ? "…" : "Vraag"}
            </button>
          </div>

          <div className="text-[10px] text-muted">
            AI-hulpmiddel ter voorbereiding — geen bestuurlijk advies. Vragen en
            bronkeuze worden vastgelegd in de governance log.
          </div>
        </div>
      )}
    </div>
  );
}

