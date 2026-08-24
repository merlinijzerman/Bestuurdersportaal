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

import { NextRequest, NextResponse } from "next/server";
import { withMachineRoute, type MachineContext } from "@/platform/lib/machine-route-wrapper";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { draaiIngestWorker } from "@/platform/lib/ingest-orchestrator";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconden; de cron herhaalt tot de queue leeg is.

async function draai(_ctx: MachineContext, req: NextRequest): Promise<NextResponse> {
  try {
    const svc = createServiceSupabase();
    // Werker-id draagt de starttijd zodat het auditspoor invocaties onderscheidt.
    const workerId = `ingest-cron-${Date.now()}`;
    const resultaat = await draaiIngestWorker(svc, {
      workerId,
      oidcToken: req.headers.get("x-vercel-oidc-token"),
    });
    // Heartbeat + telemetrie (F0.1-lijn): één gestructureerde regel per invocatie.
    console.log(JSON.stringify({ tag: "ingest-worker", worker_id: workerId, ...resultaat }));
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (error) {
    return errorResponse("ingest.worker", error);
  }
}

// De DEPLOY_TARGET-skip en de constant-time CRON_SECRET-bearer staan sinds W5b
// in platform/lib/machine-route-wrapper.ts, niet meer in dit bestand. Zelfde
// controle, zelfde volgorde, zelfde responses — alleen op één plek.
const SPEC = { bewaking: "cron-secret", label: "internal.ingest-worker", directeMutaties: [], schema: "geen-body" } as const;

// Vercel Cron gebruikt GET; POST voor handmatige/lokale triggers.
export const GET = withMachineRoute(SPEC, draai);
export const POST = withMachineRoute(SPEC, draai);
