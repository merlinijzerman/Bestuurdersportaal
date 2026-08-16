import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { embedTeksten, embedTekst, naarVectorLiteral, EMBED_MODEL } from "@/core/lib/embeddings";
import { badRequest } from "@/core/lib/api-errors";
import {
  preflight,
  preflightRespons,
  rondAf,
  sleutelUitRequest,
  vingerafdruk,
} from "@/core/lib/ai-preflight";

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

// Klein gehouden zodat één aanroep ruim binnen de Vercel-functietimeout blijft
// (embeddings + losse updates per chunk). De client roept herhaaldelijk aan.
const BATCH = 25;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    // M-06 (review 2026-07-30): deze route doet per aanroep externe
    // modelcalls en had geen enkele limiet — onbeperkt herhaalbaar door een
    // geauthenticeerde gebruiker (kosten-DoS).
    // Fail-closed: bij een storing in de teller is doorlaten juist de duurste
    // optie (zie core/lib/rate-limit.ts).
    // F0.6 (bouwticket async-ingest v2.1): dit blok stond eerder BINNEN het
    // `if (!user)`-blok, ná de return — dus onbereikbaar (dode code). De limiet
    // gold daardoor nooit. Nu op dezelfde plek als her-extract/reindex-backfill:
    // direct ná de sessiecheck.
    const limiet = await controleerLimiet(supabase, LIMIETEN.backfill, { failClosed: true });
    if (!limiet.toegestaan) return rateLimited("documents.embeddings-backfill", limiet.resetAt);

    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol")
      .eq("id", user.id)
      .single();
    if (!profiel || !["voorzitter", "beheerder"].includes(profiel.rol)) {
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }

    // AI-BEGRENZING (besluit 0180). Eén backfill-aanroep = één AI-actie,
    // ongeacht hoeveel embedding-batches eruit voortkomen. De client draait deze
    // route in een lus tot de voorraad op is; elke lusstap reserveert dus, wat
    // klopt: elke stap is een eigen kostendragende handeling.
    const idempotentie = sleutelUitRequest(req, "embeddings_backfill");
    if (!idempotentie) {
      return badRequest(
        "documents.embeddings-backfill",
        "Verzoek mist een geldige Idempotency-Key. Vernieuw de pagina en probeer het opnieuw."
      );
    }

    // Eén batch nog-niet-verwerkte chunks. "Verwerkt" = heeft een embedding OF
    // is bewust overgeslagen (embedding_model gezet, embedding null). Zo blijft
    // een probleemchunk de backfill niet eindeloos blokkeren.
    const { data: chunks, error } = await supabase
      .from("document_chunks")
      .select("id, tekst")
      .is("embedding", null)
      .is("embedding_model", null)
      .limit(BATCH);

    if (error) {
      console.error("Backfill: ophalen chunks mislukt:", error);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({ verwerkt: 0, resterend: 0, klaar: true });
    }

    // Lege/whitespace-chunks kunnen niet ge-embed worden (Mistral 400). Markeer
    // ze als overgeslagen zodat ze niet opnieuw worden opgehaald.
    const leeg = chunks.filter((c) => !c.tekst || !(c.tekst as string).trim());
    const teEmbedden = chunks.filter((c) => c.tekst && (c.tekst as string).trim());

    let verwerkt = 0;
    let overgeslagen = 0;
    let geenRij = 0; // update zonder fout maar 0 rijen geraakt (stille RLS-blok)
    let eersteFout: string | null = null;

    for (const c of leeg) {
      await supabase
        .from("document_chunks")
        .update({ embedding_model: "overgeslagen" })
        .eq("id", c.id);
      overgeslagen++;
    }

    async function bewaar(id: string, vector: number[]) {
      const { data, error: upErr } = await supabase
        .from("document_chunks")
        .update({ embedding: naarVectorLiteral(vector), embedding_model: EMBED_MODEL })
        .eq("id", id)
        .select("id");
      if (upErr) {
        if (!eersteFout) eersteFout = upErr.message;
        return;
      }
      if (data && data.length > 0) verwerkt++;
      else geenRij++;
    }

    // Probeer de batch in één keer; lukt dat niet (één dwarsliggende chunk laat
    // de hele batch falen), val dan terug op chunk-voor-chunk zodat de goede wél
    // worden verwerkt en alleen de echte probleemgevallen worden overgeslagen.
    const pf = await preflight(supabase, {
      actietype: "embeddings_backfill",
      provider: "mistral",
      model: EMBED_MODEL,
      idempotentie,
      vingerafdruk: vingerafdruk({ ids: teEmbedden.map((c) => c.id) }),
    });
    const blokkade = preflightRespons("documents.embeddings-backfill", pf);
    if (blokkade) return blokkade;
    const actieId = pf.uitkomst === "nieuw" ? pf.actieId : null;
    const poort = { supabase, label: "documents.embeddings-backfill" };

    try {
      const vectoren = await embedTeksten(poort, teEmbedden.map((c) => c.tekst as string));
      for (let i = 0; i < teEmbedden.length; i++) {
        await bewaar(teEmbedden[i].id as string, vectoren[i]);
      }
    } catch (batchFout) {
      console.error("Backfill: batch mislukt, val terug op per chunk:", batchFout);
      for (const c of teEmbedden) {
        try {
          const vector = await embedTekst(poort, c.tekst as string);
          await bewaar(c.id as string, vector);
        } catch (chunkFout) {
          console.error(`Backfill: chunk ${c.id} overgeslagen:`, chunkFout);
          await supabase
            .from("document_chunks")
            .update({ embedding_model: "overgeslagen" })
            .eq("id", c.id);
          overgeslagen++;
        }
      }
    }

    // Hoeveel chunks resteren er nog (niet verwerkt én niet overgeslagen)?
    const { count } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null)
      .is("embedding_model", null);

    const resterend = count ?? 0;
    await rondAf(supabase, actieId, "voltooid");
    return NextResponse.json({
      verwerkt,
      overgeslagen,
      geenRij,
      eersteFout,
      resterend,
      klaar: resterend === 0,
    });
  } catch (e) {
    console.error("Backfill fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
