import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

export const POST = withFondsRoute({ capability: "vergaderingen.manage" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      titel?: string;
      datum?: string;
      locatie?: string;
      status?: "gepland" | "in_voorbereiding" | "afgerond";
    };
    const { titel, datum, locatie, status } = body;

    if (!titel || !datum) {
      return NextResponse.json(
        { error: "Titel en datum zijn verplicht" },
        { status: 400 }
      );
    }

    if (!ctx.fondsId) {
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("vergaderingen")
      .insert({
        fonds_id: ctx.fondsId,
        titel,
        datum,
        locatie: locatie || null,
        status: status || "in_voorbereiding",
        aangemaakt_door: ctx.gebruikerId,
      })
      .select()
      .single();

    if (error) {
      console.error("Vergadering aanmaken fout:", error);
      return NextResponse.json({ error: "Vergadering aanmaken mislukt" }, { status: 500 });
    }

    return NextResponse.json({ vergadering: data });
  } catch (e) {
    console.error("Fout in /api/vergaderingen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
