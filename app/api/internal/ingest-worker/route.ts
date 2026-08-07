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
