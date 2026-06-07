import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { embedTeksten, naarVectorLiteral, EMBED_MODEL } from "@/lib/embeddings";

// ============================================================
//  POST /api/documents/embeddings-backfill
//
//  Vult embeddings voor bestaande chunks die er nog geen hebben (Fase C).
//  Verwerkt één batch per aanroep en rapporteert hoeveel er resteren, zodat de
//  client herhaaldelijk kan aanroepen zonder Vercel-timeouts te raken.
//
//  Alleen voor voorzitter/beheerder. RLS beperkt de zichtbare/aan te passen
//  chunks tot het eigen fonds (+ generiek). Raakt het zoekgedrag niet:
//  embeddings worden enkel gevuld; de hybride zoekroute staat los hiervan.
// ============================================================

const BATCH = 200;

export async function POST(_req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol")
      .eq("id", user.id)
      .single();
    if (!profiel || !["voorzitter", "beheerder"].includes(profiel.rol)) {
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }

    // Eén batch chunks zonder embedding (RLS: eigen fonds + generiek).
    const { data: chunks, error } = await supabase
      .from("document_chunks")
      .select("id, tekst")
      .is("embedding", null)
      .limit(BATCH);

    if (error) {
      console.error("Backfill: ophalen chunks mislukt:", error);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({ verwerkt: 0, resterend: 0, klaar: true });
    }

    let vectoren: number[][];
    try {
      vectoren = await embedTeksten(chunks.map((c) => c.tekst as string));
    } catch (embedError) {
      console.error("Backfill: embedding-API fout:", embedError);
      return NextResponse.json(
        { error: "Embedding-API fout — probeer opnieuw." },
        { status: 502 }
      );
    }

    let verwerkt = 0;
    for (let i = 0; i < chunks.length; i++) {
      const { error: upErr } = await supabase
        .from("document_chunks")
        .update({
          embedding: naarVectorLiteral(vectoren[i]),
          embedding_model: EMBED_MODEL,
        })
        .eq("id", chunks[i].id);
      if (!upErr) verwerkt++;
    }

    // Hoeveel chunks resteren er nog zonder embedding?
    const { count } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    const resterend = count ?? 0;
    return NextResponse.json({ verwerkt, resterend, klaar: resterend === 0 });
  } catch (e) {
    console.error("Backfill fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
