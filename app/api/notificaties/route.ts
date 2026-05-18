// ============================================================
//  GET /api/notificaties — Iteratie 3-A
//
//  Eigen notificaties, nieuwste eerst, gepagineerd.
//  Query params:
//    ?ongelezen=true       — filter op ongelezen
//    ?limit=20 (default)   — max rijen
//    ?offset=0  (default)  — pagination offset
//
//  RLS zorgt dat je alleen je eigen rijen ziet.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const url = new URL(req.url);
    const ongelezen = url.searchParams.get("ongelezen") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    let query = supabase
      .from("notificaties")
      .select("*")
      .order("aangemaakt", { ascending: false })
      .range(offset, offset + limit - 1);

    if (ongelezen) {
      query = query.is("gelezen_op", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Notificaties ophalen fout:", error);
      return NextResponse.json({ error: "Notificaties ophalen mislukt" }, { status: 500 });
    }

    // Totaal-ongelezen-teller voor het sidebar-badge (toekomstig)
    const { count: ongelezenTotaal } = await supabase
      .from("notificaties")
      .select("id", { count: "exact", head: true })
      .is("gelezen_op", null);

    return NextResponse.json({
      notificaties: data ?? [],
      ongelezen_totaal: ongelezenTotaal ?? 0,
    });
  } catch (e) {
    console.error("Fout in GET /api/notificaties:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
