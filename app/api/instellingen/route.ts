import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

// ============================================================
//  /api/instellingen — runtime-instellingen per fonds.
//
//  GET  : huidige instellingen van het eigen fonds (default uit env-vlag).
//  POST : { hybride_zoeken: boolean } — alleen voorzitter/beheerder.
//  RLS beperkt alles tot het eigen fonds.
// ============================================================

async function fondsVanGebruiker() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profiel: null };
  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id, rol")
    .eq("id", user.id)
    .single();
  return { supabase, user, profiel };
}

export async function GET() {
  try {
    const { supabase, user, profiel } = await fondsVanGebruiker();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    if (!profiel?.fonds_id)
      return NextResponse.json({ error: "Geen fonds" }, { status: 400 });

    const { data } = await supabase
      .from("fonds_instellingen")
      .select("hybride_zoeken")
      .eq("fonds_id", profiel.fonds_id)
      .maybeSingle();

    const hybride =
      data?.hybride_zoeken ?? process.env.HYBRID_SEARCH === "on";

    return NextResponse.json({
      hybride_zoeken: hybride,
      mag_beheren: ["voorzitter", "beheerder"].includes(profiel.rol),
    });
  } catch (e) {
    console.error("Instellingen GET fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user, profiel } = await fondsVanGebruiker();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    if (!profiel?.fonds_id)
      return NextResponse.json({ error: "Geen fonds" }, { status: 400 });
    if (!["voorzitter", "beheerder"].includes(profiel.rol))
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });

    const body = (await req.json()) as { hybride_zoeken?: boolean };
    if (typeof body.hybride_zoeken !== "boolean")
      return NextResponse.json({ error: "hybride_zoeken (boolean) vereist" }, { status: 400 });

    const { error } = await supabase.from("fonds_instellingen").upsert(
      {
        fonds_id: profiel.fonds_id,
        hybride_zoeken: body.hybride_zoeken,
        bijgewerkt: new Date().toISOString(),
      },
      { onConflict: "fonds_id" }
    );
    if (error) {
      console.error("Instellingen opslaan fout:", error);
      return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });
    }

    return NextResponse.json({ hybride_zoeken: body.hybride_zoeken });
  } catch (e) {
    console.error("Instellingen POST fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
