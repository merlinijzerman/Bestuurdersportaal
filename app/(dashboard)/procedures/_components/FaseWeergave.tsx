"use client";

// Fase-weergave (WO-3) — het rechterpaneel wanneer een FASE is geselecteerd
// (in plaats van een stap). Toont alléén de fasebeschrijving (D8): code +
// status-pill + titel + de generieke, per fonds overschrijfbare beschrijving.
// De beschrijving is bewerkbaar door voorzitter/beheerder; opslaan gaat naar de
// override-tabel via /api/procedures/[id]/fase-beschrijving (leeg = terug naar
// de generieke default). De harde gate zit server-side in die route.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FASE_STATUS_LABEL,
  type FaseStatus,
} from "@/core/lib/procedure-fase-status";

interface Props {
  procedureId: string;
  faseCode: string;
  titel: string;
  status: FaseStatus;
  beschrijving: string | null;
  isOverride: boolean;
  kanBeheren: boolean;
}

// Neutrale status-pill in hoofdmenu-stijl; alleen 'afgerond' krijgt een subtiele
// tint (consistent met de fase-accordeon).
const STATUS_PILL: Record<FaseStatus, string> = {
  afgerond: "text-ok-ink bg-ok-tint border border-ok/20",
  in_behandeling: "text-nav-text bg-app-bg border border-nav-line",
  nog_niet_begonnen: "text-nav-text bg-app-bg border border-nav-line",
};

export default function FaseWeergave({
  procedureId,
  faseCode,
  titel,
  status,
  beschrijving,
  isOverride,
  kanBeheren,
}: Props) {
  const router = useRouter();
  const [bewerken, setBewerken] = useState(false);
  const [waarde, setWaarde] = useState(beschrijving ?? "");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function opslaan() {
    setFout(null);
    setBezig(true);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/fase-beschrijving`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fase_code: faseCode,
            beschrijving: waarde.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Opslaan mislukt");
      }
      setBewerken(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="bg-white border border-line rounded-xl p-6">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">
          Fase {faseCode}
        </span>
        <span
          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${STATUS_PILL[status]}`}
        >
          {FASE_STATUS_LABEL[status]}
        </span>
      </div>
      <h2 className="text-lg font-semibold text-ink mt-1">{titel}</h2>

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            Beschrijving van deze fase
          </span>
          {kanBeheren && !bewerken && (
            <button
              type="button"
              onClick={() => {
                // Start leeg als er nog géén fonds-override is — zo schrijf je
                // niet per ongeluk de generieke tekst als (redundante) override.
                setWaarde(isOverride ? beschrijving ?? "" : "");
                setBewerken(true);
              }}
              className="text-xs text-accent hover:underline"
            >
              Wijzigen
            </button>
          )}
          <span className="text-[10px] text-muted">
            · generiek, per fonds aanpasbaar
            {isOverride ? " · fonds-variant" : ""}
          </span>
        </div>

        {bewerken ? (
          <div className="space-y-2">
            <textarea
              rows={5}
              maxLength={4000}
              value={waarde}
              onChange={(e) => setWaarde(e.target.value)}
              placeholder="Beschrijf wat deze fase inhoudt voor dit fonds. Leeg laten valt terug op de generieke beschrijving."
              className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
            />
            <p className="text-[11px] text-muted">
              Geldt voor álle processen van dit type in dit fonds — niet alleen
              voor dit dossier.
            </p>
            {fout && (
              <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded px-2 py-1.5">
                {fout}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBewerken(false);
                  setFout(null);
                }}
                className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={opslaan}
                disabled={bezig}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
              >
                {bezig ? "Bezig…" : "Opslaan"}
              </button>
            </div>
          </div>
        ) : beschrijving ? (
          <p className="text-sm text-muted leading-relaxed max-w-3xl mt-1.5">
            {beschrijving}
          </p>
        ) : (
          <p className="text-sm text-muted italic mt-1.5">
            Nog geen beschrijving voor deze fase.
          </p>
        )}
      </div>
    </div>
  );
}
