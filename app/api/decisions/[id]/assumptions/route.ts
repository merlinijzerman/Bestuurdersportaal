// POST /api/decisions/[id]/assumptions
//
// Maakt een nieuwe gestructureerde aanname aan (decision_assumptions)
// en logt een governance_event 'assumption_toegevoegd'. RLS bewaakt
// fonds-isolatie via de decision_id-keten.
//
// Body:
//   {
//     tekst: string,
//     type?: 'macro'|'beleggingsinhoudelijk'|'risico'|'kosten'|'governance'|'overig',
//     bron_document_id?: string | null,
//     onzekerheid?: 'laag'|'middel'|'hoog' | null,
//     evaluatiecriterium?: string | null,
//     ai_gedetecteerd?: boolean,
//     status?: 'concept'|'gevalideerd'|'gewijzigd' (verwijderd is alleen via PATCH)
//   }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const ASSUMPTION_TYPES = [
  "macro",
  "beleggingsinhoudelijk",
  "risico",
  "kosten",
  "governance",
  "overig",
] as const;

const ASSUMPTION_STATUS_BIJ_AANMAKEN = [
  "concept",
  "gevalideerd",
  "gewijzigd",
] as const;

const ONZEKERHEID = ["laag", "middel", "hoog"] as const;

interface CreateBody {
  tekst?: string;
  type?: (typeof ASSUMPTION_TYPES)[number];
  bron_document_id?: string | null;
  onzekerheid?: (typeof ONZEKERHEID)[number] | null;
  evaluatiecriterium?: string | null;
  ai_gedetecteerd?: boolean;
  status?: (typeof ASSUMPTION_STATUS_BIJ_AANMAKEN)[number];
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

    if (!body.tekst || typeof body.tekst !== "string" || !body.tekst.trim()) {
      return NextResponse.json(
        { error: "Tekst is verplicht" },
        { status: 400 }
      );
    }

    if (body.type && !ASSUMPTION_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `Ongeldig type: ${body.type}` },
        { status: 400 }
      );
    }

    if (
      body.status &&
      !ASSUMPTION_STATUS_BIJ_AANMAKEN.includes(body.status)
    ) {
      return NextResponse.json(
        { error: `Status '${body.status}' niet toegestaan bij aanmaken` },
        { status: 400 }
      );
    }

    if (body.onzekerheid && !ONZEKERHEID.includes(body.onzekerheid)) {
      return NextResponse.json(
        { error: `Ongeldige onzekerheid: ${body.onzekerheid}` },
        { status: 400 }
      );
    }

    // RLS-check: decision-bestaan + fonds-koppeling. Als de gebruiker geen
    // toegang heeft tot deze decision is `data` null en gooien we 404.
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
      .from("decision_assumptions")
      .insert({
        decision_id: decisionId,
        tekst: body.tekst.trim(),
        type: body.type ?? "overig",
        bron_document_id: body.bron_document_id ?? null,
        ai_gedetecteerd: body.ai_gedetecteerd ?? false,
        status: body.status ?? "concept",
        onzekerheid: body.onzekerheid ?? null,
        evaluatiecriterium: body.evaluatiecriterium?.trim() || null,
        gewijzigd_door: user.id,
      })
      .select()
      .single();

    if (insertFout || !nieuw) {
      return NextResponse.json(
        { error: insertFout?.message ?? "Aanname aanmaken mislukt" },
        { status: 500 }
      );
    }

    // Actor-naam voor het event.
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();

    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "assumption_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      object_type: "assumption",
      object_id: nieuw.id,
      nieuwe_waarde: {
        tekst: nieuw.tekst,
        type: nieuw.type,
        status: nieuw.status,
        ai_gedetecteerd: nieuw.ai_gedetecteerd,
      },
    });

    return NextResponse.json({ assumption: nieuw }, { status: 201 });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/assumptions:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
