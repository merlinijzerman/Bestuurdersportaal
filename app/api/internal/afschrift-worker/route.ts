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

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { draaiAfschriftWorker } from "@/platform/lib/afschrift-orchestrator";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconden; de cron herhaalt tot de queue leeg is.

function geautoriseerd(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed: geen secret → geen toegang.
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const verwacht = Buffer.from(`Bearer ${secret}`, "utf8");
  const gekregen = Buffer.from(auth, "utf8");
  if (verwacht.length !== gekregen.length) return false;
  return timingSafeEqual(verwacht, gekregen);
}

async function draai(req: NextRequest): Promise<NextResponse> {
  // Variant C: de cron vuurt in beide Vercel-projecten. De worker hoort alleen in
  // het beheer-project (het enige met de service-role). Skip op de app-surface.
  if (process.env.DEPLOY_TARGET === "app") {
    return NextResponse.json({ ok: true, skipped: "deploy_target=app" });
  }
  if (!geautoriseerd(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
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

export async function GET(req: NextRequest) {
  return draai(req);
}
export async function POST(req: NextRequest) {
  return draai(req);
}
