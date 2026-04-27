"use client";
import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase";

interface Bron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
}

interface Bericht {
  rol: "gebruiker" | "ai";
  tekst: string;
  bronnen?: Bron[];
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

const VOORGESTELDE_VRAGEN = [
  "Wat zijn de deskundigheidseisen voor bestuurders?",
  "Hoe wordt een tegenstrijdig belang gemeld?",
  "Wat zijn de regels voor het beleggingsbeleid?",
  "Wat is het ESG-beleid van het fonds?",
];

export default function AiPage() {
  const [berichten, setBerichten] = useState<Bericht[]>([
    {
      rol: "ai",
      tekst: `Goedemorgen! Ik ben uw AI-assistent voor het bestuurdersportaal.\n\nIk beantwoord vragen op basis van de documenten in uw bibliotheek (DNB-leidraden, AFM-kaders, Pensioenfederatie-richtlijnen en fondsspecifieke documenten). Elk antwoord bevat traceerbare bronverwijzingen.\n\nUpload eerst documenten via de Documentbibliotheek, dan kan ik ze doorzoeken.`,
    },
  ]);
  const [invoer, setInvoer] = useState("");
  const [laden, setLaden] = useState(false);
  const [fondsId, setFondsId] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data } = await supabase
          .from("profielen")
          .select("fonds_id")
          .eq("id", user.id)
          .single();
        if (data?.fonds_id) setFondsId(data.fonds_id);
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

    setBerichten((prev) => [...prev, { rol: "gebruiker", tekst }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vraag: tekst, fonds_id: fondsId }),
      });
      const data = await res.json();

      setBerichten((prev) => [
        ...prev,
        {
          rol: "ai",
          tekst: data.antwoord || data.error || "Er is een fout opgetreden.",
          bronnen: data.bronnen,
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

  return (
    <div className="flex flex-col h-screen">
      {/* Topbar */}
      <div className="bg-white border-b border-gray-200 px-7 h-14 flex items-center">
        <span className="font-bold text-[#0F2744]">AI Assistent</span>
        <span className="ml-3 bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
          ● Governance logging actief
        </span>
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
              <div
                className={
                  b.rol === "gebruiker"
                    ? "bg-[#0F2744] text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                    : "bg-gray-50 border border-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-gray-800"
                }
              >
                {b.tekst.split("\n").map((regel, j) => (
                  <p key={j} className={j > 0 ? "mt-1.5" : ""}>{regel}</p>
                ))}
              </div>

              {/* Bronverwijzingen */}
              {b.bronnen && b.bronnen.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                    📌 Bronverwijzingen ({b.bronnen.length})
                  </div>
                  <div className="space-y-2">
                    {b.bronnen.map((bron, j) => (
                      <div
                        key={j}
                        className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs ${BRONKLEUR[bron.bron] || "bg-gray-50 border-gray-200"}`}
                      >
                        <span className="text-base">📋</span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-bold ${BRONTEKST[bron.bron] || "text-gray-700"}`}>
                            {bron.bron} — {bron.titel}
                          </div>
                          {(bron.paragraaf || bron.pagina) && (
                            <div className="text-gray-500 mt-0.5 italic">
                              📍{" "}
                              {[bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                          )}
                          <div className="text-gray-500 mt-1 leading-relaxed">
                            „{bron.fragment}"
                          </div>
                        </div>
                      </div>
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
