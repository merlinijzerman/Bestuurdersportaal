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

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
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

function geautoriseerd(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed: geen secret geconfigureerd → geen toegang.
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  // L-02 (review 2026-07-30): constant-time vergelijking. Over HTTP is een
  // timing-side-channel praktisch niet exploiteerbaar (netwerkjitter ≫ het
  // verschil), maar `===` op een secret is hygiëne die je niet wilt uitleggen
  // in een securityreview. timingSafeEqual eist gelijke bufferlengtes, vandaar
  // de lengtecheck vooraf — die lekt alleen de lengte, niet de inhoud.
  const verwacht = Buffer.from(`Bearer ${secret}`, "utf8");
  const gekregen = Buffer.from(auth, "utf8");
  if (verwacht.length !== gekregen.length) return false;
  return timingSafeEqual(verwacht, gekregen);
}

async function draai(req: NextRequest): Promise<NextResponse> {
  // Fase B (variant C): de cron staat in vercel.json en vuurt in BEIDE Vercel-
  // projecten. De worker hoort alleen in het beheer-project — dat is het enige
  // project met de service-role. Skip expliciet op de gedeelde app/publiek-surface
  // (die heeft de service-role niet meer). Zonder DEPLOY_TARGET (huidige enkel-
  // project) draait hij gewoon door (backward-compat).
  if (process.env.DEPLOY_TARGET === "app") {
    return NextResponse.json({ ok: true, skipped: "deploy_target=app" });
  }
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
