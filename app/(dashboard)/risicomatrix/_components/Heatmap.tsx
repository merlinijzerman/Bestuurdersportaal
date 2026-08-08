"use client";

import { useState } from "react";
import Link from "next/link";
import {
  NIVEAU_KLEUREN,
  NIVEAU_LABEL,
  KANS_LABELS,
  IMPACT_LABELS,
  type NiveauSlug,
} from "@/core/lib/risico-config";

// ============================================================================
//  Heatmap — besluit 0141
// ----------------------------------------------------------------------------
//  TWEE PROBLEMEN OPGELOST.
//
//  1. LEESBAARHEID (WCAG 1.4.3). De risico-pil gebruikte `bg-err` met
//     `text-err-ink` — donkerrood op donkerrood. Nagerekend op de waarden in
//     app/globals.css:
//
//         hoog    1,24:1      middel  1,30:1      laag  1,26:1
//
//     De eis voor bodytekst is 4,5:1. De tokenlaag bedoelt `-ink` expliciet als
//     tekst óp de `-tint`, niet op de DEFAULT — dat staat zo in de commentaren
//     bij de tokens. Met `-ink` op `-tint` wordt het 8,09 / 7,16 / 7,50. De
//     DEFAULT keert terug als RAND, zodat de pil zichtbaar blijft tegen de
//     eveneens getinte celachtergrond. Dit is een correctie, geen smaakkeuze.
//
//  2. SCHALING. De cel toonde `slice(0, 2)` plus "+N meer" in een vaste hoogte.
//     Bij veel risico's zag je dus per cel hooguit twee namen en was de rest
//     onbereikbaar vanuit de heatmap. Nu: de cel houdt zijn vaste hoogte (het
//     raster moet een leesbaar vierkant blijven), toont het AANTAL prominent, en
//     is als geheel klikbaar — dat opent de volledige lijst van die cel eronder.
//     Zo schaalt de visual naar honderden risico's zonder uit elkaar te vallen.
//
//  De cel is een <button> en geen div-met-onClick: daarmee is hij vanzelf
//  toetsenbordbereikbaar en aankondigbaar voor een schermlezer.
// ============================================================================

export interface HeatmapRisico {
  id: string;
  titel: string;
  kans: number;
  impact: number;
  niveau: NiveauSlug;
}

/** Niveau van een CEL volgt dezelfde som-regel als een risico (K+I). */
function celNiveau(kans: number, impact: number): NiveauSlug {
  const sum = kans + impact;
  if (sum <= 4) return "laag";
  if (sum <= 7) return "middel";
  return "hoog";
}

export default function Heatmap({ risicos }: { risicos: HeatmapRisico[] }) {
  // Geselecteerde cel als "k-i", of null. Eén cel tegelijk: twee open lijsten
  // onder een heatmap leest niet.
  const [open, setOpen] = useState<string | null>(null);

  // cellen[impactIndex][kansIndex]
  const cellen: HeatmapRisico[][][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => [] as HeatmapRisico[])
  );
  for (const r of risicos) {
    const i = Math.min(Math.max(r.impact, 1), 5) - 1;
    const k = Math.min(Math.max(r.kans, 1), 5) - 1;
    cellen[i][k].push(r);
  }

  const [openK, openI] = open ? open.split("-").map(Number) : [0, 0];
  const openItems = open ? cellen[openI - 1][openK - 1] : [];

  return (
    <div>
      <div className="grid grid-cols-[52px_repeat(5,1fr)] gap-1.5">
        <div />
        {[1, 2, 3, 4, 5].map((k) => (
          <div
            key={`hdr-${k}`}
            title={KANS_LABELS[k]}
            className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted"
          >
            K{k}
          </div>
        ))}
        {[5, 4, 3, 2, 1].map((iLabel) => (
          <div className="contents" key={`row-${iLabel}`}>
            <div
              title={IMPACT_LABELS[iLabel]}
              className="self-center pr-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted"
            >
              I{iLabel}
            </div>
            {[1, 2, 3, 4, 5].map((kLabel) => {
              const items = cellen[iLabel - 1][kLabel - 1];
              const niveau = celNiveau(kLabel, iLabel);
              const sleutel = `${kLabel}-${iLabel}`;
              const isOpen = open === sleutel;
              const kleur = NIVEAU_KLEUREN[niveau];
              return (
                <button
                  key={`cell-${sleutel}`}
                  type="button"
                  disabled={items.length === 0}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : sleutel)}
                  title={
                    items.length === 0
                      ? `Kans ${KANS_LABELS[kLabel]} × impact ${IMPACT_LABELS[iLabel]} — geen risico's`
                      : `${items.length} ${items.length === 1 ? "risico" : "risico's"} — klik om te tonen`
                  }
                  className={`flex h-20 flex-col items-center justify-center rounded border transition-all ${kleur.cellBg} ${
                    isOpen ? "ring-2 ring-accent ring-offset-1" : ""
                  } ${
                    items.length === 0
                      ? `${kleur.cellBorder} cursor-default`
                      : `${kleur.cellBorder} cursor-pointer hover:shadow-card`
                  }`}
                >
                  {items.length > 0 && (
                    <>
                      {/* Het aantal is de primaire drager: dat schaalt, een lijst
                          namen in een vakje van 80 px niet. */}
                      <span
                        className={`font-serif text-xl font-bold leading-none ${kleur.pillText}`}
                      >
                        {items.length}
                      </span>
                      <span className={`mt-1 text-[9.5px] font-semibold ${kleur.pillText}`}>
                        {items.length === 1 ? "risico" : "risico's"}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 text-center text-[10px] font-semibold uppercase tracking-widest text-muted">
        Kans →
      </div>

      {/* Uitgeklapte cel. Onder het raster en niet als tooltip: zo blijft het op
          tablet werken en is het toetsenbordbereikbaar. */}
      {open && openItems.length > 0 && (
        <div className="mt-4 rounded-lg border border-line bg-app-zebra p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
              Kans {openK} × impact {openI}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-[10.5px] font-semibold ${NIVEAU_KLEUREN[celNiveau(openK, openI)].pillBg} ${NIVEAU_KLEUREN[celNiveau(openK, openI)].pillText}`}
            >
              {NIVEAU_LABEL[celNiveau(openK, openI)]}
            </span>
            <span className="text-[11.5px] text-muted">
              {KANS_LABELS[openK]} · {IMPACT_LABELS[openI]}
            </span>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="ml-auto text-[11.5px] font-semibold text-accent-ink hover:underline"
            >
              Sluiten
            </button>
          </div>
          <div className="space-y-1">
            {openItems.map((r) => {
              const kleur = NIVEAU_KLEUREN[r.niveau];
              return (
                <Link
                  key={r.id}
                  href={`/risicomatrix/${r.id}`}
                  className={`block rounded border px-2.5 py-1.5 text-[12.5px] font-medium leading-tight transition-colors ${kleur.pillBg} ${kleur.pillText} ${kleur.cellBorder} hover:border-accent`}
                >
                  {r.titel}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
