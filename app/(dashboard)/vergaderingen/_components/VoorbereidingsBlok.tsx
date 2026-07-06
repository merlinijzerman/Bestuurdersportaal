"use client";
// ============================================================
//  VoorbereidingsBlok — persoonlijke voorbereiding per agendapunt
// ============================================================
// Herziening 06-07 (opvolging gebruikersfeedback op FO duiding v0.2): het
// gestructureerde AI-product (duiding / lenzen / vergadervragen / notitie per
// vraag / "Vul inbreng") is vervallen. "Genereer voorbereiding" plaatst de
// AI-voorbereiding nu als eerste beurt in het geïntegreerde gesprek
// (AgendapuntChat.genereerVoorbereiding via ref) — met dezelfde [Bron N]-pills
// en onderbouwing als de assistent, en direct doorvraagbaar.
// Wat dit blok zelf nog doet: intro + één genereer-knop, en het vrije
// aantekeningenveld (vrije_notities, privé; PATCH notities-route werkt ook
// zonder gegenereerde voorbereiding). De `voorbereidingen`-tabel dient alleen
// nog voor die aantekeningen.
// Oude versie: Archief/ + git-historie.

import { useState, useRef, useEffect } from "react";
import AgendapuntChat, { type AgendapuntChatHandle } from "./AgendapuntChat";

// De rij uit `voorbereidingen` — alleen de aantekeningen-velden worden nog
// gebruikt; de overige velden blijven getypeerd voor bestaande rijen.
export interface Voorbereiding {
  id: string;
  agendapunt_id: string;
  ai_output: Record<string, unknown>;
  eigen_notities: Record<string, string>;
  vrije_notities: string | null;
  gegenereerd_op: string;
  bijgewerkt_op: string;
}

interface Props {
  agendapuntId: string;
  /* Titel + stukken voor de geïntegreerde chat: de inline assistent (0036)
     is onderdeel van dit blok, zodat de kaart één AI-plek kent. */
  titel: string;
  stukken: { id: string; titel: string }[];
  initieel: Voorbereiding | null;
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function VoorbereidingsBlok({
  agendapuntId,
  titel,
  stukken,
  initieel,
}: Props) {
  const [vrijeNotities, setVrijeNotities] = useState<string>(
    initieel?.vrije_notities || ""
  );
  const [notitiesGewijzigd, setNotitiesGewijzigd] = useState(false);
  const [opslaan, setOpslaan] = useState(false);
  const [opgeslagenOp, setOpgeslagenOp] = useState<string | null>(
    initieel?.bijgewerkt_op || null
  );
  const [genereren, setGenereren] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const chatRef = useRef<AgendapuntChatHandle>(null);

  useEffect(() => {
    if (initieel) {
      setVrijeNotities(initieel.vrije_notities || "");
      setOpgeslagenOp(initieel.bijgewerkt_op || null);
      setNotitiesGewijzigd(false);
    }
  }, [initieel]);

  // "Genereer voorbereiding" → eerste beurt in het geïntegreerde gesprek.
  async function genereer() {
    if (genereren) return;
    setFout(null);
    setGenereren(true);
    try {
      await chatRef.current?.genereerVoorbereiding();
    } finally {
      setGenereren(false);
    }
  }

  async function notitiesOpslaan() {
    setFout(null);
    setOpslaan(true);
    try {
      const res = await fetch(
        `/api/agendapunten/${agendapuntId}/voorbereiding/notities`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vrije_notities: vrijeNotities }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Opslaan mislukt");
      }
      const data = await res.json().catch(() => null);
      setOpgeslagenOp(
        (data?.voorbereiding?.bijgewerkt_op as string) || new Date().toISOString()
      );
      setNotitiesGewijzigd(false);
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setOpslaan(false);
    }
  }

  return (
    <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-4 space-y-3">
      {/* Intro + genereer-knop */}
      <div className="flex items-start gap-3">
        <span className="text-base">🔒</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[#0F2744]">
            Mijn voorbereiding
          </div>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            Laat de AI helpen scherper na te denken over dit punt — wat het
            stuk betekent, welk besluit wordt gevraagd, blinde vlekken en
            vragen voor de vergadering. Persoonlijk en alleen voor u zichtbaar.
          </p>
          <div className="mt-3">
            <button
              onClick={genereer}
              disabled={genereren}
              className="bg-[#0F2744] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#1a3858] disabled:opacity-50"
            >
              {genereren ? "Bezig met opstellen…" : "Genereer voorbereiding"}
            </button>
            <span className="text-[11px] text-gray-500 ml-2">
              verschijnt als eerste bericht in het gesprek hieronder
            </span>
          </div>
          {fout && <div className="text-xs text-red-700 mt-2">{fout}</div>}
        </div>
      </div>

      {/* Vrij notitieveld — privé, los van de AI */}
      <div className="bg-white border border-amber-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-2">
          Mijn aantekeningen
          <span className="text-[10px] text-gray-400 font-normal ml-2 normal-case tracking-normal">
            privé · niet zichtbaar voor anderen
          </span>
        </div>
        <textarea
          rows={3}
          value={vrijeNotities}
          onChange={(e) => {
            setVrijeNotities(e.target.value);
            setNotitiesGewijzigd(true);
          }}
          placeholder="Eigen aantekeningen bij dit agendapunt…"
          className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none resize-none bg-gray-50"
        />
        <div className="mt-1.5 flex items-center justify-end text-xs">
          {notitiesGewijzigd ? (
            <button
              onClick={notitiesOpslaan}
              disabled={opslaan}
              className="text-[#0F2744] font-medium hover:underline disabled:opacity-50"
            >
              {opslaan ? "Opslaan…" : "Aantekeningen opslaan"}
            </button>
          ) : (
            opgeslagenOp && (
              <span className="text-gray-400">
                Opgeslagen {formatDatumKort(opgeslagenOp)}
              </span>
            )
          )}
        </div>
      </div>

      {/* Geïntegreerd gesprek (0036) — de voorbereiding opent dit gesprek;
          doorvragen over het punt en de stukken gebeurt op dezelfde plek. */}
      <AgendapuntChat
        ref={chatRef}
        agendapuntId={agendapuntId}
        titel={titel}
        stukken={stukken}
      />
    </div>
  );
}
