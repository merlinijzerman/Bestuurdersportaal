"use client";
import { useState, useRef, useEffect } from "react";
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
  const [fondsId, setFondsId] = useState<string>("");
  const [modus, setModus] = useState<Modus>("combineren");
  const [highlight, setHighlight] = useState<{
    berichtIdx: number;
    bronIdx: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const highlightTimer = useRef<number | null>(null);
  const supabase = createClient();

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

        setBerichten([{ rol: "ai", tekst: personalTekst }]);
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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, fonds_id: fondsId, modus }),
      });
      const data = await res.json();

      setBerichten((prev) => [
        ...prev,
        {
          rol: "ai",
          tekst: data.antwoord || data.error || "Er is een fout opgetreden.",
          bronnen: data.bronnen,
          modus: data.modus || modus,
        },
      ]);
    } catch {
      setBerichten((prev) => [
        ...prev,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ]);
    } finally {
      setLaden(false);
    }
  }

  function startNieuwGesprek() {
    if (laden) return;
    if (berichten.length > 1 && !confirm("Huidig gesprek wissen?")) return;
    // Behoud de huidige (gepersonaliseerde) welkomstboodschap als die er al is.
    const welkomst = berichten[0];
    setBerichten(welkomst && welkomst.rol === "ai" ? [welkomst] : []);
    setInvoer("");
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Topbar */}
      <div className="bg-white border-b border-gray-200 px-7 h-14 flex items-center">
        <span className="font-bold text-[#0F2744]">AI Assistent</span>
        <span className="ml-3 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
          ● Governance logging actief
        </span>
        <button
          onClick={startNieuwGesprek}
          disabled={laden || berichten.length <= 1}
          className="ml-auto text-xs text-gray-500 hover:text-[#0F2744] border border-gray-200 px-3 py-1.5 rounded-lg hover:border-[#C9A84C] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
              <div className="w-8 h-8 bg-gradient-to-br from-[#C9A84C] to-yellow-400 rounded-full flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                ✨
              </div>
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

        {laden && (
          <div className="flex gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-[#C9A84C] to-yellow-400 rounded-full flex items-center justify-center text-sm flex-shrink-0">
              ✨
            </div>
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
function renderAntwoord(
  tekst: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  const regels = tekst.split("\n");
  return regels.map((regel, j) => (
    <p key={j} className={j > 0 ? "mt-1.5" : ""}>
      {parseInline(regel, bronnen, berichtIdx, highlight, onBronKlik)}
    </p>
  ));
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
    if (bronMatch && bronnen) {
      const bronIdx = parseInt(bronMatch[1], 10) - 1;
      const bron = bronnen[bronIdx];
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
    }
    if (/^\[algemene kennis\]$/i.test(deel)) {
      return <KennisPill key={i} label="Algemene kennis" />;
    }
    if (/^\[volgens wetgeving\]$/i.test(deel)) {
      return <KennisPill key={i} label="Volgens wetgeving" />;
    }
    return <span key={i}>{deel}</span>;
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
    return (
      <a
        id={idVoorScroll}
        href={`/api/documents/${bron.document_id}/bestand`}
        target="_blank"
        rel="noopener noreferrer"
        className={`group ${baseKlasse} hover:border-[#C9A84C] hover:shadow-sm cursor-pointer scroll-mt-24`}
        title="Origineel openen in nieuw tabblad"
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
