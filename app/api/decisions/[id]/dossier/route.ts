// GET /api/decisions/[id]/dossier
//
// Levert de volledige `DecisionDossierView` voor een Decision Object.
// RLS in Supabase doet de tenant-/rolfiltering; deze route bouwt de
// samengestelde view en voegt readiness, evidence en snapshots-meta toe.
//
// Voor toegang via procedure-id (met lazy auto-upgrade) zie de
// parallele route `/api/procedures/[id]/dossier`.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { buildDecisionDossierView } from "@/lib/decision";

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

    const view = await buildDecisionDossierView(supabase, id, {
      autoUpgraded: false,
    });

    return NextResponse.json({ dossier: view });
  } catch (e) {
    console.error("Fout in GET /api/decisions/[id]/dossier:", e);
    const bericht = e instanceof Error ? e.message : "Serverfout";
    const isNotFound = /niet gevonden/i.test(bericht);
    return NextResponse.json(
      { error: bericht },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
