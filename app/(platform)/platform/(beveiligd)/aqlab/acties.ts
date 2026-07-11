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
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPlatform } from "@/lib/platform-wrapper";
import { planRun, annuleerRun, draaiAdHocConsistentieSync, type RunConfig, type AdHocConsistentieResultaat } from "@/lib/aqlab/run-orchestrator";
import { haalProductieBaseline } from "@/lib/aqlab/console-lees";
import {
  isToegestaanModel,
  toegestaanModel,
  autoNaam,
  leidGewijzigdeAsAf,
  type VariantInstellingen,
  type GewijzigdeAs,
} from "@/lib/aqlab/modellen";
import { configHash } from "@/lib/aqlab/modellen-hash";
import { promoveerAdHocNaarTestcase, valideerPromotie, type PromotieConfig } from "@/lib/aqlab/promotie";
import { legVrijgavebesluitVast, valideerVrijgaveMogelijk, type Besluit, type Releasestatus } from "@/lib/aqlab/release";
import { genereerAuditExport, verifieerAuditExport } from "@/lib/aqlab/audit-export";

const CAP_OPERATE = "platform.aqlab.operate" as const;
const CAP_REVIEW = "platform.aqlab.review" as const;
const CAP_GOVERN = "platform.aqlab.govern" as const;
const LIJST_PAD = "/platform/aqlab";

function leeg(v: FormDataEntryValue | null): string | null {
  const s = ((v as string) || "").trim();
  return s.length ? s : null;
}

/**
 * Server-side her-validatie van de harde blokkers (CLAUDE.md: gating hoort niet
 * uitsluitend in de frontend). Retourneert een reden bij een blokkade, anders null.
 */
function valideerRunInvoer(o: { runType: string; testSetId: string | null; adHocVraag: string | null }): string | null {
  if ((o.runType === "full_regression" || o.runType === "subset") && !o.testSetId) {
    return "Kies een testset voor een regressie-/subset-run.";
  }
  if (o.runType === "ad_hoc" && !o.adHocVraag) {
    return "Vul een ad-hoc vraag in.";
  }
  return null;
}

/**
 * Pin de challenger-variant als append-only aqlab_model_configurations-rij met
 * DEDUP-OP-HASH: identieke effectieve instellingen hergebruiken de bestaande rij
 * (§2B, besloten optie A). Een nieuw gepinde variant wordt append-only gelogd.
 */
async function pinModelConfig(svc: SupabaseClient, variant: VariantInstellingen): Promise<string> {
  const hash = configHash(variant);
  const { data: bestaand } = await svc
    .from("aqlab_model_configurations").select("id").eq("config_hash", hash).maybeSingle();
  if (bestaand?.id) return bestaand.id as string;

  const naam = autoNaam(variant);
  const { data: ins, error } = await svc
    .from("aqlab_model_configurations")
    .insert({
      naam,
      model_provider: "anthropic",
      model_name: variant.model,
      temperature_requested: variant.temperature,
      max_tokens_requested: variant.maxTokens,
      top_p_requested: variant.topP,
      retrieval_settings: variant.retrieval,
      is_baseline: false,
      config_hash: hash,
    })
    .select("id")
    .single();
  if (error || !ins) {
    // Race op de unieke config_hash → her-lees de nu bestaande rij.
    const { data: retry } = await svc
      .from("aqlab_model_configurations").select("id").eq("config_hash", hash).maybeSingle();
    if (retry?.id) return retry.id as string;
    throw new Error(`modelconfig pin mislukt: ${error?.message ?? "onbekend"}`);
  }
  // Append-only auditregel: nieuwe variant gepind.
  await svc.from("aqlab_log").insert({
    actie: "modelconfig_pinned",
    object_type: "aqlab_model_configurations",
    object_id: ins.id,
    nieuwe_waarde: {
      naam,
      config_hash: hash,
      model: variant.model,
      temperature: variant.temperature,
      max_tokens: variant.maxTokens,
      top_p: variant.topP,
    },
  });
  return ins.id as string;
}

export async function startRunActie(formData: FormData): Promise<void> {
  const naam = leeg(formData.get("naam"));
  const testSetId = leeg(formData.get("test_set_id"));
  const runType = ((formData.get("run_type") as string) || "full_regression") as NonNullable<RunConfig["run_type"]>;
  const persistMode = ((formData.get("persist_mode") as string) || "full_synthetic") as NonNullable<RunConfig["persist_mode"]>;
  const adHocVraag = leeg(formData.get("ad_hoc_question"));
  const soort = (leeg(formData.get("soort")) as RunConfig["soort"]) ?? "functioneel";
  const consistencyEnabled = formData.get("consistency_enabled") === "on";
  const iterRaw = leeg(formData.get("iteraties"));
  const iteraties = iterRaw ? Number(iterRaw) : null;
  const selectedTestCaseIds = (formData.getAll("selected_test_case_ids") as string[]).map((s) => s.trim()).filter(Boolean);

  // Challenger-variant (allowlist-model + optionele expliciete instellingen).
  const challengerModel = leeg(formData.get("challenger_model"));
  const tempMode = leeg(formData.get("temp_mode")); // "default" of een getalstring
  const maxTokensRaw = leeg(formData.get("max_tokens"));
  const topPRaw = leeg(formData.get("top_p"));

  // Harde blokkers server-side afdwingen (defense-in-depth naast de UI).
  const blokker = valideerRunInvoer({ runType, testSetId, adHocVraag });
  if (blokker) redirect(`${LIJST_PAD}?fout=${encodeURIComponent(blokker)}`);
  if (challengerModel && !isToegestaanModel(challengerModel)) {
    redirect(`${LIJST_PAD}?fout=${encodeURIComponent(`Model niet toegestaan: ${challengerModel}`)}`);
  }

  const { run_id } = await withPlatform(
    {
      capability: CAP_OPERATE,
      handeling: "platform.aqlab.run.start",
      doelObject: testSetId ? `aqlab_test_sets:${testSetId}` : "aqlab:ad_hoc",
    },
    async (svc, ctx) => {
      // Vaste productie-baseline (laatst vrijgegeven variant) voor regressie/subset.
      const baseline = runType !== "ad_hoc" ? await haalProductieBaseline(svc, testSetId) : null;

      // Challenger-config pinnen (dedup-op-hash) + gewijzigde as automatisch afleiden.
      let modelConfigId: string | null = null;
      let gewijzigdeAs: GewijzigdeAs | null = null;
      if (challengerModel) {
        const kern = toegestaanModel(challengerModel)!;
        const temperature = !tempMode || tempMode === "default" ? null : Number(tempMode);
        const maxTokens = maxTokensRaw ? Number(maxTokensRaw) : kern.defaultMaxTokens;
        const topP = topPRaw ? Number(topPRaw) : null;
        const variant: VariantInstellingen = { model: challengerModel, temperature, maxTokens, topP, retrieval: {} };
        modelConfigId = await pinModelConfig(svc, variant);
        gewijzigdeAs = leidGewijzigdeAsAf(baseline?.variant ?? null, variant);
      }

      const r = await planRun(svc, {
        run_type: runType,
        test_set_id: testSetId,
        persist_mode: persistMode,
        ad_hoc_question: adHocVraag,
        model_configuration_id: modelConfigId,
        baseline_run_id: baseline?.baseline_run_id ?? null,
        rol: baseline ? "challenger" : null,
        soort,
        gewijzigde_as: gewijzigdeAs,
        consistency_enabled: runType === "full_regression" ? null : consistencyEnabled,
        iteraties,
        selected_test_case_ids: runType === "subset" && selectedTestCaseIds.length ? selectedTestCaseIds : null,
        subset_filter: runType === "subset" ? { handmatig: selectedTestCaseIds, alleen_security_safety: soort === "security_blocking" } : null,
        naam,
        notitie: `Gestart door ${ctx.identiteit.naam}`,
      });
      return { resultaat: r, effect: { run_id: r.run_id, jobs: r.aantalJobs, model_configuration_id: modelConfigId } };
    }
  );

  revalidatePath(LIJST_PAD);
  redirect(`${LIJST_PAD}/runs/${run_id}`);
}

/** Scherm 6b — synchrone ad-hoc consistentietest (respecteert persist_mode; bij none niets persistent). */
export async function adHocConsistentieActie(
  _prev: AdHocConsistentieResultaat | { fout: string } | null,
  formData: FormData
): Promise<AdHocConsistentieResultaat | { fout: string } | null> {
  const vraag = leeg(formData.get("vraag"));
  if (!vraag) return { fout: "Vraag is verplicht." };
  const persistMode = ((formData.get("persist_mode") as string) || "none") as NonNullable<RunConfig["persist_mode"]>;
  const iteraties = Number(leeg(formData.get("iteraties")) || "3");
  const rol = leeg(formData.get("rol"));
  const modelConfigId = leeg(formData.get("model_configuration_id"));
  const fixtureIds = (leeg(formData.get("fixture_ids")) || "").split(",").map((s) => s.trim()).filter(Boolean);

  try {
    return await withPlatform(
      { capability: CAP_OPERATE, handeling: "platform.aqlab.adhoc.consistentie", doelObject: "aqlab:ad_hoc" },
      async (svc, ctx) => {
        const r = await draaiAdHocConsistentieSync(svc, {
          vraag,
          rol,
          fixtureIds,
          model_configuration_id: modelConfigId,
          iteraties,
          persist_mode: persistMode,
          gestart_door: null,
          notitie: `Ad-hoc consistentietest door ${ctx.identiteit.naam}`,
        });
        return { resultaat: r, effect: { persisted: r.persisted, run_id: r.run_id, status: r.aggregaat.consistency_status } };
      }
    );
  } catch (e) {
    return { fout: e instanceof Error ? e.message : String(e) };
  }
}

/** Scherm 5a — ad-hoc vraag promoveren tot officiële testcase. */
export async function promoveerActie(formData: FormData): Promise<void> {
  const config: PromotieConfig = {
    bron_run_id: (formData.get("bron_run_id") as string) || "",
    test_set_id: leeg(formData.get("test_set_id")),
    nieuwe_testset: leeg(formData.get("nieuwe_testset_code"))
      ? { code: (formData.get("nieuwe_testset_code") as string).trim(), naam: ((formData.get("nieuwe_testset_naam") as string) || "").trim() || (formData.get("nieuwe_testset_code") as string).trim() }
      : null,
    code: ((formData.get("code") as string) || "").trim(),
    titel: ((formData.get("titel") as string) || "").trim(),
    kritikaliteit: ((formData.get("kritikaliteit") as string) || "middel") as PromotieConfig["kritikaliteit"],
    minimale_acceptatiescore: Number(leeg(formData.get("minimale_acceptatiescore")) || "0"),
    review_verplicht: formData.get("review_verplicht") === "on",
    verwachte_outputvorm: ((formData.get("verwachte_outputvorm") as string) || "").trim(),
    verplichte_onderdelen: ((formData.get("verplichte_onderdelen") as string) || "").split("\n").map((s) => s.trim()).filter(Boolean),
    blokkadecriteria: ((formData.get("blokkadecriteria") as string) || "").split(",").map((s) => s.trim()).filter(Boolean),
  };

  const ontbrekend = valideerPromotie(config);
  if (ontbrekend.length > 0) {
    redirect(`${LIJST_PAD}/promoveren?run=${config.bron_run_id}&ontbreekt=${encodeURIComponent(ontbrekend.join(","))}`);
  }

  const res = await withPlatform(
    { capability: CAP_OPERATE, handeling: "platform.aqlab.adhoc.promote", doelObject: `aqlab_runs:${config.bron_run_id}` },
    async (svc) => {
      const r = await promoveerAdHocNaarTestcase(svc, config);
      return { resultaat: r, effect: { ok: r.ok, test_case_id: r.test_case_id } };
    }
  );

  revalidatePath(LIJST_PAD);
  if (res.ok && res.test_case_id) redirect(`${LIJST_PAD}/runs/${config.bron_run_id}`);
  else redirect(`${LIJST_PAD}/promoveren?run=${config.bron_run_id}&fout=${encodeURIComponent(res.reden ?? "onbekend")}`);
}

// ── AQL-4 — vrijgavebesluit (scherm 8) ─────────────────────────────────────
// Formeel mensbesluit door de AI Governance Owner (CAP_GOVERN), strikt gescheiden
// van operate/review. Bij een formeel go/no-go bevriezen we óók het auditrapport
// en koppelen het (audit_export_id) — append-only, herleidbaar.
export async function legVrijgaveActie(formData: FormData): Promise<void> {
  const runId = (formData.get("run_id") as string) || "";
  const status = ((formData.get("gewenste_status") as string) || "") as Releasestatus;
  // Het formele besluit volgt DETERMINISTISCH uit de status (geen los,
  // inconsistent besluit-veld): een formele status = het gelijknamige besluit.
  const besluit = (status === "vrijgegeven" || status === "geblokkeerd" ? status : null) as Besluit | null;
  const motivatie = leeg(formData.get("motivatie"));
  if (!runId || !status) redirect(`${LIJST_PAD}/runs/${runId}?release_fout=${encodeURIComponent("run of status ontbreekt")}`);

  const res = await withPlatform(
    { capability: CAP_GOVERN, handeling: "platform.aqlab.release.besluit", doelObject: `aqlab_runs:${runId}` },
    async (svc, ctx) => {
      const nu = new Date().toISOString();
      const invoer = {
        run_id: runId,
        gewenste_status: status,
        besluit,
        besluit_door: besluit ? ctx.identiteit.id : null,
        acteur_id: ctx.identiteit.id,
        motivatie,
      };

      // 1. VALIDEER EERST (zonder te schrijven), zodat een geweigerd besluit nooit
      //    een onherroepelijke, bevroren auditexport-wees achterlaat.
      const voor = await valideerVrijgaveMogelijk(svc, invoer);
      if (!voor.ok) {
        return { resultaat: { ok: false, redenen: voor.redenen }, effect: { ok: false } };
      }

      // 2. Bij een formeel besluit: bevries + koppel het auditrapport (nu pas).
      let auditExportId: string | null = null;
      if (besluit) {
        const exp = await genereerAuditExport(
          svc,
          { run_id: runId, besluit, besluit_door: ctx.identiteit.id, gegenereerd_door: ctx.identiteit.id },
          nu
        );
        auditExportId = exp.ok ? exp.id : null;
      }

      // 3. Leg het besluit append-only vast (her-valideert defense-in-depth).
      const r = await legVrijgavebesluitVast(svc, { ...invoer, audit_export_id: auditExportId }, nu);
      return { resultaat: r, effect: { ok: r.ok, release_status: r.release_status, kritiek: r.kritieke_bevindingen_count } };
    }
  );

  revalidatePath(`${LIJST_PAD}/runs/${runId}`);
  if (res.ok) redirect(`${LIJST_PAD}/runs/${runId}?release_ok=1`);
  redirect(`${LIJST_PAD}/runs/${runId}?release_fout=${encodeURIComponent(res.redenen.join(" · "))}`);
}

// Standalone auditrapport genereren (scherm 8, zonder formeel besluit).
export async function genereerAuditActie(formData: FormData): Promise<void> {
  const runId = (formData.get("run_id") as string) || "";
  if (!runId) return;
  const res = await withPlatform(
    { capability: CAP_OPERATE, handeling: "platform.aqlab.audit.genereer", doelObject: `aqlab_runs:${runId}` },
    async (svc, ctx) => {
      const r = await genereerAuditExport(
        svc,
        { run_id: runId, besluit: null, besluit_door: null, gegenereerd_door: ctx.identiteit.id },
        new Date().toISOString()
      );
      return { resultaat: r, effect: { ok: r.ok, id: r.id } };
    }
  );
  revalidatePath(`${LIJST_PAD}/runs/${runId}`);
  redirect(`${LIJST_PAD}/runs/${runId}?${res.ok ? `audit_ok=${res.id}` : `audit_fout=${encodeURIComponent(res.reden ?? "onbekend")}`}`);
}

// Integriteitsverificatie: herbereken de hash van de opgeslagen bytes.
export async function verifieerAuditActie(formData: FormData): Promise<void> {
  const runId = (formData.get("run_id") as string) || "";
  const exportId = (formData.get("export_id") as string) || "";
  if (!exportId) return;
  const res = await withPlatform(
    { capability: CAP_OPERATE, handeling: "platform.aqlab.audit.verifieer", doelObject: `aqlab_audit_exports:${exportId}` },
    async (svc) => {
      const r = await verifieerAuditExport(svc, exportId);
      return { resultaat: r, effect: { match: r.match } };
    }
  );
  revalidatePath(`${LIJST_PAD}/runs/${runId}`);
  redirect(`${LIJST_PAD}/runs/${runId}?verify=${res.ok ? (res.match ? "match" : "mismatch") : "fout"}`);
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
