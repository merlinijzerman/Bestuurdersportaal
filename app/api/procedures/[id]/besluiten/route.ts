import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { notifyUser } from "@/core/lib/notifications";
import { z } from "zod";
import {
  leesVereisteVerwijzing,
  resolveRequirementBinding,
} from "@/core/lib/bewijs-binding";

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.besluiten.aanmaken" }, capability: "procedures.manage", schema: z.object({ "agendapunt_id": z.unknown().optional(), "datum": z.unknown().optional(), "formulering": z.unknown().optional(), "motivering": z.unknown().optional(), "stap_id": z.unknown().optional(), "uitkomst": z.unknown().optional(), "vereiste": z.unknown().optional(), "vergadering_id": z.unknown().optional(), "verworpen_alternatieven": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      stap_id?: string | null;
      formulering?: string;
      motivering?: string | null;
      datum?: string;
      vergadering_id?: string | null;
      agendapunt_id?: string | null;
      verworpen_alternatieven?: string[]; // 1D-3
      uitkomst?: "instemmend" | "voorwaardelijk" | "afwijzend";
      vereiste?: unknown;
    };
    const formulering = body.formulering?.trim();
    const datum = body.datum;
    if (!formulering) {
      return NextResponse.json(
        { error: "Formulering is verplicht" },
        { status: 400 }
      );
    }
    if (!datum) {
      return NextResponse.json(
        { error: "Datum is verplicht" },
        { status: 400 }
      );
    }
    if (!body.stap_id) {
      return NextResponse.json({ error: "stap_id is verplicht" }, { status: 400 });
    }
    if (!body.uitkomst || !["instemmend", "voorwaardelijk", "afwijzend"].includes(body.uitkomst)) {
      return NextResponse.json({ error: "Kies de uitkomst van het besluit" }, { status: 400 });
    }

    // Verifieer procedure + haal evt. decision_id + gestart_door op voor backref.
    const { data: proc } = await supabase
      .from("procedures")
      .select("id, decision_id, gestart_door, titel, fonds_id")
      .eq("id", id)
      .single();
    if (!proc) {
      return NextResponse.json(
        { error: "Procedure niet gevonden" },
        { status: 404 }
      );
    }

    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("id, procedure_id, volgorde")
      .eq("id", body.stap_id)
      .maybeSingle();
    if (!stap || stap.procedure_id !== id) {
      return NextResponse.json({ error: "Stap hoort niet bij deze procedure" }, { status: 400 });
    }

    const verwijzing = leesVereisteVerwijzing(body.vereiste);
    if (verwijzing === "ongeldig" || verwijzing === null || verwijzing === undefined) {
      return NextResponse.json(
        { error: "Een besluit moet aan een approval-vereiste worden gebonden" },
        { status: 400 }
      );
    }
    const binding = await resolveRequirementBinding(
      supabase,
      id,
      verwijzing,
      stap.volgorde,
      ["approval"]
    );
    if (!binding.ok) {
      return NextResponse.json(
        { error: binding.fout },
        { status: binding.serverfout ? 500 : 400 }
      );
    }

    // Verworpen alternatieven: filter lege strings + trim.
    const alternatieven = Array.isArray(body.verworpen_alternatieven)
      ? body.verworpen_alternatieven
          .map((a) => (typeof a === "string" ? a.trim() : ""))
          .filter((a) => a.length > 0)
      : [];

    const { data: besluit, error } = await supabase
      .from("procedure_besluiten")
      .insert({
        procedure_id: id,
        decision_id: proc.decision_id ?? null,
        stap_id: body.stap_id || null,
        vergadering_id: body.vergadering_id || null,
        agendapunt_id: body.agendapunt_id || null,
        formulering,
        motivering: body.motivering || null,
        datum,
        verworpen_alternatieven: alternatieven,
        uitkomst: body.uitkomst,
        requirement_sleutel: binding.sleutel,
        vastgelegd_door: ctx.gebruikerId,
        vastgelegd_door_naam: ctx.naam || null,
      })
      .select()
      .single();

    if (error || !besluit) {
      console.error("Besluit vastleggen fout:", error);
      return NextResponse.json(
        { error: "Vastleggen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "besluit_vastgelegd",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { formulering, datum, uitkomst: body.uitkomst, requirement_sleutel: binding.sleutel },
    });

    // 1D-3: ook in governance_events loggen op Decision Object niveau,
    // zodat het auditdossier de besluit-vastlegging meeneemt. We
    // includeren de formulering bewust omdat het besluit zelf
    // openbaar moet zijn binnen het dossier (anders dan dissent).
    if (proc.decision_id) {
      await supabase.from("governance_events").insert({
        decision_id: proc.decision_id,
        event_type: "besluit_vastgelegd",
        actor_id: ctx.gebruikerId,
        actor_naam: ctx.naam || null,
        object_type: "besluit",
        object_id: besluit.id,
        nieuwe_waarde: {
          formulering,
          datum,
          verworpen_alternatieven: alternatieven,
          stap_id: body.stap_id || null,
          uitkomst: body.uitkomst,
          requirement_sleutel: binding.sleutel,
        },
      });
    }

    // ── Iteratie 3-A: notificatie naar de procedure-eigenaar ──
    // Als degene die de procedure startte iemand anders is dan
    // degene die het besluit vastlegt, krijgt hij/zij een melding —
    // "iemand heeft het besluit op uw procedure geregistreerd".
    if (proc.gestart_door && proc.fonds_id) {
      const preview =
        formulering.length > 120 ? formulering.slice(0, 120) + "…" : formulering;
      await notifyUser(
        supabase,
        "besluit_geregistreerd",
        proc.gestart_door,
        proc.fonds_id,
        {
          type: "besluit_geregistreerd",
          procedure_titel: proc.titel ?? "Procedure",
          besluit_formulering_preview: preview,
          actor_naam: ctx.naam || ctx.email || "Een collega",
        },
        {
          gerelateerd_aan_type: "procedure",
          gerelateerd_aan_id: id,
          // BESLUIT (W4): `|| undefined`. Waarde-identiek — notifyUser doet
          // `opts.actor_naam ?? null` — en typegeldig tegen
          // `NotifyOpts.actor_naam?: string`. Zelfde afweging als in inbreng.
          actor_naam: ctx.naam || undefined,
        }
      );
    }

    return NextResponse.json({ besluit });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/besluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
