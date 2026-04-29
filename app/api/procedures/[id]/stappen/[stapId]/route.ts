import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stapId: string }> }
) {
  try {
    const { id, stapId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as { status?: "actief" | "afgerond" };
    if (body.status !== "afgerond" && body.status !== "actief") {
      return NextResponse.json(
        { error: "Ongeldige status" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .single();

    // Haal de stap op
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, status, procedure_id, volgorde, vereist_besluit")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json(
        { error: "Stap niet gevonden" },
        { status: 404 }
      );
    }

    if (body.status === "afgerond") {
      // Voor 'afgerond': controleer dat alle checklist-items voldaan zijn
      // en dat eventueel vereist besluit is vastgelegd
      const { data: checklistRijen } = await supabase
        .from("procedure_checklist")
        .select("voldaan, bewijs_vereist")
        .eq("stap_id", stapId);
      const checklist = checklistRijen || [];
      const allesVoldaan = checklist.every(
        (c: { voldaan: boolean }) => c.voldaan
      );
      if (!allesVoldaan) {
        return NextResponse.json(
          { error: "Niet alle checklist-items zijn voldaan" },
          { status: 400 }
        );
      }
      const heeftBewijsVereisten = checklist.some(
        (c: { bewijs_vereist: boolean }) => c.bewijs_vereist
      );
      if (heeftBewijsVereisten) {
        const { count } = await supabase
          .from("procedure_bewijs")
          .select("id", { count: "exact", head: true })
          .eq("stap_id", stapId);
        if (!count || count === 0) {
          return NextResponse.json(
            { error: "Bewijsstukken vereist maar niet aanwezig" },
            { status: 400 }
          );
        }
      }
      if (stap.vereist_besluit) {
        const { count } = await supabase
          .from("procedure_besluiten")
          .select("id", { count: "exact", head: true })
          .eq("stap_id", stapId);
        if (!count || count === 0) {
          return NextResponse.json(
            { error: "Stap vereist een formeel besluit dat nog niet is vastgelegd" },
            { status: 400 }
          );
        }
      }

      // Stap zelf op afgerond
      const { error: updateFout } = await supabase
        .from("procedure_stappen")
        .update({
          status: "afgerond",
          voltooid_op: new Date().toISOString(),
          voltooid_door: user.id,
        })
        .eq("id", stapId);
      if (updateFout) {
        return NextResponse.json(
          { error: updateFout.message },
          { status: 500 }
        );
      }

      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: "stap_voltooid",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        payload: { stap: stap.naam },
      });

      // Volgende stap activeren — of procedure afronden
      const { data: volgendeStap } = await supabase
        .from("procedure_stappen")
        .select("id, naam")
        .eq("procedure_id", id)
        .gt("volgorde", stap.volgorde)
        .order("volgorde", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (volgendeStap) {
        await supabase
          .from("procedure_stappen")
          .update({ status: "actief" })
          .eq("id", volgendeStap.id);
        await supabase.from("procedure_log").insert({
          procedure_id: id,
          event_type: "stap_gestart",
          actor_id: user.id,
          actor_naam: profiel?.naam || null,
          payload: { stap: volgendeStap.naam },
        });
      } else {
        // Geen volgende stap — procedure is klaar
        await supabase
          .from("procedures")
          .update({
            status: "afgerond",
            afgerond_op: new Date().toISOString(),
          })
          .eq("id", id);
      }

      return NextResponse.json({ ok: true });
    }

    // status='actief' — handmatig activeren (gebruikt bij latere edits)
    const { error: updateFout } = await supabase
      .from("procedure_stappen")
      .update({ status: "actief" })
      .eq("id", stapId);
    if (updateFout) {
      return NextResponse.json({ error: updateFout.message }, { status: 500 });
    }
    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "stap_gestart",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { stap: stap.naam },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/stappen/[stapId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
