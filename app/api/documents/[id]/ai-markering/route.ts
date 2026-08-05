// ============================================================================
//  PATCH /api/documents/[id]/ai-markering — B-6 (T2).
// ----------------------------------------------------------------------------
//  Zet of wist de zelfverklaarde markering `ai_ondersteund_voorbereid` op een
//  document. Zichtbaar voor het bestuur op de agendapuntkaart (ontwerp §7.7): het
//  bestuur weet zo wat het beoordeelt.
//
//  Gate: capability documents.metadata.update (het bureau doet in de praktijk het
//  documentbeheer). Tenant-isolatie via RLS ("documenten update eigen fonds"); de
//  route-check is defense in depth, RLS is de beveiliging.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { requireCapability } from "@/core/lib/capabilities";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) {
      return NextResponse.json({ error: "Ongeldig document-id" }, { status: 400 });
    }

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    if (!(await requireCapability(user.id, "documents.metadata.update"))) {
      return NextResponse.json({ error: "Geen rechten" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { markering?: unknown };
    if (typeof body.markering !== "boolean") {
      return NextResponse.json({ error: "Ongeldige waarde" }, { status: 400 });
    }

    // RLS ("documenten update eigen fonds") begrenst dit tot het eigen fonds.
    const { error } = await supabase
      .from("documenten")
      .update({ ai_ondersteund_voorbereid: body.markering })
      .eq("id", id);

    if (error) {
      console.error("ai-markering update mislukt:", error);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    return NextResponse.json({ ai_ondersteund_voorbereid: body.markering });
  } catch (e) {
    console.error("Fout in PATCH ai-markering:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
