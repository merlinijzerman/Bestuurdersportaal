import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { z } from "zod";

export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.id.checklist.itemId.patch" }, capability: "procedures.manage", schema: z.object({ "actief": z.unknown().optional(), "opmerking": z.unknown().optional(), "reden": z.unknown().optional(), "voldaan": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, itemId } = params as { id: string; itemId: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      voldaan?: boolean;
      opmerking?: string;
      // D7: soft-deactivate/heractivering van een checklist-item.
      actief?: boolean;
      // WO-3-vervolg: verplichte toelichting bij verwijderen (deactiveren).
      reden?: string;
    };
    // Ofwel het bestaande voldaan-pad, ofwel het D7 actief-pad.
    if (typeof body.actief !== "boolean" && typeof body.voldaan !== "boolean") {
      return NextResponse.json(
        { error: "voldaan of actief (boolean) is verplicht" },
        { status: 400 }
      );
    }

    // Haal item + stap op voor logging
    const { data: item } = await supabase
      .from("procedure_checklist")
      .select("label, voldaan, bron, actief, stap_id, procedure_stappen(naam, procedure_id)")
      .eq("id", itemId)
      .single();
    if (!item) {
      return NextResponse.json(
        { error: "Checklist-item niet gevonden" },
        { status: 404 }
      );
    }

    const stapData = item.procedure_stappen as
      | { naam: string; procedure_id: string }
      | { naam: string; procedure_id: string }[]
      | null
      | undefined;
    const stap = Array.isArray(stapData) ? stapData[0] : stapData;
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json(
        { error: "Item hoort niet bij deze procedure" },
        { status: 400 }
      );
    }

    // ── D7: soft-deactivate/heractivering (governance-gelogd) ──
    // Voorbehouden aan voorzitter/beheerder; append-only (actief=false i.p.v.
    // verwijderen). De 'voldaan'-toggle hieronder blijft vrij voor elk lid.
    if (typeof body.actief === "boolean") {
      if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
        return NextResponse.json(
          {
            error:
              "Alleen voorzitter of beheerder kan een checklist-item (de)activeren",
          },
          { status: 403 }
        );
      }
      // WO-3-vervolg: verwijderen (deactiveren) vereist een toelichting — nooit
      // stil (spiegelt REQ-006 bij de bewijslast). Heractiveren mag zonder.
      const reden = body.reden?.trim() || null;
      if (body.actief === false && !reden) {
        return NextResponse.json(
          { error: "Een toelichting is verplicht bij het verwijderen" },
          { status: 400 }
        );
      }
      const { error: deFout } = await supabase
        .from("procedure_checklist")
        .update({ actief: body.actief })
        .eq("id", itemId);
      if (deFout) {
        console.error("Checklist (de)activeren fout:", deFout);
        return NextResponse.json({ error: "Wijzigen mislukt" }, { status: 500 });
      }
      const { decision_id } = await ensureDecisionForProcedure(supabase, id);
      const { error: evFout } = await supabase.from("governance_events").insert({
        decision_id,
        event_type: body.actief
          ? "checklistitem_geheractiveerd"
          : "checklistitem_gedeactiveerd",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam ?? null,
        object_type: "procedure_checklist",
        object_id: itemId,
        reden,
        oude_waarde: { actief: item.actief, bron: item.bron },
        nieuwe_waarde: { actief: body.actief, label: item.label, reden },
      });
      // Append-only: zonder audit-rij niet traceerbaar → fail closed.
      if (evFout) {
        console.error("Checklist (de)activatie niet gelogd:", evFout);
        return NextResponse.json({ error: "Wijziging niet gelogd" }, { status: 500 });
      }
      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: body.actief
          ? "checklistitem_geheractiveerd"
          : "checklistitem_gedeactiveerd",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam || null,
        payload: { stap: stap.naam, item: item.label, reden },
      });
      return NextResponse.json({ ok: true });
    }

    // Vanaf hier het bestaande voldaan-pad (elk lid mag togglen).
    if (typeof body.voldaan !== "boolean") {
      return NextResponse.json(
        { error: "voldaan (boolean) is verplicht" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      voldaan: body.voldaan,
      voldaan_op: body.voldaan ? new Date().toISOString() : null,
      voldaan_door: body.voldaan ? ctx.gebruikerId : null,
      voldaan_door_naam: body.voldaan ? ctx.naam || null : null,
    };
    if (body.opmerking !== undefined) {
      updates.opmerking = body.opmerking || null;
    }

    const { error: updateFout } = await supabase
      .from("procedure_checklist")
      .update(updates)
      .eq("id", itemId);
    if (updateFout) {
      console.error("Checklist-item update fout:", updateFout);
      return NextResponse.json({ error: "Update mislukt" }, { status: 500 });
    }

    if (body.voldaan !== item.voldaan) {
      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: body.voldaan ? "checklistitem_voldaan" : "checklistitem_geopend",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam || null,
        payload: { stap: stap.naam, item: item.label },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/checklist/[itemId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
