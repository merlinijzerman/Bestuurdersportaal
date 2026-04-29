import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const TOEGESTANE_STATUSSEN = ["open", "in_voorbereiding", "genomen"] as const;
type Status = (typeof TOEGESTANE_STATUSSEN)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mid: string }> }
) {
  try {
    const { id, mid } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      status?: string;
      beschrijving?: string;
      verantwoordelijke?: string | null;
    };

    const updates: Record<string, unknown> = { bijgewerkt_op: new Date().toISOString() };
    let nieuweStatus: Status | undefined;

    if (body.status !== undefined) {
      if (!TOEGESTANE_STATUSSEN.includes(body.status as Status)) {
        return NextResponse.json(
          { error: "Ongeldige status" },
          { status: 400 }
        );
      }
      nieuweStatus = body.status as Status;
      updates.status = nieuweStatus;
    }
    if (body.beschrijving !== undefined) {
      const b = body.beschrijving.trim();
      if (!b) {
        return NextResponse.json(
          { error: "Beschrijving mag niet leeg zijn" },
          { status: 400 }
        );
      }
      updates.beschrijving = b;
    }
    if (body.verantwoordelijke !== undefined) {
      updates.verantwoordelijke = body.verantwoordelijke || null;
    }

    // Haal eerst de oude waarde op voor logging
    const { data: oude } = await supabase
      .from("risico_maatregelen")
      .select("status, beschrijving")
      .eq("id", mid)
      .eq("risico_id", id)
      .single();

    if (!oude) {
      return NextResponse.json(
        { error: "Maatregel niet gevonden" },
        { status: 404 }
      );
    }

    const { data: maatregel, error } = await supabase
      .from("risico_maatregelen")
      .update(updates)
      .eq("id", mid)
      .eq("risico_id", id)
      .select()
      .single();

    if (error || !maatregel) {
      console.error("Maatregel wijzigen fout:", error);
      return NextResponse.json(
        { error: error?.message || "Wijzigen mislukt" },
        { status: 500 }
      );
    }

    if (nieuweStatus && nieuweStatus !== oude.status) {
      const { data: profiel } = await supabase
        .from("profielen")
        .select("naam")
        .eq("id", user.id)
        .single();

      await supabase.from("risico_log").insert({
        risico_id: id,
        event_type: "maatregel_status_gewijzigd",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        payload: {
          maatregel_id: mid,
          beschrijving: oude.beschrijving,
          van: oude.status,
          naar: nieuweStatus,
        },
      });
    }

    return NextResponse.json({ maatregel });
  } catch (e) {
    console.error("Fout in PATCH /api/risicos/[id]/maatregelen/[mid]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
