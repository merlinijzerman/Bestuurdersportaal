// ============================================================================
//  lib/ingest-caps.ts — Fase 1 ingest-vangrails (bouwticket "Async document-
//  ingest + ingest-caps").
// ----------------------------------------------------------------------------
//  Pure constanten + helpers die voorkomen dat een te groot bestand de
//  (synchrone) upload-route laat timen. Geen DB/IO → los testbaar
//  (lib/ingest-caps.sanity.ts). Twee onafhankelijke drempels:
//
//    1. MAX_XLSX_RIJEN_PER_TABBLAD — gecontroleerd in de xlsx-segmentatie,
//       vóór de markdown wordt opgebouwd, zodat een dataset niet eerst tot
//       megabytes tekst wordt opgeblazen.
//    2. MAX_CHUNKS_PER_DOCUMENT — generieke vangrail in de upload-route, ná de
//       (pure) chunking maar vóór de dure prefix-/embedding-stap.
//
//  Gedrag bij overschrijding = WEIGEREN met een herkenbare melding/foutcode
//  (bewust besluit Merlin 26-06-2026: geen stille, halve bron). Een dataset
//  hoort in een data-/dashboardpad, niet in de tekst-RAG.
//
//  De drempelwaarden zijn werkhypotheses — kalibreer op echte documenten.
// ============================================================================

// Maximaal aantal tekstfragmenten (chunks) dat we per document synchroon
// indexeren. Boven deze grens timet het embedding-/prefixpad de Vercel-functie.
// Fase 2 (async worker) heft deze grens later op voor legitieme grote stukken.
export const MAX_CHUNKS_PER_DOCUMENT = 1500;

// Maximaal aantal DATArijen per xlsx-tabblad (exclusief kopregel). Een tabblad
// hierboven is vrijwel zeker een dataset i.p.v. een leesbaar document.
export const MAX_XLSX_RIJEN_PER_TABBLAD = 5000;

// Doel-tekengrootte van één xlsx-tabelblok (kopregel + N datarijen). Onder de
// chunkGrootte (800) van lib/chunking.ts zodat elk blok één hele chunk wordt en
// rijen niet middenin worden afgekapt.
export const XLSX_DOELGROOTTE_CHARS = 700;

// Foutcode die de upload-route teruggeeft (en de UI kan herkennen) wanneer een
// bestand de ingest-cap overschrijdt.
export const FOUTCODE_TE_GROOT = "bestand_te_groot_voor_rag";

// Getypte fout zodat de upload-route een cap-overschrijding kan onderscheiden
// van een echte extractiefout en de juiste melding/HTTP-status kan kiezen.
export class IngestCapError extends Error {
  readonly foutcode: string;
  constructor(message: string, foutcode: string = FOUTCODE_TE_GROOT) {
    super(message);
    this.name = "IngestCapError";
    this.foutcode = foutcode;
  }
}

// True als het aantal geplande chunks de documentcap overschrijdt.
export function overschrijdtChunkCap(aantalChunks: number): boolean {
  return aantalChunks > MAX_CHUNKS_PER_DOCUMENT;
}

// Gebruikersmelding bij een chunk-cap-overschrijding (generiek, alle types).
export function chunkCapMelding(aantalChunks: number): string {
  return (
    `Dit bestand levert ${aantalChunks} tekstfragmenten op (limiet ` +
    `${MAX_CHUNKS_PER_DOCUMENT}). Het is vermoedelijk een dataset of zeer groot ` +
    `document. Datasets ontsluit je beter via een data-/dashboardpad dan via de ` +
    `document-assistent.`
  );
}

// Gebruikersmelding bij een xlsx-rij-overschrijding (specifiek, met telling).
export function xlsxRijenMelding(sheetnaam: string, aantalRijen: number): string {
  return (
    `Het tabblad "${sheetnaam}" bevat ${aantalRijen} rijen (limiet ` +
    `${MAX_XLSX_RIJEN_PER_TABBLAD}). Dit is een dataset, geen tekstdocument — ` +
    `ontsluit het via een data-/dashboardpad in plaats van de document-assistent.`
  );
}
