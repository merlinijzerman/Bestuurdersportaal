// PATCH /api/procedures/[id]/afschriften/[afschriftId]
// -----------------------------------------------------------------------------
// T6 — Afschrift intrekken (geen delete; besluit 0001/0117). Zet de ingetrokken_*
// velden. De kolom-freeze-trigger laat vanuit een user-sessie alleen die velden
// toe; de UPDATE-policy vereist eigen fonds én niet-bureau. Append-only geborgd.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const PATCH = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.afschriften.wijzigen" }, capability: "procedures.manage", label: "procedures.afschrift.intrekken.PATCH", schema: z.object({ "reden": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: procedureId, afschriftId } = params as { id: string; afschriftId: string };
    const supabase = ctx.supabase;

    const body = (await req.json().catch(() => ({}))) as { reden?: unknown };
    const reden =
      typeof body.reden === "string" && body.reden.trim() ? body.reden.trim().slice(0, 1000) : null;
    if (!reden) {
      return NextResponse.json({ error: "Een reden voor het intrekken is verplicht." }, { status: 400 });
    }

    // Bestaat het afschrift (RLS) en is het nog niet ingetrokken?
    const { data: bestaand } = await supabase
      .from("procedure_afschriften")
      .select("id, ingetrokken_op")
      .eq("id", afschriftId)
      .eq("procedure_id", procedureId)
      .maybeSingle();
    if (!bestaand) {
      return NextResponse.json({ error: "Afschrift niet gevonden of geen toegang" }, { status: 404 });
    }
    if (bestaand.ingetrokken_op) {
      return NextResponse.json({ error: "Dit afschrift is al ingetrokken." }, { status: 409 });
    }

    // Alleen ingetrokken_* wijzigen (kolom-freeze-trigger laat dit toe).
    const { data: bijgewerkt, error: updErr } = await supabase
      .from("procedure_afschriften")
      .update({
        ingetrokken_op: new Date().toISOString(),
        ingetrokken_door: ctx.gebruikerId,
        ingetrokken_reden: reden,
      })
      .eq("id", afschriftId)
      .eq("procedure_id", procedureId)
      .is("ingetrokken_op", null)
      .select("id")
      .maybeSingle();
    if (updErr) {
      console.error("Intrekken mislukt:", updErr);
      return NextResponse.json({ error: "Kon het afschrift niet intrekken." }, { status: 500 });
    }
    if (!bijgewerkt) {
      // 0 rijen: RLS-weigering (bv. bureau-rol) of race.
      return NextResponse.json({ error: "Intrekken niet toegestaan." }, { status: 403 });
    }

    await supabase.from("procedure_log").insert({
      procedure_id: procedureId,
      event_type: "afschrift_ingetrokken",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      payload: { afschrift_id: afschriftId, reden },
    });

    return NextResponse.json({ id: afschriftId, ingetrokken: true });
  } catch (e) {
    console.error("Fout in PATCH afschrift:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
