// ============================================================
//  PATCH /api/notificaties/[id]/lezen — Iteratie 3-A
//
//  Markeer één notificatie als gelezen. Idempotent — als de
//  notificatie al gelezen is, wordt `gelezen_op` niet overschreven.
//
//  RLS zorgt dat je alleen je eigen notificaties kunt updaten.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function PATCH(
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

    // Idempotent: alleen `gelezen_op` zetten als hij nog null is.
    const { data, error } = await supabase
      .from("notificaties")
      .update({ gelezen_op: new Date().toISOString() })
      .eq("id", id)
      .is("gelezen_op", null)
      .select()
      .maybeSingle();

    if (error) {
      console.error("Notificatie als gelezen markeren fout:", error);
      return NextResponse.json({ error: "Markering mislukt" }, { status: 500 });
    }

    // `data === null` betekent: rij bestond niet (of was al gelezen of
    // hoort niet bij deze gebruiker). Geen fout — gewoon ok.
    return NextResponse.json({ ok: true, geupdatet: data !== null });
  } catch (e) {
    console.error("Fout in PATCH /api/notificaties/[id]/lezen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
