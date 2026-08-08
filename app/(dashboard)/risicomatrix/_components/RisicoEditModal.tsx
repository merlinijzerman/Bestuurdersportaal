"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORIEEN,
  KANS_LABELS,
  IMPACT_LABELS,
  NIVEAU_LABEL,
  NIVEAU_KLEUREN,
  TYPE_LABEL,
  leidNiveauAf,
  type NiveauSlug,
} from "@/core/lib/risico-config";
import { WEEGVELDEN, RISICO_VELD_LABEL } from "@/core/lib/risico-wijziging";

// ============================================================================
//  RisicoEditModal — besluit 0141
// ----------------------------------------------------------------------------
//  Tot 0141 kon een risico alleen worden aangemaakt en gesloten. Een verkeerd
//  ingeschatte kans was daarmee onherstelbaar: sluiten en opnieuw aanmaken knipt
//  de geschiedenis van dat risico in tweeën.
//
//  UX-principe "maak vereisten en blokkers expliciet": het motiveringsveld
//  verschijnt ZODRA de weging wordt aangeraakt, met de uitleg erbij — niet als
//  foutmelding ná het opslaan. Dezelfde regel (WEEGVELDEN) die de server
//  afdwingt, bepaalt hier of het veld zichtbaar is. Server-side blijft leidend.
// ============================================================================

export interface RisicoBewerkbaar {
  id: string;
  titel: string;
  toelichting: string | null;
  categorie: string;
  kans: number;
  impact: number;
  niveau: string;
  niveau_handmatig: boolean;
  type_risico: string;
  eigenaar_naam: string | null;
  volgende_beoordeling: string | null;
}

const WEEG_LABELS = WEEGVELDEN.map((v) => RISICO_VELD_LABEL[v].toLowerCase());

export default function RisicoEditModal({
  risico,
  onSluiten,
}: {
  risico: RisicoBewerkbaar;
  onSluiten: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    titel: risico.titel,
    toelichting: risico.toelichting ?? "",
    categorie: risico.categorie,
    kans: risico.kans,
    impact: risico.impact,
    niveau: risico.niveau,
    niveau_handmatig: risico.niveau_handmatig,
    type_risico: risico.type_risico,
    eigenaar_naam: risico.eigenaar_naam ?? "",
    volgende_beoordeling: risico.volgende_beoordeling ?? "",
  });
  const [reden, setReden] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Raakt deze bewerking de weging? Zelfde criterium als server-side.
  const raaktWeging =
    form.kans !== risico.kans ||
    form.impact !== risico.impact ||
    form.niveau_handmatig !== risico.niveau_handmatig ||
    (form.niveau_handmatig && form.niveau !== risico.niveau);

  // Voorbeeld van het resulterende niveau — zodat je vóór het opslaan ziet waar
  // het risico in de heatmap terechtkomt.
  const nieuwNiveau: NiveauSlug = form.niveau_handmatig
    ? (form.niveau as NiveauSlug)
    : leidNiveauAf(form.kans, form.impact);

  async function opslaan() {
    if (raaktWeging && !reden.trim()) {
      setFout(`Geef een motivering: u wijzigt ${WEEG_LABELS.slice(0, 2).join(" of ")}.`);
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/risicos/${risico.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          toelichting: form.toelichting.trim() || null,
          eigenaar_naam: form.eigenaar_naam.trim() || null,
          volgende_beoordeling: form.volgende_beoordeling || null,
          ...(reden.trim() ? { reden: reden.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Wijzigen mislukt");
      if (data.foutcode === "geen_wijziging") {
        onSluiten();
        return;
      }
      onSluiten();
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Wijzigen mislukt");
      setBezig(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-accent/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-app-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-bold text-ink">Risico bewerken</h2>
          <button onClick={onSluiten} className="text-muted hover:text-ink" aria-label="Sluiten">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <Veld label="Titel" verplicht>
            <input
              type="text"
              value={form.titel}
              onChange={(e) => setForm({ ...form, titel: e.target.value })}
              className="w-full rounded-lg border border-app-line-control px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Veld>

          <Veld label="Toelichting">
            <textarea
              rows={3}
              value={form.toelichting}
              onChange={(e) => setForm({ ...form, toelichting: e.target.value })}
              className="w-full resize-none rounded-lg border border-app-line-control px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Veld>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Veld label="Categorie">
              <select
                value={form.categorie}
                onChange={(e) => setForm({ ...form, categorie: e.target.value })}
                className="w-full rounded-lg border border-app-line-control px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {CATEGORIEEN.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Veld>
            <Veld label="Type">
              <select
                value={form.type_risico}
                onChange={(e) => setForm({ ...form, type_risico: e.target.value })}
                className="w-full rounded-lg border border-app-line-control px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {(["structureel", "tijdelijk"] as const).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Veld>
          </div>

          {/* ── Weging ─────────────────────────────────────────────────────── */}
          <div className="rounded-lg border border-line bg-app-zebra p-3">
            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted">
              Weging
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Veld label="Kans">
                <select
                  value={form.kans}
                  onChange={(e) => setForm({ ...form, kans: Number(e.target.value) })}
                  className="w-full rounded-lg border border-app-line-control bg-app-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {[1, 2, 3, 4, 5].map((k) => (
                    <option key={k} value={k}>
                      K{k} — {KANS_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Veld>
              <Veld label="Impact">
                <select
                  value={form.impact}
                  onChange={(e) => setForm({ ...form, impact: Number(e.target.value) })}
                  className="w-full rounded-lg border border-app-line-control bg-app-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {[1, 2, 3, 4, 5].map((i) => (
                    <option key={i} value={i}>
                      I{i} — {IMPACT_LABELS[i]}
                    </option>
                  ))}
                </select>
              </Veld>
            </div>

            <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={form.niveau_handmatig}
                onChange={(e) =>
                  setForm({ ...form, niveau_handmatig: e.target.checked })
                }
                className="accent-accent"
              />
              Niveau handmatig bepalen (wijkt af van kans × impact)
            </label>

            {form.niveau_handmatig && (
              <div className="mt-2">
                <select
                  value={form.niveau}
                  onChange={(e) => setForm({ ...form, niveau: e.target.value })}
                  className="w-full rounded-lg border border-app-line-control bg-app-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {(["laag", "middel", "hoog"] as NiveauSlug[]).map((n) => (
                    <option key={n} value={n}>
                      {NIVEAU_LABEL[n]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
              <span>Resultaat:</span>
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${NIVEAU_KLEUREN[nieuwNiveau].pillBg} ${NIVEAU_KLEUREN[nieuwNiveau].pillText}`}
              >
                {NIVEAU_LABEL[nieuwNiveau]}
              </span>
              <span>
                (K{form.kans} · I{form.impact})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Veld label="Eigenaar">
              <input
                type="text"
                value={form.eigenaar_naam}
                onChange={(e) => setForm({ ...form, eigenaar_naam: e.target.value })}
                className="w-full rounded-lg border border-app-line-control px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Veld>
            <Veld label="Volgende beoordeling">
              <input
                type="date"
                value={form.volgende_beoordeling}
                onChange={(e) =>
                  setForm({ ...form, volgende_beoordeling: e.target.value })
                }
                className="w-full rounded-lg border border-app-line-control px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Veld>
          </div>

          {/* Verschijnt zodra de weging wordt aangeraakt — vóór het opslaan, niet
              als foutmelding erna. */}
          {raaktWeging && (
            <div className="rounded-lg border border-warn/30 bg-warn-tint p-3">
              <label className="mb-1 block text-[12.5px] font-bold text-warn-ink">
                Motivering <span className="font-normal">(verplicht)</span>
              </label>
              <p className="mb-2 text-[11px] text-warn-ink">
                U wijzigt de weging. Dat verandert de plek in de heatmap en dus de
                bestuurlijke prioritering. De motivering landt in het logboek van dit
                risico.
              </p>
              <textarea
                rows={2}
                value={reden}
                onChange={(e) => setReden(e.target.value)}
                placeholder="Bijv.: kans herijkt na ALM-studie Q3; renteschok waargenomen."
                className="w-full resize-none rounded-lg border border-warn/40 bg-app-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          )}

          {fout && (
            <div className="rounded-lg bg-err-tint px-3 py-2 text-sm text-err-ink">{fout}</div>
          )}
        </div>

        <div className="mt-5 flex gap-3 border-t border-line pt-4">
          <button
            onClick={onSluiten}
            className="flex-1 rounded-lg border border-app-line-control py-2.5 text-sm font-semibold text-muted hover:bg-app-bg"
          >
            Annuleren
          </button>
          <button
            onClick={opslaan}
            disabled={bezig}
            className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
          >
            {bezig ? "Opslaan…" : "Wijzigingen opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Veld({
  label,
  verplicht,
  children,
}: {
  label: string;
  verplicht?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12.5px] font-bold text-ink">
        {label} {verplicht && <span className="text-err-ink">*</span>}
      </label>
      {children}
    </div>
  );
}
