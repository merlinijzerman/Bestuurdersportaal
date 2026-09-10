// ============================================================================
//  AI-bereik voor document-ingest.
// ----------------------------------------------------------------------------
//  Generieke documenten horen bewust bij geen fonds. Hun ingest en OCR moeten
//  daarom via de platformbrede actietypes lopen; fondsdocumenten blijven op de
//  fondsgebonden actietypes. Onbekende bibliotheekwaarden vallen fail-closed
//  terug op fondsgebonden verwerking: zonder fonds-id weigert de DB-preflight.
// ============================================================================

export type DocumentIngestAiScope = {
  ingestActietype: "document_ingest" | "generiek_curatie";
  ocrActietype: "ocr" | "ocr_generiek";
  fondsId: string | null;
};

export function bepaalDocumentIngestAiScope(
  bibliotheek: string | null | undefined,
  fondsId: string | null | undefined
): DocumentIngestAiScope {
  if (bibliotheek === "generiek") {
    return {
      ingestActietype: "generiek_curatie",
      ocrActietype: "ocr_generiek",
      fondsId: null,
    };
  }

  return {
    ingestActietype: "document_ingest",
    ocrActietype: "ocr",
    fondsId: fondsId ?? null,
  };
}
