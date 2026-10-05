// ============================================================================
//  retrieval/document-sectie-ophalen.ts — IO voor de volledige-sectieroute (#548).
// ----------------------------------------------------------------------------
//  Draait met de GEBRUIKERSCLIENT onder RLS: fondsdocumenten van een ander
//  fonds zijn onzichtbaar, generieke documenten zijn gedeeld leesbaar. Daarbovenop
//  dezelfde poorten als de gewone retrieval (artikeltoelating/handhaafFondsdiscipline):
//    • fonds: generiek, of fonds_id = het actieve fonds (expliciet, naast RLS);
//    • generiek: gepubliceerd (status van_kracht, bronstatus actief) en review
//      niet verlopen;
//    • fonds: vastgesteld/van kracht met actieve bronstatus (modus actueel);
//    • geldigheidsvenster op de peildatum; document actief;
//    • WP3-scanbewijs als de malwarescan aan staat;
//    • dezelfde status-/datumpoort per chunk (denormvelden): een chunk die niet
//      door de poort komt, maakt de sectie "onderbroken" in plaats van stil weg
//      te vallen.
//  Alleen PDF en DOCX. Fouten geven null: het reguliere chatpad loopt dan door.
//
//  Twee stappen: eerst de metadata van ALLE chunks (klein; gepagineerd voorbij
//  de PostgREST-rijlimiet en geteld, zodat een afgekapte lijst opvalt), dan de
//  tekst van alleen het afgebakende bereik.
// ============================================================================

import { heeftSchoonScanbewijs, isMalwarescanAan } from "../document-scan-poort";
import {
  bakenDocumentsectieAf,
  bepaalSectieverzoek,
  kiesSectiedocument,
  stelSectieSamen,
  type AfgebakendeDocumentsectie,
  type SectieChunk,
  type SectieDocument,
  type Sectieverzoek,
} from "./document-sectie";

export interface SectieDocumentRij extends SectieDocument {
  bron: string | null;
  bibliotheek: string;
  fonds_id: string | null;
  documenttype: string | null;
  bestandstype: string | null;
  status: string | null;
  bronstatus: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  volgende_review: string | null;
  opslag_pad: string | null;
  extern_url: string | null;
  ocr_toegepast: boolean | null;
  bestand_hash: string | null;
  scan_resultaat: Record<string, unknown> | null;
}

export type OpgehaaldeDocumentsectie =
  | { soort: "sectie"; verzoek: Sectieverzoek; document: SectieDocumentRij; sectie: AfgebakendeDocumentsectie }
  | { soort: "dubbelzinnig"; verzoek: Sectieverzoek; kandidaten: SectieDocument[] };

const DOCUMENTVELDEN =
  "id,titel,bestandsnaam,dossiernummer,bron,bibliotheek,fonds_id,documenttype,bestandstype,status,bronstatus,geldig_vanaf,geldig_tot,volgende_review,opslag_pad,extern_url,ocr_toegepast,bestand_hash,scan_resultaat";
const PAGINA = 1000;
const MAX_CHUNKS = 20000;

interface StatusRij {
  status?: string | null;
  documentstatus?: string | null;
  bronstatus: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
}

function binnenVenster(r: StatusRij, peildatum: string): boolean {
  return (r.geldig_vanaf === null || r.geldig_vanaf <= peildatum) && (r.geldig_tot === null || r.geldig_tot >= peildatum);
}

/** Documentpoort (puur, exporteerbaar voor tests). */
export function isDocumentToegelaten(d: SectieDocumentRij, fondsId: string | null, peildatum: string): boolean {
  if (d.bestandstype !== "pdf" && d.bestandstype !== "docx") return false;
  const bronActief = d.bronstatus === null || d.bronstatus === "actief";
  if (!bronActief || !binnenVenster(d, peildatum)) return false;
  if (d.bibliotheek === "generiek") {
    if (d.status !== "van_kracht") return false;
    if (d.volgende_review !== null && d.volgende_review < peildatum) return false;
  } else {
    if (fondsId === null || d.fonds_id !== fondsId) return false;
    if (d.status !== "vastgesteld" && d.status !== "van_kracht") return false;
  }
  if (isMalwarescanAan() && !heeftSchoonScanbewijs({ bestand_hash: d.bestand_hash, scan_resultaat: d.scan_resultaat })) {
    return false;
  }
  return true;
}

/** Chunkpoort op de denormvelden; zelfde regels als de documentpoort. */
function isChunkToegelaten(c: StatusRij & { bibliotheek?: string | null }, d: SectieDocumentRij, peildatum: string): boolean {
  const bronActief = c.bronstatus === null || c.bronstatus === "actief";
  if (!bronActief || !binnenVenster(c, peildatum)) return false;
  return d.bibliotheek === "generiek"
    ? c.documentstatus === "van_kracht"
    : c.documentstatus === "vastgesteld" || c.documentstatus === "van_kracht";
}

const EENVOUDIGE_TERM = /^[\p{L}\p{N}]+$/u;

export async function haalDocumentsectieVoorWeergave(opdracht: {
  vraag: string;
  fondsId: string | null;
  peildatum: string;
  supabase: { from: (naam: string) => any };
  signal: AbortSignal;
}): Promise<OpgehaaldeDocumentsectie | null> {
  const verzoek = bepaalSectieverzoek(opdracht.vraag);
  if (!verzoek) return null;
  const termen = verzoek.documenttermen.filter((t) => EENVOUDIGE_TERM.test(t)).slice(0, 6);
  if (termen.length === 0) return null;

  // 1. Kandidaatdocumenten (RLS), voorgefilterd op titelwoorden.
  const titelFilter = termen
    .flatMap((t) => [
      `titel.ilike."%${t}%"`,
      `bestandsnaam.ilike."%${t}%"`,
      ...(/\d/.test(t) ? [`dossiernummer.ilike."%${t}%"`] : []),
    ])
    .join(",");
  const { data: gevonden, error: docFout } = await opdracht.supabase.from("documenten")
    .select(DOCUMENTVELDEN)
    .eq("actief", true)
    .in("bestandstype", ["pdf", "docx"])
    .or(titelFilter)
    .order("id", { ascending: true })
    .limit(200)
    .abortSignal(opdracht.signal);
  if (docFout || !Array.isArray(gevonden)) return null;
  const toegelaten = (gevonden as SectieDocumentRij[]).filter((d) =>
    isDocumentToegelaten(d, opdracht.fondsId, opdracht.peildatum)
  );
  const keuze = kiesSectiedocument(verzoek, toegelaten);
  if (keuze.soort === "geen") return null;
  if (keuze.soort === "dubbelzinnig") return { soort: "dubbelzinnig", verzoek, kandidaten: keuze.kandidaten };
  const document = keuze.document as SectieDocumentRij;

  // 2. Metadata van alle chunks, gepagineerd en geteld.
  const { count, error: telFout } = await opdracht.supabase.from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", document.id)
    .abortSignal(opdracht.signal);
  if (telFout || typeof count !== "number" || count === 0 || count > MAX_CHUNKS) return null;
  const metadata: (SectieChunk & StatusRij)[] = [];
  for (let van = 0; van < count; van += PAGINA) {
    const { data, error } = await opdracht.supabase.from("document_chunks")
      .select("id,chunk_index,pagina,structuur_type,structuur_label,indexering_versie,documentstatus,bronstatus,geldig_vanaf,geldig_tot")
      .eq("document_id", document.id)
      .order("chunk_index", { ascending: true })
      .range(van, Math.min(van + PAGINA, count) - 1)
      .abortSignal(opdracht.signal);
    if (error || !Array.isArray(data)) return null;
    metadata.push(...(data as (SectieChunk & StatusRij)[]));
  }
  if (metadata.length !== count) return null;
  const doorPoort = metadata.filter((c) => isChunkToegelaten(c, document, opdracht.peildatum));

  // 3. Afbakenen en (alleen bij "ok") de tekst van het bereik ophalen.
  const bereik = bakenDocumentsectieAf(verzoek, doorPoort, { ocrToegepast: document.ocr_toegepast });
  const inBereik = (c: SectieChunk) =>
    bereik.van !== null && bereik.tot !== null && c.chunk_index >= bereik.van && c.chunk_index <= bereik.tot;
  if (bereik.reden !== "ok") {
    return { soort: "sectie", verzoek, document, sectie: stelSectieSamen(bereik, doorPoort.filter(inBereik)) };
  }
  const { data: tekstRijen, error: tekstFout } = await opdracht.supabase.from("document_chunks")
    .select("id,chunk_index,pagina,structuur_type,structuur_label,indexering_versie,tekst,documentstatus,bronstatus,geldig_vanaf,geldig_tot")
    .eq("document_id", document.id)
    .gte("chunk_index", bereik.van)
    .lte("chunk_index", bereik.tot)
    .order("chunk_index", { ascending: true })
    .limit((bereik.tot ?? 0) - (bereik.van ?? 0) + 1)
    .abortSignal(opdracht.signal);
  if (tekstFout || !Array.isArray(tekstRijen)) return null;
  const rijen = (tekstRijen as (SectieChunk & StatusRij)[]).filter((c) =>
    isChunkToegelaten(c, document, opdracht.peildatum)
  );
  return { soort: "sectie", verzoek, document, sectie: stelSectieSamen(bereik, rijen) };
}
