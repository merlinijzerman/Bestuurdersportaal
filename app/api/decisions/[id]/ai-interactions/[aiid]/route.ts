// PATCH /api/decisions/[id]/ai-interactions/[aiid]
//
// Een bestuurder valideert een AI-output: validatiestatus zetten op
// gevalideerd / aangepast / afgekeurd, optioneel met aangepaste_output,
// gebruikt_in_dossier-flag, gebruik_context of verworpen_reden.
//
// Domein-rolcheck: voor `validatie_domein` ≠ algemeen geldt dat alleen
// rol voorzitter of beheerder mag valideren. RLS doet dit ook (zie
// laag 3 in `2026_05_07_decision_object.sql`); wij returnen netjes 403
// met begrijpbare boodschap als de rol ontbreekt.
//
// Loggt een governance_event van het type ai_output_<status>:
//   • ai_output_gevalideerd, ai_output_aangepast, ai_output_afgekeurd

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import type { AIValidatieStatus } from "@/core/lib/decision-view";

const ROLLEN_VOOR_SPECIALISTISCH = new Set(["voorzitter", "beheerder"]);
const TOEGESTANE_STATUSSEN: AIValidatieStatus[] = [
  "concept",
  "gevalideerd",
  "aangepast",
  "afgekeurd",
  "gearchiveerd",
];

interface PatchBody {
  validatiestatus?: AIValidatieStatus;
  aangepaste_output?: string | null;
  gebruikt_in_dossier?: boolean;
  gebruik_context?: string | null;
  verworpen_reden?: string | null;
}

export const PATCH = withFondsRoute({ capability: "decisions.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, aiid } = params as { id: string; aiid: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as PatchBody;

    // Huidige rij ophalen — RLS filtert op fonds_id via decision-chain.
    const { data: ai, error: leesFout } = await supabase
      .from("decision_ai_interactions")
      .select("*")
      .eq("id", aiid)
      .eq("decision_id", id)
      .single();
    if (leesFout || !ai) {
      return NextResponse.json(
        { error: "AI-interactie niet gevonden" },
        { status: 404 }
      );
    }

    if (
      body.validatiestatus !== undefined &&
      !TOEGESTANE_STATUSSEN.includes(body.validatiestatus)
    ) {
      return NextResponse.json(
        { error: "Ongeldige validatiestatus" },
        { status: 400 }
      );
    }

    // Domein-rolcheck — alleen relevant als de status verandert.
    if (
      body.validatiestatus !== undefined &&
      body.validatiestatus !== ai.validatiestatus &&
      ai.validatie_domein !== "algemeen"
    ) {
      // Het `?? "bestuurder"` stond er al en blijft ONGEWIJZIGD: een gebruiker
      // zonder rol wordt hier als bestuurder behandeld. Dat is een fail-OPEN
      // default, en daarmee een observatie voor W7 — geen W4-wijziging.
      // De classifier markeert deze regel omdat de gesanctioneerde aliasvorm
      // `const X = ctx.rol;` is; met een betekenisvolle default hoort een mens
      // ernaar te kijken, en dat is precies wat hier gebeurt.
      const rol = ctx.rol ?? "bestuurder";
      if (!ROLLEN_VOOR_SPECIALISTISCH.has(rol)) {
        return NextResponse.json(
          {
            error: `Validatie van domein '${ai.validatie_domein}' vereist rol voorzitter of beheerder.`,
          },
          { status: 403 }
        );
      }
    }

    // Mutatie samenstellen.
    const updates: Record<string, unknown> = {};
    if (body.validatiestatus !== undefined) {
      updates.validatiestatus = body.validatiestatus;
      if (body.validatiestatus !== "concept") {
        updates.gevalideerd_door = ctx.gebruikerId;
        updates.gevalideerd_op = new Date().toISOString();
      }
    }
    if (body.aangepaste_output !== undefined) {
      updates.aangepaste_output = body.aangepaste_output;
    }
    if (body.gebruikt_in_dossier !== undefined) {
      updates.gebruikt_in_dossier = body.gebruikt_in_dossier;
    }
    if (body.gebruik_context !== undefined) {
      updates.gebruik_context = body.gebruik_context;
    }
    if (body.verworpen_reden !== undefined) {
      updates.verworpen_reden = body.verworpen_reden;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ai, gewijzigd: false });
    }

    const { data: na, error: updateFout } = await supabase
      .from("decision_ai_interactions")
      .update(updates)
      .eq("id", aiid)
      .select()
      .single();
    if (updateFout || !na) {
      console.error("AI-interactie wijzigen fout:", updateFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    // Governance-event loggen.
    const actorNaam = ctx.naam;

    let eventType = "ai_output_gewijzigd";
    if (
      body.validatiestatus !== undefined &&
      body.validatiestatus !== ai.validatiestatus
    ) {
      eventType = `ai_output_${body.validatiestatus}`;
    }

    await supabase.from("governance_events").insert({
      decision_id: id,
      event_type: eventType,
      actor_id: ctx.gebruikerId,
      actor_naam: actorNaam,
      object_type: "decision_ai_interaction",
      object_id: aiid,
      oude_waarde: {
        validatiestatus: ai.validatiestatus,
        validatie_domein: ai.validatie_domein,
        gebruikt_in_dossier: ai.gebruikt_in_dossier,
      },
      nieuwe_waarde: {
        validatiestatus: na.validatiestatus,
        gebruikt_in_dossier: na.gebruikt_in_dossier,
        gebruik_context: na.gebruik_context,
        verworpen_reden: na.verworpen_reden,
      },
    });

    return NextResponse.json({ ai: na, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]/ai-interactions/[aiid]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
