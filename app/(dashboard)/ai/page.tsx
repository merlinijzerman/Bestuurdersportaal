"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { createClient } from "@/lib/supabase";

type Modus = "documenten" | "combineren" | "algemeen";

interface Bron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
}

interface Bericht {
  rol: "gebruiker" | "ai";
  tekst: string;
  bronnen?: Bron[];
  modus?: Modus;
}

// Eén item in het gesprekken-overzicht (Fase B2-volledig).
interface GesprekItem {
  id: string;
  titel: string | null;
  bijgewerkt: string;
  berichten: Bericht[];
}

const BRONKLEUR: Record<string, string> = {
  DNB: "bg-red-50 border-red-200",
  AFM: "bg-blue-50 border-blue-200",
  Pensioenfederatie: "bg-green-50 border-green-200",
  Intern: "bg-amber-50 border-amber-200",
  Extern: "bg-amber-50 border-amber-200",
};

const BRONTEKST: Record<string, string> = {
  DNB: "text-red-700",
  AFM: "text-blue-700",
  Pensioenfederatie: "text-green-700",
  Intern: "text-amber-700",
  Extern: "text-amber-700",
};

const BRON_NUMMER_KLEUR: Record<string, string> = {
  DNB: "bg-red-600 text-white",
  AFM: "bg-blue-600 text-white",
  Pensioenfederatie: "bg-green-600 text-white",
  Intern: "bg-amber-600 text-white",
  Extern: "bg-amber-600 text-white",
};

// Regex pakt alle inline-markeringen in één keer:
// - [Bron 1], [Bron 12]
// - [Algemene kennis], [algemene kennis]
// - [Volgens wetgeving], [volgens wetgeving]
const MARKER_REGEX = /(\[Bron \d+\]|\[Algemene kennis\]|\[Volgens wetgeving\])/gi;

const MODI: { value: Modus; label: string; help: string }[] = [
  {
    value: "documenten",
    label: "Onze documenten",
    help: "Strikt op interne bronnen — antwoord met expliciete citaten",
  },
  {
    value: "combineren",
    label: "Slim combineren",
    help: "Gebruikt interne bronnen waar beschikbaar, vult aan met algemene kennis",
  },
  {
    value: "algemeen",
    label: "Algemene vraag",
    help: "Open AI-assistent — gebruikt Claude's algemene kennis, geen interne bronnen",
  },
];

const VOORGESTELDE_VRAGEN = [
  "Wat zijn de deskundigheidseisen voor bestuurders?",
  "Hoe wordt een tegenstrijdig belang gemeld?",
  "Wat zijn de hoofdpunten van de Wet toekomst pensioenen?",
  "Wat is het verschil tussen SPR en FPR onder de Wtp?",
];

function dagdeelGroet() {
  const u = new Date().getHours();
  if (u < 6) return "Goedenacht";
  if (u < 12) return "Goedemorgen";
  if (u < 18) return "Goedemiddag";
  return "Goedenavond";
}

export default function AiPage() {
  const [berichten, setBerichten] = useState<Bericht[]>([
    {
      rol: "ai",
      tekst: `Welkom terug. Ik ben uw AI-assistent voor het bestuurdersportaal.\n\nU kunt hierboven kiezen hoe ik antwoord:\n• Onze documenten — strikt op interne bronnen\n• Slim combineren — interne bronnen + algemene kennis (aanbevolen)\n• Algemene vraag — open AI-assistent zonder beperking tot de bibliotheek\n\nElke vraag wordt gelogd in de Governance Log, inclusief de gebruikte modus.`,
    },
  ]);
  const [invoer, setInvoer] = useState("");
  const [laden, setLaden] = useState(false);
  // True zodra de eerste tokens van een antwoord binnenstromen — gebruikt om de
  // typ-indicator te verbergen zodra de tekst zelf begint te verschijnen.
  const [antwoordGestart, setAntwoordGestart] = useState(false);
  const [fondsId, setFondsId] = useState<string>("");
  const [modus, setModus] = useState<Modus>("combineren");
  const [highlight, setHighlight] = useState<{
    berichtIdx: number;
    bronIdx: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const highlightTimer = useRef<number | null>(null);
  // Persistentie (Fase B2): id van het huidige opgeslagen gesprek en de
  // ingelogde gebruiker. Refs i.p.v. state — wijziging hoeft geen re-render.
  const gesprekId = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Gepersonaliseerde welkomstboodschap, zodat "nieuw gesprek" altijd een
  // schone start toont (ook nadat een eerder gesprek is geopend).
  const welkomstRef = useRef<Bericht | null>(null);
  // Gesprekken-overzicht (Fase B2-volledig).
  const [gesprekken, setGesprekken] = useState<GesprekItem[]>([]);
  const [historieOpen, setHistorieOpen] = useState(false);
  const supabase = createClient();

  // Haalt de eigen, niet-gearchiveerde gesprekken op voor het overzicht.
  // RLS beperkt dit al tot de eigen gesprekken; de gebruiker_id-filter maakt het
  // expliciet. Best-effort.
  async function laadGesprekken() {
    try {
      const uid = userIdRef.current;
      if (!uid) return;
      const { data } = await supabase
        .from("gesprekken")
        .select("id, titel, bijgewerkt, berichten")
        .eq("gebruiker_id", uid)
        .eq("gearchiveerd", false)
        .order("bijgewerkt", { ascending: false })
        .limit(50);
      if (Array.isArray(data)) setGesprekken(data as GesprekItem[]);
    } catch (e) {
      console.error("Gesprekken laden mislukt:", e);
    }
  }

  // Opent een bestaand gesprek in de chat.
  function openGesprek(item: GesprekItem) {
    if (laden) return;
    gesprekId.current = item.id;
    setBerichten(
      Array.isArray(item.berichten) && item.berichten.length > 0
        ? item.berichten
        : welkomstRef.current
        ? [welkomstRef.current]
        : []
    );
    setHistorieOpen(false);
  }

  // Archiveert een gesprek (soft-delete). governance_log blijft intact. Als het
  // huidige gesprek wordt gearchiveerd, start een schone weergave.
  async function archiveerGesprek(id: string) {
    try {
      await supabase.from("gesprekken").update({ gearchiveerd: true }).eq("id", id);
    } catch (e) {
      console.error("Gesprek archiveren mislukt:", e);
    }
    if (gesprekId.current === id) {
      gesprekId.current = null;
      setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    }
    laadGesprekken();
  }

  // Slaat het gesprek best-effort op. Faalt veilig: een mislukte opslag mag de
  // chat nooit verstoren. governance_log (auditspoor) staat hier los van.
  async function bewaarGesprek(finale: Bericht[]) {
    try {
      const uid = userIdRef.current;
      if (!uid || !fondsId || finale.length === 0) return;
      const eersteVraag =
        finale.find((b) => b.rol === "gebruiker")?.tekst || "Gesprek";
      const titel = eersteVraag.slice(0, 80);

      if (gesprekId.current) {
        await supabase
          .from("gesprekken")
          .update({ berichten: finale, bijgewerkt: new Date().toISOString() })
          .eq("id", gesprekId.current);
      } else {
        const { data } = await supabase
          .from("gesprekken")
          .insert({ gebruiker_id: uid, fonds_id: fondsId, titel, berichten: finale })
          .select("id")
          .single();
        if (data?.id) gesprekId.current = data.id as string;
      }
      // Ververs het overzicht zodat nieuwe/bijgewerkte gesprekken bovenaan komen.
      laadGesprekken();
    } catch (e) {
      console.error("Gesprek opslaan mislukt:", e);
    }
  }

  function scrollNaarBron(berichtIdx: number, bronIdx: number) {
    const el = document.getElementById(`bron-${berichtIdx}-${bronIdx}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight({ berichtIdx, bronIdx });
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlight(null);
      highlightTimer.current = null;
    }, 2000);
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        userIdRef.current = user.id;
        const { data } = await supabase
          .from("profielen")
          .select("fonds_id, naam, fondsen(naam)")
          .eq("id", user.id)
          .single();
        if (data?.fonds_id) setFondsId(data.fonds_id);

        const voornaam = (data?.naam as string | null)?.split(" ")[0] || "";
        const fondsenRel = data?.fondsen as
          | { naam: string }
          | { naam: string }[]
          | null
          | undefined;
        const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
        const fondsnaam =
          fondsenObj?.naam || "uw fonds";

        const groet = dagdeelGroet();
        const personalTekst = voornaam
          ? `${groet} ${voornaam}, fijn u te zien.\n\nIk help u graag met vragen rondom ${fondsnaam}. Hierboven kiest u hoe ik antwoord: strikt op onze documenten, slim gecombineerd met algemene kennis, of als open AI-assistent.\n\nElke vraag wordt vastgelegd in de Governance Log, inclusief de gekozen modus.`
          : `${groet}. Ik help u graag met vragen rondom ${fondsnaam}.\n\nU kunt hierboven kiezen hoe ik antwoord: strikt op onze documenten, slim gecombineerd, of als open AI-assistent.\n\nElke vraag wordt vastgelegd in de Governance Log.`;

        welkomstRef.current = { rol: "ai", tekst: personalTekst };

        // Auto-restore (Fase B2): haal het meest recente, niet-gearchiveerde
        // gesprek terug. RLS beperkt dit al tot de eigen gesprekken; de extra
        // gebruiker_id-filter maakt de query expliciet.
        let hersteld = false;
        try {
          const { data: laatste } = await supabase
            .from("gesprekken")
            .select("id, berichten")
            .eq("gebruiker_id", user.id)
            .eq("gearchiveerd", false)
            .order("bijgewerkt", { ascending: false })
            .limit(1)
            .maybeSingle();

          const opgeslagen = laatste?.berichten as Bericht[] | undefined;
          if (laatste?.id && Array.isArray(opgeslagen) && opgeslagen.length > 0) {
            gesprekId.current = laatste.id as string;
            setBerichten(opgeslagen);
            hersteld = true;
          }
        } catch (e) {
          console.error("Gesprek herstellen mislukt:", e);
        }

        if (!hersteld) {
          setBerichten([{ rol: "ai", tekst: personalTekst }]);
        }

        // Vul het gesprekken-overzicht.
        laadGesprekken();
      }
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [berichten]);

  async function stuurBericht(vraag?: string) {
    const tekst = vraag || invoer.trim();
    if (!tekst || laden) return;
    setInvoer("");
    setLaden(true);

    // Voeg de nieuwe vraag toe en stuur de complete geschiedenis mee.
    const nieuw: Bericht = { rol: "gebruiker", tekst };
    const conversatie = [...berichten, nieuw];
    setBerichten(conversatie);

    // Bouw de messages-array voor de API. We slaan het eerste bericht over
    // als dat de welkomst-AI-tekst is (puur UI, geen onderdeel van het gesprek).
    const messages = conversatie
      .filter((b, i) => !(i === 0 && b.rol === "ai"))
      .map((b) => ({
        role: b.rol === "gebruiker" ? ("user" as const) : ("assistant" as const),
        content: b.tekst,
      }));

    setAntwoordGestart(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, fonds_id: fondsId, modus }),
      });

      // Fouten (400/401/500) komen als JSON terug, niet als stream.
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
      let modusData: Modus = modus;

      // Werkt het laatste (AI-)bericht bij, of voegt het toe als het nog niet
      // bestaat. Bronnen worden meegegeven zodra die binnen zijn.
      const schrijfAi = () => {
        setBerichten((prev) => {
          if (!aiToegevoegd) return prev; // veiligheid
          const kopie = [...prev];
          kopie[kopie.length - 1] = {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            modus: modusData,
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
          modus?: Modus;
          error?: string;
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }

        if (evt.type === "meta") {
          bronnenData = evt.bronnen;
          modusData = evt.modus || modus;
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setAntwoordGestart(true);
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: volledig, bronnen: bronnenData, modus: modusData },
            ]);
          } else {
            schrijfAi();
          }
        } else if (evt.type === "done") {
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

      // Lees de SSE-stream; events zijn gescheiden door een lege regel.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const delen = buffer.split("\n\n");
        buffer = delen.pop() || "";
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      // Vangnet: stream eindigde zonder enige tekst.
      if (!aiToegevoegd) {
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ]);
      } else if (volledig.trim()) {
        // Persisteer het gesprek (Fase B2) na een geslaagd antwoord.
        const finale: Bericht[] = [
          ...conversatie,
          { rol: "ai", tekst: volledig, bronnen: bronnenData, modus: modusData },
        ];
        await bewaarGesprek(finale);
      }
    } catch {
      setBerichten((prev) => [
        ...prev,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ]);
    } finally {
      setLaden(false);
      setAntwoordGestart(false);
    }
  }

  function startNieuwGesprek() {
    if (laden) return;
    // Met het gesprekken-overzicht hoeft "nieuw" niets te wissen: het lopende
    // gesprek blijft gewoon in de lijst staan. We starten enkel een schone chat.
    gesprekId.current = null;
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setInvoer("");
    setHistorieOpen(false);
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Gesprekken-overzicht (drawer) */}
      {historieOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setHistorieOpen(false)}
          />
          <div className="absolute top-0 left-0 h-full w-80 max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div className="px-5 h-14 flex items-center justify-between border-b border-gray-200">
              <span className="font-bold text-[#0F2744]">Gesprekken</span>
              <button
                onClick={() => setHistorieOpen(false)}
                className="text-gray-400 hover:text-[#0F2744] text-lg leading-none"
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {gesprekken.length === 0 ? (
                <p className="text-sm text-gray-400 px-2 py-4">
                  Nog geen opgeslagen gesprekken.
                </p>
              ) : (
                gesprekken.map((g) => (
                  <div
                    key={g.id}
                    className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                      g.id === gesprekId.current
                        ? "bg-[#C9A84C]/15"
                        : "hover:bg-gray-100"
                    }`}
                    onClick={() => openGesprek(g)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#0F2744] truncate">
                        {g.titel || "Gesprek"}
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(g.bijgewerkt).toLocaleString("nl-NL", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Dit gesprek archiveren?")) archiveerGesprek(g.id);
                      }}
                      title="Archiveren"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 text-sm transition-opacity flex-shrink-0"
                      aria-label="Archiveren"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-gray-200 p-3">
              <button
                onClick={startNieuwGesprek}
                className="w-full text-sm text-[#0F2744] border border-gray-200 rounded-lg px-3 py-2 hover:border-[#C9A84C] transition-colors"
              >
                + Nieuw gesprek
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Topbar */}
      <div className="bg-white border-b border-gray-200 px-7 h-14 flex items-center">
        <span className="font-bold text-[#0F2744]">AI Assistent</span>
        <span className="ml-3 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
          ● Governance logging actief
        </span>
        <button
          onClick={() => setHistorieOpen(true)}
          className="ml-auto text-xs text-gray-500 hover:text-[#0F2744] border border-gray-200 px-3 py-1.5 rounded-lg hover:border-[#C9A84C] transition-colors"
        >
          🕑 Gesprekken{gesprekken.length > 0 ? ` (${gesprekken.length})` : ""}
        </button>
        <button
          onClick={startNieuwGesprek}
          disabled={laden || berichten.length <= 1}
          className="text-xs text-gray-500 hover:text-[#0F2744] border border-gray-200 px-3 py-1.5 rounded-lg hover:border-[#C9A84C] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Nieuw gesprek
        </button>
      </div>

      {/* Modus-bar */}
      <div className="bg-white border-b border-gray-200 px-7 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
          Bronnen
        </span>
        <div className="flex gap-0.5 bg-gray-100 rounded-lg p-1">
          {MODI.map((m) => (
            <button
              key={m.value}
              onClick={() => setModus(m.value)}
              title={m.help}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                modus === m.value
                  ? "bg-white text-[#0F2744] font-semibold shadow-sm"
                  : "text-gray-600 hover:text-[#0F2744]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {modus === "algemeen" && (
          <span className="text-xs text-amber-700 inline-flex items-center gap-1">
            <span>⚠️</span>
            <span>Antwoord wordt niet beperkt tot interne bronnen — verifieer voor besluitvorming</span>
          </span>
        )}
        {modus === "combineren" && (
          <span className="text-xs text-gray-500">
            Combineert interne documenten met algemene kennis
          </span>
        )}
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {berichten.map((b, i) => (
          <div key={i} className={b.rol === "gebruiker" ? "flex justify-end" : "flex gap-3"}>
            {b.rol === "ai" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/ai-assistent.png" alt="AI" className="w-8 h-8 object-contain flex-shrink-0 mt-0.5" />
            )}
            <div className={b.rol === "gebruiker" ? "max-w-[75%]" : "flex-1"}>
              {b.rol === "ai" && b.modus && b.modus !== "documenten" && (
                <div className="mb-2">
                  <ModusBadge modus={b.modus} />
                </div>
              )}

              <div
                className={
                  b.rol === "gebruiker"
                    ? "bg-[#0F2744] text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                    : "bg-gray-50 border border-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-gray-800"
                }
              >
                {b.rol === "ai"
                  ? renderAntwoord(b.tekst, b.bronnen, i, highlight, scrollNaarBron)
                  : b.tekst.split("\n").map((regel, j) => (
                      <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                        {regel}
                      </p>
                    ))}
              </div>

              {/* Bronverwijzingen */}
              {b.bronnen && b.bronnen.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                    📌 Bronverwijzingen ({b.bronnen.length}) · klik om in nieuw tabblad te openen
                  </div>
                  <div className="space-y-2">
                    {b.bronnen.map((bron, j) => (
                      <Bronkaart
                        key={j}
                        idx={j}
                        bron={bron}
                        idVoorScroll={`bron-${i}-${j}`}
                        gehighlight={
                          highlight?.berichtIdx === i && highlight?.bronIdx === j
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {laden && !antwoordGestart && (
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ai-assistent.png" alt="AI" className="w-8 h-8 object-contain flex-shrink-0" />
            <div className="bg-gray-50 border border-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm">
              <div className="flex gap-1.5 items-center">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Voorgestelde vragen */}
      {berichten.length <= 1 && (
        <div className="px-6 pb-2">
          <div className="text-xs text-gray-400 font-semibold mb-2">Voorgestelde vragen</div>
          <div className="flex flex-wrap gap-2">
            {VOORGESTELDE_VRAGEN.map((v) => (
              <button
                key={v}
                onClick={() => stuurBericht(v)}
                className="bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-500 hover:border-[#C9A84C] hover:text-[#0F2744] hover:bg-yellow-50 transition-all"
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Invoerbalk */}
      <div className="bg-white border-t border-gray-200 p-4 flex gap-3">
        <textarea
          value={invoer}
          onChange={(e) => setInvoer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              stuurBericht();
            }
          }}
          placeholder="Stel een vraag aan de AI-assistent... (Enter om te sturen)"
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none outline-none focus:border-[#C9A84C] bg-gray-50"
          rows={2}
          disabled={laden}
        />
        <button
          onClick={() => stuurBericht()}
          disabled={laden || !invoer.trim()}
          className="w-11 h-11 bg-[#0F2744] rounded-xl flex items-center justify-center text-white hover:bg-[#C9A84C] hover:text-[#0F2744] disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

// ============================================================
//  Renderen van AI-antwoord met inline pills voor [Bron N],
//  [Algemene kennis] en [Volgens wetgeving]
// ============================================================
// Rendert het AI-antwoord met lichte Markdown-ondersteuning. Blok-niveau:
// koppen (#..), opsommingen (- / *) en genummerde lijsten (1.), en alinea's.
// Inline-opmaak (vet/cursief/code) en de citatiemarkers ([Bron N], [Algemene
// kennis], [Volgens wetgeving]) lopen via parseInline. Bewust een eigen, kleine
// renderer i.p.v. een externe library: geen extra dependency, volledige controle
// over de bron-pills, en bestand tegen half-gestreamde (nog niet gesloten)
// markdown tijdens het streamen.
function renderAntwoord(
  tekst: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  const regels = tekst.split("\n");
  const blokken: ReactNode[] = [];
  let lijstType: "ul" | "ol" | null = null;
  let lijstItems: string[] = [];
  let sleutel = 0;

  const inline = (s: string) =>
    parseInline(s, bronnen, berichtIdx, highlight, onBronKlik);

  const sluitLijst = () => {
    if (!lijstType) return;
    const items = lijstItems.map((it, k) => (
      <li key={k}>{inline(it)}</li>
    ));
    blokken.push(
      lijstType === "ul" ? (
        <ul key={sleutel++} className="list-disc pl-5 my-1.5 space-y-0.5">
          {items}
        </ul>
      ) : (
        <ol key={sleutel++} className="list-decimal pl-5 my-1.5 space-y-0.5">
          {items}
        </ol>
      )
    );
    lijstType = null;
    lijstItems = [];
  };

  for (const regel of regels) {
    const ul = regel.match(/^\s*[-*]\s+(.*)$/);
    const ol = regel.match(/^\s*\d+\.\s+(.*)$/);
    const kop = regel.match(/^(#{1,6})\s+(.*)$/);

    if (ul) {
      if (lijstType !== "ul") sluitLijst();
      lijstType = "ul";
      lijstItems.push(ul[1]);
      continue;
    }
    if (ol) {
      if (lijstType !== "ol") sluitLijst();
      lijstType = "ol";
      lijstItems.push(ol[1]);
      continue;
    }

    sluitLijst();

    if (kop) {
      blokken.push(
        <p key={sleutel++} className="font-bold text-[#0F2744] mt-2 mb-1">
          {inline(kop[2])}
        </p>
      );
      continue;
    }
    if (!regel.trim()) continue; // lege regel = alinea-scheiding (spacing via mt)

    blokken.push(
      <p key={sleutel++} className={blokken.length > 0 ? "mt-1.5" : ""}>
        {inline(regel)}
      </p>
    );
  }
  sluitLijst();
  return blokken;
}

function parseInline(
  regel: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  if (!regel) return null;
  // Reset regex state per call (g-flag is stateful op het Regexp-object)
  const regex = new RegExp(MARKER_REGEX.source, "gi");
  const delen = regel.split(regex);
  return delen.map((deel, i) => {
    if (!deel) return null;

    const bronMatch = deel.match(/^\[Bron (\d+)\]$/i);
    if (bronMatch) {
      const bronIdx = parseInt(bronMatch[1], 10) - 1;
      const bron = bronnen?.[bronIdx];
      if (bron) {
        return (
          <BronPill
            key={i}
            nummer={bronIdx + 1}
            bron={bron}
            gehighlight={
              highlight?.berichtIdx === berichtIdx &&
              highlight?.bronIdx === bronIdx
            }
            onClick={() => onBronKlik(berichtIdx, bronIdx)}
          />
        );
      }
      // Bronvermelding-validatie: een citatie die niet aan een aangeleverde
      // bron te koppelen is, wordt zichtbaar gemarkeerd i.p.v. stil getoond.
      return <OngeldigeBronPill key={i} nummer={bronIdx + 1} />;
    }
    if (/^\[algemene kennis\]$/i.test(deel)) {
      return <KennisPill key={i} label="Algemene kennis" />;
    }
    if (/^\[volgens wetgeving\]$/i.test(deel)) {
      return <KennisPill key={i} label="Volgens wetgeving" />;
    }
    // Geen marker → verwerk inline-markdown (vet/cursief/code).
    return <span key={i}>{parseMarkdownInline(deel)}</span>;
  });
}

// Inline-markdown voor een tekstsegment zonder citatiemarkers. Subset: **vet**,
// *cursief* / _cursief_, `code`. Vet wordt vóór cursief gematcht zodat ** niet
// per ongeluk als twee losse * wordt gelezen.
function parseMarkdownInline(tekst: string): ReactNode[] {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  return tekst.split(regex).map((stuk, i) => {
    if (!stuk) return null;
    if (/^\*\*[^*]+\*\*$/.test(stuk)) {
      return <strong key={i}>{stuk.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(stuk)) {
      return (
        <code key={i} className="bg-gray-100 rounded px-1 py-0.5 text-[0.85em]">
          {stuk.slice(1, -1)}
        </code>
      );
    }
    if (/^\*[^*]+\*$/.test(stuk) || /^_[^_]+_$/.test(stuk)) {
      return <em key={i}>{stuk.slice(1, -1)}</em>;
    }
    return stuk;
  });
}

function BronPill({
  nummer,
  bron,
  gehighlight,
  onClick,
}: {
  nummer: number;
  bron: Bron;
  gehighlight: boolean;
  onClick: () => void;
}) {
  const locatie = [bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
    .filter(Boolean)
    .join(", ");
  const tooltip =
    `${bron.bron} — ${bron.titel}` +
    (locatie ? ` (${locatie})` : "") +
    `\n\n„${bron.fragment}"` +
    `\n\nKlik om de bronvermelding hieronder te openen.`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={`relative -top-[1px] inline-flex items-center justify-center align-baseline mx-0.5 min-w-[20px] h-[18px] px-1.5 rounded-md text-[10px] font-bold leading-none transition-colors cursor-pointer ${
        gehighlight
          ? "bg-[#0F2744] text-white"
          : "bg-[#C9A84C]/20 text-[#0F2744] hover:bg-[#C9A84C]/45 hover:shadow-sm"
      }`}
    >
      {nummer}
    </button>
  );
}

function KennisPill({ label }: { label: string }) {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-gray-200 text-gray-600"
      title="Niet uit een intern document — algemene kennis of wetgeving"
    >
      {label}
    </span>
  );
}

// Bronvermelding-validatie: een [Bron N] die niet aan een aangeleverde bron kan
// worden gekoppeld. Zichtbaar gemarkeerd zodat de bestuurder een mogelijk
// onjuiste/gehallucineerde verwijzing herkent en kan verifiëren.
function OngeldigeBronPill({ nummer }: { nummer: number }) {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-amber-100 text-amber-700 border border-amber-300"
      title="Deze bronverwijzing kon niet aan een aangeleverde bron worden gekoppeld. Controleer dit; mogelijk een onjuiste of niet-onderbouwde verwijzing."
    >
      ⚠ Bron {nummer}?
    </span>
  );
}

function Bronkaart({
  idx,
  bron,
  idVoorScroll,
  gehighlight,
}: {
  idx: number;
  bron: Bron;
  idVoorScroll: string;
  gehighlight: boolean;
}) {
  const locatie = [bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
    .filter(Boolean)
    .join(", ");

  const inhoud = (
    <>
      <span
        className={`flex-shrink-0 w-7 h-7 rounded-md text-[11px] font-bold flex items-center justify-center ${
          BRON_NUMMER_KLEUR[bron.bron] || "bg-gray-700 text-white"
        }`}
      >
        {idx + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={`font-bold ${BRONTEKST[bron.bron] || "text-gray-700"}`}
        >
          {bron.bron} — {bron.titel}
        </div>
        {locatie && (
          <div className="text-gray-500 mt-0.5 italic">📍 {locatie}</div>
        )}
        <div className="text-gray-500 mt-1 leading-relaxed">
          „{bron.fragment}"
        </div>
        {!bron.heeft_origineel && (
          <div className="text-gray-400 mt-1 text-[11px] italic">
            Origineel niet beschikbaar — alleen tekst voor de AI-assistent
          </div>
        )}
      </div>
      {bron.heeft_origineel && (
        <span className="flex-shrink-0 text-gray-400 group-hover:text-[#0F2744] transition-colors text-sm leading-none mt-1">
          ↗
        </span>
      )}
    </>
  );

  const baseKlasse = `flex items-start gap-2.5 p-2.5 rounded-lg border text-xs transition-all ${
    BRONKLEUR[bron.bron] || "bg-gray-50 border-gray-200"
  } ${
    gehighlight
      ? "ring-2 ring-[#C9A84C] ring-offset-1 shadow-md scale-[1.01]"
      : ""
  }`;

  if (bron.heeft_origineel) {
    // Spring direct naar de pagina als we die weten. De #page=N-fragment wordt
    // gehonoreerd door de ingebouwde PDF-viewers van Chrome/Edge/Firefox; voor
    // Word/Excel (download) wordt de fragment genegeerd — geen kwaad.
    const href = bron.pagina
      ? `/api/documents/${bron.document_id}/bestand#page=${bron.pagina}`
      : `/api/documents/${bron.document_id}/bestand`;
    return (
      <a
        id={idVoorScroll}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`group ${baseKlasse} hover:border-[#C9A84C] hover:shadow-sm cursor-pointer scroll-mt-24`}
        title={
          bron.pagina
            ? `Origineel openen op pagina ${bron.pagina} (nieuw tabblad)`
            : "Origineel openen in nieuw tabblad"
        }
      >
        {inhoud}
      </a>
    );
  }
  return (
    <div id={idVoorScroll} className={`${baseKlasse} scroll-mt-24`}>
      {inhoud}
    </div>
  );
}

function ModusBadge({ modus }: { modus: Modus }) {
  if (modus === "algemeen") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-md">
        <span>⚠️</span>
        <span>Algemene kennis — geen interne bronnen</span>
      </span>
    );
  }
  if (modus === "combineren") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] bg-blue-50 border border-blue-200 text-blue-800 px-2 py-0.5 rounded-md">
        <span>🔀</span>
        <span>Interne bronnen + algemene kennis</span>
      </span>
    );
  }
  return null;
}
