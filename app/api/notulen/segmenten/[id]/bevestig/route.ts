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
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { maakChunksUitSegmenten } from "@/core/lib/rag";
import { embedTeksten, naarVectorLiteral, EMBED_MODEL } from "@/core/lib/embeddings";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited, badRequest } from "@/core/lib/api-errors";
import {
  preflight,
  preflightRespons,
  rondAf,
  sleutelUitRequest,
  vingerafdruk,
} from "@/core/lib/ai-preflight";

export const dynamic = "force-dynamic";

export const POST = withFondsRoute({}, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    if (!(await requireCapability(ctx.gebruikerId, "notulen.segment.confirm"))) {
      return NextResponse.json(
        { error: "Geen rechten om notulensegmenten te bevestigen." },
        { status: 403 }
      );
    }

    // AI-BEGRENZING (besluit 0180). Deze route riep Mistral-embeddings aan
    // ZONDER enige burstlimiet — als enige kostendragende route naast
    // /api/vergelijk. Limiet toegevoegd (nieuwe entry, geen bestaande drempel
    // gewijzigd) en fail-closed, want dit is een betaald pad.
    const limiet = await controleerLimiet(supabase, LIMIETEN.notulen_bevestig, {
      failClosed: true,
    });
    if (!limiet.toegestaan) return rateLimited("notulen.bevestig.POST", limiet.resetAt);

    const body = await req.json().catch(() => ({}));
    const reden: string | null = body?.reden?.trim?.() || null;

    // Idempotentie: verplichte header per gebruikersactie. Zonder sleutel is er
    // geen bescherming tegen een dubbele reservering bij een retry.
    const idempotentie = sleutelUitRequest(req, "notulen_bevestig");
    if (!idempotentie) {
      return badRequest(
        "notulen.bevestig.POST",
        "Verzoek mist een geldige Idempotency-Key. Vernieuw de pagina en probeer het opnieuw."
      );
    }

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

    // Reserveren vóór de eerste providercall. Eén bevestiging = één AI-actie,
    // ongeacht hoeveel embedding-batches eruit voortkomen.
    const pf = await preflight(supabase, {
      actietype: "notulen_bevestig",
      provider: "mistral",
      model: EMBED_MODEL,
      idempotentie,
      vingerafdruk: vingerafdruk({ segment: id, chunks: chunks.length }),
    });
    const blokkade = preflightRespons("notulen.bevestig.POST", pf);
    if (blokkade) return blokkade;
    const actieId = pf.uitkomst === "nieuw" ? pf.actieId : null;

    // Best-effort embeddings (graceful degradation: zonder vector blijft FTS werken).
    try {
      const vectoren = await embedTeksten(
        { supabase, label: "notulen.bevestig" },
        chunks.map((c) => c.tekst)
      );
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
      // De reservering blijft staan: het verbruik is al gemaakt, ook al liep de
      // opslag daarna stuk. Alleen de levenscyclus gaat op `mislukt`.
      await rondAf(supabase, actieId, "mislukt");
      return NextResponse.json({ error: "Bevestigen/indexeren mislukt." }, { status: 500 });
    }

    // Afgeleide indexeer-vlag (idempotent, cosmetisch).
    await supabase.from("documenten").update({ geindexeerd: true }).eq("id", document.id);

    await rondAf(supabase, actieId, "voltooid", `notulen_segment:${id}`);

    return NextResponse.json({
      success: true,
      segment_id: id,
      chunks_aangemaakt: chunkPayload.length,
    });
  } catch (e) {
    console.error("Fout in POST /api/notulen/segmenten/[id]/bevestig:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
});
