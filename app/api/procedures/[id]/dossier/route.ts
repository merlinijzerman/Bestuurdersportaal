// GET /api/procedures/[id]/dossier
//
// Levert het Decision Dossier-zicht voor een procedure. Als de procedure
// nog geen Decision Object heeft, wordt er via `ensureDecisionForProcedure`
// lazy eentje aangemaakt — dit is het auto-upgrade-pad voor bestaande
// procedures (zie `PROCEDURE-MVP1-ONTWERP.md` sectie 8).
//
// Returnt hetzelfde shape als `/api/decisions/[id]/dossier`, met `auto_upgraded`
// op true als er nu een nieuw Decision Object is aangemaakt.

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { errorResponse } from "@/core/lib/api-errors";
import {
  buildDecisionDossierView,
  ensureDecisionForProcedure,
} from "@/core/lib/decision";

export const GET = withFondsRoute({ capability: "procedures.view" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const { decision_id, auto_upgraded } = await ensureDecisionForProcedure(
      supabase,
      id
    );

    const view = await buildDecisionDossierView(supabase, decision_id, {
      autoUpgraded: auto_upgraded,
    });

    return NextResponse.json({ dossier: view });
  } catch (e) {
    // M-13 (review 2026-07-30) — zie decisions/[id]/dossier: de ruwe
    // foutmelding lekte schema- en id-informatie naar de client.
    const intern = e instanceof Error ? e.message : "";
    const isNotFound = /niet gevonden/i.test(intern);
    return errorResponse("procedures.dossier.GET", e, {
      status: isNotFound ? 404 : 500,
      userMessage: isNotFound
        ? "Dit dossier is niet gevonden of u heeft er geen toegang toe."
        : undefined,
    });
  }
});
