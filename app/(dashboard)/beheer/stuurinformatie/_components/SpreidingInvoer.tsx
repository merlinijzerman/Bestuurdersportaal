"use client";

// ============================================================================
//  Spreiding-invoer (T15, tab 4 — decisions/0076).
//  Vijf invoervelden (beschikbaar vermogen, voorziening, aanpassingsfactor,
//  bandgrenzen); spreidingsvermogen en financieringsgraad worden LIVE afgeleid
//  via dezelfde pure module als het dashboard (leidSpreidingAf) en zijn
//  read-only — ze bestaan niet in de payload-vorm (allowlist-400 server-side).
//  De aanpassingsfactor komt kant-en-klaar van de actuaris (nooit berekend).
//  Eigen save-knop: POST { type: "spreiding" } — één batch-upsert, direct
//  gepubliceerd (geen vier-ogen), append-only gelogd door de DB-trigger.
//  De FG-maandreeks (trendgrafiek) loopt via de Excel-upload (later ticket).
// ============================================================================

import { leidSpreidingAf } from "@/core/lib/stuurinfo-spreiding";
import { parseNlGetal } from "@/core/lib/stuurinfo-sjabloon";
import type { Snapshot, VeldState } from "./StuurinfoInvoer";

type Props = {
  velden: VeldState;
  referentie: Snapshot | null;
  zetVeld: (key: string, waarde: string) => void;
  opslaan: () => void;
  bezig: boolean;
  uitgeschakeld: boolean;
};

const fmt1 = (v: number | null): string =>
  v === null
    ? "—"
    : v.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = (v: number | null): string =>
  v === null ? "—" : v.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

const VELDEN: Array<{ key: string; label: string; placeholder: string }> = [
  { key: "beschikbaar", label: "Totaal beschikbaar vermogen (€ mln)", placeholder: "880" },
  { key: "voorziening", label: "Uitkeringsvermogen / voorziening (€ mln)", placeholder: "864" },
  { key: "aanpassingsfactor", label: "Aanpassingsfactor na spreiden (%, ±)", placeholder: "0,62" },
  { key: "band_onder", label: "Bandbreedte — ondergrens (%)", placeholder: "85" },
  { key: "band_boven", label: "Bandbreedte — bovengrens (%)", placeholder: "115" },
];

export default function SpreidingInvoer({
  velden,
  referentie,
  zetVeld,
  opslaan,
  bezig,
  uitgeschakeld,
}: Props) {
  // Live afleiding — cosmetisch; de server/leeslaag rekent dezelfde formule.
  const afgeleid = leidSpreidingAf({
    beschikbaar: parseNlGetal(velden.spreiding.beschikbaar),
    voorziening: parseNlGetal(velden.spreiding.voorziening),
    aanpassingsfactor: parseNlGetal(velden.spreiding.aanpassingsfactor),
    bandOnder: parseNlGetal(velden.spreiding.band_onder),
    bandBoven: parseNlGetal(velden.spreiding.band_boven),
  });

  const referentieVan = (key: string): number | null => {
    if (!referentie) return null;
    const map: Record<string, number | null> = {
      beschikbaar: referentie.spreiding.beschikbaar,
      voorziening: referentie.spreiding.voorziening,
      aanpassingsfactor: referentie.spreiding.aanpassingsfactor,
      band_onder: referentie.spreiding.bandOnder,
      band_boven: referentie.spreiding.bandBoven,
    };
    return map[key] ?? null;
  };

  const verplichtLeeg = ["beschikbaar", "voorziening", "aanpassingsfactor"].some(
    (k) => parseNlGetal(velden.spreiding[k]) === null
  );
  // Niet-leeg maar onparseerbaar bandveld blokkeert de save: anders zou een
  // typefout de band stilzwijgend als null (= geen grens) wegschrijven.
  const ongeldigeBand = (["band_onder", "band_boven"] as const).some(
    (k) => velden.spreiding[k].trim() !== "" && parseNlGetal(velden.spreiding[k]) === null
  );

  return (
    <section id="spreiding" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">
          Spreidingsbeleid — collectieve uitkeringsfase
        </h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 4</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Voer beschikbaar vermogen en voorziening in; spreidingsvermogen en financieringsgraad
        worden berekend. De aanpassingsfactor (na spreiden) komt van de actuaris.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {VELDEN.map((v) => (
          <div key={v.key}>
            <label className="block text-xs font-medium text-muted mb-1">{v.label}</label>
            <div className="flex items-center gap-2">
              <input
                value={velden.spreiding[v.key]}
                onChange={(e) => zetVeld(v.key, e.target.value)}
                disabled={uitgeschakeld}
                inputMode="decimal"
                placeholder={v.placeholder}
                className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50"
              />
              <span className="shrink-0 text-xs text-muted">vorige: {fmt(referentieVan(v.key))}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Afgeleide velden — read-only, dezelfde formule als het dashboard. */}
      <div className="mt-4 rounded-lg bg-ok-tint px-4 py-3 text-sm text-ok-ink">
        Spreidingsvermogen <strong>€ {fmt(afgeleid.spreidingsvermogen)} mln</strong> ·
        financieringsgraad <strong>{afgeleid.financieringsgraad === null ? "—" : `${fmt1(afgeleid.financieringsgraad)}%`}</strong>{" "}
        <span className="text-xs">(berekend: beschikbaar − voorziening, resp. beschikbaar ÷ voorziening)</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={opslaan}
          disabled={bezig || uitgeschakeld || verplichtLeeg || ongeldigeBand}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Spreiding opslaan & publiceren"}
        </button>
        {verplichtLeeg && (
          <span className="text-xs text-warn-ink">
            Beschikbaar vermogen, voorziening en aanpassingsfactor zijn verplicht.
          </span>
        )}
        {ongeldigeBand && (
          <span className="text-xs text-warn-ink">
            Bandgrens ongeldig — corrigeer of maak het veld leeg (= geen grens).
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-muted italic">
        Maandreeks financieringsgraad (grafiek met bandbreedte) → via upload, niet handmatig.
      </p>
    </section>
  );
}
