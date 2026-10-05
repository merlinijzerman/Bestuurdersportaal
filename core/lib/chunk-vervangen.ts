// ============================================================================
//  lib/chunk-vervangen.ts — chunkset atomisch vervangen en veilig opruimen (#548).
// ----------------------------------------------------------------------------
//  Gedeeld door de ingestworker (eerste ingest, beide bibliotheken) en de
//  herindexering. Twee bewerkingen:
//
//  • vervangChunksAtomisch — RPC fn_document_chunks_vervangen: in één
//    transactie document → in verwerking, oude chunks weg, nieuwe kale chunks
//    erin. Faalt het, dan blijft de oude chunkset volledig staan. Er is nooit
//    een half ingevoegde chunkset zichtbaar voor de zoekroutes (die lezen
//    document_chunks direct en filteren níet op geindexeerd/verwerkingsstatus).
//
//  • ruimChunksOp — na een fout ná de vervanging (verrijking): alle chunks van
//    het document weg en status 'mislukt'. Volgorde: eerst de chunks (dan is
//    niets meer doorzoekbaar), dan de status. Een document zonder chunks blijft
//    via de herindexselectie terug te vinden.
//
//  Client-agnostisch: anon-key + RLS (fonds) of service-role (worker/platform).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChunkRecord } from "./chunk-bouw";

export type ChunkVervangUitkomst =
  | { ok: true; aantal: number }
  | { ok: false; fout: string };

/** Alleen de kale velden; prefix/embedding vult de verrijking daarna. */
export function alsKaleChunkRijen(records: ChunkRecord[]) {
  return records.map((r) => ({
    chunk_index: r.chunk_index,
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: r.paragraaf,
    structuur_type: r.structuur_type,
    structuur_label: r.structuur_label,
    context_prefix: r.context_prefix,
    prefix_model: r.prefix_model,
    indexering_versie: r.indexering_versie,
  }));
}

export async function vervangChunksAtomisch(
  client: SupabaseClient,
  documentId: string,
  records: ChunkRecord[]
): Promise<ChunkVervangUitkomst> {
  const { data, error } = await client.rpc("fn_document_chunks_vervangen", {
    p_document_id: documentId,
    p_chunks: alsKaleChunkRijen(records),
  });
  if (error) return { ok: false, fout: error.code ? `${error.code}: ${error.message}` : error.message };
  const aantal = typeof data === "number" ? data : Number(data);
  if (aantal !== records.length) {
    return { ok: false, fout: `onverwacht aantal chunks (${aantal} van ${records.length})` };
  }
  return { ok: true, aantal };
}

/**
 * Ruimt na een fout alle chunks van het document op en markeert het als
 * mislukt. Geeft terug of het opruimen van de chunks lukte; een document
 * waarvan het opruimen mislukt, heeft nog een volledige (niet gedeeltelijke)
 * chunkset — de vervanging was atomisch — maar met onvolledige verrijking.
 */
export async function ruimChunksOp(client: SupabaseClient, documentId: string): Promise<boolean> {
  const { error: delErr } = await client.from("document_chunks").delete().eq("document_id", documentId);
  await client
    .from("documenten")
    .update({ geindexeerd: false, verwerkingsstatus: "mislukt" })
    .eq("id", documentId);
  return !delErr;
}
