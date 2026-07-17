// ============================================================================
//  Stuurinformatie beheer-invoerlaag — SERVER-side leeslaag (T14).
// ----------------------------------------------------------------------------
//  Leest voor het beheerscherm (Beheer › Stuurinformatie) de RUWE leaf-waarden
//  van de gekozen periode (invoervelden) én de voorgaande periode (read-only
//  referentiekolom + Δ-signalering bij upload), plus de recente wijzigings-
//  historie uit fonds_stuurinfo_log. Alles onder fonds-RLS.
//
//  Verschil met stuurinfo-bron.ts (dashboard): dáár worden subtotalen en
//  stoplichten AFGELEID voor weergave; hier zijn de ruwe leaves zelf het
//  product (de invoervelden). Suppressie speelt hier niet — de invoerlaag
//  zet nooit populatie_n (fonds-aggregaat, geen deelnemer-PII).
//
//  fonds_id komt server-side (route: profiel.fonds_id); nooit uit de body.
//  De periode-parameter wordt uitsluitend GEVALIDEERD tegen de eigen registry
//  (onbekend → nieuwste periode); hij stuurt nooit het fonds.
// ============================================================================

import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  kiesPeriode,
  formatteerPeriode,
  formatteerPeildatum,
  type PeriodeRij,
} from "@/core/lib/stuurinfo-balans";
import {
  ACTIVA_KEYS,
  PASSIVA_KEYS,
  VRIJE_RESERVE_KEYS,
  type ActivaKey,
  type PassivaKey,
  type VrijeReserveKey,
  type SoliGrenzen,
} from "@/core/lib/stuurinfo-invoer";
import { SPREIDING_KPI_KEYS } from "@/core/lib/stuurinfo-spreiding";
import {
  SOLI_VULLING_INVOER_KEYS,
  SOLI_VULLING_REEKS,
  SOLI_UITDELING_KPI,
  type SoliVullingInvoerKey,
} from "@/core/lib/stuurinfo-soli";
import {
  LANGLEVEN_KEYS,
  RISICODEKKING_KEYS,
  LANGLEVEN_REEKS,
  RISICODEKKING_REEKS,
  type LanglevenKey,
  type RisicodekkingKey,
} from "@/core/lib/stuurinfo-biometrie";
import {
  OPER_MUTATIE_KEYS,
  OPER_KOSTEN_KEYS,
  OPER_MUTATIE_REEKS,
  OPER_KOSTEN_REALISATIE_REEKS,
  OPER_KOSTEN_BEGROOT_REEKS,
  OPER_KPI_KEYS,
  type OperMutatieKey,
  type OperKostenKey,
} from "@/core/lib/stuurinfo-operationeel";
import {
  PREMIE_COMPONENT_KEYS,
  COMP_MUTATIE_KEYS,
  PREMIE_COMPONENT_REEKS,
  PREMIE_COMPONENT_PCT_REEKS,
  COMP_MUTATIE_REEKS,
  PREMIE_KPI_KEYS,
  type PremieComponentKey,
  type CompMutatieKey,
} from "@/core/lib/stuurinfo-premie";

// ── Publieke vormen ─────────────────────────────────────────────────────────

export type BeheerPeriodeOptie = {
  periode: string;       // '2026Q2'
  label: string;         // 'Q2 2026 — 30-06-2026'
  peildatum: string;     // ISO ('2026-06-30') — voor het date-input
  bron: string;          // registry-bron ('handmatig', 'seed_synthetisch', …)
};

/** Ruwe leaf-waarden van één periode; null = (nog) niet ingevoerd. */
export type InvoerSnapshot = {
  activa: Record<ActivaKey, number | null>;
  passiva: Record<PassivaKey, number | null>;
  reserves: Record<VrijeReserveKey, number | null>;
  grenzen: { solidariteitsreserve: SoliGrenzen };
  financieringsgraad: number | null;
  /** Tab 4 (T15): uitkeringsfase-kerncijfers (kpi-rijen). */
  spreiding: {
    beschikbaar: number | null;
    voorziening: number | null;
    aanpassingsfactor: number | null;
    bandOnder: number | null;
    bandBoven: number | null;
  };
  /** Tab 3 (T17): langleven-bronnen + toegekende dekkingen. De risicopremies
   *  (read-only referentie) staan in premie.eur (risico_ppwzp/risico_aop/
   *  risico_pvi — tab 7, één bron); netto/resultaten worden in de UI afgeleid. */
  biometrie: Record<LanglevenKey, number | null> & Record<RisicodekkingKey, number | null>;
  /** Tab 5 (T15/T17): drie invoerbronnen + uitdeling + soli-reserve-stand
   *  (read-only anker uit de balans; beginstand-veld = referentie.soli.
   *  reserveStand). Het netto langleven-resultaat is AFGELEID uit de
   *  biometrie-invoer (tab 3) — geen invoerveld. */
  soli: Record<SoliVullingInvoerKey, number | null> & {
    uitdeling: number | null;
    reserveStand: number | null;
  };
  /** Tab 6 (T16): mutatiebronnen + norm/band (€ mln) + oper-reserve-stand
   *  (read-only anker; primo-veld = referentie.operationeel.reserveStand). */
  operationeel: Record<OperMutatieKey, number | null> & {
    norm: number | null;
    bandOnder: number | null;
    bandBoven: number | null;
    reserveStand: number | null;
  };
  /** Tab 6 (T16): kostendetail per kostensoort (realisatie YTD + begroot). */
  operKostenRealisatie: Record<OperKostenKey, number | null>;
  operKostenBegroot: Record<OperKostenKey, number | null>;
  /** Tab 7 (T16): premiecomponenten (€ + %), depot-mutaties, kpi's en de
   *  depot-reserve-stand (read-only anker uit de balans). De uitputtings-
   *  prognose is seed/upload-only en bewust geen invoerveld. */
  premie: {
    eur: Record<PremieComponentKey, number | null>;
    pct: Record<PremieComponentKey, number | null>;
    mutaties: Record<CompMutatieKey, number | null>;
    toekenning: number | null;
    startomvang: number | null;
    ondergrensPct: number | null;
    reserveStand: number | null;
  };
};

export type StuurinfoLogRegel = {
  id: string;
  periode: string;
  tabel: string;
  veld_key: string;
  oude_waarde: unknown;
  nieuwe_waarde: unknown;
  invoer_bron: string | null;
  gebruiker_naam: string | null;
  aangemaakt: string;
};

export type StuurinfoInvoerData = {
  periodes: BeheerPeriodeOptie[];    // nieuwste eerst
  gekozen: string | null;
  vorige: string | null;
  huidig: InvoerSnapshot;            // lege snapshot bij een verse periode
  referentie: InvoerSnapshot | null; // waarden voorgaande periode (read-only)
  log: StuurinfoLogRegel[];
};

// ── Interne rijvormen ───────────────────────────────────────────────────────

type PeriodeRow = PeriodeRij & { bron: string };
type ReeksRow = { periode: string; reeks_key: string; punt_key: string; waarde: number | null };
type ReserveRow = {
  periode: string;
  reserve_key: string;
  stand: number | null;
  ondergrens: number | null;
  bovengrens: number | null;
};
type KpiRow = { periode: string; kpi_key: string; waarde: number | null };

const legeSnapshot = (): InvoerSnapshot => ({
  activa: Object.fromEntries(ACTIVA_KEYS.map((k) => [k, null])) as Record<ActivaKey, number | null>,
  passiva: Object.fromEntries(PASSIVA_KEYS.map((k) => [k, null])) as Record<PassivaKey, number | null>,
  reserves: Object.fromEntries(VRIJE_RESERVE_KEYS.map((k) => [k, null])) as Record<VrijeReserveKey, number | null>,
  grenzen: { solidariteitsreserve: { ondergrens: null, bovengrens: null } },
  financieringsgraad: null,
  spreiding: { beschikbaar: null, voorziening: null, aanpassingsfactor: null, bandOnder: null, bandBoven: null },
  biometrie: {
    ...(Object.fromEntries(LANGLEVEN_KEYS.map((k) => [k, null])) as Record<LanglevenKey, number | null>),
    ...(Object.fromEntries(RISICODEKKING_KEYS.map((k) => [k, null])) as Record<RisicodekkingKey, number | null>),
  },
  soli: {
    ...(Object.fromEntries(SOLI_VULLING_INVOER_KEYS.map((k) => [k, null])) as Record<SoliVullingInvoerKey, number | null>),
    uitdeling: null,
    reserveStand: null,
  },
  operationeel: {
    ...(Object.fromEntries(OPER_MUTATIE_KEYS.map((k) => [k, null])) as Record<OperMutatieKey, number | null>),
    norm: null,
    bandOnder: null,
    bandBoven: null,
    reserveStand: null,
  },
  operKostenRealisatie: Object.fromEntries(
    OPER_KOSTEN_KEYS.map((k) => [k, null])
  ) as Record<OperKostenKey, number | null>,
  operKostenBegroot: Object.fromEntries(
    OPER_KOSTEN_KEYS.map((k) => [k, null])
  ) as Record<OperKostenKey, number | null>,
  premie: {
    eur: Object.fromEntries(PREMIE_COMPONENT_KEYS.map((k) => [k, null])) as Record<PremieComponentKey, number | null>,
    pct: Object.fromEntries(PREMIE_COMPONENT_KEYS.map((k) => [k, null])) as Record<PremieComponentKey, number | null>,
    mutaties: Object.fromEntries(COMP_MUTATIE_KEYS.map((k) => [k, null])) as Record<CompMutatieKey, number | null>,
    toekenning: null,
    startomvang: null,
    ondergrensPct: null,
    reserveStand: null,
  },
});

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Leest de invoerdata voor het beheerscherm: registry + ruwe leaves van de
 * gekozen én de voorgaande periode + recente wijzigingshistorie.
 */
export async function haalStuurinfoInvoer(
  fondsId: string,
  periodeParam?: string
): Promise<StuurinfoInvoerData> {
  const supabase = await createServerSupabase();

  const periodeRes = await supabase
    .from("fonds_stuurinfo_periode")
    .select("periode, peildatum, bron, volgorde")
    .eq("fonds_id", fondsId)
    .order("volgorde", { ascending: false });

  const periodes = (periodeRes.data ?? []) as PeriodeRow[];
  const { gekozen, vorige } = kiesPeriode(periodes, periodeParam);

  const opties: BeheerPeriodeOptie[] = periodes.map((p) => ({
    periode: p.periode,
    label: `${formatteerPeriode(p.periode)} — ${formatteerPeildatum(p.peildatum)}`,
    peildatum: p.peildatum,
    bron: p.bron,
  }));

  if (!gekozen) {
    return { periodes: opties, gekozen: null, vorige: null, huidig: legeSnapshot(), referentie: null, log: [] };
  }

  const gekozenPeriodes = vorige ? [gekozen.periode, vorige.periode] : [gekozen.periode];

  const [reeksRes, reserveRes, kpiRes, logRes] = await Promise.all([
    supabase
      .from("fonds_stuurinfo_reeks")
      .select("periode, reeks_key, punt_key, waarde")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes)
      .in("reeks_key", [
        "balans_activa",
        "balans_passiva",
        SOLI_VULLING_REEKS,
        LANGLEVEN_REEKS,
        RISICODEKKING_REEKS,
        OPER_MUTATIE_REEKS,
        OPER_KOSTEN_REALISATIE_REEKS,
        OPER_KOSTEN_BEGROOT_REEKS,
        PREMIE_COMPONENT_REEKS,
        PREMIE_COMPONENT_PCT_REEKS,
        COMP_MUTATIE_REEKS,
      ]),
    supabase
      .from("fonds_stuurinfo_reserve")
      .select("periode, reserve_key, stand, ondergrens, bovengrens")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes),
    supabase
      .from("fonds_stuurinfo_kpi")
      .select("periode, kpi_key, waarde")
      .eq("fonds_id", fondsId)
      .in("kpi_key", [
        "financieringsgraad",
        ...SPREIDING_KPI_KEYS,
        SOLI_UITDELING_KPI,
        ...OPER_KPI_KEYS,
        ...PREMIE_KPI_KEYS,
      ])
      .in("periode", gekozenPeriodes),
    supabase
      .from("fonds_stuurinfo_log")
      .select("id, periode, tabel, veld_key, oude_waarde, nieuwe_waarde, invoer_bron, gebruiker_naam, aangemaakt")
      .eq("fonds_id", fondsId)
      .order("aangemaakt", { ascending: false })
      .limit(30),
  ]);

  const reeksRijen = (reeksRes.data ?? []) as ReeksRow[];
  const reserveRijen = (reserveRes.data ?? []) as ReserveRow[];
  const kpiRijen = (kpiRes.data ?? []) as KpiRow[];

  const snapshotVan = (periode: string): InvoerSnapshot => {
    const snap = legeSnapshot();
    for (const r of reeksRijen) {
      if (r.periode !== periode) continue;
      if (r.reeks_key === "balans_activa" && (ACTIVA_KEYS as string[]).includes(r.punt_key)) {
        snap.activa[r.punt_key as ActivaKey] = num(r.waarde);
      } else if (r.reeks_key === "balans_passiva" && (PASSIVA_KEYS as string[]).includes(r.punt_key)) {
        snap.passiva[r.punt_key as PassivaKey] = num(r.waarde);
      } else if (r.reeks_key === SOLI_VULLING_REEKS && (SOLI_VULLING_INVOER_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.soli[r.punt_key as SoliVullingInvoerKey] = num(r.waarde);
      } else if (r.reeks_key === LANGLEVEN_REEKS && (LANGLEVEN_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.biometrie[r.punt_key as LanglevenKey] = num(r.waarde);
      } else if (r.reeks_key === RISICODEKKING_REEKS && (RISICODEKKING_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.biometrie[r.punt_key as RisicodekkingKey] = num(r.waarde);
      } else if (r.reeks_key === OPER_MUTATIE_REEKS && (OPER_MUTATIE_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.operationeel[r.punt_key as OperMutatieKey] = num(r.waarde);
      } else if (r.reeks_key === OPER_KOSTEN_REALISATIE_REEKS && (OPER_KOSTEN_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.operKostenRealisatie[r.punt_key as OperKostenKey] = num(r.waarde);
      } else if (r.reeks_key === OPER_KOSTEN_BEGROOT_REEKS && (OPER_KOSTEN_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.operKostenBegroot[r.punt_key as OperKostenKey] = num(r.waarde);
      } else if (r.reeks_key === PREMIE_COMPONENT_REEKS && (PREMIE_COMPONENT_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.premie.eur[r.punt_key as PremieComponentKey] = num(r.waarde);
      } else if (r.reeks_key === PREMIE_COMPONENT_PCT_REEKS && (PREMIE_COMPONENT_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.premie.pct[r.punt_key as PremieComponentKey] = num(r.waarde);
      } else if (r.reeks_key === COMP_MUTATIE_REEKS && (COMP_MUTATIE_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.premie.mutaties[r.punt_key as CompMutatieKey] = num(r.waarde);
      }
    }
    for (const r of reserveRijen) {
      if (r.periode !== periode) continue;
      if ((VRIJE_RESERVE_KEYS as readonly string[]).includes(r.reserve_key)) {
        snap.reserves[r.reserve_key as VrijeReserveKey] = num(r.stand);
      }
      if (r.reserve_key === "solidariteitsreserve") {
        snap.grenzen.solidariteitsreserve = {
          ondergrens: num(r.ondergrens),
          bovengrens: num(r.bovengrens),
        };
        // Read-only anker (T15): de soli-stand komt uit de balans-save; de
        // Solidariteit-sectie toont hem als eindstand-referentie en gebruikt
        // de stand van de VOORGAANDE periode als read-only beginstand.
        snap.soli.reserveStand = num(r.stand);
      }
      // Read-only ankers (T16): de ultimo's van tab 6/7 komen uit de
      // balans-save; primo = de stand van de VOORGAANDE periode (referentie).
      if (r.reserve_key === "operationele_reserve") {
        snap.operationeel.reserveStand = num(r.stand);
      }
      if (r.reserve_key === "compensatiedepot") {
        snap.premie.reserveStand = num(r.stand);
      }
    }
    const kpiVan = (key: string): number | null => {
      const kpi = kpiRijen.find((k) => k.periode === periode && k.kpi_key === key);
      return kpi ? num(kpi.waarde) : null;
    };
    snap.financieringsgraad = kpiVan("financieringsgraad");
    snap.spreiding = {
      beschikbaar: kpiVan("uitkeringsfase_beschikbaar"),
      voorziening: kpiVan("uitkeringsfase_voorziening"),
      aanpassingsfactor: kpiVan("uitkeringsfase_aanpassingsfactor"),
      bandOnder: kpiVan("uitkeringsfase_band_onder"),
      bandBoven: kpiVan("uitkeringsfase_band_boven"),
    };
    snap.soli.uitdeling = kpiVan(SOLI_UITDELING_KPI);
    snap.operationeel.norm = kpiVan("oper_norm");
    snap.operationeel.bandOnder = kpiVan("oper_band_onder");
    snap.operationeel.bandBoven = kpiVan("oper_band_boven");
    snap.premie.toekenning = kpiVan("comp_toekenning_jaar");
    snap.premie.startomvang = kpiVan("comp_startomvang");
    snap.premie.ondergrensPct = kpiVan("comp_ondergrens_pct");
    return snap;
  };

  return {
    periodes: opties,
    gekozen: gekozen.periode,
    vorige: vorige?.periode ?? null,
    huidig: snapshotVan(gekozen.periode),
    referentie: vorige ? snapshotVan(vorige.periode) : null,
    log: (logRes.data ?? []) as StuurinfoLogRegel[],
  };
}
