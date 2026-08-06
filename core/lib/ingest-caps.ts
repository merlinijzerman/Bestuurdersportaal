// ============================================================================
//  lib/ingest-caps.ts — Fase 1 ingest-vangrails (bouwticket "Async document-
//  ingest + ingest-caps").
// ----------------------------------------------------------------------------
//  Pure constanten + helpers die voorkomen dat een te groot bestand de
//  (synchrone) upload-route laat timen. Geen DB/IO → los testbaar
//  (lib/ingest-caps.sanity.ts). Drie onafhankelijke drempels:
//
//    1. MAX_XLSX_RIJEN_PER_TABBLAD — gecontroleerd in de xlsx-segmentatie,
//       vóór de markdown wordt opgebouwd, zodat een dataset niet eerst tot
//       megabytes tekst wordt opgeblazen.
//    2. MAX_CHUNKS_PER_DOCUMENT — generieke vangrail in de upload-route, ná de
//       (pure) chunking maar vóór de dure prefix-/embedding-stap.
//    3. MAX_OCR_PAGINAS_SYNCHROON — vangrail in de her-extract-route, vóór de
//       synchrone OCR-stap (besluit 0134). OCR is de duurste stap in de keten
//       en is de enige die per pagina extern werk doet.
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

// Maximaal aantal pagina's dat we SYNCHROON door OCR halen (her-extract-route,
// besluit 0134). OCR kost tot 3 pogingen × 60 s (lib/ocr.ts) en daarbovenop per
// chunk een context-prefix (Haiku) en een embedding; boven deze grens loopt één
// request richting de maxDuration van 300 s en blijft er een halve verwerking
// achter. Fase 2 (async ingest-worker) heft deze grens op.
export const MAX_OCR_PAGINAS_SYNCHROON = 40;

// Doel-tekengrootte van één xlsx-tabelblok (kopregel + N datarijen). Onder de
// chunkGrootte (800) van lib/chunking.ts zodat elk blok één hele chunk wordt en
// rijen niet middenin worden afgekapt.
export const XLSX_DOELGROOTTE_CHARS = 700;

// Foutcode die de upload-route teruggeeft (en de UI kan herkennen) wanneer een
// bestand de ingest-cap overschrijdt.
export const FOUTCODE_TE_GROOT = "bestand_te_groot_voor_rag";

// Foutcode die de her-extract-route teruggeeft wanneer een scan te veel pagina's
// heeft voor het synchrone OCR-pad.
export const FOUTCODE_OCR_TE_VEEL_PAGINAS = "ocr_te_veel_paginas";

// Statuscode die de upload-route teruggeeft wanneer een PDF geen bruikbare
// tekstlaag heeft: het document is bewaard, maar moet nog door tekstherkenning
// vóórdat het doorzoekbaar is (besluit 0134). Bewust GEEN foutcode — de upload
// is geslaagd, er staat alleen een vervolgstap open.
export const STATUS_TEKSTHERKENNING_NODIG = "tekstherkenning_nodig";

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

// Gebruikersmelding bij een OCR-paginacap-overschrijding.
export function ocrPaginaCapMelding(aantalPaginas: number): string {
  return (
    `Dit document telt ${aantalPaginas} pagina's (limiet ` +
    `${MAX_OCR_PAGINAS_SYNCHROON} voor tekstherkenning). Tekstherkenning draait ` +
    `nu nog binnen één verzoek en zou hierop vastlopen. Splits het document, of ` +
    `wacht op de asynchrone verwerking die deze grens opheft.`
  );
}

// Melding bij een PDF zonder bruikbare tekstlaag: het document IS bewaard.
export function tekstherkenningNodigMelding(titel: string): string {
  return (
    `"${titel}" is opgeslagen, maar bevat geen tekstlaag — het is vermoedelijk ` +
    `een scan. Het document staat in de bibliotheek met de markering ` +
    `"Tekstherkenning nodig"; kies daar "Tekstherkenning uitvoeren" om het ` +
    `alsnog doorzoekbaar te maken.`
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
