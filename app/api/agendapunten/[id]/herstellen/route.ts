import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

// ============================================================
//  POST /api/agendapunten/[id]/herstellen
//  Maakt een soft-deleted agendapunt weer actief.
//  Rechten: voorzitter + beheerder (niet de eigenaar zelf —
//  herstel hoort via overleg met de voorzitter).
//  Logt een 'agendapunt_hersteld'-event in agendapunt_log.
//
//  W2: auth-preamble via withFondsRoute v1 (de naad). Gedrag ongewijzigd — de
//  wrapper levert user + rol via ctx; de 404/400-checks, de rolgate en de
//  auditlog blijven exact in de route staan (audit is deploy 3, niet v1).
// ============================================================
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "agendapunten.herstellen" }, capability: "agendapunten.manage", schema: "geen-body" }, async (ctx, _req, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select("id, verwijderd_op")
      .eq("id", id)
      .maybeSingle();

    if (!agendapunt) {
      return NextResponse.json({ error: "Agendapunt niet gevonden" }, { status: 404 });
    }

    if (!(agendapunt as { verwijderd_op: string | null }).verwijderd_op) {
      return NextResponse.json(
        { error: "Agendapunt is niet verwijderd; herstellen niet van toepassing" },
        { status: 400 }
      );
    }

    // Rol komt uit de wrapper-context (haalProfiel). De rolgate blijft in de
    // route — capability-/rolmodel is deploy 3, niet v1.
    const rol = ctx.rol;
    if (rol !== "voorzitter" && rol !== "beheerder") {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder mag een agendapunt herstellen" },
        { status: 403 }
      );
    }

    const { data: updated, error: updFout } = await supabase
      .from("agendapunten")
      .update({
        verwijderd_op: null,
        verwijderd_door: null,
        verwijder_reden: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (updFout) {
      console.error("Herstel agendapunt fout:", updFout);
      return NextResponse.json({ error: "Herstellen mislukt" }, { status: 500 });
    }

    await supabase.from("agendapunt_log").insert({
      agendapunt_id: id,
      event_type: "agendapunt_hersteld",
      actor_id: ctx.gebruikerId,
      payload: {},
    });

    return NextResponse.json({ agendapunt: updated });
  } catch (e) {
    console.error("Fout in POST /api/agendapunten/[id]/herstellen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
