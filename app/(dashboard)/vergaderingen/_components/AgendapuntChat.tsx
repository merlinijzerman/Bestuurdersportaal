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

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import type { InlineMelding } from "@/lib/vraagtype";
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

// Startvragen die het stuk bestuurlijke betekenis geven. De eerdere chip
// "bestuurlijke duiding" is verwijderd (05-07): de duiding is het hoofdproduct
// van "Mijn voorbereiding" (FO duiding v0.2) — dubbel genereren gaf twee licht
// verschillende duidingen naast elkaar. De chat verwijst nu naar dat blok.
const STARTVRAGEN = [
  "Welke risico's en aandachtspunten zitten er voor het fonds in dit voorstel?",
  "Welk besluit wordt gevraagd en is dit stuk daarvoor besluitrijp?",
  "Wat betekent dit voorstel voor de deelnemers?",
];

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
  const supabase = createClient();

  // Init bij eerste keer openen: profiel (fonds_id) + eventueel eerder gesprek
  // over dit agendapunt (meest recente, niet gearchiveerd). Best-effort.
  useEffect(() => {
    if (!open || initGedaan) return;
    (async () => {
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
          setBerichten(b.length > 0 && b[0].rol === "ai" ? b.slice(1) : b);
        }
      } catch (e) {
        console.error("AgendapuntChat init mislukt:", e);
      } finally {
        setInitGedaan(true);
      }
    })();
  }, [open, initGedaan, agendapuntId, supabase]);

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
    <div className="border border-amber-200 rounded-lg bg-amber-50/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0F2744]">
          ✨ Vraag door over dit agendapunt
          {heeftGesprek && !open && (
            <span className="text-[10px] font-normal text-gray-500">
              — eerder gesprek beschikbaar
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Contextregel: waarop is de assistent hier gescoped? */}
          <div className="text-[11px] text-gray-500">
            Context: dit agendapunt
            {stukken.length > 0
              ? ` en ${stukken.length} gekoppeld${stukken.length === 1 ? " stuk" : "e stukken"}`
              : " (geen stukken gekoppeld)"}
            .{" "}
            <a
              href={`/ai?agendapunt=${agendapuntId}`}
              className="underline hover:text-[#0F2744]"
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
                    <div className="bg-[#0F2744] text-white text-sm rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap">
                      {b.tekst}
                    </div>
                  </div>
                ) : (
                  <div key={idx} className="bg-white border border-gray-200 rounded-lg px-3 py-2">
                    {b.inlineMeldingen && b.inlineMeldingen.length > 0 && (
                      <div className="mb-1.5 space-y-1">
                        {b.inlineMeldingen.map((m, i) => (
                          <div key={i} className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            {m.tekst}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-sm text-gray-800 leading-relaxed">
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
                            className="text-xs border border-gray-300 rounded-full px-3 py-1 hover:border-[#C9A84C] hover:bg-amber-50 disabled:opacity-50"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {b.bronnen && b.bronnen.length > 0 && (
                      <div className="mt-2 border-t border-gray-100 pt-1.5">
                        <button
                          onClick={() => toggleBronnen(idx)}
                          className="text-[11px] font-medium text-gray-500 hover:text-[#0F2744]"
                        >
                          {openBronnen.has(idx) ? "▾" : "▸"} Onderbouwing en bronnen (
                          {b.bronnen.length})
                        </button>
                        {openBronnen.has(idx) && (
                          <div className="mt-1.5 space-y-1.5">
                            {b.bronnen.map((bron, i) => (
                              <div
                                key={i}
                                className="text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5"
                              >
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#0F2744] text-white text-[9px] font-semibold mr-1.5">
                                  {i + 1}
                                </span>
                                <span className="font-medium text-[#0F2744]">{bron.titel}</span>
                                {bron.pagina != null && (
                                  <span className="text-gray-500"> · p. {bron.pagina}</span>
                                )}
                                {bron.paragraaf && (
                                  <span className="text-gray-500"> · {bron.paragraaf}</span>
                                )}
                                {bron.fragment && (
                                  <div className="text-gray-600 mt-0.5 line-clamp-2">
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
                <div className="text-xs text-gray-500 italic px-1">
                  {analyseVoortgang
                    ? `Analyseert stukken (${analyseVoortgang.batch}/${analyseVoortgang.totaal})…`
                    : "De assistent denkt na…"}
                </div>
              )}
              <div ref={eindRef} />
            </div>
          )}

          {/* Startvragen zolang er nog geen gesprek is */}
          {!heeftGesprek && initGedaan && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {STARTVRAGEN.map((v) => (
                  <button
                    key={v}
                    onClick={() => stuurBericht(v)}
                    disabled={laden}
                    className="text-xs text-left border border-gray-300 bg-white rounded-full px-3 py-1.5 hover:border-[#C9A84C] hover:bg-amber-50 transition-colors disabled:opacity-50"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-gray-500">
                Voor de bestuurlijke duiding met bronnen: genereer de
                voorbereiding hierboven. Deze chat is voor doorvragen.
              </div>
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
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-[#C9A84C] resize-none"
            />
            <button
              onClick={() => stuurBericht()}
              disabled={laden || !invoer.trim()}
              className="bg-[#0F2744] text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#C9A84C] hover:text-[#0F2744] transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
            >
              {laden ? "…" : "Vraag"}
            </button>
          </div>

          <div className="text-[10px] text-gray-400">
            AI-hulpmiddel ter voorbereiding — geen bestuurlijk advies. Vragen en
            bronkeuze worden vastgelegd in de governance log.
          </div>
        </div>
      )}
    </div>
  );
}

