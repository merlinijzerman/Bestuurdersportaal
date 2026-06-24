import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { bouwChunkRecords } from "@/lib/chunk-ingest";
import {
  diagnoseerExtractie,
  ONDERSTEUNDE_TYPES,
  type Bestandstype,
} from "@/lib/document-extractie";
import { extractTekstMetOcrFallback } from "@/lib/ocr";

// POST /api/documents/[id]/her-extract
//
// Haalt het origineel uit Storage, draait de (verbeterde) extractie-pipeline
// opnieuw en vervangt de chunks. Nuttig om bestaande documenten te laten
// profiteren van pipeline-verbeteringen (zoals pagina-/sectie-metadata uit
// Fase 1b). Verandert geen broninhoud — alleen de afgeleide chunks.
//
// Rechten: alleen voorzitter/beheerder, server-side afgedwongen.
// Tenant-isolatie via RLS (anon-key): de document- en chunk-policies filteren
// per fonds; een gebruiker kan alleen documenten van het eigen fonds (of de
// generieke bibliotheek) her-extracten.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const isVoorzitterOfBeheerder =
    profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";
  if (!isVoorzitterOfBeheerder) {
    return NextResponse.json(
      { error: "Alleen voorzitter of beheerder mag een document her-indexeren." },
      { status: 403 }
    );
  }

  const { data: document, error: docError } = await supabase
    .from("documenten")
    .select("id, titel, opslag_pad, bestandstype")
    .eq("id", id)
    .single();

  if (docError || !document) {
    return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
  }

  if (!document.opslag_pad) {
    return NextResponse.json(
      {
        error:
          "Het origineel van dit document is niet beschikbaar (geüpload vóór de inzage-functionaliteit). Her-indexeren is alleen mogelijk door opnieuw te uploaden.",
      },
      { status: 410 }
    );
  }

  const bestandstype = (document.bestandstype as Bestandstype) || "pdf";
  if (!ONDERSTEUNDE_TYPES.includes(bestandstype)) {
    return NextResponse.json(
      { error: `Bestandstype '${bestandstype}' wordt niet ondersteund.` },
      { status: 400 }
    );
  }

  // Origineel ophalen uit Storage (RLS dekt de toegang).
  const { data: bestand, error: storageError } = await supabase.storage
    .from("documenten")
    .download(document.opslag_pad);

  if (storageError || !bestand) {
    console.error("Her-extract: ophalen origineel mislukt:", storageError);
    return NextResponse.json(
      { error: "Kon het origineel niet ophalen uit de opslag." },
      { status: 500 }
    );
  }

  const buffer = Buffer.from(await bestand.arrayBuffer());

  // Extractie met OCR-fallback (besluit 0020): eerst de goedkope tekstlaag,
  // alleen bij een te dunne uitkomst valt dit terug op Mistral OCR. Faalt OCR
  // (bv. corrupte PDF), dan komt het originele (lege) resultaat terug en vangt
  // de tekst-drempel hieronder dat gracieus af.
  let extractie;
  try {
    extractie = await extractTekstMetOcrFallback(buffer, bestandstype);
  } catch (error) {
    console.error(`Her-extract: extractie ${bestandstype} mislukt:`, error);
    return NextResponse.json(
      { error: `Kon de inhoud van dit ${bestandstype.toUpperCase()}-bestand niet uitlezen.` },
      { status: 400 }
    );
  }

  if (!extractie.tekst || extractie.tekst.trim().length < 100) {
    return NextResponse.json(
      {
        error:
          "Her-extractie leverde te weinig tekst op — mogelijk een gescand of corrupt document waaruit ook OCR geen tekst kon halen.",
      },
      { status: 400 }
    );
  }

  if (bestandstype === "pdf") {
    const diag = diagnoseerExtractie(extractie.tekst);
    if (diag.percentageVerdacht > 5 && diag.langeWoorden >= 3) {
      console.warn(
        `[her-extract] Verdachte lange woorden voor doc ${id}: ` +
          `${diag.langeWoorden}/${diag.totaalWoorden} (${diag.percentageVerdacht.toFixed(1)}%).`
      );
    }
  }

  // Bestaande chunks vervangen. Eerst weg (RLS-policy "fonds chunks" dekt
  // delete én insert), daarna de nieuwe pagina-bewuste chunks inserten.
  const { error: deleteError } = await supabase
    .from("document_chunks")
    .delete()
    .eq("document_id", id);

  if (deleteError) {
    console.error("Her-extract: oude chunks verwijderen mislukt:", deleteError);
    return NextResponse.json(
      { error: "Kon de bestaande fragmenten niet vervangen." },
      { status: 500 }
    );
  }

  // R1.1 + R1.2 — gedeelde ingest: structuur-bewuste chunking + context-prefix
  // (Haiku) + embedding over de VERRIJKTE tekst. Anders dan voorheen embed de
  // her-index nu óók (gedeeld pad), zodat een her-geïndexeerd document meteen
  // contextueel zoekbaar is en niet op de losse embeddings-backfill hoeft te
  // wachten. `tekst` blijft het originele fragment (weergaveveld).
  const { records: chunkRecords, aantalChunks } = await bouwChunkRecords({
    documentId: id,
    titel: document.titel,
    segmenten: extractie.segmenten,
  });

  const batchGrootte = 50;
  for (let i = 0; i < chunkRecords.length; i += batchGrootte) {
    const batch = chunkRecords.slice(i, i + batchGrootte);
    const { error: chunkError } = await supabase
      .from("document_chunks")
      .insert(batch);
    if (chunkError) {
      console.error("Her-extract: chunks opslaan mislukt:", chunkError);
      return NextResponse.json(
        { error: "Kon de nieuwe fragmenten niet opslaan." },
        { status: 500 }
      );
    }
  }

  // Audit-velden (ocr_toegepast/ocr_engine, besluit 0020) gevouwen in dezelfde
  // update. Best-effort: draait de migratie 2026_06_22x_ocr_audit nog niet, dan
  // breekt de her-extract niet — we loggen en gaan door.
  const { error: updateError } = await supabase
    .from("documenten")
    .update({
      geindexeerd: true,
      paginas: extractie.aantalPaginas,
      ocr_toegepast: extractie.ocrToegepast,
      ocr_engine: extractie.ocrEngine,
    })
    .eq("id", id);

  if (updateError) {
    console.warn(
      `[her-extract] Document-update (incl. OCR-audit) mislukt voor ${id} — ` +
        `chunks zijn wel vervangen:`,
      updateError.message
    );
  }

  return NextResponse.json({
    success: true,
    document_id: id,
    chunks_aangemaakt: aantalChunks,
    paginas: extractie.aantalPaginas,
    ocr_toegepast: extractie.ocrToegepast,
    bericht: `Document opnieuw geïndexeerd: ${aantalChunks} fragmenten${
      extractie.ocrToegepast ? " (via OCR)" : ""
    }.`,
  });
}
