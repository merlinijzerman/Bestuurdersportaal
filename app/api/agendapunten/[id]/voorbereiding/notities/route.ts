import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      eigen_notities?: Record<string, string>;
    };
    if (!body.eigen_notities || typeof body.eigen_notities !== "object") {
      return NextResponse.json(
        { error: "eigen_notities (object) is verplicht" },
        { status: 400 }
      );
    }

    const { data: voorbereiding, error } = await supabase
      .from("voorbereidingen")
      .update({
        eigen_notities: body.eigen_notities,
        bijgewerkt_op: new Date().toISOString(),
      })
      .eq("agendapunt_id", id)
      .eq("gebruiker_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("Notities-update fout:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!voorbereiding) {
      return NextResponse.json(
        { error: "Geen voorbereiding gevonden — genereer er eerst een" },
        { status: 404 }
      );
    }

    return NextResponse.json({ voorbereiding });
  } catch (e) {
    console.error("Fout in notities-route:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
