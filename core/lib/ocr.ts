// ============================================================
//  lib/ocr.ts — OCR-fallback voor beeld-only PDF's (RAG-ingest).
//
//  Sommige PDF's hebben geen tekstlaag (gescand/beeld-only). De normale
//  extractie (lib/document-extractie.ts, unpdf/pdfjs) leest dan nul tekst.
//  Deze module draait Optical Character Recognition zodat zulke documenten
//  alsnog de RAG-pipeline (chunk → embed → search) in kunnen.
//
//  Engine: Mistral OCR (`mistral-ocr-latest`) — zelfde leverancier als de
//  embeddings, EU-gehost, al sub-processor in de DPIA. Slikt een PDF direct
//  in als base64 data-URI en geeft per pagina markdown terug; geen losse
//  pagina-naar-beeld-renderstap nodig. Server-side only: gebruikt
//  MISTRAL_API_KEY (NOOIT met NEXT_PUBLIC_-prefix).
//
//  Belangrijk (embed-laag): OCR verandert alleen de extractie-INPUT, niet het
//  chunking-/embedding-contract. De output hieronder is exact een
//  ExtractieResultaat (één segment per pagina), zodat maakChunksUitSegmenten
//  en de bronvermelding "pag. X" ongewijzigd blijven werken.
// ============================================================

import {
  extractTekst,
  type Bestandstype,
  type ExtractieResultaat,
  type TekstSegment,
} from "./document-extractie";

import { poortCheck, isPoortGesloten, type PoortContext } from "./ai-poort";

const OCR_URL = "https://api.mistral.ai/v1/ocr";

/**
 * Reserveert OCR-pagina's vóór verzending (besluit 0180, FR-2).
 *
 * @param paginas Het aantal pagina's dat WERKELIJK aan de provider wordt
 *                aangeboden — niet het aantal pagina's van het document als de
 *                tekstlaag al genoeg opleverde.
 * @param poging  1-based volgnummer; elke retry reserveert opnieuw, want de
 *                provider factureert die ook opnieuw.
 * @returns       false als het quotum op is; de aanroeper slaat OCR dan over.
 */
export type OcrReservering = (paginas: number, poging: number) => Promise<boolean>;

/** OCR is bewust niet uitgevoerd. Draagt de reden, zodat de melding eerlijk is. */
export class OcrGeweigerdError extends Error {
  readonly reden: OcrOvergeslagenReden;
  constructor(reden: OcrOvergeslagenReden) {
    super(`OCR geweigerd: ${reden}`);
    this.name = "OcrGeweigerdError";
    this.reden = reden;
  }
}

export type OcrOvergeslagenReden =
  | "te_veel_paginas"
  | "quotum_bereikt"
  | "paginas_onbekend"
  | "provider_gestopt";

// Centrale config — bij wisselen van engine ook de audit-waarde aanpassen.
export const OCR_PROVIDER = "mistral";
export const OCR_MODEL = "mistral-ocr-latest";
// Waarde die per document in documenten.ocr_engine wordt vastgelegd (audit).
export const OCR_ENGINE_LABEL = `${OCR_PROVIDER}:${OCR_MODEL}`;

// Drempel: < 50 tekens/pagina (witruimte genegeerd) = vrijwel zeker beeld-only.
// Identiek aan de meet-drempel waarmee de corpus-scope is bepaald.
const OCR_DREMPEL_CHARS_PER_PAGINA = 50;

const MAX_RETRIES = 3;

// Harde timeout per OCR-call. OCR is trager dan embedding en een hangende call
// zou anders tot de platform-/serverless-limiet blijven wachten (zie §8). Per
// poging opnieuw toegepast via AbortController.
const OCR_TIMEOUT_MS = 60_000;

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Telt betekenisvolle tekens (witruimte weggelaten) — maat voor "is hier tekst?".
function betekenisvolleTekens(tekst: string): number {
  return tekst.replace(/\s+/g, "").length;
}

// Beslis of een gewone extractie zo dun is dat OCR zinvol is. Alleen PDF:
// DOCX/XLSX hebben per definitie een tekstlaag (geen gescande varianten hier).
export function heeftOcrNodig(
  resultaat: ExtractieResultaat,
  bestandstype: Bestandstype
): boolean {
  if (bestandstype !== "pdf") return false;
  if (resultaat.segmenten.length === 0) return true;
  const chars = betekenisvolleTekens(resultaat.tekst);
  const paginas =
    resultaat.aantalPaginas && resultaat.aantalPaginas > 0
      ? resultaat.aantalPaginas
      : 1;
  return chars / paginas < OCR_DREMPEL_CHARS_PER_PAGINA;
}

// Markdown-opschoning voor RAG: Mistral OCR vervangt afbeeldingen/tabellen door
// placeholders als `![img-0.jpeg](img-0.jpeg)`. Die voegen ruis toe aan de
// embeddings en de full-text-search, dus we strippen image-placeholders.
// Tabellen (markdown) laten we staan — dat is echte inhoud.
function schoonOcrMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // ![img-0.jpeg](img-0.jpeg)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface MistralOcrPagina {
  index: number;
  markdown: string;
}
interface MistralOcrResponse {
  pages: MistralOcrPagina[];
  model?: string;
  usage_info?: { pages_processed?: number };
}

// Roep de Mistral OCR-API aan voor een volledige PDF en geef een
// ExtractieResultaat terug (één segment per pagina, pagina = index + 1).
// Retry/backoff op 429 en 5xx, gelijk aan embeddings.ts.
export async function ocrPdfNaarResultaat(
  buffer: Buffer,
  poort?: PoortContext,
  reserveer?: OcrReservering,
  aantalPaginas?: number | null
): Promise<ExtractieResultaat> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY ontbreekt in de omgeving");

  const dataUri = `data:application/pdf;base64,${buffer.toString("base64")}`;
  const body = JSON.stringify({
    model: OCR_MODEL,
    document: { type: "document_url", document_url: dataUri },
    include_image_base64: false,
  });

  for (let poging = 0; poging <= MAX_RETRIES; poging++) {
    // AI-BEGRENZING (besluit 0180). ELKE poging reserveert opnieuw: Mistral
    // factureert een herhaalde OCR-aanroep ook opnieuw, dus één reservering
    // voor alle pogingen zou het verbruik structureel te laag schatten. En de
    // poort draait hier per poging mee, zodat een stop halverwege de retrylus
    // de volgende poging blokkeert in plaats van hem toch te versturen.
    if (reserveer) {
      const paginas = aantalPaginas ?? null;
      if (paginas == null) {
        throw new OcrGeweigerdError("paginas_onbekend");
      }
      const toegestaan = await reserveer(paginas, poging + 1);
      if (!toegestaan) {
        throw new OcrGeweigerdError(poging === 0 ? "quotum_bereikt" : "quotum_bereikt");
      }
    }
    if (poort) {
      await poortCheck(poort, "mistral", OCR_MODEL);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(OCR_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      // Abort/netwerkfout: behandel als tijdelijk en retry tot het maximum.
      if (poging < MAX_RETRIES) {
        await slaap(1000 * 2 ** poging);
        continue;
      }
      const reden =
        error instanceof Error && error.name === "AbortError"
          ? `timeout na ${OCR_TIMEOUT_MS} ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(`Mistral OCR: ${reden}`);
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) {
      const data = (await res.json()) as MistralOcrResponse;
      const paginas = [...(data.pages ?? [])].sort((a, b) => a.index - b.index);

      // Kosten/usage zichtbaar in de logs (acceptatiecriterium §11) — niet opgeslagen.
      console.info(
        `[OCR] Mistral verwerkte ${data.usage_info?.pages_processed ?? paginas.length} pagina('s).`
      );

      const paginaTeksten: string[] = [];
      const segmenten: TekstSegment[] = [];
      for (const p of paginas) {
        const tekst = schoonOcrMarkdown(p.markdown ?? "");
        if (tekst.trim()) {
          paginaTeksten.push(tekst);
          // index is 0-based bij Mistral; ons bronnummer is 1-based.
          segmenten.push({ pagina: p.index + 1, paragraaf: null, tekst });
        }
      }

      return {
        tekst: paginaTeksten.join("\n\n"),
        aantalPaginas: paginas.length || null,
        segmenten,
      };
    }

    const tijdelijk = res.status === 429 || res.status >= 500;
    if (tijdelijk && poging < MAX_RETRIES) {
      await slaap(1000 * 2 ** poging); // 1s → 2s → 4s (OCR is trager dan embed)
      continue;
    }
    const detail = await res.text().catch(() => "");
    throw new Error(`Mistral OCR ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  throw new Error("Mistral OCR: max retries overschreden");
}

// Resultaat van de gecombineerde extractie, uitgebreid met audit-velden zodat
// de aanroeper kan vastleggen of OCR is toegepast (governance/herleidbaarheid).
export interface ExtractieResultaatMetOcr extends ExtractieResultaat {
  ocrToegepast: boolean;
  ocrEngine: string | null;
  // Gezet wanneer OCR wél nodig was maar BEWUST niet is uitgevoerd. Zo kan de
  // aanroeper het verschil zien tussen "geen OCR nodig" en "OCR overgeslagen",
  // en een eerlijke melding geven i.p.v. een leeg resultaat te presenteren als
  // een geslaagde extractie (besluit 0134).
  ocrOvergeslagen?: OcrOvergeslagenReden;
}

// Pure beslislaag voor de paginagrens (besluit 0134), apart getest in
// lib/ocr.sanity.ts. Twee bewuste "ja"-gevallen:
//   • géén grens meegegeven → bulk-/scriptpad zonder requesttimeout;
//   • ONBEKEND paginaaantal → niet blokkeren op een gegeven dat we niet hebben.
//     De AbortController-timeout en de maxDuration blijven dan de vangrail.
//
// AI-BEGRENZING (besluit 0180): zodra er een paginaquotum wordt gereserveerd,
// kantelen beide "ja"-gevallen naar NEE. Je kunt geen pagina's reserveren die je
// niet kunt tellen, en een pad zonder grens zou het fondsquotum ongemerkt
// leegtrekken. `reserveringVereist` maakt dat expliciet in plaats van het stil
// te veranderen voor de bestaande bulkpaden.
export function magOcrDraaien(
  aantalPaginas: number | null | undefined,
  maxOcrPaginas?: number,
  reserveringVereist = false
): boolean {
  if (reserveringVereist && aantalPaginas == null) return false;
  if (maxOcrPaginas == null) return true;
  if (aantalPaginas == null) return true;
  return aantalPaginas <= maxOcrPaginas;
}

// Opties voor de gecombineerde extractie.
export interface OcrFallbackOpties {
  // Bovengrens op het aantal pagina's dat synchroon door OCR mag. Boven deze
  // grens wordt OCR overgeslagen i.p.v. uitgevoerd — de aanroeper beslist wat
  // dat betekent. Weglaten = geen grens (bulk-/scriptpad, geen requesttimeout).
  maxOcrPaginas?: number;
  // AI-BEGRENZING (besluit 0180). Poortcontext voor de live Mistral-kill-switch
  // en de reserveringsfunctie voor het OCR-paginaquotum. Beide horen samen te
  // gaan: wie reserveert, moet ook gepoort worden.
  poort?: PoortContext;
  reserveerOcr?: OcrReservering;
}

// Hoofdingang voor ingest: probeer eerst de goedkope tekstlaag-extractie en val
// alleen terug op OCR als die te dun is. Faalt OCR (corrupt PDF, API-fout),
// dan geven we het oorspronkelijke (lege) resultaat terug — de aanroeper houdt
// zo zijn bestaande "geen tekst gevonden"-afhandeling. Wordt nu gebruikt door de
// her-extract-route; bedoeld als gedeeld pad dat ook het bulk-migratiescript
// (apart ticket #12) gaat hergebruiken. De upload-route roept dit pad bewust
// NIET aan (besluit 0020 §Gevolgen: geen live synchrone OCR op het high-volume
// uploadpad); die route detecteert alleen dát OCR nodig is en laat de beheerder
// de her-extractie starten (besluit 0134).
export async function extractTekstMetOcrFallback(
  buffer: Buffer,
  bestandstype: Bestandstype,
  opties: OcrFallbackOpties = {}
): Promise<ExtractieResultaatMetOcr> {
  const basis = await extractTekst(buffer, bestandstype);

  if (!heeftOcrNodig(basis, bestandstype)) {
    return { ...basis, ocrToegepast: false, ocrEngine: null };
  }

  // Paginagrens (besluit 0134): OCR is de duurste stap in de keten en de enige
  // die per pagina extern werk doet. Boven de grens slaan we hem over in plaats
  // van hem halverwege te laten afbreken.
  //
  // AI-BEGRENZING (besluit 0180): met een reserveringsfunctie is een ONBEKEND
  // paginaaantal geen reden meer om door te gaan maar om te stoppen — je kunt
  // niet reserveren wat je niet kunt tellen.
  const moetReserveren = Boolean(opties.reserveerOcr);
  if (!magOcrDraaien(basis.aantalPaginas, opties.maxOcrPaginas, moetReserveren)) {
    return {
      ...basis,
      ocrToegepast: false,
      ocrEngine: null,
      ocrOvergeslagen:
        moetReserveren && basis.aantalPaginas == null ? "paginas_onbekend" : "te_veel_paginas",
    };
  }

  try {
    const ocr = await ocrPdfNaarResultaat(
      buffer,
      opties.poort,
      opties.reserveerOcr,
      basis.aantalPaginas
    );
    // Alleen overnemen als OCR daadwerkelijk meer tekst opleverde dan de
    // (vrijwel lege) tekstlaag — anders is het corrupt/onleesbaar en heeft
    // de OCR-poging geen waarde toegevoegd.
    if (betekenisvolleTekens(ocr.tekst) > betekenisvolleTekens(basis.tekst)) {
      return { ...ocr, ocrToegepast: true, ocrEngine: OCR_ENGINE_LABEL };
    }
    return { ...basis, ocrToegepast: false, ocrEngine: null };
  } catch (error) {
    // Een BEGRENZING is geen storing. Quotum op, poort dicht of pagina's
    // onbekend: dat zijn verklaarbare uitkomsten die de aanroeper eerlijk moet
    // kunnen tonen ("OCR overgeslagen omdat het maandquotum bereikt is"), niet
    // wegmoffelen als een mislukte extractie.
    if (error instanceof OcrGeweigerdError) {
      console.warn(`[OCR] Overgeslagen wegens begrenzing: ${error.reden}`);
      return { ...basis, ocrToegepast: false, ocrEngine: null, ocrOvergeslagen: error.reden };
    }
    if (isPoortGesloten(error)) {
      console.warn(`[OCR] Overgeslagen: Mistral-poort dicht (${error.reden}).`);
      return { ...basis, ocrToegepast: false, ocrEngine: null, ocrOvergeslagen: "provider_gestopt" };
    }
    console.error(
      `[OCR] Fallback mislukt — origineel (lege) resultaat behouden:`,
      error instanceof Error ? error.message : error
    );
    return { ...basis, ocrToegepast: false, ocrEngine: null };
  }
}
