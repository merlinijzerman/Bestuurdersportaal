// ============================================================================
//  lib/reindex.ts — server-ingang van de gedeelde herindexering.
// ----------------------------------------------------------------------------
//  De logica staat in herindex-kern.ts (testbaar, zonder "server-only"); hier
//  komen de echte extractie (met OCR-terugval) en verrijking (Haiku-prefix +
//  embedding) erbij. Aangeroepen door de fonds-backfill (anon-key + RLS) en de
//  generieke curatie (service-role).
//
//  "server-only": raakt Storage + externe modellen.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractTekstMetOcrFallback } from "./ocr";
import { verrijkChunks } from "./chunk-ingest";
import {
  herindexeerMetAfhankelijkheden,
  type HerindexBegrenzing,
  type HerindexDocument,
  type HerindexResultaat,
} from "./herindex-kern";

export {
  OVERGESLAGEN_VERSIE,
  STORAGE_BUCKET,
  type HerindexBegrenzing,
  type HerindexDocument,
  type HerindexResultaat,
} from "./herindex-kern";

export function herindexeerDocument(
  client: SupabaseClient,
  doc: HerindexDocument,
  begrenzing: HerindexBegrenzing
): Promise<HerindexResultaat> {
  return herindexeerMetAfhankelijkheden(client, doc, begrenzing, {
    extraheer: extractTekstMetOcrFallback,
    verrijk: verrijkChunks,
  });
}
