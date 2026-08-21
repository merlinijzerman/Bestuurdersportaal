// GET /api/decisions/[id]/dossier
//
// Levert de volledige `DecisionDossierView` voor een Decision Object.
// RLS in Supabase doet de tenant-/rolfiltering; deze route bouwt de
// samengestelde view en voegt readiness, evidence en snapshots-meta toe.
//
// Voor toegang via procedure-id (met lazy auto-upgrade) zie de
// parallele route `/api/procedures/[id]/dossier`.

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { buildDecisionDossierView } from "@/core/lib/decision";
import { errorResponse } from "@/core/lib/api-errors";

export const GET = withFondsRoute({}, async (ctx, _req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const view = await buildDecisionDossierView(supabase, id, {
      autoUpgraded: false,
    });

    return NextResponse.json({ dossier: view });
  } catch (e) {
    // M-13 (review 2026-07-30): `e.message` bevatte ruwe PostgREST-meldingen én
    // interne UUID's en ging rechtstreeks naar de client. Daarmee kon een
    // gebruiker met een uuid van een ANDER fonds bestaan/niet-bestaan
    // bevestigen en het schema in kaart brengen — RLS voorkomt het datalek,
    // niet het metadatalek. De melding blijft nu server-side; alleen de
    // STATUS wordt nog uit de foutmelding afgeleid.
    const intern = e instanceof Error ? e.message : "";
    const isNotFound = /niet gevonden/i.test(intern);
    return errorResponse("decisions.dossier.GET", e, {
      status: isNotFound ? 404 : 500,
      userMessage: isNotFound
        ? "Dit dossier is niet gevonden of u heeft er geen toegang toe."
        : undefined,
    });
  }
});
