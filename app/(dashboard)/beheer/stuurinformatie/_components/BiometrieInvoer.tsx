"use client";

// ============================================================================
//  Biometrisch-invoer (T17, tab 3 — decisions/0078).
//  Langleven-bronnen (micro ±, macro ±, vrijval ≥ 0 = opbrengst) + toegekende
//  risicodekkingen (PP/WZP en AO/PVI, ≤ 0 = last). Netto langleven en de
//  resultaten PP/WZP en AO/PVI worden LIVE afgeleid (zelfde pure module als
//  het dashboard) — nooit ingevoerd.
//
//  Kernregels (decisions/0078):
//  - De BINNENGEKOMEN risicopremies zijn de premie_component-rijen van
//    sectie 7 (tab 7) — hier alleen zichtbaar als read-only referentie (één
//    bron). Ontbreken ze: expliciete blokker-melding, maar de save van de
//    biometrische bronnen zelf kan wél door (de oper-RPC toetst de
//    doorwerking pas bij de Operationeel-save).
//  - VERREKENING: netto langleven → solidariteitsreserve (tab 5, afgeleide
//    post in de soli-ontwikkeling); resultaten PP/WZP + AO/PVI → operationele
//    reserve (tab 6, afgeleide mutatieregels). Eén bron — de soli-/oper-RPC's
//    dwingen de consistentie hard af bij hún save.
//  - WERKHYPOTHESE (actuarieel te valideren): de verrekenrichting en de
//    vrijval als aparte langleven-post zijn nog niet ABTN-bevestigd.
// ============================================================================

import {
  LANGLEVEN_DEFINITIES,
  RISICODEKKING_DEFINITIES,
  nettoLangleven,
  leidRisicodekkingAf,
  risicopremiesVan,
} from "@/core/lib/stuurinfo-biometrie";
import { parseNlGetal } from "@/core/lib/stuurinfo-sjabloon";
import type { Snapshot, VeldState } from "./StuurinfoInvoer";

type Props = {
  velden: VeldState;
  huidig: Snapshot;
  zetVeld: (key: string, waarde: string) => void;
  opslaan: () => void;
  bezig: boolean;
  uitgeschakeld: boolean;
};

const fmt1 = (v: number | null): string =>
  v === null
    ? "—"
    : v.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const inputClass =
  "w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm text-right disabled:opacity-50";
const readOnlyClass =
  "w-full rounded-lg border border-app-line-strong bg-app-bg px-3 py-2 text-sm text-right text-muted";

export default function BiometrieInvoer({
  velden,
  huidig,
  zetVeld,
  opslaan,
  bezig,
  uitgeschakeld,
}: Props) {
  // Read-only referentie: de binnengekomen risicopremies uit de OPGESLAGEN
  // premie-sectie (tab 7 — één bron; de oper-RPC leest dezelfde rijen).
  const premies = risicopremiesVan(
    ["risico_ppwzp", "risico_aop", "risico_pvi"].map((k) => ({
      puntKey: k,
      label: null,
      volgorde: 0,
      waarde: huidig.premie.eur[k] ?? null,
    }))
  );
  const premieOntbreekt = premies.ppwzp === null || premies.aopvi === null;

  // Live afleiding — cosmetisch, via dezelfde pure module als leeslaag en
  // RPC-spiegel; de soli-/oper-RPC's dwingen de doorwerking hard af.
  const parse = (key: string): number | null => parseNlGetal(velden.biometrie[key]);
  const netto = nettoLangleven(
    LANGLEVEN_DEFINITIES.map((d) => ({
      puntKey: d.key,
      label: null,
      volgorde: d.volgorde,
      waarde: parse(d.key),
    }))
  );
  const ppwzp = leidRisicodekkingAf(premies.ppwzp, parse("ppwzp_toegekend"));
  const aopvi = leidRisicodekkingAf(premies.aopvi, parse("aopvi_toegekend"));

  const vrijval = parse("vrijval");
  const toegekendPositief = RISICODEKKING_DEFINITIES.some((d) => {
    const w = parse(d.key);
    return w !== null && w > 0;
  });
  const vrijvalNegatief = vrijval !== null && vrijval < 0;
  const verplichtLeeg =
    LANGLEVEN_DEFINITIES.some((d) => parse(d.key) === null) ||
    RISICODEKKING_DEFINITIES.some((d) => parse(d.key) === null);

  const magOpslaan =
    !bezig && !uitgeschakeld && !verplichtLeeg && !vrijvalNegatief && !toegekendPositief;

  return (
    <section id="biometrie" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">Biometrische rendementen</h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 3</span>
      </div>
      <p className="text-sm text-muted mb-4">
        Voer de biometrische bronnen in (€ mln); netto langleven en de resultaten PP/WZP en
        AO/PVI worden berekend en verrekend met de reserves (tabs 5 en 6).
      </p>

      {premieOntbreekt && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn-ink">
          <strong>Risicopremies ontbreken:</strong> de binnengekomen premies komen uit de sectie
          7 · Premie &amp; compensatie (één bron). Zolang die niet is opgeslagen, blijven de
          resultaten PP/WZP en AO/PVI hier leeg en blokkeert de Operationeel-save (tab 6).
        </div>
      )}

      {/* ── Langleven-resultaat naar bron ─────────────────────────────────── */}
      <div className="text-sm font-medium text-ink mb-2">
        Langleven-resultaat naar bron — verrekend met de solidariteitsreserve (tab 5)
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {LANGLEVEN_DEFINITIES.map((d) => (
          <div key={d.key}>
            <label className="block text-xs font-medium text-muted mb-1">
              {d.label} (€ mln{d.key === "vrijval" ? ", opbrengst ≥ 0" : ", ±"})
            </label>
            <input
              value={velden.biometrie[d.key]}
              onChange={(e) => zetVeld(d.key, e.target.value)}
              disabled={uitgeschakeld}
              inputMode="decimal"
              className={inputClass}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-app-bg px-4 py-3 text-sm text-ink">
        Netto langleven resultaat <strong>€ {fmt1(netto)} mln</strong>{" "}
        <span className="text-xs text-muted">
          (berekend: micro + macro + vrijval; wordt de langleven-post in de
          solidariteitsreserve-ontwikkeling — tab 5, één bron)
        </span>
      </div>

      {/* ── Risicodekkingen (PP/WZP en AO/PVI) ────────────────────────────── */}
      <div className="mt-5 text-sm font-medium text-ink mb-2">
        Risicodekkingen — verrekend met de operationele reserve (tab 6)
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-line p-3">
          <div className="text-xs font-medium text-ink mb-2">Partner-/wezenpensioen (PP/WZP)</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-muted mb-1">
                Binnengekomen premie (sectie 7)
              </label>
              <input value={fmt1(premies.ppwzp)} readOnly disabled className={readOnlyClass} />
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Toegekende PP/WZP (≤ 0)</label>
              <input
                value={velden.biometrie.ppwzp_toegekend}
                onChange={(e) => zetVeld("ppwzp_toegekend", e.target.value)}
                disabled={uitgeschakeld}
                inputMode="decimal"
                placeholder="-0,3"
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-2 text-xs text-muted">
            Resultaat PP/WZP: <strong className="text-ink">€ {fmt1(ppwzp.resultaat)} mln</strong>{" "}
            (berekend) → operationele reserve
          </div>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="text-xs font-medium text-ink mb-2">
            AO / premievrijstelling (AO/PVI)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-muted mb-1">
                Binnengekomen premie (sectie 7)
              </label>
              <input value={fmt1(premies.aopvi)} readOnly disabled className={readOnlyClass} />
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Toegekende AO/PVI (≤ 0)</label>
              <input
                value={velden.biometrie.aopvi_toegekend}
                onChange={(e) => zetVeld("aopvi_toegekend", e.target.value)}
                disabled={uitgeschakeld}
                inputMode="decimal"
                placeholder="-0,4"
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-2 text-xs text-muted">
            Resultaat AO/PVI: <strong className="text-ink">€ {fmt1(aopvi.resultaat)} mln</strong>{" "}
            (berekend) → operationele reserve
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={opslaan}
          disabled={!magOpslaan}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
        >
          {bezig ? "Bezig…" : "Biometrisch opslaan & publiceren"}
        </button>
        {verplichtLeeg && (
          <span className="text-xs text-warn-ink">
            Alle vijf de bronnen zijn verplicht (0 mag).
          </span>
        )}
        {vrijvalNegatief && (
          <span className="text-xs text-warn-ink">
            Vrijval is een opbrengst — voer 0 of een positief bedrag in.
          </span>
        )}
        {toegekendPositief && (
          <span className="text-xs text-warn-ink">
            Toegekende dekkingen zijn lasten — voer 0 of een negatief bedrag in.
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Eén bron over de tabs: netto langleven voedt de solidariteitsreserve-ontwikkeling (tab 5),
        de resultaten voeden de operationele-reserve-ontwikkeling (tab 6) en de binnengekomen
        premies zijn de risicopremies uit tab 7 — nergens dubbele invoer. Wijzig je deze bronnen
        ná een soli-/operationeel-save, sla die secties dan opnieuw op (het dashboard signaleert
        de afwijking). Verrekenrichting en de vrijval-post: actuarieel te valideren
        (werkhypothese).
      </p>
    </section>
  );
}
