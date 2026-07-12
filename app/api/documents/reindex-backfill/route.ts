import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { herindexeerDocument } from "@/core/lib/reindex";
import { INDEXERING_VERSIE, PREFIX_MODEL, PREFIX_PROMPT_VERSIE } from "@/core/lib/chunk-ingest";

// ============================================================================
//  POST /api/documents/reindex-backfill — gedeelde R1.1+R1.2-re-index (fonds).
// ----------------------------------------------------------------------------
//  Herindexeert bestaande FONDS-documenten naar de structuur-bewuste +
//  contextuele indexering. Verwerkt ÉÉN document per aanroep (her-extractie +
//  tientallen prefix-/embedding-calls) zodat de Vercel-functietimeout niet wordt
//  geraakt; de client roept herhaaldelijk aan tot `klaar`.
//
//  Selectie = chunks met indexering_versie IS NULL én bibliotheek='fonds'. De
//  bibliotheek-scope is essentieel: tenants zijn op generieke chunks read-only
//  (RLS), dus die horen hier niet en zouden anders nooit "klaar" raken — generiek
//  loopt via de platform-actie (service-role).
//
//  Rechten: alleen voorzitter/beheerder (server-side). Tenant-isolatie via RLS
//  (anon-key): selectie, chunk-vervanging en de reindex_runs-rij blijven binnen
//  het eigen fonds. `tekst` wordt nooit aangeraakt (omkeerbaar).
// ============================================================================

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
      .select("rol, fonds_id")
      .eq("id", user.id)
      .single();
    if (!profiel || !["voorzitter", "beheerder"].includes(profiel.rol)) {
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }
    if (!profiel.fonds_id) {
      return NextResponse.json({ error: "Geen fonds gekoppeld" }, { status: 400 });
    }

    // Hoeveel chunks resteren er nog vóór deze ronde (voortgangsindicatie).
    async function tellResterend(): Promise<number> {
      const { count } = await supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("bibliotheek", "fonds")
        .is("indexering_versie", null);
      return count ?? 0;
    }

    // Eén nog-baseline fondsdocument zoeken (via een baseline-chunk → document_id).
    const { data: chunkRij, error: selErr } = await supabase
      .from("document_chunks")
      .select("document_id")
      .eq("bibliotheek", "fonds")
      .is("indexering_versie", null)
      .limit(1)
      .maybeSingle();

    if (selErr) {
      console.error("[reindex-backfill] selectie mislukt:", selErr.message);
      return NextResponse.json({ error: "Selectie mislukt" }, { status: 500 });
    }
    if (!chunkRij) {
      return NextResponse.json({ verwerkt: 0, resterend: 0, klaar: true });
    }

    const { data: doc, error: docErr } = await supabase
      .from("documenten")
      .select("id, titel, opslag_pad, bestandstype")
      .eq("id", chunkRij.document_id)
      .single();

    if (docErr || !doc) {
      console.error("[reindex-backfill] document niet gevonden:", docErr?.message);
      return NextResponse.json({ error: "Document niet gevonden" }, { status: 500 });
    }

    const res = await herindexeerDocument(supabase, doc);

    // Per-run provenance (lichte registratie). Best-effort: een logfout mag de
    // re-index niet breken. fonds_id = eigen fonds (RLS-policy "fonds reindex_runs").
    const { error: runErr } = await supabase.from("reindex_runs").insert({
      fonds_id: profiel.fonds_id,
      bibliotheek: "fonds",
      prefix_model: PREFIX_MODEL,
      prompt_versie: PREFIX_PROMPT_VERSIE,
      indexering_versie: INDEXERING_VERSIE,
      aantal_documenten: res.status === "verwerkt" ? 1 : 0,
      aantal_chunks: res.aantalChunks,
      gestart_door: user.id,
    });
    if (runErr) console.error("[reindex-backfill] reindex_runs niet geschreven:", runErr.message);

    const resterend = await tellResterend();
    return NextResponse.json({
      document_id: doc.id,
      titel: doc.titel,
      status: res.status,
      reden: res.reden ?? null,
      aantal_chunks: res.aantalChunks,
      embeddings: res.embeddingsGelukt,
      verwerkt: res.status === "verwerkt" ? 1 : 0,
      overgeslagen: res.status === "overgeslagen" ? 1 : 0,
      resterend,
      klaar: resterend === 0,
    });
  } catch (e) {
    console.error("[reindex-backfill] fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
