"use client";

// ============================================================================
//  Balans-invoertabel (T14) — invoervelden per leaf-post, read-only referentie-
//  kolom (voorgaande periode), live berekende subtotaalrijen "(berekend)" en
//  de live balansevenwicht-balk. De berekening hier is COSMETISCH — dezelfde
//  pure functies als de server (berekenEvenwicht → leidBalansAf), maar de
//  harde validatie zit in de route (422) en de RPC (DB-niveau).
// ============================================================================

import {
  ACTIVA_DEFINITIES,
  PASSIVA_DEFINITIES,
  berekenEvenwicht,
  type ActivaKey,
  type PassivaKey,
} from "@/core/lib/stuurinfo-invoer";
import { parseNlGetal } from "@/core/lib/stuurinfo-sjabloon";
import type { Snapshot, VeldState } from "./StuurinfoInvoer";

type Props = {
  velden: VeldState;
  referentie: Snapshot | null;
  gekozenPeriode: string | null;
  vorigePeriode: string | null;
  zetVeld: (sectie: "activa" | "passiva", key: string, waarde: string) => void;
  zetFg: (waarde: string) => void;
  uitgeschakeld: boolean;
};

/** Passiva-weergavestructuur (mockup): subtotalen tussen de invoervelden. */
const PASSIVA_WEERGAVE: Array<
  | { soort: "subtotaal"; key: "eigen_vermogen" | "toetsvermogen"; label: string; niveau: 0 | 1 }
  | { soort: "invoer"; key: PassivaKey; niveau: 0 | 1 | 2 }
> = [
  { soort: "subtotaal", key: "eigen_vermogen", label: "Eigen vermogen", niveau: 0 },
  { soort: "subtotaal", key: "toetsvermogen", label: "Toetsvermogen", niveau: 1 },
  { soort: "invoer", key: "ev_toets_mvev", niveau: 2 },
  { soort: "invoer", key: "ev_toets_oper", niveau: 2 },
  { soort: "invoer", key: "ev_toets_overig", niveau: 2 },
  { soort: "invoer", key: "ev_soli", niveau: 1 },
  { soort: "invoer", key: "ev_comp", niveau: 1 },
  { soort: "invoer", key: "tv", niveau: 0 },
  { soort: "invoer", key: "vuk", niveau: 0 },
  { soort: "invoer", key: "overig", niveau: 0 },
];

const fmt = (v: number | null): string =>
  v === null ? "—" : v.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

const inspring = (niveau: 0 | 1 | 2) =>
  niveau === 2 ? "pl-10" : niveau === 1 ? "pl-6" : "";

export default function BalansInvoerTabel({
  velden,
  referentie,
  gekozenPeriode,
  vorigePeriode,
  zetVeld,
  zetFg,
  uitgeschakeld,
}: Props) {
  // Live geparsede waarden (null = leeg/ongeldig; telt als 0 in de subtotalen,
  // de savebar blokkeert opslaan zolang velden ontbreken).
  const act = {} as Record<ActivaKey, number | null>;
  const pas = {} as Record<PassivaKey, number | null>;
  for (const d of ACTIVA_DEFINITIES) act[d.key] = parseNlGetal(velden.activa[d.key]);
  for (const d of PASSIVA_DEFINITIES) pas[d.key] = parseNlGetal(velden.passiva[d.key]);

  const n = (v: number | null) => v ?? 0;
  const toets = n(pas.ev_toets_mvev) + n(pas.ev_toets_oper) + n(pas.ev_toets_overig);
  const ev = toets + n(pas.ev_soli) + n(pas.ev_comp);
  const subtotalen: Record<"eigen_vermogen" | "toetsvermogen", number> = {
    eigen_vermogen: ev,
    toetsvermogen: toets,
  };

  const evenwicht = berekenEvenwicht(
    Object.fromEntries(Object.entries(act).map(([k, v]) => [k, v ?? 0])) as Record<ActivaKey, number>,
    Object.fromEntries(Object.entries(pas).map(([k, v]) => [k, v ?? 0])) as Record<PassivaKey, number>
  );

  const refActiva = (key: ActivaKey): number | null => referentie?.activa[key] ?? null;
  const refPassiva = (key: PassivaKey): number | null => referentie?.passiva[key] ?? null;
  const refToets =
    referentie === null
      ? null
      : n(refPassiva("ev_toets_mvev")) + n(refPassiva("ev_toets_oper")) + n(refPassiva("ev_toets_overig"));
  const refEv =
    refToets === null ? null : refToets + n(refPassiva("ev_soli")) + n(refPassiva("ev_comp"));
  const refTotActiva =
    referentie === null ? null : n(refActiva("belegd")) + n(refActiva("overig"));
  const refTotPassiva =
    refEv === null ? null : refEv + n(refPassiva("tv")) + n(refPassiva("vuk")) + n(refPassiva("overig"));

  const kolomkopHuidig = gekozenPeriode ? `${gekozenPeriode} (invoer)` : "Invoer";
  const kolomkopVorig = vorigePeriode ? `${vorigePeriode} (ref.)` : "Vorige (ref.)";

  const invoerCel = (sectie: "activa" | "passiva", key: string, label: string, waarde: string) => (
    <input
      aria-label={label}
      value={waarde}
      onChange={(e) => zetVeld(sectie, key, e.target.value)}
      disabled={uitgeschakeld}
      inputMode="decimal"
      className="w-32 rounded-lg border border-app-line-strong px-3 py-1.5 text-sm text-right disabled:opacity-50"
    />
  );

  return (
    <section id="balans" className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-ink">Balans</h2>
        <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-xs text-muted">Tab 1 · € mln</span>
      </div>
      <p className="text-sm text-muted mb-3">
        Alleen de posten zelf worden ingevoerd; subtotalen en totalen zijn{" "}
        <strong>berekend</strong> en niet te wijzigen.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-2 pr-3 text-left font-medium">Post</th>
              <th className="py-2 px-3 text-right font-medium">{kolomkopHuidig}</th>
              <th className="py-2 pl-3 text-right font-medium">{kolomkopVorig}</th>
            </tr>
          </thead>
          <tbody>
            {/* ── Activa ── */}
            <tr>
              <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Activa
              </td>
            </tr>
            {ACTIVA_DEFINITIES.map((d) => (
              <tr key={d.key} className="border-b border-line/60">
                <td className="py-1.5 pr-3 text-ink">{d.label}</td>
                <td className="py-1.5 px-3 text-right">{invoerCel("activa", d.key, d.label, velden.activa[d.key])}</td>
                <td className="py-1.5 pl-3 text-right text-muted">{fmt(refActiva(d.key))}</td>
              </tr>
            ))}
            <tr className="border-b border-line font-semibold">
              <td className="py-1.5 pr-3 text-ink">
                Totaal activa <span className="font-normal text-xs text-muted">(berekend)</span>
              </td>
              <td className="py-1.5 px-3 text-right text-ink">{fmt(evenwicht.totaalActiva)}</td>
              <td className="py-1.5 pl-3 text-right text-muted">{fmt(refTotActiva)}</td>
            </tr>

            {/* ── Passiva ── */}
            <tr>
              <td colSpan={3} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Passiva
              </td>
            </tr>
            {PASSIVA_WEERGAVE.map((rij) =>
              rij.soort === "subtotaal" ? (
                <tr key={rij.key} className="border-b border-line/60 italic">
                  <td className={`py-1.5 pr-3 text-ink ${inspring(rij.niveau)}`}>
                    {rij.label} <span className="not-italic font-normal text-xs text-muted">(berekend)</span>
                  </td>
                  <td className="py-1.5 px-3 text-right text-ink">{fmt(subtotalen[rij.key])}</td>
                  <td className="py-1.5 pl-3 text-right text-muted">
                    {fmt(rij.key === "eigen_vermogen" ? refEv : refToets)}
                  </td>
                </tr>
              ) : (
                <tr key={rij.key} className="border-b border-line/60">
                  <td className={`py-1.5 pr-3 text-ink ${inspring(rij.niveau)}`}>
                    {PASSIVA_DEFINITIES.find((d) => d.key === rij.key)?.label}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {invoerCel(
                      "passiva",
                      rij.key,
                      PASSIVA_DEFINITIES.find((d) => d.key === rij.key)?.label ?? rij.key,
                      velden.passiva[rij.key],
                    )}
                  </td>
                  <td className="py-1.5 pl-3 text-right text-muted">{fmt(refPassiva(rij.key))}</td>
                </tr>
              )
            )}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3 text-ink">
                Totaal passiva <span className="font-normal text-xs text-muted">(berekend)</span>
              </td>
              <td className="py-1.5 px-3 text-right text-ink">{fmt(evenwicht.totaalPassiva)}</td>
              <td className="py-1.5 pl-3 text-right text-muted">{fmt(refTotPassiva)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Live balansevenwicht-check ── */}
      <div
        className={`mt-3 rounded-lg border p-3 text-sm ${
          evenwicht.sluit
            ? "border-ok/30 bg-ok-tint text-ok-ink"
            : "border-err/30 bg-err-tint text-err-ink"
        }`}
      >
        {evenwicht.sluit ? (
          <span>
            Balans sluit — <strong>verschil € 0 mln</strong>
          </span>
        ) : (
          <span>
            Balans sluit niet — <strong>verschil € {fmt(evenwicht.verschil)} mln</strong> (activa −
            passiva). Opslaan is geblokkeerd tot de balans sluit.
          </span>
        )}
      </div>

      {/* ── Financieringsgraad ── */}
      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="balans-financieringsgraad" className="text-sm text-ink">Financieringsgraad (%)</label>
        <input
          id="balans-financieringsgraad"
          value={velden.fg}
          onChange={(e) => zetFg(e.target.value)}
          disabled={uitgeschakeld}
          inputMode="decimal"
          placeholder="106,0"
          className="w-32 rounded-lg border border-app-line-strong px-3 py-1.5 text-sm text-right disabled:opacity-50"
        />
        <span className="text-xs text-muted">
          Vorige periode: {fmt(referentie?.financieringsgraad ?? null)}%
        </span>
      </div>
    </section>
  );
}
