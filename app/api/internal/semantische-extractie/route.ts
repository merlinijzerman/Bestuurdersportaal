// app/api/internal/semantische-extractie/route.ts
// -----------------------------------------------------------------------------
// T8 — handmatige/lui enqueue van een semantische-extractie-job voor één document.
// De feitelijke verwerking loopt via de bestaande ingest-worker (die claimt en
// verwerkt óók stap='semantische_extractie'); deze route zet alleen de job weg.
//
// Beveiliging: uitsluitend met de CRON_SECRET (bearer, constant-time). Draait
// ALLEEN in het beheer-project — op de app/publiek-surface (DEPLOY_TARGET=app)
// slaat de route zichzelf over (die heeft de service-role niet). Machine-pad:
// createServiceSupabase, géén usersessie.
//
// T5 roept enqueueSemantischeExtractie server-side direct aan; deze route is de
// handmatige trigger voor test/beheer. Behavior-neutraal als de flag uit staat.
// -----------------------------------------------------------------------------

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { enqueueSemantischeExtractie } from "@/platform/lib/semantische-extractie-job";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function geautoriseerd(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const verwacht = Buffer.from(`Bearer ${secret}`, "utf8");
  const gekregen = Buffer.from(auth, "utf8");
  if (verwacht.length !== gekregen.length) return false;
  return timingSafeEqual(verwacht, gekregen);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.DEPLOY_TARGET === "app") {
    return NextResponse.json({ ok: true, skipped: "deploy_target=app" });
  }
  if (!geautoriseerd(req)) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }
  let documentId: string | undefined;
  try {
    const body = (await req.json()) as { document_id?: unknown };
    documentId = typeof body.document_id === "string" ? body.document_id : undefined;
  } catch {
    documentId = undefined;
  }
  if (!documentId) {
    return NextResponse.json({ error: "document_id ontbreekt" }, { status: 400 });
  }
  try {
    const svc = createServiceSupabase();
    const resultaat = await enqueueSemantischeExtractie(svc, documentId);
    return NextResponse.json({ ok: true, ...resultaat });
  } catch (error) {
    return errorResponse("semantische-extractie.enqueue", error);
  }
}
