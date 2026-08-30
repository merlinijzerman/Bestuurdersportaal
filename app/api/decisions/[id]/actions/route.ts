// POST /api/decisions/[id]/actions
//
// Actie die uit een besluit voortvloeit. Optionele koppeling aan een
// voorwaarde (`voorwaarde_id`) als de actie een KPI/voorwaarde
// bewaakt. Afhankelijkheid tussen acties via `afhankelijk_van` is
// schema-toegestaan maar nog niet via de UI bewerkbaar.
//
// Body:
//   {
//     actie: string,
//     eigenaar_id?: string | null,
//     deadline?: string | null,
//     status?: 'open'|'in_behandeling'|'afgerond'|'vervallen'|'escalatie',
//     voorwaarde_id?: string | null,
//     afhankelijk_van?: string | null
//   }

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

const STATUS = [
  "open",
  "in_behandeling",
  "afgerond",
  "vervallen",
  "escalatie",
] as const;

interface CreateBody {
  actie?: string;
  eigenaar_id?: string | null;
  deadline?: string | null;
  status?: (typeof STATUS)[number];
  voorwaarde_id?: string | null;
  afhankelijk_van?: string | null;
}

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "decisions.actions.aanmaken" }, capability: "decisions.manage", schema: z.object({ "actie": z.unknown().optional(), "afhankelijk_van": z.unknown().optional(), "deadline": z.unknown().optional(), "eigenaar_id": z.unknown().optional(), "status": z.unknown().optional(), "voorwaarde_id": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as CreateBody;
    if (!body.actie || typeof body.actie !== "string" || !body.actie.trim()) {
      return NextResponse.json(
        { error: "Actie is verplicht" },
        { status: 400 }
      );
    }
    if (body.status && !STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `Ongeldige status: ${body.status}` },
        { status: 400 }
      );
    }
    if (
      body.eigenaar_id !== undefined &&
      body.eigenaar_id !== null &&
      typeof body.eigenaar_id !== "string"
    ) {
      return NextResponse.json(
        { error: "Ongeldige actie-eigenaar" },
        { status: 400 }
      );
    }

    const { data: decision } = await supabase
      .from("decision_objects")
      .select("id")
      .eq("id", decisionId)
      .maybeSingle();
    if (!decision) {
      return NextResponse.json(
        { error: "Decision Object niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    // Optioneel: valideer dat voorwaarde_id (indien gezet) bij hetzelfde
    // decision hoort — anders rommelen we cross-decision data.
    if (body.voorwaarde_id) {
      const { data: voorw } = await supabase
        .from("decision_conditions")
        .select("id")
        .eq("id", body.voorwaarde_id)
        .eq("decision_id", decisionId)
        .maybeSingle();
      if (!voorw) {
        return NextResponse.json(
          { error: "Voorwaarde niet gevonden of niet bij dit besluit" },
          { status: 400 }
        );
      }
    }

    // `vw_fondsleden` is een smalle, fonds-gescopete profielprojectie. Deze
    // check maakt een actie-eigenaar altijd een bestaand profiel uit hetzelfde
    // fonds; de database-trigger borgt dezelfde invariant buiten de route.
    let eigenaar: { id: string; naam: string | null } | null = null;
    if (body.eigenaar_id) {
      const { data } = await supabase
        .from("vw_fondsleden")
        .select("id, naam")
        .eq("id", body.eigenaar_id)
        .maybeSingle();
      eigenaar = data as { id: string; naam: string | null } | null;
      if (!eigenaar) {
        return NextResponse.json(
          { error: "Eigenaar heeft geen profiel binnen dit fonds" },
          { status: 400 }
        );
      }
    }

    const { data: nieuw, error: insertFout } = await supabase
      .from("decision_actions")
      .insert({
        decision_id: decisionId,
        voorwaarde_id: body.voorwaarde_id ?? null,
        actie: body.actie.trim(),
        eigenaar_id: eigenaar?.id ?? null,
        eigenaar_naam: eigenaar?.naam?.trim() || null,
        deadline: body.deadline ?? null,
        status: body.status ?? "open",
        afhankelijk_van: body.afhankelijk_van ?? null,
      })
      .select()
      .single();
    if (insertFout || !nieuw) {
      console.error("Actie aanmaken fout:", insertFout);
      return NextResponse.json(
        { error: "Actie aanmaken mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "actie_toegevoegd",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      object_type: "action",
      object_id: nieuw.id,
      nieuwe_waarde: {
        actie: nieuw.actie,
        eigenaar_id: nieuw.eigenaar_id,
        eigenaar_naam: nieuw.eigenaar_naam,
        deadline: nieuw.deadline,
        status: nieuw.status,
      },
    });

    return NextResponse.json({ action: nieuw }, { status: 201 });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/actions:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
