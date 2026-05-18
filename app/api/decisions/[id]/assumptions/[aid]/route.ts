// PATCH /api/decisions/[id]/assumptions/[aid]
//
// Werkt een bestaande aanname bij. Wijzigingen worden gediffd; status-
// wijzigingen krijgen een eigen event 'assumption_status_gewijzigd',
// inhoudelijke wijzigingen 'assumption_gewijzigd'. Voor "verwijderen"
// gebruiken we soft-delete via status='verwijderd' zodat het audit-spoor
// behouden blijft. Hard delete is niet toegestaan.
//
// Body — alle velden optioneel:
//   {
//     tekst?: string,
//     type?: 'macro'|'beleggingsinhoudelijk'|'risico'|'kosten'|'governance'|'overig',
//     bron_document_id?: string | null,
//     onzekerheid?: 'laag'|'middel'|'hoog' | null,
//     evaluatiecriterium?: string | null,
//     ai_gedetecteerd?: boolean,
//     status?: 'concept'|'gevalideerd'|'gewijzigd'|'verwijderd'
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

const ASSUMPTION_STATUS = [
  "concept",
  "gevalideerd",
  "gewijzigd",
  "verwijderd",
] as const;

const ONZEKERHEID = ["laag", "middel", "hoog"] as const;

type WijzigBody = Partial<{
  tekst: string;
  type: (typeof ASSUMPTION_TYPES)[number];
  bron_document_id: string | null;
  onzekerheid: (typeof ONZEKERHEID)[number] | null;
  evaluatiecriterium: string | null;
  ai_gedetecteerd: boolean;
  status: (typeof ASSUMPTION_STATUS)[number];
}>;

const INHOUDELIJKE_VELDEN: (keyof WijzigBody)[] = [
  "tekst",
  "type",
  "bron_document_id",
  "onzekerheid",
  "evaluatiecriterium",
  "ai_gedetecteerd",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> }
) {
  try {
    const { id: decisionId, aid } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as WijzigBody;

    // Validatie van enums.
    if (body.type && !ASSUMPTION_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `Ongeldig type: ${body.type}` },
        { status: 400 }
      );
    }
    if (body.status && !ASSUMPTION_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `Ongeldige status: ${body.status}` },
        { status: 400 }
      );
    }
    if (body.onzekerheid && !ONZEKERHEID.includes(body.onzekerheid)) {
      return NextResponse.json(
        { error: `Ongeldige onzekerheid: ${body.onzekerheid}` },
        { status: 400 }
      );
    }

    // Huidige rij ophalen voor diff + RLS-check.
    const { data: huidig, error: leesFout } = await supabase
      .from("decision_assumptions")
      .select("*")
      .eq("id", aid)
      .eq("decision_id", decisionId)
      .maybeSingle();
    if (leesFout || !huidig) {
      return NextResponse.json(
        { error: "Aanname niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    const wijzigingen: Record<string, unknown> = {};
    const oudeWaarden: Record<string, unknown> = {};
    const nieuweWaarden: Record<string, unknown> = {};
    let statusGewijzigd = false;
    const inhoudelijkGewijzigd: string[] = [];

    for (const veld of INHOUDELIJKE_VELDEN) {
      if (body[veld] === undefined) continue;
      const nieuw =
        veld === "tekst" || veld === "evaluatiecriterium"
          ? typeof body[veld] === "string"
            ? (body[veld] as string).trim() || null
            : body[veld]
          : body[veld];
      const oud = (huidig as Record<string, unknown>)[veld];
      if (nieuw === oud) continue;
      // tekst mag niet leeg
      if (veld === "tekst" && (!nieuw || typeof nieuw !== "string")) {
        return NextResponse.json(
          { error: "Tekst mag niet leeg zijn" },
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
      return NextResponse.json({ assumption: huidig, gewijzigd: false });
    }

    wijzigingen.gewijzigd_door = user.id;

    const { data: bijgewerkt, error: updFout } = await supabase
      .from("decision_assumptions")
      .update(wijzigingen)
      .eq("id", aid)
      .select()
      .single();
    if (updFout || !bijgewerkt) {
      console.error("Aanname wijzigen fout:", updFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    // Actor-naam voor events.
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();
    const actorNaam = profiel?.naam ?? null;

    if (inhoudelijkGewijzigd.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "assumption_gewijzigd",
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "assumption",
        object_id: aid,
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
        event_type:
          body.status === "verwijderd"
            ? "assumption_verwijderd"
            : "assumption_status_gewijzigd",
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "assumption",
        object_id: aid,
        oude_waarde: { status: oudeWaarden.status },
        nieuwe_waarde: { status: nieuweWaarden.status },
      });
    }

    return NextResponse.json({ assumption: bijgewerkt, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]/assumptions/[aid]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
