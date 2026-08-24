// ============================================================
//  POST /api/notificaties/alles-lezen — Iteratie 3-A
//
//  Markeer alle ongelezen notificaties van de huidige gebruiker
//  in één keer als gelezen. RLS doet het werk: alleen eigen rijen.
// ============================================================

import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

export const POST = withFondsRoute({ capability: "notificaties.manage.own", schema: "geen-body" }, async (ctx) => {
  try {
    const supabase = ctx.supabase;

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
});
