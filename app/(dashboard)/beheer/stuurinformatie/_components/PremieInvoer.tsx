"use client";

// ============================================================================
//  Premie & compensatie-invoer (T16, tab 7 — decisions/0077).
//  Premiecomponenten (€ per periode én % van de premiegrondslag — beide
//  aangeleverd door de uitvoerder), depot-mutatiebronnen (±, onttrekkingen −)
//  en de kpi's toekenning/jaar, startomvang en prognose-ondergrens. Totaal
//  premie, totaal mutatie en ultimo worden LIVE afgeleid (zelfde pure module
//  als het dashboard); primo = depotstand van de voorgaande periode.
//
//  Kernregels (decisions/0077, soli-patroon):
//  - De depot-STAND (= ultimo) komt uit de balans-save (gekoppelde reserve) —
//    hier alleen zichtbaar als anker. Ontbreekt de reserve-rij: expliciete
//    blokker ("sla eerst de balans op") vóór de save.
//  - HARDE consistentie: primo + totaal mutatie moet de balans-stand zijn;
//    de RPC weigert anders (COMP_MUTATIE_ONGELIJK). De UI blokkeert vooraf.
//  - De uitputtingsprognose-reeks is SEED/UPLOAD-only — bewust géén
//    handinvoer van tijdreeksen (werkopdracht-scopegrens).
// ============================================================================

import {
  PREMIE_COMPONENT_DEFINITIES,
  COMP_MUTATIE_DEFINITIES,
  compTotaalMutatie,
} from "@/core/lib/stuurinfo-premie";
import { ONTWIKKELING_TOLERANTIE } from "@/core/lib/stuurinfo-ontwikkeling";
import { parseNlGetal } from "@/core/lib/stuurinfo-sjabloon";
import type { Snapshot, VeldState, T16VeldSectie } from "./StuurinfoInvoer";

type Props = {
  velden: VeldState;
  huidig: Snapshot;
  referentie: Snapshot | null;
  zetVeld: (sectie: T16VeldSectie, key: string, waarde: string) => void;
  opslaan: () => void;
  bezig: boolean;
  uitgeschakeld: boolean;
};

const fmt1 = (v: number | null): string =>
  v === null
    ? "—"
    : v.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = (v: number | null): string =>
  v === null
    ? "—"
    : v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PremieInvoer({
  velden,
  huidig,
  referentie,
  zetVeld,
  opslaan,
  bezig,
  uitgeschakeld,
}: Props) {
  // Read-only ankers uit de data: ultimo (balans, deze periode) en primo
  // (balans, voorgaande periode).
  const reserveStand = huidig.premie.reserveStand;
  const primo = referentie?.premie.reserveStand ?? null;

  // Live afleiding — cosmetisch, via dezelfde pure modules als leeslaag en
  // RPC-spiegel; de RPC dwingt hard af.
  const somAlsCompleet = (waarden: Array<number | null>): number | null => {
    let som = 0;
    for (const w of waarden) {
      if (w === null) return null;
      som += w;
    }
    return som;
  };
  const totaalEur = somAlsCompleet(
    PREMIE_COMPONENT_DEFINITIES.map((d) => parseNlGetal(velden.premieEur[d.key]))
  );
  const totaalPct = somAlsCompleet(
    PREMIE_COMPONENT_DEFINITIES.map((d) => parseNlGetal(velden.premiePct[d.key]))
  );
  const totaalMutatie = compTotaalMutatie(
    COMP_MUTATIE_DEFINITIES.map((d) => ({
      puntKey: d.key,
      label: null,
      volgorde: d.volgorde,
      waarde: parseNlGetal(velden.compMutaties[d.key]),
    }))
  );
  const ultimo = primo !== null && totaalMutatie !== null ? primo + totaalMutatie : null;
  const wijktAf =
    ultimo !== null &&
    reserveStand !== null &&
    Math.abs(ultimo - reserveStand) >= ONTWIKKELING_TOLERANTIE;

  const toekenning = parseNlGetal(velden.premieKpis.toekenning);
  const verplichtLeeg =
    totaalEur === null || totaalPct === null || totaalMutatie === null || toekenning === null;
  const reserveOntbreekt = reserveStand === null;
  // Niet-leeg maar onparseerbaar optioneel veld blokkeert de save (anders zou
  // een typefout stilzwijgend als "onbekend/geen grens" worden weggeschreven).
  const ongeldigOptioneel = (
    [velden.premieKpis.startomvang, velden.premieKpis.ondergrens_pct] as const
  ).some((v) => v.trim() !== "" && parseNlGetal(v) === null);
  const magOpslaan =
    !bezig && !uitgeschakeld && !verplichtLeeg && !reserveOntbreekt && !wijktAf && !ongeldigOptioneel;

  const inputClass =
    "w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50";

  return (
    <section id="premie" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">Premie &amp; compensatie</h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 7</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Voer per premiecomponent het €-bedrag en het %-aandeel in de grondslag in (beide
        aangeleverd), plus de depot-mutaties naar bron. Totaal premie, totaal mutatie en ultimo
        worden berekend. Primo = ultimo vorige periode.
      </p>

      {reserveOntbreekt && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn-ink">
          <strong>Eerst de balans opslaan:</strong> de compensatiedepot-stand van deze periode komt
          uit de balans/reserves-invoer (één bron per bedrag). Sla die sectie eerst op; daarna
          kunnen de gegevens hier worden vastgelegd.
        </div>
      )}

      {/* Premiecomponenten (€ + % grondslag) */}
      <div className="text-sm font-medium text-ink mb-2">Premiecomponenten</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PREMIE_COMPONENT_DEFINITIES.map((d) => (
          <div key={d.key} className="rounded-lg border border-line p-3">
            <div className="text-xs font-medium text-ink mb-2">{d.label}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-muted mb-1">€ mln</label>
                <input
                  value={velden.premieEur[d.key]}
                  onChange={(e) => zetVeld("premieEur", d.key, e.target.value)}
                  disabled={uitgeschakeld}
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">% grondslag</label>
                <input
                  value={velden.premiePct[d.key]}
                  onChange={(e) => zetVeld("premiePct", d.key, e.target.value)}
                  disabled={uitgeschakeld}
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg bg-app-bg px-4 py-3 text-sm text-ink">
        Totaal premie <strong>€ {fmt1(totaalEur)} mln</strong> ·{" "}
        <strong>{fmt2(totaalPct)}%</strong> van de grondslag{" "}
        <span className="text-xs text-muted">(berekend: som van de componenten)</span>
      </div>

      {/* Depot-mutaties */}
      <div className="mt-5 text-sm font-medium text-ink mb-2">
        Ontwikkeling compensatiedepot — mutaties naar bron
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Primo (€ mln)</label>
          <input
            value={primo === null ? "—" : fmt1(primo)}
            readOnly
            disabled
            className="w-full rounded-lg border border-app-line-strong bg-app-bg px-3 py-2 text-sm text-right text-muted"
          />
        </div>
        {COMP_MUTATIE_DEFINITIES.map((d) => (
          <div key={d.key}>
            <label className="block text-xs font-medium text-muted mb-1">
              {d.key === "onttrekkingen" ? "Onttrekkingen (toekenning, −)" : d.label} (€ mln, ±)
            </label>
            <input
              value={velden.compMutaties[d.key]}
              onChange={(e) => zetVeld("compMutaties", d.key, e.target.value)}
              disabled={uitgeschakeld}
              inputMode="decimal"
              className={inputClass}
            />
          </div>
        ))}
      </div>

      {/* Afgeleide velden — read-only; de RPC dwingt de consistentie hard af. */}
      <div
        className={`mt-4 rounded-lg px-4 py-3 text-sm ${
          wijktAf ? "bg-err-tint text-err-ink" : "bg-ok-tint text-ok-ink"
        }`}
      >
        Totaal mutatie <strong>€ {fmt1(totaalMutatie)} mln</strong> · ultimo{" "}
        <strong>€ {fmt1(ultimo)} mln</strong>{" "}
        <span className="text-xs">(berekend: primo + som mutaties)</span>
        {wijktAf && (
          <div className="mt-1 text-xs">
            <strong>Wijkt af van de balans:</strong> het compensatiedepot staat daar op €{" "}
            {fmt1(reserveStand)} mln. Pas de mutaties of de balans aan — opslaan is geblokkeerd tot
            beide sporen (één bron per bedrag).
          </div>
        )}
      </div>

      {/* Kpi's */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Toekenning per jaar (€ mln)
          </label>
          <input
            value={velden.premieKpis.toekenning}
            onChange={(e) => zetVeld("premieKpis", "toekenning", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="6,5"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Startomvang depot (€ mln, optioneel)
          </label>
          <input
            value={velden.premieKpis.startomvang}
            onChange={(e) => zetVeld("premieKpis", "startomvang", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="60"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Ondergrens (% van startomvang, optioneel)
          </label>
          <input
            value={velden.premieKpis.ondergrens_pct}
            onChange={(e) => zetVeld("premieKpis", "ondergrens_pct", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="40"
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={opslaan}
          disabled={!magOpslaan}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Premie & compensatie opslaan & publiceren"}
        </button>
        {verplichtLeeg && !reserveOntbreekt && (
          <span className="text-xs text-warn-ink">
            Alle componenten (€ en %), alle zes de mutaties en de toekenning zijn verplicht (0 mag).
          </span>
        )}
        {ongeldigOptioneel && (
          <span className="text-xs text-warn-ink">
            Startomvang of ondergrens ongeldig — corrigeer of maak het veld leeg.
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Ultimo = het compensatiedepot uit de balans (tab 1) — één bron per bedrag. De{" "}
        <span className="text-ink">uitputtingsprognose (ALM-reeks)</span> gaat via upload/levering
        — geen handinvoer van tijdreeksen. €-bedragen en %-aandelen komen van de uitvoerder
        (werkhypothese — grondslagdefinitie valideren).
      </p>
    </section>
  );
}
