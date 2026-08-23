import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { REQUIREMENT_TYPES } from "@/core/lib/procedure-definitie";

// GET  /api/procedures/[id]/requirements  — actieve instantie-requirements
// POST /api/procedures/[id]/requirements  — voeg een instantie-requirement toe
//
// D7: op een LOPENDE procedure kan een bevoegde rol (voorzitter/beheerder) een
// extra bewijslasttype aan een stap toevoegen. Fonds_id + decision_id worden
// server-side afgeleid (nooit uit de request). Elke toevoeging schrijft precies
// één governance_event (append-only) en telt mee in de readiness-unie.

export const GET = withFondsRoute({ capability: "procedures.view" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const { decision_id } = await ensureDecisionForProcedure(supabase, id);
    const { data } = await supabase
      .from("procedure_requirement_instance")
      .select("*")
      .eq("decision_id", decision_id)
      .eq("actief", true)
      .order("stap_volgorde", { ascending: true });
    return NextResponse.json({ requirements: data ?? [] });
  } catch (e) {
    console.error("Fout in GET …/requirements:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});

export const POST = withFondsRoute({ capability: "procedures.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      stap_volgorde?: number;
      requirement_type?: string;
      label?: string;
      documenttype?: string | null;
      veld_pad?: string | null;
      verplicht?: boolean;
      blokkerend?: boolean;
      min_aantal?: number;
      vereist_validatie_domein?: string | null;
    };

    // Capability: alleen voorzitter/beheerder.
    // BESLUIT (W4): `!profiel ||` valt weg en `ctx.rol` krijgt `?? ""`.
    // Uitkomst-identiek: geen profielrij -> haalProfiel geeft null -> ctx.rol is
    // null -> "" -> 403; profielrij met rol null idem; rol gezet ongewijzigd.
    // Zelfde afweging als bij de twee documents-backfills.
    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een vereiste toevoegen" },
        { status: 403 }
      );
    }

    const label = body.label?.trim();
    if (!label) {
      return NextResponse.json({ error: "label is verplicht" }, { status: 400 });
    }
    if (typeof body.stap_volgorde !== "number" || !Number.isInteger(body.stap_volgorde)) {
      return NextResponse.json(
        { error: "stap_volgorde (geheel getal) is verplicht" },
        { status: 400 }
      );
    }
    if (
      !body.requirement_type ||
      !(REQUIREMENT_TYPES as readonly string[]).includes(body.requirement_type)
    ) {
      return NextResponse.json(
        { error: "Onbekend requirement_type" },
        { status: 400 }
      );
    }
    // De DB-CHECK eist min_aantal >= 1; weiger 0/negatief hier al met een
    // nette melding i.p.v. een 500 op de constraint.
    if (
      body.min_aantal !== undefined &&
      (!Number.isInteger(body.min_aantal) || body.min_aantal < 1)
    ) {
      return NextResponse.json(
        { error: "min_aantal moet een geheel getal >= 1 zijn" },
        { status: 400 }
      );
    }

    // Fonds_id server-side uit de procedure (RLS begrenst tot eigen fonds).
    const { data: procedure } = await supabase
      .from("procedures")
      .select("id, fonds_id")
      .eq("id", id)
      .single();
    if (!procedure?.fonds_id) {
      return NextResponse.json({ error: "Procedure niet gevonden" }, { status: 404 });
    }
    const { decision_id } = await ensureDecisionForProcedure(supabase, id);

    // 1. Instantie-requirement invoegen.
    const { data: nieuw, error: insFout } = await supabase
      .from("procedure_requirement_instance")
      .insert({
        decision_id,
        stap_volgorde: body.stap_volgorde,
        requirement_type: body.requirement_type,
        label,
        documenttype: body.documenttype ?? null,
        veld_pad: body.veld_pad ?? null,
        verplicht: body.verplicht ?? true,
        blokkerend: body.blokkerend ?? false,
        min_aantal: body.min_aantal ?? 1,
        vereist_validatie_domein: body.vereist_validatie_domein ?? null,
        bron: "handmatig",
        actief: true,
        aangemaakt_door: ctx.gebruikerId,
        fonds_id: procedure.fonds_id,
      })
      .select()
      .single();
    if (insFout || !nieuw) {
      console.error("Requirement toevoegen fout:", insFout);
      return NextResponse.json({ error: "Toevoegen mislukt" }, { status: 500 });
    }

    // 2. Append-only governance_event + backref.
    const { data: event, error: evFout } = await supabase
      .from("governance_events")
      .insert({
        decision_id,
        event_type: "requirement_toegevoegd",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam ?? null,
        object_type: "procedure_requirement_instance",
        object_id: nieuw.id,
        nieuwe_waarde: {
          stap_volgorde: body.stap_volgorde,
          requirement_type: body.requirement_type,
          label,
          blokkerend: body.blokkerend ?? false,
        },
      })
      .select("id")
      .single();
    if (evFout) {
      console.error("Requirement-event niet geschreven:", evFout);
      return NextResponse.json(
        { error: "Toevoeging niet gelogd" },
        { status: 500 }
      );
    }
    await supabase
      .from("procedure_requirement_instance")
      .update({ governance_event_id: event.id })
      .eq("id", nieuw.id);

    return NextResponse.json({ requirement: { ...nieuw, governance_event_id: event.id } });
  } catch (e) {
    console.error("Fout in POST …/requirements:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
