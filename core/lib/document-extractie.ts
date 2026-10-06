// Tekstextractie voor documenten in verschillende formaten.
// Wordt gebruikt door de upload-route om uniforme tekst aan het
// RAG-systeem te leveren, ongeacht of het origineel een PDF, Word- of
// Excel-bestand was.

import { getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { segmenteerTabblad } from "./xlsx-segment";
import {
  bouwBronblokken,
  type PdfPaginaInvoer,
  type PdfTekstItem,
} from "./pdf-bronblokken";

export type Bestandstype = "pdf" | "docx" | "pptx" | "xlsx";

export const ONDERSTEUNDE_TYPES: Bestandstype[] = ["pdf", "docx", "pptx", "xlsx"];

export const CONTENT_TYPE_PER_BESTANDSTYPE: Record<Bestandstype, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const LABEL_PER_BESTANDSTYPE: Record<Bestandstype, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  xlsx: "Excel",
};

// Een logisch tekstblok met herkomst-locatie. Voor PDF één per pagina, voor
// XLSX één per tabblad, voor DOCX één enkel segment (geen pagina-concept).
// De chunker (lib/rag.ts maakChunksUitSegmenten) tagt elke chunk met deze
// pagina/paragraaf, zodat de bronvermelding "pag. X" / "Tabblad: Y" klopt.
export interface TekstSegment {
  pagina: number | null;
  paragraaf: string | null;
  tekst: string;
  /**
   * #548 — tekstformaat dat de extractor garandeert. "alinea_per_regel": elke
   * alinea, kop, tabelrij en voetnoot staat op een eigen regel (PDF-
   * bronblokken, DOCX-alinea's, nabewerkte OCR). De chunkbouw gebruikt dan de
   * verbeterde structuurherkenning en laat geen korte tekst weg. Ontbreekt het
   * veld (PPTX, XLSX, oudere aanroepers), dan blijft het bestaande gedrag.
   */
  opmaak?: "alinea_per_regel";
}

export interface ExtractieResultaat {
  tekst: string;
  aantalPaginas: number | null;
  // Pagina-/sectie-bewuste segmenten. Altijd gevuld; de platte `tekst` blijft
  // beschikbaar voor o.a. de AI-samenvatting.
  segmenten: TekstSegment[];
}

// Diagnostiek: schat de kwaliteit van een tekstextractie. Twee signalen:
//  1. "Verdacht lange woorden" (>30 chars) — wijst op gefaalde spatie-detectie
//     ("Decommissieheefteenadviesuitgebracht").
//  2. "Hyphen-fragmenten" — paren als "vertegen-\nwoordigt" die door de joiner
//     gemist zijn. Voor een typisch pensioendocument zou dit aantal nul of
//     bijna-nul moeten zijn na de woordafbreking-fix.
// Geeft per signaal het aantal en wat voorbeelden terug zodat je in de
// Vercel-logs snel kunt zien om welk document het gaat.
export interface ExtractieDiagnostiek {
  totaalWoorden: number;
  langeWoorden: number;
  percentageVerdacht: number;
  voorbeeldenLangeWoorden: string[];
  hyphenFragmenten: number;
  voorbeeldenHyphenFragmenten: string[];
}

export function diagnoseerExtractie(tekst: string): ExtractieDiagnostiek {
  const woorden = tekst.split(/\s+/).filter((w) => w.length > 0);
  const lange = woorden.filter((w) => w.length > 30);

  // Zoek naar 'letter-\nletter' patroon in de ruwe tekst — gemiste woordafbrekingen.
  const hyphenMatches = tekst.match(/[A-Za-zÀ-ÿ]+-\n[a-zà-ÿ]+/g) ?? [];

  return {
    totaalWoorden: woorden.length,
    langeWoorden: lange.length,
    percentageVerdacht:
      woorden.length === 0 ? 0 : (lange.length / woorden.length) * 100,
    voorbeeldenLangeWoorden: lange.slice(0, 5),
    hyphenFragmenten: hyphenMatches.length,
    voorbeeldenHyphenFragmenten: hyphenMatches
      .slice(0, 5)
      .map((m) => m.replace("\n", "↵")),
  };
}

// Bepaal bestandstype op basis van bestandsnaam en mime-type.
// Geeft null terug voor niet-ondersteunde formaten.
export function bepaalBestandstype(file: File): Bestandstype | null {
  const naam = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  if (naam.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (
    naam.endsWith(".docx") ||
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (
    naam.endsWith(".pptx") ||
    type ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    return "pptx";
  if (
    naam.endsWith(".xlsx") ||
    type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return "xlsx";

  return null;
}

// Eenvoudige opschoning:
//  - verwijder NULL-bytes (kunnen vanuit pdfjs binnenkomen)
//  - verwijder soft hyphens (U+00AD) — onzichtbare typografie-hints die
//    woorden onnodig zouden splitsen voor de full-text-search-tokenizer
//  - vervang andere control-chars door spaties zodat tokenizer er niet over struikelt
function schoonTekst(tekst: string): string {
  return tekst
    .replace(/\x00/g, "")
    .replace(/­/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

// ── PDF ──────────────────────────────────────────────────────────
// PDF's zijn geen tekstdocumenten maar verzamelingen positionele "text items".
// We lezen elke pagina via pdfjs (unpdf) op itemniveau en bouwen daaruit
// leesbare bronblokken (pdf-bronblokken.ts, #548): regels op basis van de
// basislijn, alinea's op basis van regelafstand en inspringing, woordafbreking
// hersteld ("overdra-" + "gende"), terugkerende kop-/voetregels en
// paginanummers uit de marge verwijderd, voetnoten en de inhoudsopgave als
// eigen blok. Eén segment per pagina; het paginanummer is het bronnummer.
//
// De vorige reconstructie zette elke visuele regel op een eigen regel (vaak met
// een witregel ertussen), waardoor een afgebroken verwijzing als
// "artikel 102a, heeft …" als kop kon worden gelezen en Kamerstuk-paginavoeten
// in de doorzoekbare tekst stonden (zie #548 voor de meting).

interface PdfjsTekstItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
}

/** Leest per pagina de tekstitems met positie en lettergrootte (pdfjs). */
export async function leesPdfPaginas(buffer: Buffer): Promise<PdfPaginaInvoer[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const paginas: PdfPaginaInvoer[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTekstItem[] = [];
    for (const ruw of content.items as PdfjsTekstItem[]) {
      if (typeof ruw.str !== "string" || !ruw.transform) continue;
      const [a, b, c, d, x, y] = ruw.transform;
      // Lettergrootte uit de transformatiematrix; `height` als terugval.
      const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || ruw.height || 0;
      items.push({ str: schoonTekst(ruw.str), x, y, fontSize, width: ruw.width ?? 0, font: ruw.fontName });
    }
    paginas.push({ pagina: i, breedte: viewport.width, hoogte: viewport.height, items });
  }
  return paginas;
}

export async function extractTekstUitPdf(
  buffer: Buffer
): Promise<ExtractieResultaat> {
  const paginas = await leesPdfPaginas(buffer);
  const { segmenten } = bouwBronblokken(paginas);
  return {
    tekst: segmenten.map((s) => s.tekst).join("\n\n"),
    aantalPaginas: paginas.length,
    segmenten: segmenten.map((s) => ({ ...s, opmaak: "alinea_per_regel" as const })),
  };
}

// ── DOCX ─────────────────────────────────────────────────────────
// mammoth levert ruwe tekst, met paragraaf-scheidingen die we behouden
// als dubbele newlines — dat past bij de chunker in lib/rag.ts.
export async function extractTekstUitDocx(
  buffer: Buffer
): Promise<ExtractieResultaat> {
  const { value } = await mammoth.extractRawText({ buffer });
  const tekst = schoonTekst(value);
  return {
    tekst,
    aantalPaginas: null, // mammoth heeft geen pagina-concept; null is acceptabel
    // Eén segment zonder pagina — Word kent geen vaste pagina-grenzen.
    // mammoth zet elke Word-alinea op een eigen regel (gescheiden door een
    // witregel): hetzelfde formaat als de PDF-bronblokken.
    segmenten: [{ pagina: null, paragraaf: null, tekst, opmaak: "alinea_per_regel" }],
  };
}

// ── PPTX ─────────────────────────────────────────────────────────
// PPTX is een OOXML-zip: ppt/slides/slideN.xml per dia, met de tekst in
// <a:t>…</a:t>-runs. Geen pagina-/tekstlaag-conventie zoals PDF, dus we lezen de
// dia's in numerieke volgorde (slide1, slide2, … — niet de zip-/lexicografische
// volgorde, anders komt slide10 vóór slide2) en maken één segment per dia met de
// dianummer als pagina. Tekstruns binnen één dia worden met spaties/newlines
// samengevoegd; XML-entiteiten worden gedecodeerd. Speaker notes blijven bewust
// buiten beschouwing (ppt/notesSlides/*): die horen niet in de brontekst.
export async function extractTekstUitPptx(
  buffer: Buffer
): Promise<ExtractieResultaat> {
  const zip = await JSZip.loadAsync(buffer);

  // Verzamel + sorteer de dia-paden op hun numerieke index (slideN.xml).
  const diaPaden = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => diaIndex(a) - diaIndex(b));

  const blokken: string[] = [];
  const segmenten: TekstSegment[] = [];

  for (let i = 0; i < diaPaden.length; i++) {
    const xml = await zip.files[diaPaden[i]].async("string");
    const tekst = schoonTekst(diaTekstUitXml(xml));
    if (tekst.trim()) {
      const dianummer = i + 1;
      blokken.push(tekst);
      segmenten.push({
        pagina: dianummer,
        paragraaf: `Dia ${dianummer}`,
        tekst,
      });
    }
  }

  return {
    tekst: blokken.join("\n\n"),
    aantalPaginas: diaPaden.length,
    segmenten,
  };
}

function diaIndex(pad: string): number {
  const m = pad.match(/slide(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Trek de zichtbare tekst uit één slide-XML. Elke <a:p> is een paragraaf
// (newline ertussen); de <a:t>-runs binnen een paragraaf worden aaneengeplakt.
function diaTekstUitXml(xml: string): string {
  const paragrafen: string[] = [];
  // Splits grof op paragraaf-grenzen zodat opsommingsregels op aparte regels komen.
  for (const pBlok of xml.split(/<a:p[ >]/)) {
    const runs = [...pBlok.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeerXmlEntiteiten(m[1])
    );
    const regel = runs.join("").trim();
    if (regel) paragrafen.push(regel);
  }
  return paragrafen.join("\n");
}

function decodeerXmlEntiteiten(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// ── XLSX ─────────────────────────────────────────────────────────
// Elk tabblad wordt door lib/xlsx-segment.ts omgezet in CHUNK-VRIENDELIJKE
// segmenten: kleine markdown-tabellen met de kopregel herhaald, elk ≤ de
// doelgrootte zodat hele rijen intact blijven en één segment één nette chunk
// wordt. De rij-cap (MAX_XLSX_RIJEN_PER_TABBLAD) gooit een IngestCapError die
// de upload-route naar een 413 vertaalt — een dataset hoort niet in tekst-RAG.
export async function extractTekstUitXlsx(
  buffer: Buffer
): Promise<ExtractieResultaat> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const segmenten: TekstSegment[] = [];

  for (const sheetnaam of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetnaam];
    if (!sheet) continue;

    // header: 1 → 2D-array van rauwe waardes
    const rijen = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });

    // Kan IngestCapError gooien (rij-cap) — bewust laten doorpropageren.
    for (const seg of segmenteerTabblad(sheetnaam, rijen)) {
      segmenten.push({ ...seg, tekst: schoonTekst(seg.tekst) });
    }
  }

  if (segmenten.length === 0) {
    return { tekst: "", aantalPaginas: 0, segmenten: [] };
  }

  return {
    tekst: schoonTekst(segmenten.map((s) => s.tekst).join("\n\n---\n\n")),
    aantalPaginas: workbook.SheetNames.length,
    segmenten,
  };
}

// ── Dispatcher ───────────────────────────────────────────────────
export async function extractTekst(
  buffer: Buffer,
  bestandstype: Bestandstype
): Promise<ExtractieResultaat> {
  switch (bestandstype) {
    case "pdf":
      return extractTekstUitPdf(buffer);
    case "docx":
      return extractTekstUitDocx(buffer);
    case "pptx":
      return extractTekstUitPptx(buffer);
    case "xlsx":
      return extractTekstUitXlsx(buffer);
  }
}
