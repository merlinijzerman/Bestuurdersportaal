// PATCH /api/procedures/[id]/afschriften/[afschriftId]
// -----------------------------------------------------------------------------
// T6 — Afschrift intrekken (geen delete; besluit 0001/0117). Zet de ingetrokken_*
// velden. De kolom-freeze-trigger laat vanuit een user-sessie alleen die velden
// toe; de UPDATE-policy vereist eigen fonds én niet-bureau. Append-only geborgd.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; afschriftId: string }> }
) {
  try {
    const { id: procedureId, afschriftId } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, fonds_id")
      .eq("id", user.id)
      .maybeSingle();
    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: profiel?.fonds_id ?? null,
      gebruikerId: user.id,
      label: "procedures.afschrift.PATCH",
    });
    if (!hostOordeel.toegestaan) {
      return NextResponse.json({ error: "Dit webadres hoort niet bij uw fonds." }, { status: 403 });
    }

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
        ingetrokken_door: user.id,
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
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      payload: { afschrift_id: afschriftId, reden },
    });

    return NextResponse.json({ id: afschriftId, ingetrokken: true });
  } catch (e) {
    console.error("Fout in PATCH afschrift:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
