// lib/aqlab/dashboard-lees.ts
// -----------------------------------------------------------------------------
// AQLab — server-only READ voor scherm 7 (dashboard kwaliteit per feature,
// platform-console). Geaggregeerd per AI-feature over de laatste voltooide run:
// gemiddelde quality_score, grounded/format-indicatoren, # geblokkeerde outputs,
// # openstaande reviews, laatste release-status. Toont het steekproefkarakter
// (aantal outputs) expliciet. Alleen platform-console (nooit fonds-facing).
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FeatureKwaliteit {
  feature_id: string;
  code: string;
  naam: string;
  laatste_run_id: string | null;
  laatste_run_op: string | null;
  aantal_outputs: number;
  gem_quality_score: number | null;
  aantal_geblokkeerd: number;
  aantal_review_vereist: number;
  open_kritieke_bevindingen: number;
  laatste_release_status: string | null;
  laatste_release_advies: string | null;
}

/** Bouwt het per-feature kwaliteitsoverzicht. Enkele queries per feature (MVP: 3). */
export async function haalKwaliteitDashboard(svc: SupabaseClient): Promise<FeatureKwaliteit[]> {
  const { data: feats } = await svc
    .from("aqlab_ai_features").select("id, code, naam").order("code");
  const features = (feats ?? []) as { id: string; code: string; naam: string }[];

  const uit: FeatureKwaliteit[] = [];
  for (const f of features) {
    const rij: FeatureKwaliteit = {
      feature_id: f.id, code: f.code, naam: f.naam,
      laatste_run_id: null, laatste_run_op: null, aantal_outputs: 0,
      gem_quality_score: null, aantal_geblokkeerd: 0, aantal_review_vereist: 0,
      open_kritieke_bevindingen: 0, laatste_release_status: null, laatste_release_advies: null,
    };

    // Test-sets van de feature → laatste voltooide run.
    const { data: sets } = await svc.from("aqlab_test_sets").select("id").eq("feature_id", f.id);
    const setIds = ((sets ?? []) as { id: string }[]).map((s) => s.id);
    if (setIds.length) {
      const { data: run } = await svc
        .from("aqlab_runs")
        .select("id, voltooid_op")
        .in("test_set_id", setIds)
        .eq("status", "done")
        .order("voltooid_op", { ascending: false })
        .limit(1)
        .maybeSingle();
      const r = run as { id: string; voltooid_op: string | null } | null;
      if (r) {
        rij.laatste_run_id = r.id;
        rij.laatste_run_op = r.voltooid_op;
        const { data: outs } = await svc
          .from("aqlab_run_outputs").select("id, quality_score, gate_status").eq("run_id", r.id);
        const outputs = (outs ?? []) as { id: string; quality_score: number | null; gate_status: string | null }[];
        rij.aantal_outputs = outputs.length;
        const scores = outputs.map((o) => o.quality_score).filter((x): x is number => typeof x === "number");
        rij.gem_quality_score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        rij.aantal_geblokkeerd = outputs.filter((o) => o.gate_status === "geblokkeerd").length;
        rij.aantal_review_vereist = outputs.filter((o) => o.gate_status === "review_vereist").length;
        const outputIds = outputs.map((o) => o.id);
        if (outputIds.length) {
          const { count } = await svc
            .from("aqlab_findings").select("id", { count: "exact", head: true })
            .in("run_output_id", outputIds).eq("ernst", "kritiek").eq("status", "open");
          rij.open_kritieke_bevindingen = count ?? 0;
        }
      }
    }

    // Laatste besluitregel van de feature.
    const { data: besluit } = await svc
      .from("aqlab_release_decisions")
      .select("release_status, release_advies")
      .eq("feature_id", f.id)
      .order("aangemaakt_op", { ascending: false })
      .limit(1)
      .maybeSingle();
    const b = besluit as { release_status: string; release_advies: string | null } | null;
    rij.laatste_release_status = b?.release_status ?? null;
    rij.laatste_release_advies = b?.release_advies ?? null;

    uit.push(rij);
  }
  return uit;
}
