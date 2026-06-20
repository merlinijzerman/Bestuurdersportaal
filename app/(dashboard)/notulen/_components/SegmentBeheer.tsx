"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AgendapuntOptie {
  id: string;
  titel: string;
  volgorde: number;
}

export interface SegmentData {
  id: string;
  segment_index: number;
  titel: string | null;
  tekst: string;
  agendapunt_id: string | null;
  bevestigd: boolean;
  bevestigd_op: string | null;
}

interface Props {
  documentId: string;
  vastgesteld: boolean;
  magBeheren: boolean;
  agendapunten: AgendapuntOptie[];
  segmenten: SegmentData[];
}

// Increment D — secretaris bevestigt/corrigeert segmentvoorstellen. Alle
// schrijfacties lopen via de capability-gated API-routes (UI-zichtbaarheid is
// cosmetisch; de server is leidend).
export default function SegmentBeheer({
  documentId,
  vastgesteld,
  magBeheren,
  agendapunten,
  segmenten,
}: Props) {
  const router = useRouter();
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown, sleutel = url) {
    setBezig(sleutel);
    setFout(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFout(json?.error ?? "Actie mislukt");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setFout("Netwerkfout");
      return false;
    } finally {
      setBezig(null);
    }
  }

  function apLabel(id: string | null): string {
    if (!id) return "— geen agendapunt —";
    const ap = agendapunten.find((a) => a.id === id);
    return ap ? `${ap.volgorde}. ${ap.titel}` : "(onbekend agendapunt)";
  }

  return (
    <div>
      {magBeheren && (
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => call(`/api/notulen/${documentId}/segmenteer`, "POST", undefined, "segmenteer")}
            disabled={bezig !== null}
            className="bg-[#0F2744] text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-[#1A3A5C] disabled:opacity-50"
          >
            {bezig === "segmenteer" ? "Bezig…" : "Segmentvoorstellen genereren / verversen"}
          </button>
          <span className="text-xs text-gray-400">
            Verversen laat bevestigde segmenten ongemoeid.
          </span>
        </div>
      )}

      {fout && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
          {fout}
        </div>
      )}

      {segmenten.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">
          Nog geen segmenten. {magBeheren ? "Genereer voorstellen om te beginnen." : ""}
        </div>
      ) : (
        <div className="space-y-3">
          {segmenten.map((s) => (
            <SegmentKaart
              key={s.id}
              segment={s}
              vastgesteld={vastgesteld}
              magBeheren={magBeheren}
              agendapunten={agendapunten}
              apLabel={apLabel}
              bezig={bezig}
              onBevestig={() =>
                call(`/api/notulen/segmenten/${s.id}/bevestig`, "POST", {}, s.id)
              }
              onOntBevestig={() =>
                call(`/api/notulen/segmenten/${s.id}`, "PATCH", { bevestigd: false }, s.id)
              }
              onKoppel={(agendapunt_id) =>
                call(`/api/notulen/segmenten/${s.id}`, "PATCH", { agendapunt_id }, s.id)
              }
              onVerwijder={() => call(`/api/notulen/segmenten/${s.id}`, "DELETE", undefined, s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentKaart({
  segment,
  vastgesteld,
  magBeheren,
  agendapunten,
  apLabel,
  bezig,
  onBevestig,
  onOntBevestig,
  onKoppel,
  onVerwijder,
}: {
  segment: SegmentData;
  vastgesteld: boolean;
  magBeheren: boolean;
  agendapunten: AgendapuntOptie[];
  apLabel: (id: string | null) => string;
  bezig: string | null;
  onBevestig: () => void;
  onOntBevestig: () => void;
  onKoppel: (agendapunt_id: string | null) => void;
  onVerwijder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dit = bezig === segment.id;

  return (
    <div
      className={`border rounded-xl p-4 ${
        segment.bevestigd ? "border-green-300 bg-green-50/40" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[#0F2744] text-sm">
            {segment.titel || `Segment ${segment.segment_index + 1}`}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{apLabel(segment.agendapunt_id)}</div>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${
            segment.bevestigd ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {segment.bevestigd ? "Bevestigd ✓" : "Voorstel"}
        </span>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-gray-400 hover:text-gray-600 mt-2"
      >
        {open ? "Tekst verbergen" : "Tekst tonen"}
      </button>
      {open && (
        <pre className="text-xs text-gray-600 whitespace-pre-wrap mt-2 bg-gray-50 rounded-lg p-3 max-h-60 overflow-auto">
          {segment.tekst}
        </pre>
      )}

      {magBeheren && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <select
            defaultValue={segment.agendapunt_id ?? ""}
            onChange={(e) => onKoppel(e.target.value || null)}
            disabled={dit || segment.bevestigd}
            title={segment.bevestigd ? "Ont-bevestig eerst om het agendapunt te wijzigen" : ""}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 disabled:opacity-50"
          >
            <option value="">— geen agendapunt —</option>
            {agendapunten.map((a) => (
              <option key={a.id} value={a.id}>
                {a.volgorde}. {a.titel}
              </option>
            ))}
          </select>

          {!segment.bevestigd ? (
            <button
              onClick={() => onBevestig()}
              disabled={dit || !vastgesteld}
              title={vastgesteld ? "" : "Notulen moeten eerst vastgesteld zijn"}
              className="bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-green-800 disabled:opacity-40"
            >
              {dit ? "Bezig…" : "Bevestigen & indexeren"}
            </button>
          ) : (
            <button
              onClick={onOntBevestig}
              disabled={dit}
              className="border border-amber-300 text-amber-700 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-amber-50 disabled:opacity-40"
            >
              {dit ? "Bezig…" : "Ont-bevestigen"}
            </button>
          )}

          <button
            onClick={onVerwijder}
            disabled={dit}
            className="border border-red-200 text-red-600 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-red-50 disabled:opacity-40"
          >
            Verwijderen
          </button>
        </div>
      )}
    </div>
  );
}
