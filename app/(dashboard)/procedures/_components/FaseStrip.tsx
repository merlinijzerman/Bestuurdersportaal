// Fasestrip voor het procesoverzicht (WO-2, §7.1) — pure presentatie.
//
// Per fase één segment met de afgeleide fase-status (kleur + vorm) en een
// orthogonale aandachtsstip. Geen sequentiële cursor: de segmenten zeggen
// "waar staat elke fase", niet "hoe ver is het proces".

import type { FaseStatus, AandachtNiveau } from "@/core/lib/procedure-fase-status";
import { FASE_STATUS_LABEL } from "@/core/lib/procedure-fase-status";

export interface FaseSegment {
  fase_code: string;
  titel: string;
  status: FaseStatus;
  aandacht: AandachtNiveau;
}

const SEGMENT_KLEUR: Record<FaseStatus, string> = {
  afgerond: "bg-ok",
  in_behandeling: "bg-accent",
  nog_niet_begonnen: "bg-app-bg border border-line",
  vervallen: "bg-line opacity-60",
};

export default function FaseStrip({ fasen }: { fasen: FaseSegment[] }) {
  if (fasen.length === 0) return null;
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${fasen.length}, minmax(0, 1fr))` }}
    >
      {fasen.map((f) => (
        <div key={f.fase_code} className="min-w-0">
          <div
            className="relative"
            title={`${f.fase_code} · ${f.titel} — ${FASE_STATUS_LABEL[f.status]}${
              f.aandacht !== "geen" ? " (aandacht)" : ""
            }`}
          >
            <div className={`h-2 rounded-sm ${SEGMENT_KLEUR[f.status]}`} />
            {f.aandacht !== "geen" && (
              <span
                className={`absolute -top-1 right-0 w-2 h-2 rounded-full ring-1 ring-white ${
                  f.aandacht === "rood" ? "bg-err" : "bg-warn"
                }`}
              />
            )}
          </div>
          <div className="text-[10px] text-muted truncate mt-1">
            {f.fase_code} · {f.titel}
          </div>
        </div>
      ))}
    </div>
  );
}
