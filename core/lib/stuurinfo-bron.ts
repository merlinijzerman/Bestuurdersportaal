// ============================================================================
//  Stuurinformatie — SERVER-side tenant-veilige leeslaag (T11 → T13 Balans-tab).
// ----------------------------------------------------------------------------
//  Leest de periode-registry (fonds_stuurinfo_periode), de balans-reeksen
//  (fonds_stuurinfo_reeks), de reserves (fonds_stuurinfo_reserve) en de
//  financieringsgraad-KPI (fonds_stuurinfo_kpi) ONDER FONDS-RLS, voor de
//  gekozen rapportageperiode + het voorgaande kwartaal. Presentatie
//  (regelingLabel) komt uit de per-fonds module-config (T8).
//
//  Alle rekenlogica (subtotalen, balansevenwicht, stoplicht, mutaties) is puur
//  en staat in stuurinfo-balans.ts (sanity-getest). GEEN deelnemer-PII: alles
//  is fonds-aggregaat. De kleine-populatie-suppressie (n<10) blijft als
//  defense-in-depth bedraad: draagt een rij tóch een populatie_n < 10, dan
//  wordt de waarde vóór de payload genuld (isOnderdrukt, besluit 0055).
//
//  fonds_id komt server-side (haalFondsSessie); nooit uit de request-body.
//  De periode-parameter uit de URL wordt uitsluitend GEVALIDEERD tegen de
//  eigen registry (onbekend → nieuwste periode); hij stuurt nooit het fonds.
// ============================================================================

import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { moduleConfig } from "@/core/lib/fonds-config";
import { isOnderdrukt } from "@/core/lib/suppressie";
import {
  leidBalansAf,
  leidReserveStatusAf,
  kiesPeriode,
  formatteerPeriode,
  formatteerPeildatum,
  mutatiePct,
  mutatiePt,
  type BalansBronRij,
  type BalansOverzicht,
  type PeriodeRij,
  type ReserveStatus,
} from "@/core/lib/stuurinfo-balans";

// ── Publieke vormen ─────────────────────────────────────────────────────────
export type PeriodeOptie = {
  periode: string;      // '2026Q2'
  label: string;        // 'Q2 2026 — 30-06-2026'
  peildatum: string;    // '30-06-2026'
};

export type KpiTegel = {
  key: string;
  label: string;
  waarde: number | null;
  eenheid: "mln" | "pct";
  /** Mutatie t.o.v. voorgaand kwartaal: procenten (mln-tegels) of procentpunten (pct-tegels). */
  mutatie: number | null;
  mutatieEenheid: "pct" | "pt";
};

export type ReserveRegel = {
  key: string;
  label: string;
  stand: number;
  pctWaarde: number | null;
  ondergrens: number | null;
  bovengrens: number | null;
  status: ReserveStatus;
};

export type StuurinfoBalansData = {
  periodes: PeriodeOptie[];          // nieuwste eerst (voor de periodefilter)
  gekozenPeriode: PeriodeOptie | null;
  vorigePeriode: PeriodeOptie | null;
  regelingLabel: string;
  kpiTegels: KpiTegel[];
  financieringsgraad: number | null; // voor de status-pill in de header
  balans: BalansOverzicht;
  reserves: ReserveRegel[];
};

// ── Interne rijvormen ───────────────────────────────────────────────────────
type ReeksRow = {
  periode: string;
  reeks_key: string;
  punt_key: string;
  label: string | null;
  volgorde: number;
  waarde: number | null;
  populatie_n: number | null;
};

type ReserveRow = {
  reserve_key: string;
  label: string;
  stand: number | null;
  pct_waarde: number | null;
  ondergrens: number | null;
  bovengrens: number | null;
  volgorde: number;
};

const naarOptie = (p: PeriodeRij): PeriodeOptie => {
  const peildatum = formatteerPeildatum(p.peildatum);
  return { periode: p.periode, label: `${formatteerPeriode(p.periode)} — ${peildatum}`, peildatum };
};

// Defense-in-depth (besluit 0055): balans-rijen dragen normaliter GEEN
// populatie_n; draagt een rij er tóch een met n<10, dan wordt de waarde genuld
// vóór hij de payload bereikt. Het balansevenwicht signaleert het gat dan
// expliciet — geen stille schijnzekerheid.
const naarBronRij = (r: ReeksRow): BalansBronRij => ({
  puntKey: r.punt_key,
  label: r.label,
  volgorde: r.volgorde,
  waarde: isOnderdrukt(r.populatie_n) ? null : r.waarde === null ? null : Number(r.waarde),
});

function tekst(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Leest de Balans-tab-data voor het eigen fonds: gekozen periode (gevalideerd
 * tegen de registry; onbekend/ontbrekend → nieuwste) + voorgaand kwartaal.
 */
export async function haalStuurinfoBalans(
  fondsId: string,
  periodeParam?: string
): Promise<StuurinfoBalansData> {
  const supabase = await createServerSupabase();

  // 1. Periode-registry (RLS: eigen fonds) → filterlijst + gekozen/vorige.
  const periodeRes = await supabase
    .from("fonds_stuurinfo_periode")
    .select("periode, peildatum, volgorde")
    .eq("fonds_id", fondsId)
    .order("volgorde", { ascending: false });

  const periodes = (periodeRes.data ?? []) as PeriodeRij[];
  const { gekozen, vorige } = kiesPeriode(periodes, periodeParam);

  const leeg: StuurinfoBalansData = {
    periodes: periodes.map(naarOptie),
    gekozenPeriode: null,
    vorigePeriode: null,
    regelingLabel: "",
    kpiTegels: [],
    financieringsgraad: null,
    balans: leidBalansAf([], [], null, null),
    reserves: [],
  };
  if (!gekozen) return leeg;

  const gekozenPeriodes = vorige ? [gekozen.periode, vorige.periode] : [gekozen.periode];

  // 2. Parallel: balans-reeksen (beide periodes), reserves (gekozen periode),
  //    FG-KPI (beide periodes), module-config (presentatie).
  const [reeksRes, reserveRes, kpiRes, cfg] = await Promise.all([
    supabase
      .from("fonds_stuurinfo_reeks")
      .select("periode, reeks_key, punt_key, label, volgorde, waarde, populatie_n")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes)
      .in("reeks_key", ["balans_activa", "balans_passiva"])
      .order("volgorde", { ascending: true }),
    supabase
      .from("fonds_stuurinfo_reserve")
      .select("reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde")
      .eq("fonds_id", fondsId)
      .eq("periode", gekozen.periode)
      .order("volgorde", { ascending: true }),
    supabase
      .from("fonds_stuurinfo_kpi")
      .select("periode, waarde, populatie_n")
      .eq("fonds_id", fondsId)
      .eq("kpi_key", "financieringsgraad")
      .in("periode", gekozenPeriodes),
    moduleConfig(fondsId, "stuurinformatie"),
  ]);

  // 3. Balans afleiden (subtotalen + evenwicht + richting) — puur.
  const rijen = (reeksRes.data ?? []) as ReeksRow[];
  const selecteer = (periode: string, reeks: string) =>
    rijen.filter((r) => r.periode === periode && r.reeks_key === reeks).map(naarBronRij);

  const balans = leidBalansAf(
    selecteer(gekozen.periode, "balans_activa"),
    selecteer(gekozen.periode, "balans_passiva"),
    vorige ? selecteer(vorige.periode, "balans_activa") : null,
    vorige ? selecteer(vorige.periode, "balans_passiva") : null
  );

  // 4. Reserves + afgeleide stoplichtstatus — puur.
  const reserves: ReserveRegel[] = ((reserveRes.data ?? []) as ReserveRow[]).map((r) => {
    const pctWaarde = r.pct_waarde === null ? null : Number(r.pct_waarde);
    const ondergrens = r.ondergrens === null ? null : Number(r.ondergrens);
    const bovengrens = r.bovengrens === null ? null : Number(r.bovengrens);
    return {
      key: r.reserve_key,
      label: r.label,
      stand: Number(r.stand ?? 0),
      pctWaarde,
      ondergrens,
      bovengrens,
      status: leidReserveStatusAf(ondergrens, bovengrens, pctWaarde),
    };
  });

  // 5. KPI-tegels: FG uit de KPI-tabel (beide periodes), de rest afgeleid uit
  //    de balans — de balans is de enige bron voor bedragen (geen dubbele
  //    waarheid tussen tegel en tabel).
  // KPI-cellen behouden de n<10-suppressie (besluit 0055): draagt de FG-rij
  // ooit een populatie_n < 10, dan blijft de waarde uit de payload.
  const fgVan = (periode: string): number | null => {
    const rij = (kpiRes.data ?? []).find((k) => (k as { periode: string }).periode === periode) as
      | { waarde: number | null; populatie_n: number | null }
      | undefined;
    if (!rij || isOnderdrukt(rij.populatie_n)) return null;
    return rij.waarde === null || rij.waarde === undefined ? null : Number(rij.waarde);
  };
  const fgHuidig = fgVan(gekozen.periode);
  const fgVorig = vorige ? fgVan(vorige.periode) : null;

  const regelVan = (key: string) => balans.passiva.find((r) => r.key === key) ?? null;
  const evRegel = regelVan("eigen_vermogen");
  const tvRegel = regelVan("tv");
  const mlnTegel = (key: string, label: string, huidig: number | null, vorig: number | null): KpiTegel => ({
    key,
    label,
    waarde: huidig,
    eenheid: "mln",
    mutatie: mutatiePct(huidig, vorig),
    mutatieEenheid: "pct",
  });

  const kpiTegels: KpiTegel[] = [
    mlnTegel("balanstotaal", "Balanstotaal", balans.evenwicht.totaalActiva,
      balans.evenwichtVorig?.totaalActiva ?? null),
    {
      key: "financieringsgraad",
      label: "Financieringsgraad",
      waarde: fgHuidig,
      eenheid: "pct",
      mutatie: mutatiePt(fgHuidig, fgVorig),
      mutatieEenheid: "pt",
    },
    mlnTegel("eigen_vermogen", "Eigen vermogen (buffer)", evRegel?.huidig ?? null, evRegel?.vorig ?? null),
    mlnTegel("kapitalen", "Kapitalen deelnemers", tvRegel?.huidig ?? null, tvRegel?.vorig ?? null),
  ];

  return {
    periodes: periodes.map(naarOptie),
    gekozenPeriode: naarOptie(gekozen),
    vorigePeriode: vorige ? naarOptie(vorige) : null,
    regelingLabel: tekst(cfg.regelingLabel, ""),
    kpiTegels,
    financieringsgraad: fgHuidig,
    balans,
    reserves,
  };
}
