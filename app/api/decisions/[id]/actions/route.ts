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
//     eigenaar_naam?: string | null,
//     deadline?: string | null,
//     status?: 'open'|'in_behandeling'|'afgerond'|'vervallen'|'escalatie',
//     voorwaarde_id?: string | null,
//     afhankelijk_van?: string | null
//   }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const STATUS = [
  "open",
  "in_behandeling",
  "afgerond",
  "vervallen",
  "escalatie",
] as const;

interface CreateBody {
  actie?: string;
  eigenaar_naam?: string | null;
  deadline?: string | null;
  status?: (typeof STATUS)[number];
  voorwaarde_id?: string | null;
  afhankelijk_van?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: decisionId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

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

    const { data: nieuw, error: insertFout } = await supabase
      .from("decision_actions")
      .insert({
        decision_id: decisionId,
        voorwaarde_id: body.voorwaarde_id ?? null,
        actie: body.actie.trim(),
        eigenaar_naam: body.eigenaar_naam?.trim() || null,
        deadline: body.deadline ?? null,
        status: body.status ?? "open",
        afhankelijk_van: body.afhankelijk_van ?? null,
      })
      .select()
      .single();
    if (insertFout || !nieuw) {
      return NextResponse.json(
        { error: insertFout?.message ?? "Actie aanmaken mislukt" },
        { status: 500 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();

    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "actie_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      object_type: "action",
      object_id: nieuw.id,
      nieuwe_waarde: {
        actie: nieuw.actie,
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
}
