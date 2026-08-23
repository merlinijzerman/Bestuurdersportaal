import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

// Per-proces fase-toelichting (WO-2-vervolg). Upsert op (procedure_id, fase_code).
// Server-side gegate op voorzitter/beheerder; fonds_id wordt server-side
// afgeleid (nooit uit de request). De RLS-policy op procedure_fase_toelichting
// dwingt hetzelfde af (defense-in-depth).
export const POST = withFondsRoute({ capability: "TE_BEPALEN" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      fase_code?: string;
      toelichting?: string | null;
    };
    const faseCode = body.fase_code?.trim();
    if (!faseCode) {
      return NextResponse.json(
        { error: "fase_code is verplicht" },
        { status: 400 }
      );
    }

    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een fase-toelichting bewerken" },
        { status: 403 }
      );
    }

    // Verifieer dat de procedure van het eigen fonds is (RLS scoping-check).
    const { data: procedure } = await supabase
      .from("procedures")
      .select("id, fonds_id")
      .eq("id", id)
      .single();
    if (!procedure || procedure.fonds_id !== ctx.fondsId) {
      return NextResponse.json(
        { error: "Procedure hoort niet bij dit fonds" },
        { status: 400 }
      );
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

    const { error: upsertFout } = await supabase
      .from("procedure_fase_toelichting")
      .upsert(
        {
          procedure_id: id,
          fase_code: faseCode,
          toelichting,
          fonds_id: procedure.fonds_id,
          aangepast_door: ctx.gebruikerId,
          aangepast_op: new Date().toISOString(),
        },
        { onConflict: "procedure_id,fase_code" }
      );
    if (upsertFout) {
      console.error("Fase-toelichting upsert fout:", upsertFout);
      return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "fase_toelichting_bijgewerkt",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { fase_code: faseCode, leeg: toelichting === null },
    });

    return NextResponse.json({ ok: true, toelichting });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/fase-toelichting:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
