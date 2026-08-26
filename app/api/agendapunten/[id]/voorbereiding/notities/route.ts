import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "agendapunten.manage", schema: z.object({ "eigen_notities": z.unknown().optional(), "vrije_notities": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      eigen_notities?: Record<string, string>;
      vrije_notities?: string | null;
    };

    const heeftEigen =
      body.eigen_notities !== undefined &&
      body.eigen_notities !== null &&
      typeof body.eigen_notities === "object";
    const heeftVrij =
      body.vrije_notities !== undefined; // mag ook leeg of null zijn

    if (!heeftEigen && !heeftVrij) {
      return NextResponse.json(
        { error: "Geef eigen_notities of vrije_notities mee" },
        { status: 400 }
      );
    }

    // Controleer of het agendapunt bestaat en binnen het fonds valt (RLS doet dat impliciet)
    const { data: agendapunt, error: apFout } = await supabase
      .from("agendapunten")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (apFout) {
      console.error("Agendapunt-lookup fout:", apFout);
      return NextResponse.json({ error: "Notities opslaan mislukt" }, { status: 500 });
    }
    if (!agendapunt) {
      return NextResponse.json({ error: "Agendapunt niet gevonden" }, { status: 404 });
    }

    // Bouw payload — alleen meegegeven velden meesturen om bestaande
    // AI-output of andere notities niet te overschrijven.
    const update: Record<string, unknown> = {
      bijgewerkt_op: new Date().toISOString(),
    };
    if (heeftEigen) update.eigen_notities = body.eigen_notities;
    if (heeftVrij) update.vrije_notities = body.vrije_notities;

    // Probeer eerst te updaten; als er geen rij is, doe een insert.
    const { data: bestaand } = await supabase
      .from("voorbereidingen")
      .select("id")
      .eq("agendapunt_id", id)
      .eq("gebruiker_id", ctx.gebruikerId)
      .maybeSingle();

    let voorbereiding;
    if (bestaand) {
      const { data, error } = await supabase
        .from("voorbereidingen")
        .update(update)
        .eq("agendapunt_id", id)
        .eq("gebruiker_id", ctx.gebruikerId)
        .select()
        .single();
      if (error) {
        console.error("Notities-update fout:", error);
        return NextResponse.json({ error: "Notities opslaan mislukt" }, { status: 500 });
      }
      voorbereiding = data;
    } else {
      // Eerste keer dat de gebruiker iets opslaat — maak een lege voorbereiding aan.
      // ai_output blijft default '{}' (geen AI-output gegenereerd).
      const insertPayload: Record<string, unknown> = {
        agendapunt_id: id,
        gebruiker_id: ctx.gebruikerId,
        ...update,
      };
      if (!heeftEigen) insertPayload.eigen_notities = {};
      const { data, error } = await supabase
        .from("voorbereidingen")
        .insert(insertPayload)
        .select()
        .single();
      if (error) {
        console.error("Notities-insert fout:", error);
        return NextResponse.json({ error: "Notities opslaan mislukt" }, { status: 500 });
      }
      voorbereiding = data;
    }

    return NextResponse.json({ voorbereiding });
  } catch (e) {
    console.error("Fout in notities-route:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
