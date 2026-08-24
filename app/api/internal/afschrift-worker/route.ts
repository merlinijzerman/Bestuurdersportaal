// app/api/internal/afschrift-worker/route.ts
// -----------------------------------------------------------------------------
// T6 — Afschrift-worker (cron). Draint de procedure_afschriften-queue: claimt
// rijen op status='bezig', bouwt de zip (core/lib/afschrift-bundel) en schrijft
// die naar de private 'afschriften'-bucket.
//
// Beveiliging: uitsluitend met CRON_SECRET (bearer, constant-time). Draait ALLEEN
// in het beheer-project (het enige met de service-role, na de variant-C-cutover);
// op de app-surface (DEPLOY_TARGET=app) slaat de worker zichzelf over. Machine-
// pad: createServiceSupabase, géén usersessie (ADR-5, fonds-scope in code).
//
// Idempotent + lease-gebaseerd (claim met FOR UPDATE SKIP LOCKED). Gemodelleerd
// naar app/api/internal/ingest-worker/route.ts.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { withMachineRoute, type MachineContext } from "@/platform/lib/machine-route-wrapper";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { draaiAfschriftWorker } from "@/platform/lib/afschrift-orchestrator";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconden; de cron herhaalt tot de queue leeg is.

async function draai(_ctx: MachineContext, _req: NextRequest): Promise<NextResponse> {
  try {
    const svc = createServiceSupabase();
    const workerId = `afschrift-cron-${Date.now()}`;
    const resultaat = await draaiAfschriftWorker(svc, { workerId });
    console.log(JSON.stringify({ tag: "afschrift-worker", worker_id: workerId, ...resultaat }));
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (error) {
    return errorResponse("afschrift.worker", error);
  }
}

// De DEPLOY_TARGET-skip en de constant-time CRON_SECRET-bearer staan sinds W5b
// in platform/lib/machine-route-wrapper.ts, niet meer in dit bestand. Zelfde
// controle, zelfde volgorde, zelfde responses — alleen op één plek.
const SPEC = { bewaking: "cron-secret", label: "internal.afschrift-worker", directeMutaties: [], schema: "geen-body" } as const;

// Vercel Cron gebruikt GET; POST voor handmatige/lokale triggers.
export const GET = withMachineRoute(SPEC, draai);
export const POST = withMachineRoute(SPEC, draai);
