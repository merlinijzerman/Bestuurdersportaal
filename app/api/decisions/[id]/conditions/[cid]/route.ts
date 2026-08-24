// PATCH /api/decisions/[id]/conditions/[cid]
//
// Bewerken van een voorwaarde. Status-wijzigingen krijgen een eigen
// event 'voorwaarde_status_gewijzigd' (zichtbaar in auditdossier);
// inhoudelijke wijzigingen 'voorwaarde_gewijzigd'.

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

const STATUS = [
  "open",
  "op_schema",
  "afwijking",
  "vervuld",
  "overschreden",
] as const;

type WijzigBody = Partial<{
  voorwaarde: string;
  eigenaar_naam: string | null;
  kpi: string | null;
  drempelwaarde: string | null;
  monitorfrequentie: string | null;
  deadline: string | null;
  heroverwegingstrigger: string | null;
  status: (typeof STATUS)[number];
}>;

const INHOUDELIJK: (keyof WijzigBody)[] = [
  "voorwaarde",
  "eigenaar_naam",
  "kpi",
  "drempelwaarde",
  "monitorfrequentie",
  "deadline",
  "heroverwegingstrigger",
];

export const PATCH = withFondsRoute({ capability: "decisions.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId, cid } = params as { id: string; cid: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as WijzigBody;
    if (body.status !== undefined && !STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `Ongeldige status: ${body.status}` },
        { status: 400 }
      );
    }

    const { data: huidig } = await supabase
      .from("decision_conditions")
      .select("*")
      .eq("id", cid)
      .eq("decision_id", decisionId)
      .maybeSingle();
    if (!huidig) {
      return NextResponse.json(
        { error: "Voorwaarde niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    const wijzigingen: Record<string, unknown> = {};
    const oude: Record<string, unknown> = {};
    const nieuw: Record<string, unknown> = {};
    const inhoudelijk: string[] = [];
    let statusGewijzigd = false;

    for (const veld of INHOUDELIJK) {
      if (body[veld] === undefined) continue;
      let nieuweW: unknown = body[veld];
      // String-velden trimmen + lege strings naar null (behalve voorwaarde).
      if (
        typeof nieuweW === "string" &&
        veld !== "deadline"
      ) {
        nieuweW = nieuweW.trim() || (veld === "voorwaarde" ? "" : null);
      }
      const oudeW = (huidig as Record<string, unknown>)[veld];
      if (nieuweW === oudeW) continue;
      if (veld === "voorwaarde" && (!nieuweW || typeof nieuweW !== "string")) {
        return NextResponse.json(
          { error: "Voorwaarde mag niet leeg zijn" },
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
      return NextResponse.json({ condition: huidig, gewijzigd: false });
    }

    const { data: bijgewerkt, error: updFout } = await supabase
      .from("decision_conditions")
      .update(wijzigingen)
      .eq("id", cid)
      .select()
      .single();
    if (updFout || !bijgewerkt) {
      console.error("Voorwaarde wijzigen fout:", updFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    const actorNaam = ctx.naam;

    if (inhoudelijk.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "voorwaarde_gewijzigd",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "condition",
        object_id: cid,
        oude_waarde: Object.fromEntries(inhoudelijk.map((k) => [k, oude[k]])),
        nieuwe_waarde: Object.fromEntries(inhoudelijk.map((k) => [k, nieuw[k]])),
      });
    }
    if (statusGewijzigd) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "voorwaarde_status_gewijzigd",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "condition",
        object_id: cid,
        oude_waarde: { status: oude.status },
        nieuwe_waarde: { status: nieuw.status },
      });
    }

    return NextResponse.json({ condition: bijgewerkt, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]/conditions/[cid]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
