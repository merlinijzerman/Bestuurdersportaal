// ============================================================
//  POST /api/notificaties/alles-lezen — Iteratie 3-A
//
//  Markeer alle ongelezen notificaties van de huidige gebruiker
//  in één keer als gelezen. RLS doet het werk: alleen eigen rijen.
// ============================================================

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function POST() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const { error, count } = await supabase
      .from("notificaties")
      .update({ gelezen_op: new Date().toISOString() }, { count: "exact" })
      .is("gelezen_op", null);

    if (error) {
      console.error("Bulk-als-gelezen markeren fout:", error);
      return NextResponse.json({ error: "Markering mislukt" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, aantal_gewijzigd: count ?? 0 });
  } catch (e) {
    console.error("Fout in POST /api/notificaties/alles-lezen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
