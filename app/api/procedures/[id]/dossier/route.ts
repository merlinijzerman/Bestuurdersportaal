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
import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildDecisionDossierView,
  ensureDecisionForProcedure,
} from "@/lib/decision";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const { decision_id, auto_upgraded } = await ensureDecisionForProcedure(
      supabase,
      id
    );

    const view = await buildDecisionDossierView(supabase, decision_id, {
      autoUpgraded: auto_upgraded,
    });

    return NextResponse.json({ dossier: view });
  } catch (e) {
    console.error("Fout in GET /api/procedures/[id]/dossier:", e);
    const bericht = e instanceof Error ? e.message : "Serverfout";
    const isNotFound = /niet gevonden/i.test(bericht);
    return NextResponse.json(
      { error: bericht },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
