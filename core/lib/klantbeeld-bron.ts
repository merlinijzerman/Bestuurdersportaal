// ============================================================================
//  Klantbeeld — SERVER-side tenant-veilige leeslaag (T11).
// ----------------------------------------------------------------------------
//  Leest de cohort-aggregaten uit fonds_klantbeeld_cohort ONDER FONDS-RLS
//  (anon-key; de RLS-policy filtert op het eigen fonds) en de werkgever-/inning-
//  parameters uit de per-fonds module-config. Past kleine-populatie-suppressie
//  toe (n<10) VÓÓR de data de client bereikt. Bevat GEEN deelnemer-PII — de bron
//  is aggregaat/cohort-niveau.
//
//  fonds_id komt server-side (haalFondsSessie); nooit uit de request-body.
// ============================================================================

import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { moduleConfig } from "@/core/lib/fonds-config";
import { isOnderdrukt } from "@/core/lib/suppressie";
import {
  buildCohortenVanBron,
  buildWerkgeversReeks,
  bouwWgSegmenten,
  buildInningReeks,
  inningAggregaat,
  type Cohort,
  type CohortBron,
  type WerkgeverBasis,
  type WgSegmentConfig,
  type WgSegment,
  type WerkgeversMaand,
  type InningMaand,
  type InningAggregaat,
} from "@/core/lib/klantbeeld-data";

// ── Fail-safe defaults (config ontbreekt → generieke waarden) ───────────────
const DEFAULT_WERKGEVER_BASIS: WerkgeverBasis = {
  werkgevers0: 300,
  gemSalaris0: 48000,
  franchise: 16500,
  premiepctPg: 0.3,
  wgDeel: 0.6667,
};

const DEFAULT_SEGMENTEN: WgSegmentConfig[] = [
  { key: "klein", naam: "Klein", toelichting: "1–25 werknemers", werkgeversAandeel: 0.66, werknemersAandeel: 0.18, premieAandeel: 0.16, kleur: "#94a3b8" },
  { key: "midden", naam: "Midden", toelichting: "25–200 werknemers", werkgeversAandeel: 0.27, werknemersAandeel: 0.38, premieAandeel: 0.39, kleur: "#0ea5e9" },
  { key: "groot", naam: "Groot", toelichting: "> 200 werknemers", werkgeversAandeel: 0.07, werknemersAandeel: 0.44, premieAandeel: 0.45, kleur: "var(--accent)" },
];

const DEFAULT_OPTIJD0 = 0.93;

// ── Coercie-helpers voor de jsonb-config (onbetrouwbaar getypeerd) ──────────
function getal(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export type KlantbeeldCohortData = {
  /** Cohorten met een populatie ≥ drempel (klein-populatie-cohorten zijn onderdrukt). */
  cohorten: Cohort[];
  /** Aantal cohorten dat wegens kleine populatie (n<10) is onderdrukt. */
  onderdrukteCohorten: number;
};

/**
 * Cohort-aggregaten voor het eigen fonds (RLS). Cohorten met een te kleine
 * populatie (n<10) worden onderdrukt (uit de set verwijderd), zodat ze niet
 * indirect herleidbaar worden. Geeft ook het aantal onderdrukte cohorten terug
 * voor een expliciete UI-melding (geen stille truncatie).
 */
export async function haalCohorten(fondsId: string): Promise<KlantbeeldCohortData> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("fonds_klantbeeld_cohort")
    .select(
      "leeftijd, aantal, actief_p, slapend_p, uitkerend_p, salaris, maand_premie, maand_uitkering, invaar_kapitaal, doel_op67, over_weight, bescherm_weight, duration_jr, uitvoering_mult"
    )
    .eq("fonds_id", fondsId)
    .order("leeftijd", { ascending: true });

  const rows = data ?? [];
  const zichtbaar = rows.filter((r) => !isOnderdrukt(r.aantal as number));
  const onderdrukteCohorten = rows.length - zichtbaar.length;

  const bron: CohortBron[] = zichtbaar.map((r) => ({
    leeftijd: r.leeftijd as number,
    aantal: r.aantal as number,
    actiefP: Number(r.actief_p),
    slapendP: Number(r.slapend_p),
    uitkerendP: Number(r.uitkerend_p),
    salaris: Number(r.salaris),
    maandPremie: Number(r.maand_premie),
    maandUitkering: Number(r.maand_uitkering),
    invaarKapitaal: Number(r.invaar_kapitaal),
    doelOp67: Number(r.doel_op67),
    overWeight: Number(r.over_weight),
    beschermWeight: Number(r.bescherm_weight),
    durationJr: Number(r.duration_jr),
    uitvoeringMult: Number(r.uitvoering_mult),
  }));

  return { cohorten: buildCohortenVanBron(bron), onderdrukteCohorten };
}

export type WerkgeversData = {
  werkgeversReeks: WerkgeversMaand[];
  segmenten: WgSegment[];
  inningReeks: InningMaand[];
  inningAgg: InningAggregaat;
};

/**
 * Werkgever-/inning-weergave voor het eigen fonds. De maandreeksen worden
 * deterministisch afgeleid van de cohort-aggregaten (RLS) + de per-fonds
 * werkgever-basisparameters/segmenten uit de module-config (ook RLS via manifest).
 */
export async function haalWerkgevers(fondsId: string): Promise<WerkgeversData> {
  const { cohorten } = await haalCohorten(fondsId);
  const cfg = await moduleConfig(fondsId, "klantbeeld");

  const basisRec = record(cfg.werkgeverBasis);
  const basis: WerkgeverBasis = {
    werkgevers0: getal(basisRec.werkgevers0, DEFAULT_WERKGEVER_BASIS.werkgevers0),
    gemSalaris0: getal(basisRec.gemSalaris0, DEFAULT_WERKGEVER_BASIS.gemSalaris0),
    franchise: getal(basisRec.franchise, DEFAULT_WERKGEVER_BASIS.franchise),
    premiepctPg: getal(basisRec.premiepctPg, DEFAULT_WERKGEVER_BASIS.premiepctPg),
    wgDeel: getal(basisRec.wgDeel, DEFAULT_WERKGEVER_BASIS.wgDeel),
  };

  const segmentenRaw = Array.isArray(cfg.segmenten) ? cfg.segmenten : null;
  const segmentenCfg: WgSegmentConfig[] = segmentenRaw
    ? segmentenRaw.map((s, i) => {
        const r = record(s);
        const d = DEFAULT_SEGMENTEN[i % DEFAULT_SEGMENTEN.length];
        return {
          key: typeof r.key === "string" ? r.key : `seg${i}`,
          naam: typeof r.naam === "string" ? r.naam : d.naam,
          toelichting: typeof r.toelichting === "string" ? r.toelichting : d.toelichting,
          werkgeversAandeel: getal(r.werkgeversAandeel, d.werkgeversAandeel),
          werknemersAandeel: getal(r.werknemersAandeel, d.werknemersAandeel),
          premieAandeel: getal(r.premieAandeel, d.premieAandeel),
          kleur: typeof r.kleur === "string" ? r.kleur : d.kleur,
        };
      })
    : DEFAULT_SEGMENTEN;

  const inningRec = record(cfg.inning);
  const opTijd0 = getal(inningRec.opTijd0, DEFAULT_OPTIJD0);

  const werkgeversReeks = buildWerkgeversReeks(cohorten, basis);
  const inningReeks = buildInningReeks(opTijd0);
  return {
    werkgeversReeks,
    segmenten: bouwWgSegmenten(werkgeversReeks, segmentenCfg),
    inningReeks,
    inningAgg: inningAggregaat(inningReeks),
  };
}
