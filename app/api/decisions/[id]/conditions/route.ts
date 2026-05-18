// POST /api/decisions/[id]/conditions
//
// Voorwaarde bij een (voorwaardelijk) besluit. Met KPI, drempelwaarde,
// monitorfrequentie, deadline en heroverwegingstrigger zodat het
// auditdossier kan tonen waar het besluit aan voldaan moet worden.
//
// Body:
//   {
//     voorwaarde: string,
//     eigenaar_naam?: string | null,
//     kpi?: string | null,
//     drempelwaarde?: string | null,
//     monitorfrequentie?: string | null,
//     deadline?: string | null,                   // ISO date
//     heroverwegingstrigger?: string | null,
//     status?: 'open'|'op_schema'|'afwijking'|'vervuld'|'overschreden'
//   }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const STATUS = [
  "open",
  "op_schema",
  "afwijking",
  "vervuld",
  "overschreden",
] as const;

interface CreateBody {
  voorwaarde?: string;
  eigenaar_naam?: string | null;
  kpi?: string | null;
  drempelwaarde?: string | null;
  monitorfrequentie?: string | null;
  deadline?: string | null;
  heroverwegingstrigger?: string | null;
  status?: (typeof STATUS)[number];
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
    if (
      !body.voorwaarde ||
      typeof body.voorwaarde !== "string" ||
      !body.voorwaarde.trim()
    ) {
      return NextResponse.json(
        { error: "Voorwaarde is verplicht" },
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

    const { data: nieuw, error: insertFout } = await supabase
      .from("decision_conditions")
      .insert({
        decision_id: decisionId,
        voorwaarde: body.voorwaarde.trim(),
        eigenaar_naam: body.eigenaar_naam?.trim() || null,
        kpi: body.kpi?.trim() || null,
        drempelwaarde: body.drempelwaarde?.trim() || null,
        monitorfrequentie: body.monitorfrequentie?.trim() || null,
        deadline: body.deadline ?? null,
        heroverwegingstrigger: body.heroverwegingstrigger?.trim() || null,
        status: body.status ?? "open",
      })
      .select()
      .single();
    if (insertFout || !nieuw) {
      console.error("Voorwaarde aanmaken fout:", insertFout);
      return NextResponse.json(
        { error: "Voorwaarde aanmaken mislukt" },
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
      event_type: "voorwaarde_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      object_type: "condition",
      object_id: nieuw.id,
      nieuwe_waarde: {
        voorwaarde: nieuw.voorwaarde,
        kpi: nieuw.kpi,
        deadline: nieuw.deadline,
        status: nieuw.status,
      },
    });

    return NextResponse.json({ condition: nieuw }, { status: 201 });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/conditions:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
