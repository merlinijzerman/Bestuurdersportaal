"use client";

// ============================================================================
//  Solidariteit-invoer (T15, tab 5 — decisions/0076).
//  Vulling naar bron (premie, rendement, resultaat micro-langleven ±,
//  overrendementsbijdrage) + uitdeling + bandgrenzen. Netto vulling en
//  eindstand worden LIVE afgeleid (zelfde pure module als het dashboard);
//  beginstand = soli-reservestand van de voorgaande periode (read-only).
//
//  Kernregels (decisions/0076):
//  - De soli-STAND komt uit de balans-save (gekoppelde reserve) — hier alleen
//    zichtbaar als anker. Ontbreekt de reserve-rij: expliciete blokker
//    ("sla eerst de balans op") vóór de save i.p.v. een 422 erna.
//  - HARDE consistentie: beginstand + netto − uitdeling moet de balans-stand
//    zijn; de RPC weigert anders (SOLI_EINDSTAND_ONGELIJK). De UI blokkeert
//    dezelfde afwijking vooraf (UX-principe: blokkers expliciet).
//  - micro-langleven = het biometrische resultaat (tab 3) — één bron.
//  - De bandbreedte hier is DE bron voor het tab 1-stoplicht (reserve-rij).
// ============================================================================

import {
  SOLI_VULLING_DEFINITIES,
  SOLI_TOLERANTIE,
  nettoVullingVan,
} from "@/core/lib/stuurinfo-soli";
import { parseNlGetal } from "@/core/lib/stuurinfo-sjabloon";
import type { Snapshot, VeldState } from "./StuurinfoInvoer";

type Props = {
  velden: VeldState;
  huidig: Snapshot;
  referentie: Snapshot | null;
  zetVeld: (key: string, waarde: string) => void;
  zetGrens: (veld: "ondergrens" | "bovengrens", waarde: string) => void;
  opslaan: () => void;
  bezig: boolean;
  uitgeschakeld: boolean;
};

const fmt1 = (v: number | null): string =>
  v === null
    ? "—"
    : v.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function SolidariteitInvoer({
  velden,
  huidig,
  referentie,
  zetVeld,
  zetGrens,
  opslaan,
  bezig,
  uitgeschakeld,
}: Props) {
  // Read-only ankers uit de data: eindstand (balans, deze periode) en
  // beginstand (balans, voorgaande periode).
  const reserveStand = huidig.soli.reserveStand;
  const beginstand = referentie?.soli.reserveStand ?? null;

  // Live afleiding — cosmetisch, via dezelfde pure module (nettoVullingVan +
  // SOLI_TOLERANTIE) als leeslaag en RPC-spiegel; de RPC dwingt hard af.
  const netto = nettoVullingVan(
    SOLI_VULLING_DEFINITIES.map((d) => ({
      puntKey: d.key,
      label: null,
      volgorde: d.volgorde,
      waarde: parseNlGetal(velden.soli[d.key]),
    }))
  );
  const uitdeling = parseNlGetal(velden.soli.uitdeling);
  const eindstand =
    beginstand !== null && netto !== null && uitdeling !== null
      ? beginstand + netto - uitdeling
      : null;
  const wijktAf =
    eindstand !== null &&
    reserveStand !== null &&
    Math.abs(eindstand - reserveStand) >= SOLI_TOLERANTIE;

  const verplichtLeeg = netto === null || uitdeling === null;
  const reserveOntbreekt = reserveStand === null;
  // Niet-leeg maar onparseerbaar grensveld blokkeert de save: anders zou een
  // typefout de ABTN-band stilzwijgend als null (= geen grens) wegschrijven
  // en het tab 1-stoplicht naar "monitoring" laten vallen.
  const ongeldigeGrens = ([velden.ondergrens, velden.bovengrens] as const).some(
    (v) => v.trim() !== "" && parseNlGetal(v) === null
  );
  // Zonder voorgaande periode is de beginstand niet onafhankelijk te bepalen
  // en toont het dashboard hem teruggerekend; opslaan kan gewoon (de RPC slaat
  // de eindstand-check dan over).
  const magOpslaan =
    !bezig && !uitgeschakeld && !verplichtLeeg && !reserveOntbreekt && !wijktAf && !ongeldigeGrens;

  return (
    <section id="solidariteit" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">Solidariteitsbeleid</h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 5</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Voer de mutatie naar bron in (€ mln); netto vulling en eindstand worden berekend.
        Beginstand = eindstand vorige periode.
      </p>

      {reserveOntbreekt && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn-ink">
          <strong>Eerst de balans opslaan:</strong> de solidariteitsreserve-stand van deze periode
          komt uit de balans/reserves-invoer (één bron per bedrag). Sla die sectie eerst op; daarna
          kan de vulling hier worden vastgelegd.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Beginstand (€ mln)</label>
          <input
            value={beginstand === null ? "—" : fmt1(beginstand)}
            readOnly
            disabled
            className="w-full rounded-lg border border-app-line-strong bg-app-bg px-3 py-2 text-sm text-right text-muted"
          />
        </div>
        {SOLI_VULLING_DEFINITIES.map((d) => (
          <div key={d.key}>
            <label className="block text-xs font-medium text-muted mb-1">
              {d.label} (€ mln{d.key === "micro_langleven" ? ", ±" : ""})
            </label>
            <input
              value={velden.soli[d.key]}
              onChange={(e) => zetVeld(d.key, e.target.value)}
              disabled={uitgeschakeld}
              inputMode="decimal"
              className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50"
            />
          </div>
        ))}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Uitdeling (€ mln)</label>
          <input
            value={velden.soli.uitdeling}
            onChange={(e) => zetVeld("uitdeling", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50"
          />
        </div>
      </div>

      {/* Afgeleide velden — read-only; de RPC dwingt de consistentie hard af. */}
      <div
        className={`mt-4 rounded-lg px-4 py-3 text-sm ${
          wijktAf ? "bg-err-tint text-err-ink" : "bg-ok-tint text-ok-ink"
        }`}
      >
        Netto vulling <strong>€ {fmt1(netto)} mln</strong> · eindstand{" "}
        <strong>€ {fmt1(eindstand)} mln</strong>{" "}
        <span className="text-xs">(berekend: beginstand + som bronnen − uitdeling)</span>
        {wijktAf && (
          <div className="mt-1 text-xs">
            <strong>Wijkt af van de balans:</strong> de solidariteitsreserve staat daar op €{" "}
            {fmt1(reserveStand)} mln. Pas de vulling of de balans aan — opslaan is geblokkeerd tot
            beide sporen (één bron per bedrag).
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Bandbreedte — ondergrens (% van de technische voorziening)
          </label>
          <input
            value={velden.ondergrens}
            onChange={(e) => zetGrens("ondergrens", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="1,5"
            className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            Bandbreedte — bovengrens (% van de technische voorziening)
          </label>
          <input
            value={velden.bovengrens}
            onChange={(e) => zetGrens("bovengrens", e.target.value)}
            disabled={uitgeschakeld}
            inputMode="decimal"
            placeholder="5,0"
            className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={opslaan}
          disabled={!magOpslaan}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Solidariteit opslaan & publiceren"}
        </button>
        {verplichtLeeg && !reserveOntbreekt && (
          <span className="text-xs text-warn-ink">
            Alle vier de bronnen en de uitdeling zijn verplicht (0 mag).
          </span>
        )}
        {ongeldigeGrens && (
          <span className="text-xs text-warn-ink">
            Bandgrens ongeldig — corrigeer of maak het veld leeg (= geen grens).
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Bandbreedte uit de ABTN; voedt de stoplichtstatus in het Overzicht reserves (tab 1) — één
        bron. Resultaat micro-langleven: onderbouwing komt uit tab 3 (Biometrische rendementen),
        geen dubbele invoer.
      </p>
    </section>
  );
}
