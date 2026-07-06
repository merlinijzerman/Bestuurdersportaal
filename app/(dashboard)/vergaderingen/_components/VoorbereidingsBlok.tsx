"use client";
// ============================================================
//  VoorbereidingsBlok — assistent + aantekeningen per agendapunt
// ============================================================
// Herziening 06-07 (na toetsing met externe bestuurder): het aparte blok
// "Mijn voorbereiding" met eigen genereer-knop is vervallen — de inline chat
// ("Vraag door over dit agendapunt") is het enige AI-instappunt. De rijke
// voorbereiding (route met risicomatrix, procedures, profielsturing) zit
// daar als startchip "Stel mijn voorbereiding op" (zie AgendapuntChat).
// Dit component ordent alleen nog: (1) de chat, (2) daaronder "Mijn
// aantekeningen" (vrije_notities, privé; PATCH notities-route werkt zonder
// gegenereerde voorbereiding) — direct boven "Inbreng vooraf" in de kaart.
// De `voorbereidingen`-tabel dient uitsluitend nog voor die aantekeningen.
// Oude versies: Archief/ + git-historie.

import { useState, useEffect } from "react";
import AgendapuntChat from "./AgendapuntChat";

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
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    if (initieel) {
      setVrijeNotities(initieel.vrije_notities || "");
      setOpgeslagenOp(initieel.bijgewerkt_op || null);
      setNotitiesGewijzigd(false);
    }
  }, [initieel]);

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
    <div className="space-y-3">
      {/* Hét AI-instappunt van de kaart (0036 + FO duiding v0.3) */}
      <AgendapuntChat
        agendapuntId={agendapuntId}
        titel={titel}
        stukken={stukken}
      />

      {/* Vrij notitieveld — privé, los van de AI; direct boven "Inbreng vooraf" */}
      <div className="bg-white border border-amber-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
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
          className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-accent outline-none resize-none bg-gray-50"
        />
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-red-700">{fout}</span>
          {notitiesGewijzigd ? (
            <button
              onClick={notitiesOpslaan}
              disabled={opslaan}
              className="text-ink font-medium hover:underline disabled:opacity-50"
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
    </div>
  );
}
