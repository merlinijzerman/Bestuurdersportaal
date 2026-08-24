import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { requirementSleutel } from "@/core/lib/requirement-sleutel";
import { REQUIREMENT_TYPES } from "@/core/lib/procedure-definitie";
import { z } from "zod";

// GET  /api/procedures/[id]/requirements  — actieve instantie-requirements
// POST /api/procedures/[id]/requirements  — voeg een instantie-requirement toe
//
// D7: op een LOPENDE procedure kan een bevoegde rol (voorzitter/beheerder) een
// extra bewijslasttype aan een stap toevoegen. Fonds_id + decision_id worden
// server-side afgeleid (nooit uit de request). Elke toevoeging schrijft precies
// één governance_event (append-only) en telt mee in de readiness-unie.

export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "procedures.view", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
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

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.requirements.aanmaken" }, capability: "procedures.manage", schema: z.object({ "blokkerend": z.unknown().optional(), "documenttype": z.unknown().optional(), "label": z.unknown().optional(), "min_aantal": z.unknown().optional(), "requirement_type": z.unknown().optional(), "stap_volgorde": z.unknown().optional(), "veld_pad": z.unknown().optional(), "vereist_validatie_domein": z.unknown().optional(), "verplicht": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
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
      .select("id, fonds_id, template_code, template_versie")
      .eq("id", id)
      .single();
    if (!procedure?.fonds_id) {
      return NextResponse.json({ error: "Procedure niet gevonden" }, { status: 404 });
    }
    const { decision_id } = await ensureDecisionForProcedure(supabase, id);

    // Uniciteit van de matchsleutel binnen de stap. De identiteit
    // coalesce(documenttype, label) draagt de bewijs↔vereiste-binding
    // (procedure_bewijs.requirement_sleutel, besluit 0183) én het
    // uitsluitingsmasker. Botsen twee vereisten op die identiteit, dan wordt
    // de configuratie ambigu. De DB-trigger herhaalt deze cross-table
    // invariant transactioneel; deze routecheck levert vóór de insert een
    // bruikbare foutmelding.
    const nieuweDocumenttype = body.documenttype?.trim() || null;
    const nieuweSleutel = requirementSleutel(
      body.stap_volgorde,
      body.requirement_type,
      nieuweDocumenttype,
      label
    );
    // P1b (#166): template-arm versie-gefilterd op de gepinde versie; fallback
    // naar code-only als die (kortstondig) null is.
    let tplQuery = supabase
      .from("procedure_requirements")
      .select("stap_volgorde, requirement_type, documenttype, label")
      .eq("template_code", procedure.template_code)
      .eq("stap_volgorde", body.stap_volgorde)
      .eq("requirement_type", body.requirement_type);
    if (procedure.template_versie) {
      tplQuery = tplQuery.eq("template_versie", procedure.template_versie);
    }
    const [{ data: templateRijen }, { data: instantieRijen }] = await Promise.all([
      tplQuery,
      supabase
        .from("procedure_requirement_instance")
        .select("stap_volgorde, requirement_type, documenttype, label")
        .eq("decision_id", decision_id)
        .eq("actief", true)
        .eq("stap_volgorde", body.stap_volgorde)
        .eq("requirement_type", body.requirement_type),
    ]);
    type SleutelRij = {
      stap_volgorde: number;
      requirement_type: string;
      documenttype: string | null;
      label: string;
    };
    const botst = [
      ...((templateRijen ?? []) as SleutelRij[]),
      ...((instantieRijen ?? []) as SleutelRij[]),
    ].some(
      (r) =>
        requirementSleutel(
          r.stap_volgorde,
          r.requirement_type,
          r.documenttype,
          r.label
        ) === nieuweSleutel
    );
    if (botst) {
      return NextResponse.json(
        {
          error:
            "Er bestaat op deze stap al een vereiste van dit type met dezelfde identiteit " +
            "(documenttype, of anders het label). Kies een ander label of een eigen documenttype.",
        },
        { status: 400 }
      );
    }

    // 1. Instantie-requirement invoegen.
    const { data: nieuw, error: insFout } = await supabase
      .from("procedure_requirement_instance")
      .insert({
        decision_id,
        stap_volgorde: body.stap_volgorde,
        requirement_type: body.requirement_type,
        label,
        documenttype: nieuweDocumenttype,
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
    if (insFout?.code === "23505" || insFout?.code === "23514") {
      return NextResponse.json(
        { error: "Er bestaat in deze procedure al een vereiste met dezelfde bindingssleutel" },
        { status: 409 }
      );
    }
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
