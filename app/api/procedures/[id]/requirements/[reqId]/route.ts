import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

// PATCH /api/procedures/[id]/requirements/[reqId]
//
// Soft-deactivate (of heractivering) van een instantie-requirement (D7).
// Append-only: `actief = false` i.p.v. verwijderen. Voorbehouden aan
// voorzitter/beheerder. Een BLOKKERENDE vereiste deactiveren kan alleen met
// verplichte motivering (REQ-006) — nooit stil. Elke mutatie logt één
// governance_event.
export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.id.requirements.reqId.patch" }, capability: "procedures.manage", schema: z.object({ "actief": z.unknown().optional(), "motivering": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, reqId } = params as { id: string; reqId: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as { actief?: boolean; motivering?: string };
    if (typeof body.actief !== "boolean") {
      return NextResponse.json(
        { error: "actief (boolean) is verplicht" },
        { status: 400 }
      );
    }
    const motivering = body.motivering?.trim() || null;

    // BESLUIT (W4): `!profiel ||` valt weg en `ctx.rol` krijgt `?? ""`.
    // Uitkomst-identiek: geen profielrij -> haalProfiel geeft null -> ctx.rol is
    // null -> "" -> 403; profielrij met rol null idem; rol gezet ongewijzigd.
    // Zelfde afweging als bij de twee documents-backfills.
    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een vereiste wijzigen" },
        { status: 403 }
      );
    }

    // Requirement laden + verifiëren dat hij bij deze procedure hoort.
    const { data: reqRow } = await supabase
      .from("procedure_requirement_instance")
      .select(
        "id, blokkerend, actief, label, stap_volgorde, decision_id, decision_objects(procedure_id)"
      )
      .eq("id", reqId)
      .single();
    if (!reqRow) {
      return NextResponse.json({ error: "Vereiste niet gevonden" }, { status: 404 });
    }
    const decRef = reqRow.decision_objects as
      | { procedure_id: string }
      | { procedure_id: string }[]
      | null;
    const proc = Array.isArray(decRef) ? decRef[0] : decRef;
    if (!proc || proc.procedure_id !== id) {
      return NextResponse.json(
        { error: "Vereiste hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    // REQ-006: een blokkerende vereiste deactiveren kan alleen met motivering.
    if (reqRow.blokkerend && body.actief === false && !motivering) {
      return NextResponse.json(
        {
          error:
            "Een blokkerende vereiste kan alleen met motivering worden gedeactiveerd",
        },
        { status: 422 }
      );
    }

    const { error: updFout } = await supabase
      .from("procedure_requirement_instance")
      .update({ actief: body.actief })
      .eq("id", reqId);
    if (updFout) {
      console.error("Requirement wijzigen fout:", updFout);
      return NextResponse.json({ error: "Wijzigen mislukt" }, { status: 500 });
    }

    const { error: evFout } = await supabase.from("governance_events").insert({
      decision_id: reqRow.decision_id,
      event_type: body.actief
        ? "requirement_geheractiveerd"
        : "requirement_gedeactiveerd",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      object_type: "procedure_requirement_instance",
      object_id: reqId,
      oude_waarde: { actief: reqRow.actief, blokkerend: reqRow.blokkerend },
      nieuwe_waarde: { actief: body.actief, label: reqRow.label },
      reden: motivering,
    });
    if (evFout) {
      console.error("Requirement-mutatie niet gelogd:", evFout);
      return NextResponse.json({ error: "Wijziging niet gelogd" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH …/requirements/[reqId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
