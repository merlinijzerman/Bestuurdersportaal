// ============================================================================
//  #367 — Supabase-private opbouw en herlezing van versiebewijs.
// ----------------------------------------------------------------------------
//  De databasevelden blijven in deze adaptermodule. Naar het publieke contract
//  gaat uitsluitend een hash of de expliciet zwakke status-datumfallback.
// ============================================================================
import { createServerSupabase } from "../supabase-server";
import type { DocumentChunk } from "../rag";
import type { ActueleVersiestand, Versiebewijs } from "./contract";
import { maakVolledigeVersieHash } from "./identiteit";

interface Versierij {
  id: string;
  document_id: string;
  indexering_versie: string | null;
  documenten: {
    id: string;
    fonds_id: string | null;
    bibliotheek: string | null;
    bestand_hash: string | null;
    documentdatum: string | null;
  } | null;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

function nietLeeg(waarde: unknown): waarde is string {
  return typeof waarde === "string" && waarde.length > 0;
}

export function bewijsUitVersierij(
  rij: Versierij | undefined,
  verwachtDocumentId: string,
  fondsId: string,
  gecontroleerdOp: string
): Versiebewijs {
  const d = rij?.documenten;
  const tenantKlopt =
    d?.bibliotheek === "generiek" || (nietLeeg(d?.fonds_id) && d?.fonds_id === fondsId);
  if (!rij || !d || rij.document_id !== verwachtDocumentId || d.id !== verwachtDocumentId || !tenantKlopt) {
    return { soort: "onbekend", waarde: null, gecontroleerdOp };
  }
  if (nietLeeg(rij.indexering_versie) && nietLeeg(d.bestand_hash) && SHA256_HEX.test(d.bestand_hash)) {
    return {
      soort: "hash",
      waarde: maakVolledigeVersieHash(rij.document_id, rij.indexering_versie, d.bestand_hash),
      gecontroleerdOp,
    };
  }
  if (nietLeeg(d.documentdatum)) {
    return { soort: "status-datum", waarde: d.documentdatum, gecontroleerdOp };
  }
  return { soort: "onbekend", waarde: null, gecontroleerdOp };
}

export async function leesSupabaseVersies(
  chunks: readonly DocumentChunk[],
  fondsId: string,
  signal?: AbortSignal
): Promise<Map<string, Versiebewijs>> {
  const perChunk = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  if (perChunk.size === 0) return new Map();
  const supabase = await createServerSupabase();
  let query = supabase
    .from("document_chunks")
    .select("id, document_id, indexering_versie, documenten!inner(id, fonds_id, bibliotheek, bestand_hash, documentdatum)")
    .in("id", [...perChunk.keys()]);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Afgebroken", "AbortError");
  if (error) throw error;

  const rijen = new Map(((data ?? []) as unknown as Versierij[]).map((rij) => [rij.id, rij]));
  const gecontroleerdOp = new Date().toISOString();
  return new Map(
    [...perChunk].map(([id, chunk]) => [
      id,
      bewijsUitVersierij(rijen.get(id), chunk.document_id, fondsId, gecontroleerdOp),
    ])
  );
}

export function alsActueleVersiestand(
  versie: Versiebewijs | undefined,
  documentIdentiteit?: string,
  passageIdentiteit?: string
): ActueleVersiestand {
  return {
    beschikbaar: versie?.soort !== "onbekend" && typeof versie?.waarde === "string" && versie.waarde.length > 0,
    documentIdentiteit: documentIdentiteit ?? null,
    passageIdentiteit: passageIdentiteit ?? null,
    versie: { soort: versie?.soort ?? "onbekend", waarde: versie?.waarde ?? null },
  };
}
