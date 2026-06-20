// ============================================================
//  POST /api/notulen/segmenten/[id]/bevestig — Increment D
//
//  Bevestigt één notulensegment EN indexeert het transactioneel: segmentchunks
//  vervangen de whole-document-chunks (keuze 2). De RPC fn_notulen_segment_bevestig
//  doet de bevestiging, de chunk-vervanging én de append-only audit in ÉÉN
//  transactie (audit-evidence-review D / R2). Alleen toegestaan als de notulen
//  status='vastgesteld' dragen.
//
//  Corrigeren (hernoemen / agendapunt koppelen / tekst) gebeurt VOORAF via
//  PATCH /api/notulen/segmenten/[id] op het nog onbevestigde segment — een
//  bevestigd (= geïndexeerd) segment is immutable tot het wordt ont-bevestigd.
//
//  Capability notulen.segment.confirm, server-side. RLS per fonds_id.
//  [id] = segment_id.  Body (optioneel): { reden? }.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { requireCapability } from "@/lib/capabilities";
import { maakChunksUitSegmenten } from "@/lib/rag";
import { embedTeksten, naarVectorLiteral, EMBED_MODEL } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    if (!(await requireCapability(user.id, "notulen.segment.confirm"))) {
      return NextResponse.json(
        { error: "Geen rechten om notulensegmenten te bevestigen." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const reden: string | null = body?.reden?.trim?.() || null;

    // Segment laden (RLS: eigen fonds).
    const { data: segment, error: segError } = await supabase
      .from("notulen_segmenten")
      .select("id, document_id, tekst")
      .eq("id", id)
      .maybeSingle();
    if (segError || !segment) {
      return NextResponse.json({ error: "Segment niet gevonden" }, { status: 404 });
    }

    // Statusgate (UX-pre-check; de RPC herbevestigt deze server-side).
    const { data: document } = await supabase
      .from("documenten")
      .select("id, status")
      .eq("id", segment.document_id)
      .maybeSingle();
    if (!document) {
      return NextResponse.json({ error: "Bovenliggend document niet gevonden" }, { status: 404 });
    }
    if (document.status !== "vastgesteld") {
      return NextResponse.json(
        {
          error:
            "Notulen zijn nog niet vastgesteld; een segment kan pas worden bevestigd en geïndexeerd zodra de notulen status 'vastgesteld' hebben.",
          documentstatus: document.status,
        },
        { status: 409 }
      );
    }

    // Chunks + embeddings opbouwen uit de segmenttekst.
    const chunks = maakChunksUitSegmenten([
      { pagina: null, paragraaf: null, tekst: segment.tekst },
    ]);
    if (chunks.length === 0) {
      return NextResponse.json(
        {
          error:
            "Dit segment levert geen doorzoekbare inhoud op (te weinig tekst). Voeg tekst toe of voeg het samen met een ander segment.",
        },
        { status: 400 }
      );
    }

    const chunkPayload: {
      chunk_index: number;
      tekst: string;
      pagina: number | null;
      paragraaf: string | null;
      embedding: string | null;
      embedding_model: string | null;
    }[] = chunks.map((c, i) => ({
      chunk_index: i,
      tekst: c.tekst,
      pagina: c.pagina,
      paragraaf: c.paragraaf,
      embedding: null,
      embedding_model: null,
    }));

    // Best-effort embeddings (graceful degradation: zonder vector blijft FTS werken).
    try {
      const vectoren = await embedTeksten(chunks.map((c) => c.tekst));
      if (vectoren.length === chunkPayload.length) {
        chunkPayload.forEach((rec, i) => {
          rec.embedding = naarVectorLiteral(vectoren[i]);
          rec.embedding_model = EMBED_MODEL;
        });
      }
    } catch (embedError) {
      console.error("Bevestig: embeddings mislukt — chunks zonder vector:", embedError);
    }

    // Bevestigen + transactioneel (her)indexeren + audit in één RPC-transactie.
    const { error: rpcError } = await supabase.rpc("fn_notulen_segment_bevestig", {
      p_segment_id: id,
      p_chunks: chunkPayload,
      p_reden: reden,
    });
    if (rpcError) {
      console.error("Bevestig: indexering (RPC) mislukt:", rpcError);
      return NextResponse.json({ error: "Bevestigen/indexeren mislukt." }, { status: 500 });
    }

    // Afgeleide indexeer-vlag (idempotent, cosmetisch).
    await supabase.from("documenten").update({ geindexeerd: true }).eq("id", document.id);

    return NextResponse.json({
      success: true,
      segment_id: id,
      chunks_aangemaakt: chunkPayload.length,
    });
  } catch (e) {
    console.error("Fout in POST /api/notulen/segmenten/[id]/bevestig:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
