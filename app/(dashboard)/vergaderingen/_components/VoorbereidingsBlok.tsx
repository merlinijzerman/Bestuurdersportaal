"use client";
// ============================================================
//  VoorbereidingsBlok — voorbereiding + aantekeningen per agendapunt
// ============================================================
// Dit component ordent twee dingen, in deze volgorde: (1) "Mijn voorbereiding"
// — de UITKOMST, met één knop per toestand — en (2) "Mijn aantekeningen"
// (vrije_notities, privé; de PATCH-notitiesroute werkt zonder gegenereerde
// voorbereiding). Beide staan direct boven "Inbreng vooraf" in de kaart.
//
// Geschiedenis, omdat de slinger twee keer is doorgeslagen: 06-07 verviel het
// aparte blok "Mijn voorbereiding" ten gunste van een inline chat, die het
// enige AI-instappunt werd. Die chat was een tweede gespreksimplementatie met
// een eigen, verschraald payloadlichaam. T1 (besluit 0204) haalt hem weg: het
// gesprek staat nu in het assistentpaneel, dat over elke module heen
// beschikbaar is, en de kaart houdt de uitkomst plus één knop "Doorvragen".
// De `voorbereidingen`-tabel dient nog steeds uitsluitend voor de aantekeningen.
// Oude versies: Archief/ + git-historie.

import { useState, useEffect } from "react";
import VoorbereidingKaart from "./VoorbereidingKaart";

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
      {/* De uitkomst, niet het gesprek: doorvragen gebeurt in het paneel. */}
      <VoorbereidingKaart agendapuntId={agendapuntId} titel={titel} />

      {/* Vrij notitieveld — privé, los van de AI; direct boven "Inbreng vooraf" */}
      <div className="bg-white border border-warn/30 rounded-lg p-3">
        <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
          Mijn aantekeningen
          <span className="text-[10px] text-muted font-normal ml-2 normal-case tracking-normal">
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
          className="w-full text-sm border border-line rounded px-3 py-2 focus:border-accent outline-none resize-none bg-app-bg"
        />
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-err-ink">{fout}</span>
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
              <span className="text-muted">
                Opgeslagen {formatDatumKort(opgeslagenOp)}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
