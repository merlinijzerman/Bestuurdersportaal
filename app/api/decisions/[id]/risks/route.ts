// POST /api/decisions/[id]/risks
//
// Maakt een nieuw besluitrisico aan (decision_risks). Dit is een risico
// dat hoort bij dít besluit — los van de fonds-brede risicomatrix, maar
// met optionele `risicomatrix_id` voor verwijzing daarheen. Logt
// 'risk_toegevoegd' in governance_events.
//
// Body:
//   {
//     beschrijving: string,
//     categorie?: 'financieel'|'operationeel'|'juridisch'|'reputatie'|'liquiditeit'|'compliance'|'overig',
//     impact?: number (1-5),
//     kans?: number (1-5),
//     eigenaar_naam?: string | null,
//     mitigatie?: string | null,
//     residual_risk?: string | null,
//     risicomatrix_id?: string | null,
//     status?: 'open'|'gemitigeerd'|'geaccepteerd'   // default 'open'
//   }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const RISK_CATEGORIE = [
  "financieel",
  "operationeel",
  "juridisch",
  "reputatie",
  "liquiditeit",
  "compliance",
  "overig",
] as const;

const RISK_STATUS = ["open", "gemitigeerd", "geaccepteerd"] as const;

interface CreateBody {
  beschrijving?: string;
  categorie?: (typeof RISK_CATEGORIE)[number];
  impact?: number | null;
  kans?: number | null;
  eigenaar_naam?: string | null;
  mitigatie?: string | null;
  residual_risk?: string | null;
  risicomatrix_id?: string | null;
  status?: (typeof RISK_STATUS)[number];
}

function isGeldigeKi(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
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
      !body.beschrijving ||
      typeof body.beschrijving !== "string" ||
      !body.beschrijving.trim()
    ) {
      return NextResponse.json(
        { error: "Beschrijving is verplicht" },
        { status: 400 }
      );
    }
    if (body.categorie && !RISK_CATEGORIE.includes(body.categorie)) {
      return NextResponse.json(
        { error: `Ongeldige categorie: ${body.categorie}` },
        { status: 400 }
      );
    }
    if (body.status && !RISK_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `Ongeldige status: ${body.status}` },
        { status: 400 }
      );
    }
    if (body.impact !== undefined && body.impact !== null && !isGeldigeKi(body.impact)) {
      return NextResponse.json(
        { error: "Impact moet een geheel getal van 1 t/m 5 zijn" },
        { status: 400 }
      );
    }
    if (body.kans !== undefined && body.kans !== null && !isGeldigeKi(body.kans)) {
      return NextResponse.json(
        { error: "Kans moet een geheel getal van 1 t/m 5 zijn" },
        { status: 400 }
      );
    }

    // Decision-bestaan + RLS-check.
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
      .from("decision_risks")
      .insert({
        decision_id: decisionId,
        beschrijving: body.beschrijving.trim(),
        categorie: body.categorie ?? null,
        impact: body.impact ?? null,
        kans: body.kans ?? null,
        eigenaar_naam: body.eigenaar_naam?.trim() || null,
        mitigatie: body.mitigatie?.trim() || null,
        residual_risk: body.residual_risk?.trim() || null,
        risicomatrix_id: body.risicomatrix_id ?? null,
        status: body.status ?? "open",
      })
      .select()
      .single();

    if (insertFout || !nieuw) {
      console.error("Decision-risk aanmaken fout:", insertFout);
      return NextResponse.json(
        { error: "Risico aanmaken mislukt" },
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
      event_type: "risk_toegevoegd",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      object_type: "risk",
      object_id: nieuw.id,
      nieuwe_waarde: {
        beschrijving: nieuw.beschrijving,
        categorie: nieuw.categorie,
        impact: nieuw.impact,
        kans: nieuw.kans,
        status: nieuw.status,
      },
    });

    return NextResponse.json({ risk: nieuw }, { status: 201 });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/risks:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
