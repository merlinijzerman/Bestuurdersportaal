// app/api/aqlab/worker/route.ts
// -----------------------------------------------------------------------------
// AQLab — cron-worker (AQL-2, spike 2). Draint de aqlab_run_jobs-queue.
//
// Beveiliging: uitsluitend aanroepbaar met de CRON_SECRET (bearer). Vercel Cron
// stuurt automatisch `Authorization: Bearer $CRON_SECRET` mee (zie vercel.json).
// Machine-pad: gebruikt de niet-tenant service-role-client (lib/supabase-service),
// géén usersessie/withPlatform (analoog aan het seed-pad). De user-gestuurde
// "run starten"-actie loopt wél via withPlatform (platform.aqlab.operate).
//
// Werkt in begrensde batches binnen één invocatie (maxDuration); de cron roept
// elke minuut opnieuw aan tot de queue leeg is. Idempotent + lease-gebaseerd, dus
// overlappende invocaties zijn veilig.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { withMachineRoute, type MachineContext } from "@/platform/lib/machine-route-wrapper";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { verwerkBatch } from "@/platform/lib/aqlab/run-orchestrator";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconden; de cron herhaalt tot de queue leeg is.

// Hoeveel batches per invocatie en hoeveel jobs per batch (kostenbewaking +
// blijf binnen maxDuration; een generatie+judge duurt enkele seconden).
const MAX_BATCHES_PER_INVOCATIE = 4;
const JOBS_PER_BATCH = 3;
const LEASE_SECONDS = 180;

async function draai(_ctx: MachineContext, _req: NextRequest): Promise<NextResponse> {
  try {
    const svc = createServiceSupabase();
    const workerId = `cron-${Date.now()}`;
    let totaalVerwerkt = 0;
    const afgerond = new Set<string>();
    for (let i = 0; i < MAX_BATCHES_PER_INVOCATIE; i++) {
      const r = await verwerkBatch(svc, {
        workerId,
        limiet: JOBS_PER_BATCH,
        leaseSeconds: LEASE_SECONDS,
        judgeEnabled: true,
      });
      totaalVerwerkt += r.verwerkt;
      r.afgerond.forEach((id) => afgerond.add(id));
      if (r.verwerkt === 0) break; // queue leeg voor nu.
    }
    return NextResponse.json({
      ok: true,
      verwerkt: totaalVerwerkt,
      runs_afgerond: [...afgerond],
    });
  } catch (error) {
    return errorResponse("aqlab.worker", error);
  }
}

// De DEPLOY_TARGET-skip en de constant-time CRON_SECRET-bearer staan sinds W5b
// in platform/lib/machine-route-wrapper.ts, niet meer in dit bestand. Zelfde
// controle, zelfde volgorde, zelfde responses — alleen op één plek.
const SPEC = { rateLimit: "geen", audit: "geen", bewaking: "cron-secret", label: "aqlab.worker", directeMutaties: [], schema: "geen-body" } as const;

// Vercel Cron gebruikt GET; POST voor handmatige/lokale triggers.
export const GET = withMachineRoute(SPEC, draai);
export const POST = withMachineRoute(SPEC, draai);
