// PATCH /api/decisions/[id]/actions/[aid]
//
// Bewerken van een actie. Status-wijzigingen krijgen een eigen event
// 'actie_status_gewijzigd', inhoudelijke wijzigingen 'actie_gewijzigd'.

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

type WijzigBody = Partial<{
  actie: string;
  eigenaar_id: string | null;
  deadline: string | null;
  status: (typeof STATUS)[number];
  voorwaarde_id: string | null;
  afhankelijk_van: string | null;
}>;

const INHOUDELIJK: (keyof WijzigBody)[] = [
  "actie",
  "deadline",
  "voorwaarde_id",
  "afhankelijk_van",
];

export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "decisions.actions.wijzigen" }, capability: "decisions.manage", schema: z.object({ "eigenaar_id": z.unknown().optional(), "status": z.unknown().optional(), "voorwaarde_id": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId, aid } = params as { id: string; aid: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as WijzigBody;
    if (body.status !== undefined && !STATUS.includes(body.status)) {
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

    const { data: huidig } = await supabase
      .from("decision_actions")
      .select("*")
      .eq("id", aid)
      .eq("decision_id", decisionId)
      .maybeSingle();
    if (!huidig) {
      return NextResponse.json(
        { error: "Actie niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    // Voorwaarde-koppeling: valideer dezelfde decision-scope.
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

    const wijzigingen: Record<string, unknown> = {};
    const oude: Record<string, unknown> = {};
    const nieuw: Record<string, unknown> = {};
    const inhoudelijk: string[] = [];
    let statusGewijzigd = false;

    if (body.eigenaar_id !== undefined) {
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
      const huidigeEigenaarId = huidig.eigenaar_id as string | null;
      if ((eigenaar?.id ?? null) !== huidigeEigenaarId) {
        wijzigingen.eigenaar_id = eigenaar?.id ?? null;
        wijzigingen.eigenaar_naam = eigenaar?.naam?.trim() || null;
        oude.eigenaar_id = huidigeEigenaarId;
        oude.eigenaar_naam = huidig.eigenaar_naam;
        nieuw.eigenaar_id = eigenaar?.id ?? null;
        nieuw.eigenaar_naam = eigenaar?.naam?.trim() || null;
        inhoudelijk.push("eigenaar_id");
      }
    }

    for (const veld of INHOUDELIJK) {
      if (body[veld] === undefined) continue;
      let nieuweW: unknown = body[veld];
      if (
        typeof nieuweW === "string" &&
        veld !== "deadline" &&
        veld !== "voorwaarde_id" &&
        veld !== "afhankelijk_van"
      ) {
        nieuweW = nieuweW.trim() || null;
      }
      const oudeW = (huidig as Record<string, unknown>)[veld];
      if (nieuweW === oudeW) continue;
      if (veld === "actie" && (!nieuweW || typeof nieuweW !== "string")) {
        return NextResponse.json(
          { error: "Actie mag niet leeg zijn" },
          { status: 400 }
        );
      }
      wijzigingen[veld] = nieuweW;
      oude[veld] = oudeW;
      nieuw[veld] = nieuweW;
      inhoudelijk.push(veld);
    }

    if (body.status !== undefined && body.status !== huidig.status) {
      wijzigingen.status = body.status;
      oude.status = huidig.status;
      nieuw.status = body.status;
      statusGewijzigd = true;
    }

    if (Object.keys(wijzigingen).length === 0) {
      return NextResponse.json({ action: huidig, gewijzigd: false });
    }

    const { data: bijgewerkt, error: updFout } = await supabase
      .from("decision_actions")
      .update(wijzigingen)
      .eq("id", aid)
      .select()
      .single();
    if (updFout || !bijgewerkt) {
      console.error("Actie wijzigen fout:", updFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    const actorNaam = ctx.naam;

    if (inhoudelijk.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "actie_gewijzigd",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "action",
        object_id: aid,
        oude_waarde: Object.fromEntries(inhoudelijk.map((k) => [k, oude[k]])),
        nieuwe_waarde: Object.fromEntries(
          inhoudelijk.map((k) => [k, nieuw[k]])
        ),
      });
    }
    if (statusGewijzigd) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "actie_status_gewijzigd",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "action",
        object_id: aid,
        oude_waarde: { status: oude.status },
        nieuwe_waarde: { status: nieuw.status },
      });
    }

    return NextResponse.json({ action: bijgewerkt, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]/actions/[aid]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
