// ============================================================================
//  lib/generiek-pipeline.ts — Increment P1/B14 (platform back-office, §8.2).
// ----------------------------------------------------------------------------
//  Synchrone uploadsecurity-/verwerkingspipeline voor een AL gevalideerd en in
//  `documenten` weggeschreven generiek document. Draait UITSLUITEND achter
//  withPlatform (service-role-client wordt doorgegeven; deze module opent zelf
//  geen client en importeert supabase-platform niet). Per stap:
//    scan(mock) → extractie → (opslag) → chunking → embedding → indexering,
//  met per-stap een document_processing_jobs-rij (FO §21.1) en een lopende
//  documenten.verwerkingsstatus. RAG-availability-gate werkt via afwezigheid van
//  chunks: een doc dat 'mislukt'/'geweigerd' raakt, krijgt nooit chunks.
//
//  Malwarescan is UITGESTELD (WP3, decisions/0022): de scan-stap is hier een
//  expliciet 'overgeslagen' job, GEEN stille no-op. Zodra WP3 landt, verplaatst
//  een verdacht bestand naar de quarantainebucket en zet verwerkingsstatus
//  'gequarantineerd'.
//
//  "server-only": pipeline raakt storage/embeddings; nooit client-importeerbaar.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTENT_TYPE_PER_BESTANDSTYPE,
  type Bestandstype,
} from "./document-extractie";
import { extractTekstMetOcrFallback } from "./ocr";
import { bouwChunkRecords } from "./chunk-ingest";

export const STORAGE_BUCKET = "documenten";
export const GENERIEK_PAD_PREFIX = "generiek";

// Private, deny-by-default zone waar een upload eerst landt (signed upload URL,
// geen RLS-policy). De server valideert de kopie hier en promoveert pas daarna
// naar STORAGE_BUCKET; daarna wordt de quarantaine-kopie verwijderd. Zie
// supabase/migrations/2026_06_24_storage_quarantaine.sql.
export const QUARANTAINE_BUCKET = "documenten-quarantaine";

export type PipelineResultaat =
  | {
      ok: true;
      paginas: number | null;
      chunks: number;
      embeddings: boolean;
      verwerkingsstatus: "beschikbaar";
    }
  | {
      ok: false;
      foutcode: "geen_tekst" | "extractie_mislukt";
      verwerkingsstatus: "mislukt";
    };

type JobStap =
  | "validatie"
  | "scan"
  | "extractie"
  | "ocr"
  | "chunking"
  | "embedding"
  | "indexering";
type JobStatus = "geslaagd" | "mislukt" | "overgeslagen";

async function schrijfJob(
  svc: SupabaseClient,
  p: {
    documentId: string;
    versieId?: string | null;
    correlatieId: string;
    stap: JobStap;
    status: JobStatus;
    start: string;
    foutcode?: string | null;
  }
): Promise<void> {
  // Lichte registratie (middenweg): synchroon, geen queue/worker (= TO/P5).
  // Best-effort: een job-logfout mag de verwerking niet breken.
  const { error } = await svc.from("document_processing_jobs").insert({
    document_id: p.documentId,
    versie_id: p.versieId ?? null,
    stap: p.stap,
    status: p.status,
    start: p.start,
    eind: new Date().toISOString(),
    foutcode: p.foutcode ?? null,
    correlatie_id: p.correlatieId,
  });
  if (error) console.error(`[P1-pipeline] job '${p.stap}' niet geregistreerd:`, error.message);
}

async function zetStatus(
  svc: SupabaseClient,
  documentId: string,
  verwerkingsstatus: string
): Promise<void> {
  await svc.from("documenten").update({ verwerkingsstatus }).eq("id", documentId);
}

/** Verwerkt een gevalideerd generiek document tot 'beschikbaar' (of 'mislukt').
 *  De documenten-rij bestaat al (met de §8.1-metadata, bestand_hash, bestandstype
 *  en verwerkingsstatus='gevalideerd'); deze functie doet de rest van de keten. */
export async function verwerkGeneriekBestand(
  svc: SupabaseClient,
  params: {
    documentId: string;
    versieId?: string | null;
    titel: string;
    buffer: Buffer;
    bestandstype: Bestandstype;
    correlatieId: string;
  }
): Promise<PipelineResultaat> {
  const { documentId, versieId, titel, buffer, bestandstype, correlatieId } = params;

  // ── Scan (mock, WP3 uitgesteld) ──────────────────────────────────────────
  let t = new Date().toISOString();
  await schrijfJob(svc, {
    documentId, versieId, correlatieId, stap: "scan", status: "overgeslagen",
    start: t, foutcode: "scan_uitgesteld_wp3",
  });
  await zetStatus(svc, documentId, "gescand");

  // ── Extractie met OCR-fallback (besluit 0020 + addendum 0023) ─────────────
  // Eerst de goedkope tekstlaag; bij een te dunne uitkomst (beeld-only/gescande
  // PDF) valt dit terug op Mistral OCR. Synchrone OCR is hier aanvaard omdat de
  // generieke curatie back-office + laagfrequent is (zelfde risicoprofiel als de
  // her-extract-route); de maxDuration op de curatiepagina dekt de extra
  // wandkloktijd. Faalt OCR, dan houdt extractTekstMetOcrFallback het (lege)
  // tekstlaag-resultaat aan en vangt de <100-tekens-poort hieronder dat af.
  t = new Date().toISOString();
  await zetStatus(svc, documentId, "extractie");
  let extractie;
  try {
    extractie = await extractTekstMetOcrFallback(buffer, bestandstype);
  } catch (e) {
    await schrijfJob(svc, {
      documentId, versieId, correlatieId, stap: "extractie", status: "mislukt",
      start: t, foutcode: "extractie_exception",
    });
    await zetStatus(svc, documentId, "mislukt");
    console.error("[P1-pipeline] extractie-exception:", e);
    return { ok: false, foutcode: "extractie_mislukt", verwerkingsstatus: "mislukt" };
  }
  // OCR-job weerspiegelt of de fallback daadwerkelijk is ingezet (audit, FO §21.1).
  await schrijfJob(svc, {
    documentId, versieId, correlatieId, stap: "ocr",
    status: extractie.ocrToegepast ? "geslaagd" : "overgeslagen", start: t,
  });

  if (!extractie.tekst || extractie.tekst.trim().length < 100) {
    await schrijfJob(svc, {
      documentId, versieId, correlatieId, stap: "extractie", status: "mislukt",
      start: t, foutcode: "geen_tekstlaag",
    });
    await zetStatus(svc, documentId, "mislukt");
    return { ok: false, foutcode: "geen_tekst", verwerkingsstatus: "mislukt" };
  }
  await schrijfJob(svc, {
    documentId, versieId, correlatieId, stap: "extractie", status: "geslaagd", start: t,
  });

  // Paginatelling + OCR-audit (ocr_toegepast/ocr_engine, besluit 0020) vastleggen.
  await svc
    .from("documenten")
    .update({
      paginas: extractie.aantalPaginas,
      ocr_toegepast: extractie.ocrToegepast,
      ocr_engine: extractie.ocrEngine,
    })
    .eq("id", documentId);

  // ── Opslag origineel (service-role schrijft naar het generiek/-pad) ───────
  const opslagPad = `${GENERIEK_PAD_PREFIX}/${documentId}.${bestandstype}`;
  const { error: storageError } = await svc.storage
    .from(STORAGE_BUCKET)
    .upload(opslagPad, buffer, {
      contentType: CONTENT_TYPE_PER_BESTANDSTYPE[bestandstype],
      upsert: true, // versievervanging mag overschrijven op hetzelfde pad
    });
  if (storageError) {
    // Niet fataal: chunks worden alsnog gemaakt zodat RAG werkt; inzage-knop
    // blijft dan onzichtbaar. Mirror van de tenant-uploadroute.
    console.error("[P1-pipeline] storage-upload mislukt:", storageError.message);
  } else {
    await svc.from("documenten").update({ opslag_pad: opslagPad }).eq("id", documentId);
  }

  // ── Chunking + embedding (gedeelde R1.1+R1.2-ingest) ──────────────────────
  // Structuur-bewuste chunking + context-prefix (Haiku) + embedding over de
  // VERRIJKTE tekst. Denorm-trigger vult bibliotheek/normgewicht op de chunk;
  // de R1-velden (structuur/prefix/versie) raakt die trigger niet. `tekst`
  // blijft het originele fragment. Best-effort op prefix/embedding (FTS blijft
  // werken zonder vector). Eén gedeeld pad met de tenant-upload/her-extract.
  t = new Date().toISOString();
  await zetStatus(svc, documentId, "chunking");
  await zetStatus(svc, documentId, "embedding");
  const { records: chunkRecords, aantalChunks, embeddingsGelukt: embeddings } =
    await bouwChunkRecords({ documentId, titel, segmenten: extractie.segmenten });
  await schrijfJob(svc, {
    documentId, versieId, correlatieId, stap: "embedding",
    status: embeddings ? "geslaagd" : "overgeslagen", start: t,
  });

  const batch = 50;
  for (let i = 0; i < chunkRecords.length; i += batch) {
    const { error: chunkError } = await svc
      .from("document_chunks")
      .insert(chunkRecords.slice(i, i + batch));
    if (chunkError) console.error("[P1-pipeline] chunk-insert mislukt:", chunkError.message);
  }
  await schrijfJob(svc, {
    documentId, versieId, correlatieId, stap: "chunking", status: "geslaagd", start: t,
  });

  // ── Indexering klaar → beschikbaar ───────────────────────────────────────
  t = new Date().toISOString();
  await svc
    .from("documenten")
    .update({ verwerkingsstatus: "beschikbaar", geindexeerd: true })
    .eq("id", documentId);
  await schrijfJob(svc, {
    documentId, versieId, correlatieId, stap: "indexering", status: "geslaagd", start: t,
  });

  return {
    ok: true,
    paginas: extractie.aantalPaginas,
    chunks: aantalChunks,
    embeddings,
    verwerkingsstatus: "beschikbaar",
  };
}
