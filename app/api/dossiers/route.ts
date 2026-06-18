// ============================================================
//  GET /api/dossiers — Increment B
//
//  Lijst van dossiers (procesinstanties) van het eigen fonds, met de
//  EFFECTIEVE dossierstatus + sublabel uit `vw_dossier_status`. De view
//  leidt de status af uit het primaire Decision Object (TO §3.2) en valt
//  terug op de handmatige `procedures.status` als er geen DO is.
//
//  Tenant-isolatie loopt via RLS (anon-key + fonds_id op procedures/
//  decision_objects, view = security_invoker). Geen service-role.
// ============================================================

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    // Procedures van het eigen fonds (RLS dwingt fonds_id af; expliciete
    // filter laten we weg en vertrouwen op de policy — net als de overige
    // dossier-reads). We selecteren de periode-/metadata-velden hier.
    const { data: procedures, error: procFout } = await supabase
      .from("procedures")
      .select(
        "id, template_code, titel, beschrijving, status, gestart_op, deadline, periode_type, periode_start, periode_eind, periode_jaar, procesmodel_id"
      )
      .order("gestart_op", { ascending: false });
    if (procFout) {
      console.error("Dossiers ophalen fout:", procFout);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }

    // Afgeleide status per dossier uit de view.
    const { data: statusRijen, error: viewFout } = await supabase
      .from("vw_dossier_status")
      .select(
        "procedure_id, decision_id, decision_status, afgeleid_van_decision, dossierstatus, sublabel"
      );
    if (viewFout) {
      console.error("vw_dossier_status fout:", viewFout);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }

    const statusPerProc = new Map(
      (statusRijen || []).map((r: { procedure_id: string }) => [
        r.procedure_id,
        r,
      ])
    );

    const dossiers = (procedures || []).map((p: { id: string }) => ({
      ...p,
      status_view: statusPerProc.get(p.id) ?? null,
    }));

    return NextResponse.json({ dossiers });
  } catch (e) {
    console.error("Fout in GET /api/dossiers:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
