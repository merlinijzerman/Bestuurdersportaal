import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";

// Fasebeschrijving-override (WO-3, D8) — de generieke, per fonds
// overschrijfbare beschrijving van een fase (`procedure_fase_beschrijving_override`,
// gesleuteld op template_code+fase_code+fonds_id). Server-side gegate op
// voorzitter/beheerder; template_code en fonds_id worden server-side uit de
// procedure afgeleid (nooit uit de request). De RLS-policies op de tabel
// (WO-1/D8) dwingen hetzelfde af (defense-in-depth).
//
// Leeg opslaan verwijdert de override → de fase valt terug op de gedeelde
// generieke beschrijving (fail-safe leeslogica in `mergeFasen`). De mutatie is
// fonds-config maar wordt per-procedure append-only gelogd in `procedure_log`,
// zodat ze in dezelfde audit-trail zichtbaar is als de fase-toelichting.
export async function POST(
  req: NextRequest,
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

    const body = (await req.json()) as {
      fase_code?: string;
      beschrijving?: string | null;
    };
    const faseCode = body.fase_code?.trim();
    if (!faseCode) {
      return NextResponse.json(
        { error: "fase_code is verplicht" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id, naam, rol")
      .eq("id", user.id)
      .single();
    if (!["voorzitter", "beheerder"].includes(profiel?.rol ?? "")) {
      return NextResponse.json(
        {
          error:
            "Alleen voorzitter of beheerder kan een fasebeschrijving bewerken",
        },
        { status: 403 }
      );
    }

    // Template_code + fonds_id server-side afleiden uit de procedure (RLS-scope).
    const { data: procedure } = await supabase
      .from("procedures")
      .select("id, fonds_id, template_code")
      .eq("id", id)
      .single();
    if (!procedure || procedure.fonds_id !== profiel?.fonds_id) {
      return NextResponse.json(
        { error: "Procedure hoort niet bij dit fonds" },
        { status: 400 }
      );
    }

    const beschrijving =
      typeof body.beschrijving === "string" && body.beschrijving.trim().length > 0
        ? body.beschrijving.trim()
        : null;
    if (beschrijving && beschrijving.length > 4000) {
      return NextResponse.json(
        { error: "Beschrijving is te lang (max. 4000 tekens)" },
        { status: 400 }
      );
    }

    // Leeg opslaan wist de override zónder DELETE: de tabel heeft DELETE
    // gerevoket (D8-migratie) en de kolom is `not null`, dus we upserten een
    // lege string. `mergeFasen` (procedure-fasen.ts) telt een lege/whitespace
    // override niet mee → de fase valt fail-safe terug op de generieke default.
    const teBewaren = beschrijving ?? "";
    const { error: upsertFout } = await supabase
      .from("procedure_fase_beschrijving_override")
      .upsert(
        {
          template_code: procedure.template_code,
          fase_code: faseCode,
          fonds_id: procedure.fonds_id,
          beschrijving: teBewaren,
          aangepast_door: user.id,
          aangepast_op: new Date().toISOString(),
        },
        { onConflict: "template_code,fase_code,fonds_id" }
      );
    if (upsertFout) {
      console.error("Fasebeschrijving-override upsert fout:", upsertFout);
      return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "fase_beschrijving_bijgewerkt",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { fase_code: faseCode, leeg: beschrijving === null },
    });

    return NextResponse.json({ ok: true, beschrijving });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/fase-beschrijving:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
