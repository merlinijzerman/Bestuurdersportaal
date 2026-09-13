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
import type { RetrievalMeta } from "../rag";
import type { Versiebewijs } from "./contract";
import { maakCitationId } from "./identiteit";

/** Providerneutrale kijk: precies wat het auditspoor per bron vastlegt. */
export interface AuditBron {
  ref: string;
  documentId: string;
  bron: string;
  bibliotheek: string;
  fondsId?: string | null;
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  score?: number | null;
  fts?: number | null;
  vec?: number | null;
  documentIdentiteit?: string;
  passageIdentiteit?: string;
  versie?: Versiebewijs;
}

export function bouwMeta(
  methode: RetrievalMeta["methode"],
  opgehaald: number,
  geselecteerd: AuditBron[],
  correlationId?: string
): RetrievalMeta {
  return {
    methode,
    opgehaald,
    geselecteerd: geselecteerd.length,
    ...(correlationId ? { correlation_id: correlationId } : {}),
    chunks: geselecteerd.map((c) => ({
      id: c.ref,
      document_id: c.documentId,
      rang: c.score ?? null,
      // Besluit 0139 — arm-herkomst mee in het auditspoor.
      fts_rang: c.fts ?? null,
      vec_rang: c.vec ?? null,
    })),
    // T4 — minimale bronversie-audit over de daadwerkelijk geselecteerde chunks.
    bronversie_audit: geselecteerd.map((c) => {
      const versie = c.versie;
      const citationId = c.documentIdentiteit && c.passageIdentiteit && versie?.waarde
        ? maakCitationId(c.documentIdentiteit, c.passageIdentiteit, versie.soort, versie.waarde)
        : undefined;
      return {
        document_id: c.documentId,
        bron: c.bron,
        bibliotheek: c.bibliotheek,
        fonds_id: c.fondsId ?? null,
        documentstatus: c.documentstatus ?? null,
        bronstatus: c.bronstatus ?? null,
        documentdatum: c.documentdatum ?? null,
        ...(c.documentIdentiteit ? { document_identiteit: c.documentIdentiteit } : {}),
        ...(c.passageIdentiteit ? { passage_identiteit: c.passageIdentiteit } : {}),
        ...(citationId ? { citation_id: citationId } : {}),
        ...(versie ? { versie: {
          soort: versie.soort,
          waarde: versie.waarde,
          gecontroleerd_op: versie.gecontroleerdOp,
          toestand: versie.soort === "onbekend" ? "onbekend" : versie.soort === "status-datum" ? "gedegradeerd" : "sterk",
        } } : {}),
      };
    }),
  };
}
