"use server";

// ============================================================================
//  Server-actions — AI Quality Lab console (AQL-2).
// ----------------------------------------------------------------------------
//  Run starten/annuleren + menselijke review, ALLE achter withPlatform met de
//  AQLab-capabilities (platform.aqlab.operate / .review) en het append-only
//  platform-auditspoor. De aqlab_*-tabellen zijn deny-by-default; schrijven loopt
//  uitsluitend via de service-role ACHTER deze capability+audit-wrapper.
//
//  De worker (cron) draint de queue; deze actie zet alleen de run op 'queued'.
// ============================================================================

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withPlatform } from "@/lib/platform-wrapper";
import { planRun, annuleerRun, type RunConfig } from "@/lib/aqlab/run-orchestrator";

const CAP_OPERATE = "platform.aqlab.operate" as const;
const CAP_REVIEW = "platform.aqlab.review" as const;
const LIJST_PAD = "/platform/aqlab";

export async function startRunActie(formData: FormData): Promise<void> {
  const testSetId = ((formData.get("test_set_id") as string) || "").trim() || null;
  const runType = ((formData.get("run_type") as string) || "full_regression") as NonNullable<
    RunConfig["run_type"]
  >;
  const persistMode = ((formData.get("persist_mode") as string) || "full_synthetic") as NonNullable<
    RunConfig["persist_mode"]
  >;
  const adHocVraag = ((formData.get("ad_hoc_question") as string) || "").trim() || null;

  const { run_id } = await withPlatform(
    {
      capability: CAP_OPERATE,
      handeling: "platform.aqlab.run.start",
      doelObject: testSetId ? `aqlab_test_sets:${testSetId}` : "aqlab:ad_hoc",
    },
    async (svc, ctx) => {
      const r = await planRun(svc, {
        run_type: runType,
        test_set_id: testSetId,
        persist_mode: persistMode,
        ad_hoc_question: adHocVraag,
        notitie: `Gestart door ${ctx.identiteit.naam}`,
      });
      return { resultaat: r, effect: { run_id: r.run_id, jobs: r.aantalJobs } };
    }
  );

  revalidatePath(LIJST_PAD);
  redirect(`${LIJST_PAD}/runs/${run_id}`);
}

export async function annuleerRunActie(formData: FormData): Promise<void> {
  const runId = (formData.get("run_id") as string) || "";
  if (!runId) return;
  await withPlatform(
    { capability: CAP_OPERATE, handeling: "platform.aqlab.run.cancel", doelObject: `aqlab_runs:${runId}` },
    async (svc) => {
      await annuleerRun(svc, runId);
      return { resultaat: null, effect: { run_id: runId } };
    }
  );
  revalidatePath(`${LIJST_PAD}/runs/${runId}`);
}

export async function humanReviewActie(formData: FormData): Promise<void> {
  const outputId = (formData.get("run_output_id") as string) || "";
  const oordeel = (formData.get("oordeel") as string) || "";
  const motivatie = ((formData.get("motivatie") as string) || "").trim();
  const runId = (formData.get("run_id") as string) || "";
  if (!outputId || !["bevestigd", "overruled", "geblokkeerd"].includes(oordeel)) return;
  // Motivatie verplicht bij overrule/blokkade (geen stille override).
  if ((oordeel === "overruled" || oordeel === "geblokkeerd") && !motivatie) return;

  await withPlatform(
    { capability: CAP_REVIEW, handeling: "platform.aqlab.review.add", doelObject: `aqlab_run_outputs:${outputId}` },
    async (svc) => {
      await svc.from("aqlab_human_reviews").insert({
        run_output_id: outputId,
        oordeel,
        motivatie: motivatie || null,
      });
      await svc.from("aqlab_log").insert({
        actie: "human_review",
        object_type: "aqlab_run_outputs",
        object_id: outputId,
        nieuwe_waarde: { oordeel },
      });
      return { resultaat: null, effect: { run_output_id: outputId, oordeel } };
    }
  );
  revalidatePath(`${LIJST_PAD}/runs/${runId}`);
}
