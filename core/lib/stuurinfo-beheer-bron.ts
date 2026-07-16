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
  SOLI_VULLING_KEYS,
  SOLI_VULLING_REEKS,
  SOLI_UITDELING_KPI,
  type SoliVullingKey,
} from "@/core/lib/stuurinfo-soli";

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
  /** Tab 5 (T15): vullingsbronnen + uitdeling + soli-reserve-stand (read-only
   *  anker uit de balans; beginstand-veld = referentie.soli.reserveStand). */
  soli: Record<SoliVullingKey, number | null> & {
    uitdeling: number | null;
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
  soli: {
    ...(Object.fromEntries(SOLI_VULLING_KEYS.map((k) => [k, null])) as Record<SoliVullingKey, number | null>),
    uitdeling: null,
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
      .in("reeks_key", ["balans_activa", "balans_passiva", SOLI_VULLING_REEKS]),
    supabase
      .from("fonds_stuurinfo_reserve")
      .select("periode, reserve_key, stand, ondergrens, bovengrens")
      .eq("fonds_id", fondsId)
      .in("periode", gekozenPeriodes),
    supabase
      .from("fonds_stuurinfo_kpi")
      .select("periode, kpi_key, waarde")
      .eq("fonds_id", fondsId)
      .in("kpi_key", ["financieringsgraad", ...SPREIDING_KPI_KEYS, SOLI_UITDELING_KPI])
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
      } else if (r.reeks_key === SOLI_VULLING_REEKS && (SOLI_VULLING_KEYS as readonly string[]).includes(r.punt_key)) {
        snap.soli[r.punt_key as SoliVullingKey] = num(r.waarde);
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
