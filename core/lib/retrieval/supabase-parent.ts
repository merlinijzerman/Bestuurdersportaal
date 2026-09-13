// #368 — providerprivate sibling-read achter de bestaande adapterhook.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentChunk } from "../rag";
import { createServerSupabase } from "../supabase-server";
import { bewaakNaIO } from "./afbreken";

export interface SupabaseSiblingRij extends DocumentChunk {
  structuur_type: string | null;
  structuur_label: string | null;
}

export async function haalSupabaseSiblings(opdracht: {
  privateDocumentRefs: readonly string[];
  limiet: number;
  signal?: AbortSignal;
  supabase?: SupabaseClient;
}): Promise<SupabaseSiblingRij[]> {
  const supabase = opdracht.supabase ?? await createServerSupabase();
  let query = supabase
    .from("document_chunks")
    .select(
      `id, document_id, tekst, pagina, paragraaf, chunk_index, indexering_versie, structuur_type, structuur_label,
       documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, documentstatus:status, bronstatus, documentdatum, bestand_hash, volgende_review)`
    )
    .in("document_id", [...opdracht.privateDocumentRefs])
    .eq("documenten.actief", true)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(opdracht.limiet + 1);
  if (opdracht.signal) query = query.abortSignal(opdracht.signal);
  const { data, error } = await query;
  bewaakNaIO(opdracht.signal, error);
  if (error) throw error;
  if ((data?.length ?? 0) > opdracht.limiet) throw new Error("parent_siblings_afgekapt");
  return (data ?? []) as unknown as SupabaseSiblingRij[];
}
