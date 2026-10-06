import { heeftSchoonScanbewijs, isMalwarescanAan } from "../document-scan-poort";
import {
  bakenParagraafAf,
  bepaalSectiefocus,
  kiesJuridischDocument,
  kiesParagraafkop,
  sectieBronlink,
  type AfgebakendeSectie,
  type Sectierij,
} from "./juridische-sectie";

interface DocumentRij {
  id: string;
  titel: string;
  extern_url: string | null;
  status: string | null;
  bronstatus: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  fonds_id: string | null;
  bibliotheek: string;
  volgende_review: string | null;
  bestand_hash: string | null;
  scan_resultaat: Record<string, unknown> | null;
}

export interface OpgehaaldeJuridischeSectie {
  documentId: string;
  documentTitel: string;
  sectie: AfgebakendeSectie;
  bronlink: string;
}

/**
 * Alleen voor een expliciet verzoek om de HELE paragraaf. De opvraging draait
 * met de gebruikersclient onder RLS; dezelfde fonds-, status-, datum-, review-
 * en scanbeperkingen als het gewone juridische bibliotheekpad gelden hier.
 * Fouten geven null: het reguliere chatpad blijft dan beschikbaar.
 */
export async function haalJuridischeSectieVoorWeergave(opdracht: {
  vraag: string;
  fondsId: string | null;
  peildatum: string;
  supabase: { from: (naam: string) => any };
  signal: AbortSignal;
}): Promise<OpgehaaldeJuridischeSectie | null> {
  const focus = bepaalSectiefocus(opdracht.vraag);
  if (!focus?.volledig || !focus.nummer) return null;
  const { data: gevonden, error: docFout } = await opdracht.supabase.from("documenten")
    .select("id,titel,extern_url,status,bronstatus,geldig_vanaf,geldig_tot,fonds_id,bibliotheek,volgende_review,bestand_hash,scan_resultaat")
    .eq("documenttype", "wetgeving")
    .eq("actief", true)
    .order("id", { ascending: true })
    .limit(200)
    .abortSignal(opdracht.signal);
  if (docFout || !Array.isArray(gevonden)) return null;
  const docs = (gevonden as DocumentRij[]).filter((d) =>
    d.status === "van_kracht" &&
    (d.bronstatus === null || d.bronstatus === "actief") &&
    (d.geldig_vanaf === null || d.geldig_vanaf <= opdracht.peildatum) &&
    (d.geldig_tot === null || d.geldig_tot >= opdracht.peildatum) &&
    (d.bibliotheek === "generiek" || d.fonds_id === opdracht.fondsId) &&
    (d.bibliotheek !== "generiek" || d.volgende_review === null || d.volgende_review >= opdracht.peildatum) &&
    (!isMalwarescanAan() || heeftSchoonScanbewijs({ bestand_hash: d.bestand_hash, scan_resultaat: d.scan_resultaat }))
  );
  const gekozen = kiesJuridischDocument(opdracht.vraag, docs);
  if (!gekozen) return null;
  const bronlink = sectieBronlink(gekozen.extern_url, focus.nummer);
  if (!bronlink) return null;

  const { data: kopRijen, error: kopFout } = await opdracht.supabase.from("document_chunks")
    .select("id,document_id,chunk_index,tekst,pagina,structuur_type,structuur_label")
    .eq("document_id", gekozen.id)
    .ilike("tekst", `%Paragraaf ${focus.nummer}.%`)
    .order("chunk_index", { ascending: true })
    .limit(12)
    .abortSignal(opdracht.signal);
  if (kopFout || !Array.isArray(kopRijen)) return null;
  const kop = kiesParagraafkop(focus, kopRijen as Sectierij[]);
  if (!kop) return null;

  const { data: sectieRijen, error: sectieFout } = await opdracht.supabase.from("document_chunks")
    .select("id,document_id,chunk_index,tekst,pagina,structuur_type,structuur_label,documentstatus,bronstatus,geldig_vanaf,geldig_tot")
    .eq("document_id", gekozen.id)
    .gte("chunk_index", kop.rij.chunk_index)
    .lte("chunk_index", kop.rij.chunk_index + 80)
    .order("chunk_index", { ascending: true })
    .limit(81)
    .abortSignal(opdracht.signal);
  if (sectieFout || !Array.isArray(sectieRijen)) return null;
  const toegelaten = (sectieRijen as (Sectierij & {
    documentstatus: string | null;
    bronstatus: string | null;
    geldig_vanaf: string | null;
    geldig_tot: string | null;
  })[]).filter((r) =>
    r.documentstatus === "van_kracht" &&
    (r.bronstatus === null || r.bronstatus === "actief") &&
    (r.geldig_vanaf === null || r.geldig_vanaf <= opdracht.peildatum) &&
    (r.geldig_tot === null || r.geldig_tot >= opdracht.peildatum)
  );
  if (!toegelaten.some((rij) => rij.id === kop.rij.id)) return null;
  const sectie = bakenParagraafAf(kop, toegelaten);
  if (sectie.rijen.length === 0) return null;
  return { documentId: gekozen.id, documentTitel: gekozen.titel, sectie, bronlink };
}
