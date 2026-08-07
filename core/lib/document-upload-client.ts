// ============================================================================
//  core/lib/document-upload-client.ts — F7 direct-to-storage upload (client)
// ----------------------------------------------------------------------------
//  Eén client-helper voor álle documentuploads (bibliotheek, vergaderstuk,
//  bewijsstuk). Drie stappen, alle RLS-afgedwongen:
//
//    1. init      — POST {mode:'init'} → gate't de metadata server-side en geeft
//                   een opslagpad <fonds_id>/<uuid>.<ext> terug. Faalt vóór de
//                   upload, zodat een blokkade geen bestand verspilt.
//    2. upload    — het bestand gaat RECHTSTREEKS browser→Supabase Storage
//                   (langs de Vercel-body-limiet van ~4,5 MB heen). De storage-
//                   INSERT-policy dwingt af dat het pad in het eigen fonds valt.
//    3. complete  — POST {mode:'complete'} → de server downloadt het object,
//                   draait de volledige validatie (magic bytes, OOXML, zip-bom,
//                   hash), dedupt en maakt pas dán de documentrij + geeft het vrij
//                   voor de async worker.
//
//  Client-veilig: importeert alleen het pure ingest-caps-module + de browser-
//  Supabase-client — géén node-only validatiecode.
// ============================================================================

import { createClient } from "@/core/lib/supabase";
import {
  MAX_BESTAND_BYTES,
  toegestaneUploadExtensie,
  bestandTeGrootMelding,
} from "@/core/lib/ingest-caps";

export interface UploadMetadata {
  titel?: string;
  bron?: string;
  bibliotheek?: string;
  agendapunt_id?: string | null;
  status?: string | null;
  status_reden?: string | null;
  // Besluit 0140 — classificatie bij aanlevering. Beide optioneel: de
  // vergaderstuk- en bewijsstukstroom leveren ze niet aan en houden daarmee
  // exact het gedrag van vóór 0140. Server-side blijft leidend.
  documenttype?: string | null;
  bronstatus?: string | null;
  bronstatus_reden?: string | null;
}

export interface UploadResultaat {
  ok: boolean;
  document_id?: string;
  status?: string;
  titel?: string;
  bestandstype?: string;
  bericht?: string;
  error?: string;
  foutcode?: string;
  httpStatus?: number;
}

// Defensief JSON-parsen: een platform-fout (bv. een 413 zonder body) levert geen
// JSON en zou anders gooien. Val terug op null.
async function veiligJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function uploadDocument(
  file: File,
  meta: UploadMetadata
): Promise<UploadResultaat> {
  // 1a. Client-side groottecontrole — fail fast met een eerlijke melding.
  if (file.size > MAX_BESTAND_BYTES) {
    return { ok: false, error: bestandTeGrootMelding(file.size), foutcode: "te_groot" };
  }
  // 1b. Extensie moet ondersteund zijn (autoriteit blijft de server-validatie).
  const ext = toegestaneUploadExtensie(file.name);
  if (!ext) {
    return {
      ok: false,
      error: "Bestandstype niet ondersteund (alleen PDF, Word, PowerPoint of Excel).",
      foutcode: "type_niet_ondersteund",
    };
  }

  // 2. init — metadata-poort + opslagpad.
  const initRes = await fetch("/api/documents/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "init",
      bestandsnaam: file.name,
      grootte: file.size,
      ...meta,
    }),
  });
  const initJson = await veiligJson(initRes);
  const document_id = initJson?.document_id as string | undefined;
  const opslag_pad = initJson?.opslag_pad as string | undefined;
  if (!initRes.ok || !document_id || !opslag_pad) {
    return {
      ok: false,
      error: (initJson?.error as string) ?? "Voorbereiden van de upload mislukt.",
      foutcode: initJson?.foutcode as string | undefined,
      httpStatus: initRes.status,
    };
  }

  // 3. Directe upload naar Storage (eigen sessie, RLS-afgedwongen op het fondspad).
  const supabase = createClient();
  const { error: upErr } = await supabase.storage
    .from("documenten")
    .upload(opslag_pad, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
  if (upErr) {
    return {
      ok: false,
      error: "Het bestand kon niet worden geüpload. Probeer het opnieuw.",
      foutcode: "storage_upload_mislukt",
    };
  }

  // 4. complete — server valideert het object + registreert de documentrij.
  const compRes = await fetch("/api/documents/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "complete",
      document_id,
      opslag_pad,
      bestandsnaam: file.name,
      mimeType: file.type,
      ...meta,
    }),
  });
  const compJson = await veiligJson(compRes);
  if (!compRes.ok || !compJson?.success) {
    return {
      ok: false,
      error: (compJson?.error as string) ?? "Verwerken van de upload mislukt.",
      foutcode: compJson?.foutcode as string | undefined,
      document_id: (compJson?.document_id as string | undefined) ?? document_id,
      httpStatus: compRes.status,
    };
  }
  return {
    ok: true,
    document_id: (compJson.document_id as string) ?? document_id,
    status: compJson.status as string | undefined,
    titel: compJson.titel as string | undefined,
    bestandstype: compJson.bestandstype as string | undefined,
    bericht: compJson.bericht as string | undefined,
  };
}
