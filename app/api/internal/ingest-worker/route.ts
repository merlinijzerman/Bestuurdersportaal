// app/api/internal/ingest-worker/route.ts
// -----------------------------------------------------------------------------
// Async ingest-worker — cron-worker (F4). Draint de document_processing_jobs-
// queue voor tenant-ingest: prefix (live of batch) + embedding over de kale
// chunks die de upload-route (F3) heeft ingezet, en rondt het document af.
//
// Beveiliging: uitsluitend aanroepbaar met de CRON_SECRET (bearer, constant-time).
// Draait ALLEEN in het beheer-project — dat is na de variant-C-cutover het enige
// project met de service-role. Op de app/publiek-surface (DEPLOY_TARGET=app) slaat
// de worker zichzelf over (die heeft de service-role niet). Machine-pad: de niet-
// tenant service-role-client (createServiceSupabase), géén usersessie/withPlatform.
//
// Idempotent + lease-gebaseerd: overlappende invocaties zijn veilig (claim met
// FOR UPDATE SKIP LOCKED, `embedding is null` is de voortgang, de lease is de klok).
// -----------------------------------------------------------------------------

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { draaiIngestWorker } from "@/platform/lib/ingest-orchestrator";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconden; de cron herhaalt tot de queue leeg is.

function geautoriseerd(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed: geen secret geconfigureerd → geen toegang.
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  // Constant-time vergelijking (L-02). timingSafeEqual eist gelijke bufferlengtes,
  // vandaar de lengtecheck vooraf — die lekt alleen de lengte, niet de inhoud.
  const verwacht = Buffer.from(`Bearer ${secret}`, "utf8");
  const gekregen = Buffer.from(auth, "utf8");
  if (verwacht.length !== gekregen.length) return false;
  return timingSafeEqual(verwacht, gekregen);
}

async function draai(req: NextRequest): Promise<NextResponse> {
  // Variant C: de cron vuurt in BEIDE Vercel-projecten. De worker hoort alleen in
  // het beheer-project (het enige met de service-role). Skip op de app-surface.
  if (process.env.DEPLOY_TARGET === "app") {
    return NextResponse.json({ ok: true, skipped: "deploy_target=app" });
  }
  if (!geautoriseerd(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  // ── W0.1-PROBE (Route A WP3) — TIJDELIJK, VERWIJDEREN NA HET GO/NO-GO ──────
  // Het hele authenticatiemodel van de WP3-scanner rust erop dat de beheerworker
  // een kortlevend Vercel OIDC-token kan minten. In Vercel Functions arriveert
  // dat token als `x-vercel-oidc-token`-header op de Request — maar of een
  // CRON-invocatie die header draagt, is niet gedocumenteerd. Deze probe stelt
  // dat vast langs het echte cron-pad, zonder gedrag te wijzigen.
  //
  // Logt bewust NOOIT het token zelf. Alleen aanwezigheid, lengte en de
  // niet-geheime claims die we moeten pinnen (iss/aud/sub/owner_id/project_id).
  // De handtekening wordt niet gelezen en niet geverifieerd — dit is een
  // aanwezigheidstest, geen authenticatie.
  try {
    const oidc = req.headers.get("x-vercel-oidc-token");
    let claims: Record<string, unknown> = {};
    if (oidc) {
      const deel = oidc.split(".")[1];
      if (deel) {
        const { iss, aud, sub, owner_id, project_id, environment, exp, iat } = JSON.parse(
          Buffer.from(deel, "base64url").toString("utf8")
        );
        claims = { iss, aud, sub, owner_id, project_id, environment, levensduur_s: exp - iat };
      }
    }
    console.log(
      JSON.stringify({
        tag: "wp3-oidc-probe",
        trigger: req.method === "GET" ? "cron_of_get" : "post",
        aanwezig: Boolean(oidc),
        lengte: oidc?.length ?? 0,
        ...claims,
      })
    );
  } catch {
    console.log(JSON.stringify({ tag: "wp3-oidc-probe", aanwezig: false, fout: "onleesbaar" }));
  }
  // ── EINDE W0.1-PROBE ──────────────────────────────────────────────────────

  try {
    const svc = createServiceSupabase();
    // Werker-id draagt de starttijd zodat het auditspoor invocaties onderscheidt.
    const workerId = `ingest-cron-${Date.now()}`;
    const resultaat = await draaiIngestWorker(svc, { workerId });
    // Heartbeat + telemetrie (F0.1-lijn): één gestructureerde regel per invocatie.
    console.log(JSON.stringify({ tag: "ingest-worker", worker_id: workerId, ...resultaat }));
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (error) {
    return errorResponse("ingest.worker", error);
  }
}

// Vercel Cron gebruikt GET; POST voor handmatige/lokale triggers.
export async function GET(req: NextRequest) {
  return draai(req);
}
export async function POST(req: NextRequest) {
  return draai(req);
}
