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

import { NextRequest, NextResponse } from "next/server";
import { withMachineRoute, type MachineContext } from "@/platform/lib/machine-route-wrapper";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { enqueueSemantischeExtractie } from "@/platform/lib/semantische-extractie-job";
import { errorResponse } from "@/core/lib/api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function draai(_ctx: MachineContext, req: NextRequest): Promise<NextResponse> {
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

// De DEPLOY_TARGET-skip en de constant-time CRON_SECRET-bearer staan sinds W5b
// in platform/lib/machine-route-wrapper.ts, niet meer in dit bestand. Zelfde
// controle, zelfde volgorde, zelfde responses — alleen op één plek.
const SPEC = { bewaking: "cron-secret", label: "internal.semantische-extractie" } as const;

// Alleen POST: dit is de handmatige trigger, geen cron-GET.
export const POST = withMachineRoute(SPEC, draai);
