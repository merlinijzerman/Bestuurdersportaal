import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";

// Stap-toelichting (WO-3) — de bestuurlijke toelichting onder de staptitel.
// Slaat op in de bestaande kolom `procedure_stappen.beschrijving` (per-proces
// snapshot; pure content, raakt checklist/bewijslast/activatie niet). Server-side
// gegate op voorzitter/beheerder; de procedure-koppeling wordt geverifieerd en
// de mutatie append-only gelogd in `procedure_log`.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stapId: string }> }
) {
  try {
    const { id, stapId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as { toelichting?: string | null };

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, naam, rol")
      .eq("id", user.id)
      .single();
    if (!["voorzitter", "beheerder"].includes(profiel?.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan de toelichting bewerken" },
        { status: 403 }
      );
    }

    // Defense-in-depth: verifieer dat de procedure van het eigen fonds is
    // (naast de RLS op procedure_stappen), consistent met de fase-routes.
    const { data: procedure } = await supabase
      .from("procedures")
      .select("id, fonds_id")
      .eq("id", id)
      .single();
    if (!procedure || procedure.fonds_id !== profiel?.fonds_id) {
      return NextResponse.json(
        { error: "Procedure hoort niet bij dit fonds" },
        { status: 400 }
      );
    }

    // Stap moet bij deze procedure horen (RLS scoping-check).
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("id, naam, procedure_id")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json({ error: "Stap niet gevonden" }, { status: 404 });
    }

    const toelichting =
      typeof body.toelichting === "string" && body.toelichting.trim().length > 0
        ? body.toelichting.trim()
        : null;
    if (toelichting && toelichting.length > 4000) {
      return NextResponse.json(
        { error: "Toelichting is te lang (max. 4000 tekens)" },
        { status: 400 }
      );
    }

    const { error: updateFout } = await supabase
      .from("procedure_stappen")
      .update({ beschrijving: toelichting })
      .eq("id", stapId)
      .eq("procedure_id", id);
    if (updateFout) {
      console.error("Stap-toelichting update fout:", updateFout);
      return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "stap_toelichting_bijgewerkt",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { stap: stap.naam, leeg: toelichting === null },
    });

    return NextResponse.json({ ok: true, toelichting });
  } catch (e) {
    console.error(
      "Fout in POST /api/procedures/[id]/stappen/[stapId]/toelichting:",
      e
    );
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
