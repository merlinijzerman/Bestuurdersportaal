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
import { createServiceSupabase } from "@/lib/supabase-service";
import { verwerkBatch } from "@/lib/aqlab/run-orchestrator";
import { errorResponse } from "@/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconden; de cron herhaalt tot de queue leeg is.

// Hoeveel batches per invocatie en hoeveel jobs per batch (kostenbewaking +
// blijf binnen maxDuration; een generatie+judge duurt enkele seconden).
const MAX_BATCHES_PER_INVOCATIE = 4;
const JOBS_PER_BATCH = 3;
const LEASE_SECONDS = 180;

function geautoriseerd(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed: geen secret geconfigureerd → geen toegang.
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function draai(req: NextRequest): Promise<NextResponse> {
  if (!geautoriseerd(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
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

// Vercel Cron gebruikt GET; POST voor handmatige/lokale triggers.
export async function GET(req: NextRequest) {
  return draai(req);
}
export async function POST(req: NextRequest) {
  return draai(req);
}
