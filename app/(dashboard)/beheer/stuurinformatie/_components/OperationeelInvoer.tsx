"use client";

// ============================================================================
//  Operationeel-invoer (T16, tab 6 — decisions/0077).
//  Mutatiebronnen naar bron (premie/kostenopslag, beschermingsrendement ±,
//  overrendement, gemist rendement TWK, TWK-invaarmutaties, verrekening
//  reserves, overig, kosten geaggregeerd −) + norm/band (€ mln) + kostendetail
//  (realisatie YTD + begroot per kostensoort). Totaal mutatie en ultimo worden
//  LIVE afgeleid (zelfde pure module als het dashboard); primo = oper-
//  reservestand van de voorgaande periode (read-only).
//
//  Kernregels (decisions/0077, soli-patroon):
//  - De oper-STAND (= ultimo) komt uit de balans-save (gekoppelde reserve) —
//    hier alleen zichtbaar als anker. Ontbreekt de reserve-rij: expliciete
//    blokker ("sla eerst de balans op") vóór de save i.p.v. een 422 erna.
//  - HARDE consistentie: primo + totaal mutatie moet de balans-stand zijn;
//    de RPC weigert anders (OPER_MUTATIE_ONGELIJK). De UI blokkeert dezelfde
//    afwijking vooraf (UX-principe: blokkers expliciet).
//  - Norm + band zijn kpi's in € MLN — bewust niet de reserve-rij-band
//    (die is in % van de TV en stuurt het tab 1-stoplicht).
// ============================================================================

import {
  OPER_MUTATIE_DEFINITIES,
  OPER_KOSTEN_DEFINITIES,
  operTotaalMutatie,
} from "@/core/lib/stuurinfo-operationeel";
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

export default function OperationeelInvoer({
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
  const reserveStand = huidig.operationeel.reserveStand;
  const primo = referentie?.operationeel.reserveStand ?? null;

  // Live afleiding — cosmetisch, via dezelfde pure module (operTotaalMutatie +
  // ONTWIKKELING_TOLERANTIE) als leeslaag en RPC-spiegel; de RPC dwingt hard af.
  const totaal = operTotaalMutatie(
    OPER_MUTATIE_DEFINITIES.map((d) => ({
      puntKey: d.key,
      label: null,
      volgorde: d.volgorde,
      waarde: parseNlGetal(velden.operationeel[d.key]),
    }))
  );
  const ultimo = primo !== null && totaal !== null ? primo + totaal : null;
  const wijktAf =
    ultimo !== null &&
    reserveStand !== null &&
    Math.abs(ultimo - reserveStand) >= ONTWIKKELING_TOLERANTIE;

  const norm = parseNlGetal(velden.operationeel.norm);
  const kostenLeeg =
    OPER_KOSTEN_DEFINITIES.some((d) => parseNlGetal(velden.operKostenRealisatie[d.key]) === null) ||
    OPER_KOSTEN_DEFINITIES.some((d) => parseNlGetal(velden.operKostenBegroot[d.key]) === null);
  const verplichtLeeg = totaal === null || norm === null || kostenLeeg;
  const reserveOntbreekt = reserveStand === null;
  // Niet-leeg maar onparseerbaar bandveld blokkeert de save: anders zou een
  // typefout de band stilzwijgend als null (= geen grens) wegschrijven.
  const ongeldigeBand = ([velden.operationeel.band_onder, velden.operationeel.band_boven] as const).some(
    (v) => v.trim() !== "" && parseNlGetal(v) === null
  );
  // Zonder voorgaande periode is de primo niet onafhankelijk te bepalen en
  // toont het dashboard hem teruggerekend; opslaan kan gewoon (de RPC slaat
  // de consistentie-check dan over).
  const magOpslaan =
    !bezig && !uitgeschakeld && !verplichtLeeg && !reserveOntbreekt && !wijktAf && !ongeldigeBand;

  const inputClass =
    "w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50";

  return (
    <section id="operationeel" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">Operationeel beleid</h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 6</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Voer de mutaties naar bron in (€ mln, ± — kosten als geaggregeerde post negatief); totaal
        mutatie en ultimo worden berekend. Primo = ultimo vorige periode.
      </p>

      {reserveOntbreekt && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn-ink">
          <strong>Eerst de balans opslaan:</strong> de operationele-reservestand van deze periode
          komt uit de balans/reserves-invoer (één bron per bedrag). Sla die sectie eerst op; daarna
          kunnen de mutaties hier worden vastgelegd.
        </div>
      )}

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
        {OPER_MUTATIE_DEFINITIES.map((d) => (
          <div key={d.key}>
            <label className="block text-xs font-medium text-muted mb-1">
              {d.label} (€ mln, ±)
            </label>
            <input
              value={velden.operationeel[d.key]}
              onChange={(e) => zetVeld("operationeel", d.key, e.target.value)}
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
        Totaal mutatie <strong>€ {fmt1(totaal)} mln</strong> · ultimo{" "}
        <strong>€ {fmt1(ultimo)} mln</strong>{" "}
        <span className="text-xs">(berekend: primo + som mutaties)</span>
        {wijktAf && (
          <div className="mt-1 text-xs">
            <strong>Wijkt af van de balans:</strong> de operationele reserve staat daar op €{" "}
            {fmt1(reserveStand)} mln. Pas de mutaties of de balans aan — opslaan is geblokkeerd tot
            beide sporen (één bron per bedrag).
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Norm operationele reserve (€ mln)
          </label>
          <input
            value={velden.operationeel.norm}
            onChange={(e) => zetVeld("operationeel", "norm", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="8,0"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Band — ondergrens (€ mln)
          </label>
          <input
            value={velden.operationeel.band_onder}
            onChange={(e) => zetVeld("operationeel", "band_onder", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="6,0"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Band — bovengrens (€ mln)
          </label>
          <input
            value={velden.operationeel.band_boven}
            onChange={(e) => zetVeld("operationeel", "band_boven", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="12,0"
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-medium text-ink mb-2">
          Kostendetail YTD — realisatie vs. begroot (€ mln)
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {OPER_KOSTEN_DEFINITIES.map((d) => (
            <div key={d.key} className="rounded-lg border border-line p-3">
              <div className="text-xs font-medium text-ink mb-2">{d.label}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-muted mb-1">Realisatie</label>
                  <input
                    value={velden.operKostenRealisatie[d.key]}
                    onChange={(e) => zetVeld("operKostenRealisatie", d.key, e.target.value)}
                    disabled={uitgeschakeld}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted mb-1">Begroot</label>
                  <input
                    value={velden.operKostenBegroot[d.key]}
                    onChange={(e) => zetVeld("operKostenBegroot", d.key, e.target.value)}
                    disabled={uitgeschakeld}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={opslaan}
          disabled={!magOpslaan}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Operationeel opslaan & publiceren"}
        </button>
        {verplichtLeeg && !reserveOntbreekt && (
          <span className="text-xs text-warn-ink">
            Alle acht de mutaties, de norm en het kostendetail zijn verplicht (0 mag).
          </span>
        )}
        {ongeldigeBand && (
          <span className="text-xs text-warn-ink">
            Bandgrens ongeldig — corrigeer of maak het veld leeg (= geen grens).
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Ultimo = de operationele reserve uit de balans (tab 1) — één bron per bedrag. Norm en band
        zijn in € mln (ABTN); ze sturen de norm-gauge in tab 6, niet het reserve-stoplicht in
        tab 1. De TWK-/verrekeningsposten zijn aangeleverde waarden (werkhypothese — valideren met
        actuaris/uitvoerder).
      </p>
    </section>
  );
}
