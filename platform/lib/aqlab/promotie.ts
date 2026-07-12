// lib/aqlab/promotie.ts
// -----------------------------------------------------------------------------
// AQLab — "Opslaan als testcase" (AQL-3, functioneel §scherm 5a / technisch §2.6b).
// Promoveert een ad-hoc vraag (uit een gepersisteerde ad_hoc-run) tot een
// reproduceerbare, formeel meetellende aqlab_test_cases-rij en markeert de bron-
// run (promoted_to_testcase = true + promoted_testcase_id).
//
// GUARDRAILS: UX-principe "maak vereisten expliciet" — valideer de verplichte
// velden VOORAF (blokker, geen foutmelding achteraf). De bron-run zelf telt niet
// met terugwerkende kracht mee. Server-only; schrijft via de service-role achter
// de capability+audit-wrapper.
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PromotieConfig {
  bron_run_id: string;
  /** Bestaande testset OF (nieuwe testset) — één van beide vereist. */
  test_set_id?: string | null;
  nieuwe_testset?: { code: string; naam: string } | null;
  code: string;
  titel: string;
  kritikaliteit: "kritiek" | "hoog" | "middel" | "laag";
  minimale_acceptatiescore: number;
  review_verplicht: boolean;
  verwachte_outputvorm: string;
  verplichte_onderdelen: string[];
  blokkadecriteria: string[];
  /** Machine-toetsbare spec (optioneel; criterium-codes). */
  checks?: string[];
  gestart_door?: string | null;
}

export interface PromotieResultaat {
  ok: boolean;
  ontbrekend: string[];
  test_case_id?: string;
  reden?: string;
}

/** Valideert de verplichte velden vooraf (UX: blokker vooraf, niet achteraf). */
export function valideerPromotie(config: Partial<PromotieConfig>): string[] {
  const ontbrekend: string[] = [];
  if (!config.code?.trim()) ontbrekend.push("testcase-code");
  if (!config.titel?.trim()) ontbrekend.push("titel");
  if (!config.test_set_id && !config.nieuwe_testset?.code?.trim()) ontbrekend.push("testset (bestaand of nieuw)");
  if (!config.verwachte_outputvorm?.trim()) ontbrekend.push("verwachte outputvorm");
  if (!config.verplichte_onderdelen || config.verplichte_onderdelen.length === 0) ontbrekend.push("verplichte onderdelen");
  if (!config.blokkadecriteria || config.blokkadecriteria.length === 0) ontbrekend.push("blokkadecriteria");
  if (config.minimale_acceptatiescore == null || Number.isNaN(config.minimale_acceptatiescore)) ontbrekend.push("minimale acceptatiescore");
  if (config.review_verplicht == null) ontbrekend.push("reviewverplichting");
  return ontbrekend;
}

export async function promoveerAdHocNaarTestcase(
  svc: SupabaseClient,
  config: PromotieConfig
): Promise<PromotieResultaat> {
  const ontbrekend = valideerPromotie(config);
  if (ontbrekend.length > 0) return { ok: false, ontbrekend };

  // Bron-run laden (moet een gepersisteerde ad_hoc-run zijn).
  const { data: run } = await svc
    .from("aqlab_runs")
    .select("id, run_type, ad_hoc_question, promoted_to_testcase")
    .eq("id", config.bron_run_id)
    .maybeSingle();
  if (!run) return { ok: false, ontbrekend: [], reden: "Bron-run niet gevonden." };
  if (run.run_type !== "ad_hoc") return { ok: false, ontbrekend: [], reden: "Alleen een ad-hoc run is promoveerbaar." };
  if (run.promoted_to_testcase) return { ok: false, ontbrekend: [], reden: "Deze run is al gepromoveerd." };
  if (!run.ad_hoc_question) return { ok: false, ontbrekend: [], reden: "Bron-run heeft geen opgeslagen vraag (persist_mode?)." };

  // Broncontext uit een representatieve output (snapshot_refs).
  const { data: out } = await svc
    .from("aqlab_run_outputs")
    .select("snapshot_refs")
    .eq("run_id", config.bron_run_id)
    .limit(1)
    .maybeSingle();
  const broncontextRef = (out?.snapshot_refs as unknown) ?? [];

  // Testset resolven (bestaand of nieuw aanmaken).
  let testSetId = config.test_set_id ?? null;
  if (!testSetId && config.nieuwe_testset) {
    const { data: ts, error: tsErr } = await svc
      .from("aqlab_test_sets")
      .insert({ code: config.nieuwe_testset.code, naam: config.nieuwe_testset.naam, status: "actief" })
      .select("id")
      .single();
    if (tsErr || !ts) return { ok: false, ontbrekend: [], reden: `Nieuwe testset aanmaken mislukt: ${tsErr?.message}` };
    testSetId = ts.id as string;
  }
  if (!testSetId) return { ok: false, ontbrekend: ["testset (bestaand of nieuw)"] };

  // Testcase aanmaken. spec bevat de machine-toetsbare onderdelen (reproduceerbaar).
  const spec = {
    required_sections: config.verplichte_onderdelen,
    blokkadecriteria: config.blokkadecriteria,
    checks: config.checks ?? [],
    min_quality_score: config.minimale_acceptatiescore,
    promoted_from_run: config.bron_run_id,
  };
  const { data: tc, error: tcErr } = await svc
    .from("aqlab_test_cases")
    .insert({
      test_set_id: testSetId,
      code: config.code,
      titel: config.titel,
      gebruikersvraag: run.ad_hoc_question,
      broncontext_ref: broncontextRef,
      verwachte_outputvorm: config.verwachte_outputvorm,
      verplichte_onderdelen: config.verplichte_onderdelen,
      blokkadecriteria: config.blokkadecriteria,
      minimale_acceptatiescore: config.minimale_acceptatiescore,
      kritikaliteit: config.kritikaliteit,
      review_verplicht: config.review_verplicht,
      spec,
      actief: true,
      aangemaakt_door: config.gestart_door ?? null,
    })
    .select("id")
    .single();
  if (tcErr || !tc) return { ok: false, ontbrekend: [], reden: `Testcase aanmaken mislukt: ${tcErr?.message}` };
  const testCaseId = tc.id as string;

  // Bron-run markeren (telt zelf niet met terugwerkende kracht mee).
  await svc
    .from("aqlab_runs")
    .update({ promoted_to_testcase: true, promoted_testcase_id: testCaseId })
    .eq("id", config.bron_run_id);

  await svc.from("aqlab_log").insert({
    actie: "adhoc_gepromoveerd",
    object_type: "aqlab_test_cases",
    object_id: testCaseId,
    nieuwe_waarde: { bron_run_id: config.bron_run_id, code: config.code, test_set_id: testSetId },
  });

  return { ok: true, ontbrekend: [], test_case_id: testCaseId };
}
