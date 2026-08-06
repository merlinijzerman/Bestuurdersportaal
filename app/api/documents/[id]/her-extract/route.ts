import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { bouwChunkRecords } from "@/core/lib/chunk-ingest";
import {
  diagnoseerExtractie,
  ONDERSTEUNDE_TYPES,
  type Bestandstype,
} from "@/core/lib/document-extractie";
import { extractTekstMetOcrFallback } from "@/core/lib/ocr";
import {
  FOUTCODE_OCR_TE_VEEL_PAGINAS,
  MAX_OCR_PAGINAS_SYNCHROON,
  ocrPaginaCapMelding,
} from "@/core/lib/ingest-caps";

// Deze route doet per aanroep de duurste keten die het portaal kent: storage-
// download → eventueel volledige OCR (Mistral, tot 3 pogingen × 60 s) → per
// chunk een context-prefix (Haiku) → embeddings. Zonder expliciete grens draait
// hij op de Vercel-default en breekt een grote scan halverwege af.
//
// Zelfde mitigatie als besluit 0023 voor de generieke curatiepagina; vereist het
// Vercel Pro-plan + fluid compute (bevestigd aanwezig). De paginacap hieronder
// (besluit 0134) is de tweede, hardere grens: maxDuration voorkomt afbreken,
// de cap voorkomt dat we er überhaupt tegenaan lopen.
export const maxDuration = 300;

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

  // M-06 (review 2026-07-30): deze route doet per aanroep externe modelcalls
  // (storage-download + eventueel volledige OCR + tientallen Haiku-calls +
  // embeddings) en had geen enkele limiet — onbeperkt herhaalbaar door elke
  // voorzitter/beheerder. Fail-closed: bij een storing in de teller is
  // doorlaten juist de duurste optie (zie core/lib/rate-limit.ts).
  const limiet = await controleerLimiet(supabase, LIMIETEN.her_extract, {
    failClosed: true,
  });
  if (!limiet.toegestaan) return rateLimited("documents.her-extract", limiet.resetAt);

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
    extractie = await extractTekstMetOcrFallback(buffer, bestandstype, {
      // Paginacap (besluit 0134). Bewust hier en niet vóór de download: pas ná
      // de goedkope tekstlaag-extractie weten we of OCR überhaupt nodig is. Een
      // groot document mét tekstlaag mag gewoon her-geïndexeerd worden — de
      // grens geldt alleen voor de OCR-stap.
      maxOcrPaginas: MAX_OCR_PAGINAS_SYNCHROON,
    });
  } catch (error) {
    console.error(`Her-extract: extractie ${bestandstype} mislukt:`, error);
    return NextResponse.json(
      { error: `Kon de inhoud van dit ${bestandstype.toUpperCase()}-bestand niet uitlezen.` },
      { status: 400 }
    );
  }

  const teWeinigTekst = !extractie.tekst || extractie.tekst.trim().length < 100;

  // Volgorde is bewust: de paginacap mag alleen blokkeren als er ook géén
  // bruikbare tekst is. `heeftOcrNodig` slaat namelijk óók aan op een dunne
  // maar echte tekstlaag (bijlagenboek, tekeningenbundel, presentatie-export).
  // Zou de cap dáár hard weigeren, dan kan zo'n document van meer dan
  // MAX_OCR_PAGINAS_SYNCHROON pagina's via geen enkel pad meer geïndexeerd
  // worden — een regressie ten opzichte van het oude gedrag, waar een mislukte
  // of overgeslagen OCR gewoon terugviel op de basistekst.
  if (teWeinigTekst && extractie.ocrOvergeslagen === "te_veel_paginas") {
    return NextResponse.json(
      {
        error: ocrPaginaCapMelding(
          extractie.aantalPaginas ?? MAX_OCR_PAGINAS_SYNCHROON
        ),
        foutcode: FOUTCODE_OCR_TE_VEEL_PAGINAS,
      },
      { status: 413 }
    );
  }

  if (teWeinigTekst) {
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

  // ── H-09 (review 2026-07-30): vervanging is nu ATOMAIR ─────────────────
  // Voorheen werden EERST alle chunks verwijderd en pas daarna de nieuwe
  // ingevoegd. Faalde die insert (of liep de functie tegen de Vercel-timeout
  // aan), dan bleef het document chunkloos achter terwijl `geindexeerd` op
  // `true` bleef staan: permanent onvindbaar, zonder statussignaal en zonder
  // retry. Herstel vroeg handmatig ingrijpen.
  //
  // Nu: het document gaat eerst op `geindexeerd = false` (zodat het tijdens de
  // vervanging niet als volledig geïndexeerd geldt), daarna worden de nieuwe
  // chunks opgebouwd, en pas als die klaarstaan wisselen we ze in één keer om.
  // Bij een fout in de insertfase draaien we terug naar de lege staat en geven
  // we een expliciete fout — nooit een half-geïndexeerd document dat zich als
  // volledig presenteert.
  await supabase.from("documenten").update({ geindexeerd: false }).eq("id", id);

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

  // Pas hier — nadat de dure stappen (extractie, OCR, context-prefix,
  // embeddings) zijn geslaagd — vervangen we de bestaande chunks.
  const { error: deleteError } = await supabase
    .from("document_chunks")
    .delete()
    .eq("document_id", id);

  if (deleteError) {
    console.error("Her-extract: oude chunks verwijderen mislukt:", deleteError);
    // Niets verwijderd, niets ingevoegd: de oude index staat er nog. Alleen
    // `geindexeerd` terugzetten.
    await supabase.from("documenten").update({ geindexeerd: true }).eq("id", id);
    return NextResponse.json(
      { error: "Kon de bestaande fragmenten niet vervangen." },
      { status: 500 }
    );
  }

  const batchGrootte = 50;
  for (let i = 0; i < chunkRecords.length; i += batchGrootte) {
    const batch = chunkRecords.slice(i, i + batchGrootte);
    const { error: chunkError } = await supabase
      .from("document_chunks")
      .insert(batch);
    if (chunkError) {
      console.error(
        `[her-extract] chunks opslaan mislukt voor document ${id} ` +
          `(batch ${i / batchGrootte + 1}):`,
        chunkError
      );
      // Fail-closed opruimen: geen deels vervangen index laten staan. Het
      // document blijft op geindexeerd = false, dus het presenteert zich niet
      // als volledig verwerkt en kan opnieuw worden geïndexeerd.
      await supabase.from("document_chunks").delete().eq("document_id", id);
      return NextResponse.json(
        {
          error:
            "Kon de nieuwe fragmenten niet opslaan. Het document staat nu als niet-geïndexeerd; probeer de her-indexering opnieuw.",
          foutcode: "indexering_mislukt",
        },
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
