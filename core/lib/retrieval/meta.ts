// ============================================================================
//  #322 F4-T2-1 — Opbouw van het retrieval-auditspoor.
// ----------------------------------------------------------------------------
//  Verplaatst uit `core/lib/rag.ts` (ongewijzigd, byte voor byte). Besluit 0213
//  punt 5 belegt het schrijven van `RetrievalMeta` bij de ORKESTRATIE, niet bij
//  de adapter: een adapter die zijn eigen auditvorm bepaalt, laat het spoor per
//  provider uiteenlopen.
//
//  `rag.ts` importeert dit tijdelijk terug zodat de call-sites die nog niet door
//  de orkestratie lopen (C5 zoeken, C6 vergelijk, C7 AQLab) ongewijzigd blijven.
//  T2-2 haalt die terugimport weg.
// ============================================================================
import type { DocumentChunk, RetrievalMeta } from "../rag";

export function bouwMeta(
  methode: RetrievalMeta["methode"],
  opgehaald: number,
  geselecteerd: DocumentChunk[]
): RetrievalMeta {
  return {
    methode,
    opgehaald,
    geselecteerd: geselecteerd.length,
    chunks: geselecteerd.map((c) => ({
      id: c.id,
      document_id: c.document_id,
      rang: c.rang ?? null,
      // Besluit 0139 — arm-herkomst mee in het auditspoor.
      fts_rang: c.fts_rang ?? null,
      vec_rang: c.vec_rang ?? null,
    })),
    // T4 — minimale bronversie-audit over de daadwerkelijk geselecteerde chunks.
    bronversie_audit: geselecteerd.map((c) => ({
      document_id: c.document_id,
      bron: c.documenten.bron,
      bibliotheek: c.documenten.bibliotheek,
      fonds_id: c.documenten.fonds_id ?? null,
      documentstatus: c.documenten.documentstatus ?? null,
      bronstatus: c.documenten.bronstatus ?? null,
      documentdatum: c.documenten.documentdatum ?? null,
    })),
  };
}

