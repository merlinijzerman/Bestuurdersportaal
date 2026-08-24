// ============================================================
//  PATCH/DELETE /api/notulen/segmenten/[id] — Increment D
//
//  PATCH  — twee modi:
//    • Ont-bevestigen (`{ bevestigd: false }`): via RPC fn_notulen_segment_ontbevestig
//      — segmentchunks opruimen + audit in ÉÉN transactie (whole-document-chunks
//      worden NIET hersteld).
//    • Corrigeren (`{ titel?, agendapunt_id?, tekst? }`): ALLEEN op een nog
//      ONBEVESTIGD segment (een bevestigd/geïndexeerd segment is immutable tot het
//      wordt ont-bevestigd → 409). Geen chunks in het spel; per gewijzigd veld een
//      append-only auditregel.
//  DELETE — via RPC fn_notulen_segment_verwijder: segment weg (cascade ruimt de
//      segmentchunks) + audit in ÉÉN transactie.
//
//  Capability notulen.segment.confirm, server-side. RLS per fonds_id.
//  [id] = segment_id.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const PATCH = withFondsRoute({ capability: "notulen.segment.confirm", schema: z.object({ "agendapunt_id": z.unknown().optional(), "bevestigd": z.unknown().optional(), "reden": z.unknown().optional(), "tekst": z.unknown().optional(), "titel": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;
    if (!(await requireCapability(ctx.gebruikerId, "notulen.segment.confirm"))) {
      return NextResponse.json({ error: "Geen rechten" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const reden: string | null = body?.reden?.trim?.() || null;

    const { data: segment } = await supabase
      .from("notulen_segmenten")
      .select("id, document_id, titel, agendapunt_id, tekst, bevestigd")
      .eq("id", id)
      .maybeSingle();
    if (!segment) {
      return NextResponse.json({ error: "Segment niet gevonden" }, { status: 404 });
    }

    // ── Modus 1: ont-bevestigen (atomair via RPC) ──
    if (body?.bevestigd === false) {
      if (!segment.bevestigd) {
        return NextResponse.json({ success: true, segment_id: id, ont_bevestigd: false });
      }
      const { error: rpcError } = await supabase.rpc("fn_notulen_segment_ontbevestig", {
        p_segment_id: id,
        p_reden: reden,
      });
      if (rpcError) {
        console.error("Ont-bevestigen (RPC) mislukt:", rpcError);
        return NextResponse.json({ error: "Ont-bevestigen mislukt" }, { status: 500 });
      }
      return NextResponse.json({ success: true, segment_id: id, ont_bevestigd: true });
    }

    // ── Modus 2: corrigeren (alleen op onbevestigd segment) ──
    if (segment.bevestigd) {
      return NextResponse.json(
        {
          error:
            "Een bevestigd (geïndexeerd) segment is niet bewerkbaar. Ont-bevestig het eerst om titel, agendapunt of tekst te corrigeren.",
        },
        { status: 409 }
      );
    }

    const update: Record<string, unknown> = {};
    const logVelden: { veld: string; oud: string | null; nieuw: string | null }[] = [];
    if (typeof body?.titel === "string") {
      const nieuw = body.titel.trim() || null;
      update.titel = nieuw;
      logVelden.push({ veld: "segment_titel", oud: segment.titel, nieuw });
    }
    if ("agendapunt_id" in (body ?? {})) {
      const nieuw = body.agendapunt_id || null;
      update.agendapunt_id = nieuw;
      logVelden.push({ veld: "segment_agendapunt", oud: segment.agendapunt_id, nieuw });
    }
    if (typeof body?.tekst === "string" && body.tekst.trim()) {
      update.tekst = body.tekst;
      logVelden.push({ veld: "segment_tekst", oud: "(vorige tekst)", nieuw: "(gewijzigd)" });
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Geen wijzigingen opgegeven" }, { status: 400 });
    }

    const { error: updError } = await supabase
      .from("notulen_segmenten")
      .update(update)
      .eq("id", id);
    if (updError) {
      console.error("PATCH segment: bijwerken mislukt:", updError);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    // Per gewijzigd veld één append-only auditregel (correctie op onbevestigd
    // segment = reversibel, geen chunks → rag_impact=false).
    const { data: document } = await supabase
      .from("documenten")
      .select("titel, fonds_id")
      .eq("id", segment.document_id)
      .maybeSingle();

    const { error: logError } = await supabase.from("document_metadata_log").insert(
      logVelden.map((v) => ({
        document_id: segment.document_id,
        document_titel_snapshot: document?.titel ?? null,
        fonds_id: document?.fonds_id ?? null,
        gewijzigd_door: ctx.gebruikerId,
        gewijzigd_door_naam: ctx.naam ?? null,
        veld_naam: v.veld,
        oude_waarde: v.oud,
        nieuwe_waarde: v.nieuw,
        wijzig_reden: reden,
        wijzig_type: "notulen_segment",
        rag_impact: false,
      }))
    );
    if (logError) {
      console.error("PATCH segment: auditlog mislukt:", logError);
      return NextResponse.json(
        { error: "Correctie toegepast maar auditlog faalde — herhaal de correctie." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, segment_id: id });
  } catch (e) {
    console.error("Fout in PATCH /api/notulen/segmenten/[id]:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
});

export const DELETE = withFondsRoute({ capability: "notulen.segment.confirm", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;
    if (!(await requireCapability(ctx.gebruikerId, "notulen.segment.confirm"))) {
      return NextResponse.json({ error: "Geen rechten" }, { status: 403 });
    }

    // Verwijderen + cascade-chunkopruiming + audit in één RPC-transactie.
    const { error: rpcError } = await supabase.rpc("fn_notulen_segment_verwijder", {
      p_segment_id: id,
      p_reden: null,
    });
    if (rpcError) {
      console.error("DELETE segment (RPC) mislukt:", rpcError);
      return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
    }

    return NextResponse.json({ success: true, segment_id: id });
  } catch (e) {
    console.error("Fout in DELETE /api/notulen/segmenten/[id]:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
});
