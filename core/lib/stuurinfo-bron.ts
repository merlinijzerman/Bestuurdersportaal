// ============================================================================
//  Stuurinformatie — SERVER-side tenant-veilige leeslaag (T11 → T13 → T15).
// ----------------------------------------------------------------------------
//  Leest de periode-registry (fonds_stuurinfo_periode), de reeksen
//  (fonds_stuurinfo_reeks), de reserves (fonds_stuurinfo_reserve) en de
//  KPI's (fonds_stuurinfo_kpi) ONDER FONDS-RLS, voor de gekozen
//  rapportageperiode + het voorgaande kwartaal. Presentatie (regelingLabel)
//  komt uit de per-fonds module-config (T8). Drie readers:
//    haalStuurinfoBalans        — tab 1 (T13)
//    haalStuurinfoSpreiding     — tab 4 (T15, decisions/0076)
//    haalStuurinfoSolidariteit  — tab 5 (T15, decisions/0076)
//
//  Alle rekenlogica (subtotalen, evenwicht, stoplicht, spreidings-/soli-
//  afleiding, mutaties) is puur en staat in stuurinfo-balans.ts,
//  stuurinfo-spreiding.ts en stuurinfo-soli.ts (sanity-getest). GEEN
//  deelnemer-PII: alles is fonds-aggregaat. De kleine-populatie-suppressie
//  (n<10) blijft als defense-in-depth bedraad: draagt een rij tóch een
//  populatie_n < 10, dan wordt de waarde vóór de payload genuld
//  (isOnderdrukt, besluit 0055).
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
import {
  leidSpreidingAf,
  bouwSpreidingTabel,
  bouwFgMaandreeks,
  SPREIDING_KPI_KEYS,
  UITKERINGSFASE_FG_REEKS,
  type SpreidingKerncijfers,
  type SpreidingAfleiding,
  type SpreidingRegel,
} from "@/core/lib/stuurinfo-spreiding";
import {
  leidSoliOntwikkelingAf,
  SOLI_VULLING_REEKS,
  SOLI_UITDELING_KPI,
  type SoliOntwikkeling,
  type SoliPeriodeBron,
} from "@/core/lib/stuurinfo-soli";

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

// ════════════════════════════════════════════════════════════════════════════
//  Tab 4 (Spreidingsbeleid) + tab 5 (Solidariteitsbeleid) — T15 (decisions/0076)
// ════════════════════════════════════════════════════════════════════════════

/** Gedeelde tab-basis: periodefilter + header-gegevens (StuurinfoShell). */
export type StuurinfoTabBasis = {
  periodes: PeriodeOptie[];          // nieuwste eerst (voor de periodefilter)
  gekozenPeriode: PeriodeOptie | null;
  vorigePeriode: PeriodeOptie | null;
  regelingLabel: string;
  /** Fondsbrede FG (kpi 'financieringsgraad') voor de status-pill in de header. */
  financieringsgraad: number | null;
};

type KpiRow = {
  periode: string;
  kpi_key: string;
  waarde: number | null;
  populatie_n: number | null;
};

// KPI-cellen behouden de n<10-suppressie als defense-in-depth (besluit 0055).
const kpiWaarde = (rijen: KpiRow[], periode: string, key: string): number | null => {
  const rij = rijen.find((r) => r.periode === periode && r.kpi_key === key);
  if (!rij || isOnderdrukt(rij.populatie_n)) return null;
  return rij.waarde === null ? null : Number(rij.waarde);
};

async function haalPeriodeRegistry(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  fondsId: string,
  periodeParam?: string
) {
  const res = await supabase
    .from("fonds_stuurinfo_periode")
    .select("periode, peildatum, volgorde")
    .eq("fonds_id", fondsId)
    .order("volgorde", { ascending: false });
  const periodes = (res.data ?? []) as PeriodeRij[];
  return { periodes, ...kiesPeriode(periodes, periodeParam) };
}

// ── Tab 4 — Spreidingsbeleid ────────────────────────────────────────────────

export type StuurinfoSpreidingData = StuurinfoTabBasis & {
  /** Ingevoerde kerncijfers van de gekozen periode (incl. bandgrenzen). */
  kerncijfers: SpreidingKerncijfers;
  /** Afgeleid (spreidingsvermogen, FG uitkeringsfase) — nooit data. */
  afgeleid: SpreidingAfleiding;
  /** Kerncijfertabel huidig + voorgaand kwartaal (afgeleide rijen gemarkeerd). */
  tabel: SpreidingRegel[];
  /** FG-maandreeks van de gekozen periode (seed/upload; leeg = geen grafiek). */
  maandreeks: Array<{ label: string; waarde: number }>;
};

/**
 * Leest de Spreidingsbeleid-tab (tab 4): uitkeringsfase-kerncijfers van de
 * gekozen + voorgaande periode (kpi-rijen) en de FG-maandreeks van de gekozen
 * periode. Spreidingsvermogen en FG worden hier AFGELEID (stuurinfo-spreiding).
 */
export async function haalStuurinfoSpreiding(
  fondsId: string,
  periodeParam?: string
): Promise<StuurinfoSpreidingData> {
  const supabase = await createServerSupabase();
  const { periodes, gekozen, vorige } = await haalPeriodeRegistry(supabase, fondsId, periodeParam);

  const legeKerncijfers: SpreidingKerncijfers = {
    beschikbaar: null, voorziening: null, aanpassingsfactor: null, bandOnder: null, bandBoven: null,
  };
  if (!gekozen) {
    return {
      periodes: periodes.map(naarOptie),
      gekozenPeriode: null,
      vorigePeriode: null,
      regelingLabel: "",
      financieringsgraad: null,
      kerncijfers: legeKerncijfers,
      afgeleid: leidSpreidingAf(legeKerncijfers),
      tabel: bouwSpreidingTabel(legeKerncijfers, null),
      maandreeks: [],
    };
  }

  const gekozenPeriodes = vorige ? [gekozen.periode, vorige.periode] : [gekozen.periode];

  const [kpiRes, reeksRes, cfg] = await Promise.all([
    supabase
      .from("fonds_stuurinfo_kpi")
      .select("periode, kpi_key, waarde, populatie_n")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes)
      .in("kpi_key", ["financieringsgraad", ...SPREIDING_KPI_KEYS]),
    supabase
      .from("fonds_stuurinfo_reeks")
      .select("punt_key, label, volgorde, waarde, populatie_n")
      .eq("fonds_id", fondsId)
      .eq("periode", gekozen.periode)
      .eq("reeks_key", UITKERINGSFASE_FG_REEKS)
      .order("volgorde", { ascending: true }),
    moduleConfig(fondsId, "stuurinformatie"),
  ]);

  const kpiRijen = (kpiRes.data ?? []) as KpiRow[];
  const kerncijfersVan = (periode: string): SpreidingKerncijfers => ({
    beschikbaar: kpiWaarde(kpiRijen, periode, "uitkeringsfase_beschikbaar"),
    voorziening: kpiWaarde(kpiRijen, periode, "uitkeringsfase_voorziening"),
    aanpassingsfactor: kpiWaarde(kpiRijen, periode, "uitkeringsfase_aanpassingsfactor"),
    bandOnder: kpiWaarde(kpiRijen, periode, "uitkeringsfase_band_onder"),
    bandBoven: kpiWaarde(kpiRijen, periode, "uitkeringsfase_band_boven"),
  });

  const kerncijfers = kerncijfersVan(gekozen.periode);
  const kerncijfersVorig = vorige ? kerncijfersVan(vorige.periode) : null;

  type MaandRow = { punt_key: string; label: string | null; volgorde: number; waarde: number | null; populatie_n: number | null };
  const maandreeks = bouwFgMaandreeks(
    ((reeksRes.data ?? []) as MaandRow[]).map((r) => ({
      puntKey: r.punt_key,
      label: r.label,
      volgorde: r.volgorde,
      waarde: isOnderdrukt(r.populatie_n) ? null : r.waarde === null ? null : Number(r.waarde),
    }))
  );

  return {
    periodes: periodes.map(naarOptie),
    gekozenPeriode: naarOptie(gekozen),
    vorigePeriode: vorige ? naarOptie(vorige) : null,
    regelingLabel: tekst(cfg.regelingLabel, ""),
    financieringsgraad: kpiWaarde(kpiRijen, gekozen.periode, "financieringsgraad"),
    kerncijfers,
    afgeleid: leidSpreidingAf(kerncijfers),
    tabel: bouwSpreidingTabel(kerncijfers, kerncijfersVorig),
    maandreeks,
  };
}

// ── Tab 5 — Solidariteitsbeleid ─────────────────────────────────────────────

export type StuurinfoSolidariteitData = StuurinfoTabBasis & {
  /** Ontwikkeling gekozen periode (bronnen, netto, begin/eindstand, band, status). */
  huidig: SoliOntwikkeling;
  /** Ontwikkeling voorgaand kwartaal (beginstand teruggerekend); null zonder. */
  vorig: SoliOntwikkeling | null;
  /** pct_basis van de soli-reserve-rij ('technische_voorziening') — presentatie. */
  pctBasis: string | null;
};

/**
 * Leest de Solidariteitsbeleid-tab (tab 5): vullingsbronnen + uitdeling van
 * beide periodes en de soli-reserve-rij (stand/pct/band — DEZELFDE bron als
 * het tab 1-stoplicht). Netto vulling, begin- en eindstand worden AFGELEID
 * (stuurinfo-soli); beginstand huidig = stand voorgaande periode.
 */
export async function haalStuurinfoSolidariteit(
  fondsId: string,
  periodeParam?: string
): Promise<StuurinfoSolidariteitData> {
  const supabase = await createServerSupabase();
  const { periodes, gekozen, vorige } = await haalPeriodeRegistry(supabase, fondsId, periodeParam);

  const legeBron: SoliPeriodeBron = {
    vulling: [], uitdeling: null, stand: null, pctWaarde: null, ondergrens: null, bovengrens: null,
  };
  if (!gekozen) {
    return {
      periodes: periodes.map(naarOptie),
      gekozenPeriode: null,
      vorigePeriode: null,
      regelingLabel: "",
      financieringsgraad: null,
      huidig: leidSoliOntwikkelingAf(legeBron, null),
      vorig: null,
      pctBasis: null,
    };
  }

  const gekozenPeriodes = vorige ? [gekozen.periode, vorige.periode] : [gekozen.periode];

  const [reeksRes, kpiRes, reserveRes, cfg] = await Promise.all([
    supabase
      .from("fonds_stuurinfo_reeks")
      .select("periode, punt_key, label, volgorde, waarde, populatie_n")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes)
      .eq("reeks_key", SOLI_VULLING_REEKS)
      .order("volgorde", { ascending: true }),
    supabase
      .from("fonds_stuurinfo_kpi")
      .select("periode, kpi_key, waarde, populatie_n")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes)
      .in("kpi_key", ["financieringsgraad", SOLI_UITDELING_KPI]),
    supabase
      .from("fonds_stuurinfo_reserve")
      .select("periode, stand, pct_basis, pct_waarde, ondergrens, bovengrens")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes)
      .eq("reserve_key", "solidariteitsreserve"),
    moduleConfig(fondsId, "stuurinformatie"),
  ]);

  type VullingRow = { periode: string; punt_key: string; label: string | null; volgorde: number; waarde: number | null; populatie_n: number | null };
  type SoliReserveRow = { periode: string; stand: number | null; pct_basis: string | null; pct_waarde: number | null; ondergrens: number | null; bovengrens: number | null };

  const vullingRijen = (reeksRes.data ?? []) as VullingRow[];
  const kpiRijen = (kpiRes.data ?? []) as KpiRow[];
  const reserveRijen = (reserveRes.data ?? []) as SoliReserveRow[];

  const num = (v: number | null): number | null => (v === null ? null : Number(v));
  const bronVan = (periode: string): SoliPeriodeBron => {
    const reserve = reserveRijen.find((r) => r.periode === periode);
    return {
      vulling: vullingRijen
        .filter((r) => r.periode === periode)
        .map((r) => ({
          puntKey: r.punt_key,
          label: r.label,
          volgorde: r.volgorde,
          waarde: isOnderdrukt(r.populatie_n) ? null : num(r.waarde),
        })),
      uitdeling: kpiWaarde(kpiRijen, periode, SOLI_UITDELING_KPI),
      stand: num(reserve?.stand ?? null),
      pctWaarde: num(reserve?.pct_waarde ?? null),
      ondergrens: num(reserve?.ondergrens ?? null),
      bovengrens: num(reserve?.bovengrens ?? null),
    };
  };

  const vorigeBron = vorige ? bronVan(vorige.periode) : null;

  return {
    periodes: periodes.map(naarOptie),
    gekozenPeriode: naarOptie(gekozen),
    vorigePeriode: vorige ? naarOptie(vorige) : null,
    regelingLabel: tekst(cfg.regelingLabel, ""),
    financieringsgraad: kpiWaarde(kpiRijen, gekozen.periode, "financieringsgraad"),
    huidig: leidSoliOntwikkelingAf(bronVan(gekozen.periode), vorigeBron?.stand ?? null),
    vorig: vorigeBron ? leidSoliOntwikkelingAf(vorigeBron, null) : null,
    pctBasis: reserveRijen.find((r) => r.periode === gekozen.periode)?.pct_basis ?? null,
  };
}
