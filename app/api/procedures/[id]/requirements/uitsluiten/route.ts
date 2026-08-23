import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";

// POST /api/procedures/[id]/requirements/uitsluiten
//
// WO-3-vervolg: sluit een TEMPLATE-vereiste (uit de generieke standaardset) uit
// voor DIT proces. De generieke `procedure_requirements` blijft onaangeroerd —
// dit schrijft alleen een overlay-rij (`procedure_requirement_uitsluiting`) per
// Decision Object. Match op (stap_volgorde, requirement_type, label). Verplichte
// toelichting; gegate op voorzitter/beheerder; fonds_id + decision_id server-side
// afgeleid; append-only gelogd. Upsert op de unieke sleutel = idempotent en
// heractiveert een eerder teruggedraaide uitsluiting.
export const POST = withFondsRoute({ capability: "TE_BEPALEN" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      stap_volgorde?: number;
      requirement_type?: string;
      label?: string;
      documenttype?: string | null;
      reden?: string;
    };

    // BESLUIT (W4): `!profiel ||` valt weg en `ctx.rol` krijgt `?? ""`.
    // Uitkomst-identiek: geen profielrij -> haalProfiel geeft null -> ctx.rol is
    // null -> "" -> 403; profielrij met rol null idem; rol gezet ongewijzigd.
    // Zelfde afweging als bij de twee documents-backfills.
    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een vereiste uitsluiten" },
        { status: 403 }
      );
    }

    const label = body.label?.trim();
    const requirementType = body.requirement_type?.trim();
    const documenttype = body.documenttype?.trim() || null;
    const reden = body.reden?.trim();
    // Identiteit = coalesce(documenttype, label), gelijk aan de unieke index van
    // procedure_requirements → matcht exact de bedoelde template-vereiste.
    const matchSleutel = documenttype ?? label;
    if (
      !label ||
      !requirementType ||
      typeof body.stap_volgorde !== "number" ||
      !Number.isInteger(body.stap_volgorde)
    ) {
      return NextResponse.json(
        { error: "stap_volgorde, requirement_type en label zijn verplicht" },
        { status: 400 }
      );
    }
    if (!reden) {
      return NextResponse.json(
        { error: "Een toelichting is verplicht bij het uitsluiten" },
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

    // Upsert op de business key (heractiveert een teruggedraaide uitsluiting).
    const { data: rij, error: upFout } = await supabase
      .from("procedure_requirement_uitsluiting")
      .upsert(
        {
          decision_id,
          fonds_id: procedure.fonds_id,
          stap_volgorde: body.stap_volgorde,
          requirement_type: requirementType,
          label,
          match_sleutel: matchSleutel,
          reden,
          actief: true,
          uitgesloten_door: ctx.gebruikerId,
          uitgesloten_op: new Date().toISOString(),
        },
        { onConflict: "decision_id,stap_volgorde,requirement_type,match_sleutel" }
      )
      .select("id")
      .single();
    if (upFout || !rij) {
      console.error("Requirement-uitsluiting fout:", upFout);
      return NextResponse.json({ error: "Uitsluiten mislukt" }, { status: 500 });
    }

    // Append-only governance_event + backref.
    const { data: event, error: evFout } = await supabase
      .from("governance_events")
      .insert({
        decision_id,
        event_type: "requirement_uitgesloten",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam ?? null,
        object_type: "procedure_requirement_uitsluiting",
        object_id: rij.id,
        reden,
        nieuwe_waarde: {
          stap_volgorde: body.stap_volgorde,
          requirement_type: requirementType,
          label,
          reden,
        },
      })
      .select("id")
      .single();
    if (evFout) {
      console.error("Uitsluiting-event niet geschreven:", evFout);
      return NextResponse.json({ error: "Uitsluiting niet gelogd" }, { status: 500 });
    }
    await supabase
      .from("procedure_requirement_uitsluiting")
      .update({ governance_event_id: event.id })
      .eq("id", rij.id);

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "requirement_uitgesloten",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { stap_volgorde: body.stap_volgorde, label, reden },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in POST …/requirements/uitsluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
