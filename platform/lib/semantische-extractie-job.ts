// ============================================================================
//  platform/lib/semantische-extractie-job.ts — de async T8-job (server-only).
// ----------------------------------------------------------------------------
//  Draait onder de SERVICE-ROLE in het beheer-project (Variant-C), via de
//  bestaande ingest-worker/claim-RPC. Eén job = één document. Verantwoordelijk voor:
//    • enqueue (lui, on-demand): een 'semantische_extractie'-job wegzetten.
//    • verwerking: skip-als-al-geëxtraheerd → incrementele diff t.o.v. de
//      voorganger → extractie van alleen gewijzigde chunks → atomische schrijf.
//
//  Idempotent: slaat over als er al een GESLAAGDE extraction_run is voor
//  (document_id, catalog_version) → een tweede run op een ongewijzigd document
//  maakt geen nieuwe semantic_units. Incrementeel: chunks waarvan de (whitespace-
//  genormaliseerde) tekst ongewijzigd is t.o.v. de voorganger worden NIET opnieuw
//  door het model gehaald; hun units worden hergebruikt (binding overgenomen).
//
//  De schrijf loopt via fn_schrijf_semantische_extractie (atomisch: append-only
//  run + vervangbare units in één transactie).
// ============================================================================

import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HAIKU_MODEL } from "@/core/lib/llm-modellen";
import {
  extraheerUnits,
  maakHaikuVoorkomenExtractor,
  type VoorkomenExtractor,
} from "@/core/lib/semantische-extractie";
import {
  actieveConcepten,
  catalogusVersie,
  normWS,
  ontdubbel,
  semantischeExtractieAan,
  SEMANTISCHE_EXTRACTOR_VERSIE,
  SEMANTISCHE_PROMPT_VERSIE,
  type BronChunk,
  type ConceptRij,
  type ConceptType,
  type KandidaatUnit,
} from "@/core/lib/semantische-concepten";

// Uitkomst gelijk aan de ingest-orchestrator (dezelfde teller-buckets in de worker).
export type SemantischeUitkomst = "afgerond" | "bezig" | "overgeslagen" | "mislukt";

// Job-rij zoals documenten_claim_ingest_jobs die teruggeeft (relevante velden).
interface SemJob {
  id: string;
  document_id: string;
  stap: string;
  status: string;
  retry_count: number | null;
  fonds_id: string | null;
}

const MAX_RETRIES = 3;
const BACKOFF_SEC = [30, 120, 480];
const nu = () => new Date().toISOString();
const leaseTijd = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
const teksthash = (t: string) => createHash("sha256").update(normWS(t)).digest("hex");

interface DocRij {
  id: string;
  fonds_id: string;
  status: string | null;
  geindexeerd: boolean | null;
  actief: boolean | null;
  vervangt_document_id: string | null;
}

interface ChunkRij {
  id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  structuur_label: string | null;
}

// Voorganger-unit zoals we die uit semantic_units lezen om te hergebruiken.
interface VoorgangerUnit {
  concept_id: string;
  type: string;
  chunk_id: string | null;
  statement: string;
  value_raw: string;
  value_num: number | null;
  value_date: string | null;
  value_text: string | null;
  value_unit: string | null;
  page: number | null;
  section: string | null;
  evidence: string;
  evidence_verified: boolean;
  confidence_signals: Record<string, unknown> | null;
}

// ── Enqueue (lui / on-demand) ────────────────────────────────────────────────
// Zet één semantische-extractie-job weg voor een document. Behavior-neutraal als
// de flag uit staat (geen job). De partiële unieke index (document_id, stap) vangt
// een concurrente dubbele enqueue af (23505 = onschadelijk). T5 roept dit aan bij
// de eerste vergelijkingsbehoefte; de interne route biedt een handmatige trigger.
export async function enqueueSemantischeExtractie(
  svc: SupabaseClient,
  documentId: string
): Promise<{ enqueued: boolean; reden?: string }> {
  if (!semantischeExtractieAan()) return { enqueued: false, reden: "flag_uit" };

  const { data: doc, error } = await svc
    .from("documenten")
    .select("id, fonds_id, actief, geindexeerd")
    .eq("id", documentId)
    .single();
  if (error || !doc) return { enqueued: false, reden: "document_niet_gevonden" };
  if (doc.actief === false) return { enqueued: false, reden: "document_inactief" };

  const { error: insErr } = await svc.from("document_processing_jobs").insert({
    document_id: documentId,
    fonds_id: doc.fonds_id,
    stap: "semantische_extractie",
    status: "wachtend",
  });
  if (insErr) {
    const dubbel = insErr.code === "23505" || /duplicate|unique/i.test(insErr.message ?? "");
    if (dubbel) return { enqueued: false, reden: "reeds_in_wachtrij" };
    throw new Error(`enqueueSemantischeExtractie: ${insErr.message}`);
  }
  return { enqueued: true };
}

// ── Job-afronding / backoff ──────────────────────────────────────────────────
async function jobTerminaal(
  svc: SupabaseClient,
  jobId: string,
  status: "geslaagd" | "mislukt" | "overgeslagen",
  foutcode: string | null
): Promise<void> {
  await svc
    .from("document_processing_jobs")
    .update({ status, eind: nu(), foutcode })
    .eq("id", jobId);
}

// Tijdelijke fout → backoff (future lease = de klok); boven het plafond → mislukt.
async function backoff(svc: SupabaseClient, job: SemJob, foutcode: string): Promise<SemantischeUitkomst> {
  const nieuweRetry = (job.retry_count ?? 0) + 1;
  if (nieuweRetry > MAX_RETRIES) {
    await svc
      .from("document_processing_jobs")
      .update({ status: "mislukt", retry_count: nieuweRetry, foutcode, eind: nu() })
      .eq("id", job.id);
    return "mislukt";
  }
  const sec = BACKOFF_SEC[Math.min(nieuweRetry - 1, BACKOFF_SEC.length - 1)];
  await svc
    .from("document_processing_jobs")
    .update({
      status: "bezig", retry_count: nieuweRetry, claim_count: 0,
      foutcode, lease_expires_at: leaseTijd(sec),
    })
    .eq("id", job.id);
  return "bezig";
}

// ── Verwerking ───────────────────────────────────────────────────────────────
// Aangeroepen door de ingest-worker-dispatch voor job.stap==='semantische_extractie'.
// De extractor is injecteerbaar voor tests. Productie bouwt hem uit de
// poortcontext (besluit 0180): elke tool-call loopt dan langs de kill switch en
// de modelallowlist. Er is bewust GEEN default meer — een vergeten argument zou
// anders een ongemeten providercall opleveren.
export async function verwerkSemantischeExtractieJob(
  svc: SupabaseClient,
  job: SemJob,
  _deadline: number,
  extractor?: VoorkomenExtractor
): Promise<SemantischeUitkomst> {
  // Defensieve flag-poort (naast de enqueue): flag uit → niets doen.
  if (!semantischeExtractieAan()) {
    await jobTerminaal(svc, job.id, "overgeslagen", "flag_uit");
    return "overgeslagen";
  }

  // 1. Document laden.
  const { data: docData, error: docErr } = await svc
    .from("documenten")
    .select("id, fonds_id, status, geindexeerd, actief, vervangt_document_id")
    .eq("id", job.document_id)
    .single();
  if (docErr || !docData) {
    await jobTerminaal(svc, job.id, "mislukt", "document_niet_gevonden");
    return "mislukt";
  }
  const doc = docData as DocRij;
  if (doc.actief === false) {
    await jobTerminaal(svc, job.id, "overgeslagen", "document_inactief");
    return "overgeslagen";
  }
  // Nog niet geïndexeerd = nog geen chunks (ingest loopt mogelijk nog) → backoff.
  if (!doc.geindexeerd) return await backoff(svc, job, "nog_niet_geindexeerd");

  // 2. Catalogus + actieve concepten laden.
  const { data: conceptData, error: conceptErr } = await svc
    .from("concepts")
    .select("id, key, label, type, status, normalization");
  if (conceptErr || !conceptData) return await backoff(svc, job, "concepts_laden");
  const conceptRijen = conceptData as ConceptRij[];
  const catVersie = catalogusVersie(conceptRijen);
  const concepten = actieveConcepten(conceptRijen);
  const actieveIds = new Set(concepten.map((c) => c.id));

  // 3. Idempotentie: al een GESLAAGDE run voor (document, catalogus)? → skip.
  const { data: bestaandeRun } = await svc
    .from("extraction_run")
    .select("id")
    .eq("document_id", doc.id)
    .eq("catalog_version", catVersie)
    .eq("status", "geslaagd")
    .limit(1);
  if (bestaandeRun && bestaandeRun.length > 0) {
    await jobTerminaal(svc, job.id, "overgeslagen", "reeds_geextraheerd");
    return "overgeslagen";
  }

  // 4. Huidige chunks laden.
  const { data: chunkData, error: chunkErr } = await svc
    .from("document_chunks")
    .select("id, tekst, pagina, paragraaf, structuur_label")
    .eq("document_id", doc.id)
    .order("chunk_index", { ascending: true });
  if (chunkErr) return await backoff(svc, job, "chunks_laden");
  const huidigeChunks = (chunkData ?? []) as ChunkRij[];

  // 5. Incrementele diff t.o.v. de voorganger (indien er een is).
  const { teExtraheren, hergebruikt } = await bepaalWerk(svc, doc, huidigeChunks, actieveIds);

  // 6. Extractie van alleen de te-extraheren chunks.
  let nieuweUnits: KandidaatUnit[];
  try {
    const r = await extraheerUnits(
      teExtraheren,
      concepten,
      doc.status,
      extractor ?? maakHaikuVoorkomenExtractor({ supabase: svc, label: "semantische-extractie" })
    );
    nieuweUnits = r.units;
  } catch (e) {
    console.error(`[semantische-extractie-job] extractie mislukt (doc ${doc.id}):`, (e as Error).message);
    return await backoff(svc, job, "extractie_fout");
  }

  // 7. Combineren + ontdubbelen (hergebruikte + nieuwe).
  const alleUnits = ontdubbel([...hergebruikt, ...nieuweUnits]);

  // 8. Atomisch wegschrijven (append-only run + vervangbare units).
  const { error: schrijfErr } = await svc.rpc("fn_schrijf_semantische_extractie", {
    p_fonds_id: doc.fonds_id,
    p_document_id: doc.id,
    p_model: HAIKU_MODEL,
    p_prompt_version: SEMANTISCHE_PROMPT_VERSIE,
    p_extractor_version: SEMANTISCHE_EXTRACTOR_VERSIE,
    p_catalog_version: catVersie,
    p_status: "geslaagd",
    p_units: alleUnits,
  });
  if (schrijfErr) {
    console.error(`[semantische-extractie-job] schrijf mislukt (doc ${doc.id}):`, schrijfErr.message);
    return await backoff(svc, job, "schrijf_fout");
  }

  await jobTerminaal(svc, job.id, "geslaagd", null);
  console.log(
    JSON.stringify({
      tag: "semantische-extractie",
      document_id: doc.id,
      catalog_version: catVersie,
      units: alleUnits.length,
      hergebruikt: hergebruikt.length,
      geextraheerd: teExtraheren.length,
    })
  );
  return "afgerond";
}

// Bepaal welke chunks opnieuw geëxtraheerd moeten worden en welke voorganger-units
// hergebruikt kunnen worden. Zonder voorganger: alles extraheren, niets hergebruiken.
async function bepaalWerk(
  svc: SupabaseClient,
  doc: DocRij,
  huidigeChunks: ChunkRij[],
  actieveIds: Set<string>
): Promise<{ teExtraheren: BronChunk[]; hergebruikt: KandidaatUnit[] }> {
  const alsBron = (c: ChunkRij): BronChunk => ({
    id: c.id,
    tekst: c.tekst,
    pagina: c.pagina,
    paragraaf: c.paragraaf,
    structuur_label: c.structuur_label,
  });

  if (!doc.vervangt_document_id) {
    return { teExtraheren: huidigeChunks.map(alsBron), hergebruikt: [] };
  }

  // Voorganger-chunks: hash → chunk_id (voor het terugvinden van de huidige chunk
  // met identieke tekst) en de omgekeerde map (voor unit-hergebruik).
  const { data: vorigeChunkData } = await svc
    .from("document_chunks")
    .select("id, tekst")
    .eq("document_id", doc.vervangt_document_id);
  const vorigeChunks = (vorigeChunkData ?? []) as { id: string; tekst: string }[];
  const hashVanVorigeChunk = new Map<string, string>(); // vorige chunk_id → hash
  const vorigeHashes = new Set<string>();
  for (const vc of vorigeChunks) {
    const h = teksthash(vc.tekst);
    hashVanVorigeChunk.set(vc.id, h);
    vorigeHashes.add(h);
  }

  // Huidige chunk per hash (eerste wint), en de te-extraheren set = nieuwe hashes.
  const huidigeChunkPerHash = new Map<string, ChunkRij>();
  const teExtraheren: BronChunk[] = [];
  for (const c of huidigeChunks) {
    const h = teksthash(c.tekst);
    if (!huidigeChunkPerHash.has(h)) huidigeChunkPerHash.set(h, c);
    if (!vorigeHashes.has(h)) teExtraheren.push(alsBron(c)); // gewijzigd/nieuw → her-extractie
  }

  // Voorganger-units waarvan de bronchunk ongewijzigd terugkomt → hergebruiken
  // (binding overnemen, chunk_id herwijzen naar de huidige chunk met dezelfde tekst).
  const { data: vorigeUnitData } = await svc
    .from("semantic_units")
    .select(
      "concept_id, type, chunk_id, statement, value_raw, value_num, value_date, value_text, value_unit, page, section, evidence, evidence_verified, confidence_signals"
    )
    .eq("document_id", doc.vervangt_document_id);
  const vorigeUnits = (vorigeUnitData ?? []) as VoorgangerUnit[];

  const hergebruikt: KandidaatUnit[] = [];
  for (const pu of vorigeUnits) {
    if (!actieveIds.has(pu.concept_id)) continue; // concept niet meer actief → niet hergebruiken
    if (!pu.chunk_id) continue; // zonder bronchunk kunnen we ongewijzigd-zijn niet vaststellen
    const h = hashVanVorigeChunk.get(pu.chunk_id);
    if (!h || !vorigeHashes.has(h)) continue;
    const huidig = huidigeChunkPerHash.get(h);
    if (!huidig) continue; // bronchunk kwam niet ongewijzigd terug → wordt her-geëxtraheerd
    hergebruikt.push({
      concept_id: pu.concept_id,
      type: pu.type as ConceptType,
      chunk_id: huidig.id,
      statement: pu.statement,
      value_raw: pu.value_raw,
      value_num: pu.value_num,
      value_date: pu.value_date,
      value_text: pu.value_text,
      value_unit: pu.value_unit,
      page: huidig.pagina,
      section: pu.section,
      evidence: pu.evidence,
      evidence_verified: pu.evidence_verified,
      confidence_signals: { ...(pu.confidence_signals ?? {}), hergebruikt: true },
      document_status: doc.status, // gezag-signaal van het NIEUWE document
    });
  }

  return { teExtraheren, hergebruikt };
}
