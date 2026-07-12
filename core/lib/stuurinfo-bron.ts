// ============================================================================
//  Stuurinformatie — SERVER-side tenant-veilige leeslaag (T11).
// ----------------------------------------------------------------------------
//  Leest de KPI's (fonds_stuurinfo_kpi) en reeksen (fonds_stuurinfo_reeks) ONDER
//  FONDS-RLS en de presentatie/content (peildatum, signaleringen, vergaderingen,
//  KPI-volgorde) uit de per-fonds module-config. Past kleine-populatie-suppressie
//  (n<10) toe op elke cel met een populatie-teller. GEEN deelnemer-PII (aggregaat).
//
//  fonds_id komt server-side (haalFondsSessie); nooit uit de request-body.
// ============================================================================

import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { moduleConfig } from "@/core/lib/fonds-config";
import { isOnderdrukt } from "@/core/lib/suppressie";

// ── Publieke vormen ─────────────────────────────────────────────────────────
export type Kpi = {
  key: string;
  label: string;
  waarde: number | null;
  delta: number | null;
  eenheid: string;
  toelichting: string | null;
  populatieN: number | null;
  onderdrukt: boolean;
};

export type BalansRij = {
  key: string;
  naam: string;
  waarde: number;
  delta: number | null;
  kleur: string | null;
};

export type StatusRij = {
  key: string;
  label: string;
  aantal: number | null;
  delta: number | null;
  kleur: string | null;
  populatieN: number | null;
  onderdrukt: boolean;
};

export type Signalering = { kleur: string; titel: string; sub: string };
export type Vergadering = { categorie: string; titel: string; datum: string; kleur: string };

export type StuurinfoData = {
  peildatum: string;
  toonTrend: boolean;
  toonBalans: boolean;
  kpis: Kpi[];
  trend: { labels: string[]; waarden: number[] };
  balans: {
    activa: { bescherming: BalansRij[]; overrend: BalansRij[]; liquide: BalansRij[] };
    passiva: { ppv: BalansRij[]; reserve: BalansRij[]; overig: BalansRij[] };
  };
  deelnemerStatus: StatusRij[];
  deelnemerMutatie: { instroom: number; uitstroom: number; pensioneringen: number };
  signaleringen: Signalering[];
  vergaderingen: Vergadering[];
};

// ── Coercie-helpers voor jsonb-config ───────────────────────────────────────
function tekst(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function stringLijst(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function signaleringen(v: unknown): Signalering[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => {
    const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      kleur: tekst(r.kleur, "blue"),
      titel: tekst(r.titel, ""),
      sub: tekst(r.sub, ""),
    };
  }).filter((s) => s.titel);
}
function vergaderingen(v: unknown): Vergadering[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => {
    const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      categorie: tekst(r.categorie, ""),
      titel: tekst(r.titel, ""),
      datum: tekst(r.datum, ""),
      kleur: tekst(r.kleur, "blue"),
    };
  }).filter((s) => s.titel);
}

type ReeksRow = {
  reeks_key: string;
  punt_key: string;
  label: string | null;
  volgorde: number;
  waarde: number | null;
  delta: number | null;
  kleur: string | null;
  populatie_n: number | null;
};

const balansRij = (r: ReeksRow): BalansRij => ({
  key: r.punt_key,
  naam: r.label ?? r.punt_key,
  waarde: Number(r.waarde ?? 0),
  delta: r.delta === null ? null : Number(r.delta),
  kleur: r.kleur,
});

export async function haalStuurinfo(fondsId: string): Promise<StuurinfoData> {
  const supabase = await createServerSupabase();
  const cfg = await moduleConfig(fondsId, "stuurinformatie");

  const [kpiRes, reeksRes] = await Promise.all([
    supabase
      .from("fonds_stuurinfo_kpi")
      .select("kpi_key, label, waarde, delta, eenheid, toelichting, volgorde, populatie_n")
      .eq("fonds_id", fondsId),
    supabase
      .from("fonds_stuurinfo_reeks")
      .select("reeks_key, punt_key, label, volgorde, waarde, delta, kleur, populatie_n")
      .eq("fonds_id", fondsId)
      .order("reeks_key", { ascending: true })
      .order("volgorde", { ascending: true }),
  ]);

  // ── KPI's: config-gedreven volgorde (kpiVolgorde), anders volgorde-kolom ──
  const volgordeCfg = stringLijst(cfg.kpiVolgorde);
  const kpiRows = (kpiRes.data ?? []) as Array<{
    kpi_key: string; label: string; waarde: number | null; delta: number | null;
    eenheid: string; toelichting: string | null; volgorde: number; populatie_n: number | null;
  }>;
  const kpiMap = new Map(kpiRows.map((r) => [r.kpi_key, r]));
  const geordend = volgordeCfg.length
    ? volgordeCfg.map((k) => kpiMap.get(k)).filter((r): r is (typeof kpiRows)[number] => !!r)
    : kpiRows.slice().sort((a, b) => a.volgorde - b.volgorde);

  const kpis: Kpi[] = geordend.map((r) => {
    const onderdrukt = isOnderdrukt(r.populatie_n);
    // Onderdrukt → GEEN getal, delta én exacte teller in de payload (structurele
    // garantie: geen leak, ook niet als het object later aan een client-component
    // wordt doorgegeven — besluit 0055).
    return {
      key: r.kpi_key,
      label: r.label,
      waarde: onderdrukt ? null : r.waarde === null ? null : Number(r.waarde),
      delta: onderdrukt ? null : r.delta === null ? null : Number(r.delta),
      eenheid: r.eenheid,
      toelichting: r.toelichting,
      populatieN: onderdrukt ? null : r.populatie_n,
      onderdrukt,
    };
  });

  // ── Reeksen groeperen ──
  const rows = (reeksRes.data ?? []) as ReeksRow[];
  const groep = (key: string) => rows.filter((r) => r.reeks_key === key);

  const trendRows = groep("trend_fg");
  const trend = {
    labels: trendRows.map((r) => r.label ?? r.punt_key),
    waarden: trendRows.map((r) => Number(r.waarde ?? 0)),
  };

  const deelnemerStatus: StatusRij[] = groep("deelnemer_status").map((r) => {
    const onderdrukt = isOnderdrukt(r.populatie_n);
    // Onderdrukt → aantal, delta én exacte teller uit de payload (geen leak, ook
    // niet via een afgeleide zoals nettoDelta; besluit 0055).
    return {
      key: r.punt_key,
      label: r.label ?? r.punt_key,
      aantal: onderdrukt ? null : Number(r.waarde ?? 0),
      delta: onderdrukt ? null : r.delta === null ? null : Number(r.delta),
      kleur: r.kleur,
      populatieN: onderdrukt ? null : r.populatie_n,
      onderdrukt,
    };
  });

  const mutatieMap = new Map(groep("deelnemer_mutatie").map((r) => [r.punt_key, Number(r.waarde ?? 0)]));
  const deelnemerMutatie = {
    instroom: mutatieMap.get("instroom") ?? 0,
    uitstroom: mutatieMap.get("uitstroom") ?? 0,
    pensioneringen: mutatieMap.get("pensioneringen") ?? 0,
  };

  return {
    peildatum: tekst(cfg.peildatum, ""),
    toonTrend: cfg.toonTrend !== false,
    toonBalans: cfg.toonBalans !== false,
    kpis,
    trend,
    balans: {
      activa: {
        bescherming: groep("balans_activa_bescherming").map(balansRij),
        overrend: groep("balans_activa_overrend").map(balansRij),
        liquide: groep("balans_activa_liquide").map(balansRij),
      },
      passiva: {
        ppv: groep("balans_passiva_ppv").map(balansRij),
        reserve: groep("balans_passiva_reserve").map(balansRij),
        overig: groep("balans_passiva_overig").map(balansRij),
      },
    },
    deelnemerStatus,
    deelnemerMutatie,
    signaleringen: signaleringen(cfg.signaleringen),
    vergaderingen: vergaderingen(cfg.vergaderingen),
  };
}
