// PATCH /api/decisions/[id]/risks/[rid]
//
// Werkt een bestaand besluitrisico bij. Status-wijzigingen krijgen een
// eigen event 'risk_status_gewijzigd'; inhoudelijke wijzigingen
// 'risk_gewijzigd'. Geen hard-delete (audit).

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

type WijzigBody = Partial<{
  beschrijving: string;
  categorie: (typeof RISK_CATEGORIE)[number] | null;
  impact: number | null;
  kans: number | null;
  eigenaar_naam: string | null;
  mitigatie: string | null;
  residual_risk: string | null;
  risicomatrix_id: string | null;
  status: (typeof RISK_STATUS)[number];
}>;

const INHOUDELIJKE_VELDEN: (keyof WijzigBody)[] = [
  "beschrijving",
  "categorie",
  "impact",
  "kans",
  "eigenaar_naam",
  "mitigatie",
  "residual_risk",
  "risicomatrix_id",
];

function isGeldigeKi(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rid: string }> }
) {
  try {
    const { id: decisionId, rid } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as WijzigBody;

    if (
      body.categorie !== undefined &&
      body.categorie !== null &&
      !RISK_CATEGORIE.includes(body.categorie)
    ) {
      return NextResponse.json(
        { error: `Ongeldige categorie: ${body.categorie}` },
        { status: 400 }
      );
    }
    if (body.status !== undefined && !RISK_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `Ongeldige status: ${body.status}` },
        { status: 400 }
      );
    }
    if (
      body.impact !== undefined &&
      body.impact !== null &&
      !isGeldigeKi(body.impact)
    ) {
      return NextResponse.json(
        { error: "Impact moet 1 t/m 5 zijn" },
        { status: 400 }
      );
    }
    if (
      body.kans !== undefined &&
      body.kans !== null &&
      !isGeldigeKi(body.kans)
    ) {
      return NextResponse.json(
        { error: "Kans moet 1 t/m 5 zijn" },
        { status: 400 }
      );
    }

    const { data: huidig, error: leesFout } = await supabase
      .from("decision_risks")
      .select("*")
      .eq("id", rid)
      .eq("decision_id", decisionId)
      .maybeSingle();
    if (leesFout || !huidig) {
      return NextResponse.json(
        { error: "Risico niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    const wijzigingen: Record<string, unknown> = {};
    const oudeWaarden: Record<string, unknown> = {};
    const nieuweWaarden: Record<string, unknown> = {};
    const inhoudelijkGewijzigd: string[] = [];
    let statusGewijzigd = false;

    for (const veld of INHOUDELIJKE_VELDEN) {
      if (body[veld] === undefined) continue;
      let nieuw: unknown = body[veld];
      // Strings die alleen whitespace zijn → null.
      if (
        veld === "beschrijving" ||
        veld === "eigenaar_naam" ||
        veld === "mitigatie" ||
        veld === "residual_risk"
      ) {
        nieuw = typeof nieuw === "string" ? nieuw.trim() || null : nieuw;
      }
      const oud = (huidig as Record<string, unknown>)[veld];
      if (nieuw === oud) continue;
      if (veld === "beschrijving" && (!nieuw || typeof nieuw !== "string")) {
        return NextResponse.json(
          { error: "Beschrijving mag niet leeg zijn" },
          { status: 400 }
        );
      }
      wijzigingen[veld] = nieuw;
      oudeWaarden[veld] = oud;
      nieuweWaarden[veld] = nieuw;
      inhoudelijkGewijzigd.push(veld);
    }

    if (body.status !== undefined && body.status !== huidig.status) {
      wijzigingen.status = body.status;
      oudeWaarden.status = huidig.status;
      nieuweWaarden.status = body.status;
      statusGewijzigd = true;
    }

    if (Object.keys(wijzigingen).length === 0) {
      return NextResponse.json({ risk: huidig, gewijzigd: false });
    }

    const { data: bijgewerkt, error: updFout } = await supabase
      .from("decision_risks")
      .update(wijzigingen)
      .eq("id", rid)
      .select()
      .single();
    if (updFout || !bijgewerkt) {
      console.error("Decision-risk wijzigen fout:", updFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();
    const actorNaam = profiel?.naam ?? null;

    if (inhoudelijkGewijzigd.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "risk_gewijzigd",
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "risk",
        object_id: rid,
        oude_waarde: Object.fromEntries(
          inhoudelijkGewijzigd.map((k) => [k, oudeWaarden[k]])
        ),
        nieuwe_waarde: Object.fromEntries(
          inhoudelijkGewijzigd.map((k) => [k, nieuweWaarden[k]])
        ),
      });
    }

    if (statusGewijzigd) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "risk_status_gewijzigd",
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "risk",
        object_id: rid,
        oude_waarde: { status: oudeWaarden.status },
        nieuwe_waarde: { status: nieuweWaarden.status },
      });
    }

    return NextResponse.json({ risk: bijgewerkt, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]/risks/[rid]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
