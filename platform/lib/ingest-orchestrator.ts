// ============================================================================
//  platform/lib/ingest-orchestrator.ts — async ingest-worker orchestratie (F4).
// ----------------------------------------------------------------------------
//  Gedraind door de cron-worker (app/api/internal/ingest-worker). Draait met de
//  SERVICE-ROLE (RLS-bypass) — de begrensde, aanvaarde uitzondering op het
//  tenant-ingestpad (besluit B). Mitigaties, hier afgedwongen:
//    1. Raakt uitsluitend rijen van het geclaimde document_id.
//    2. fonds_id staat op de job (denorm) — auditspoor + eerlijke verdeling.
//    (3/4 = documentatie/RLS-review, buiten deze module.)
//
//  Model: aqlab run-orchestrator (claim → per-job try/catch → finalize/fail).
//  Uitgangspunt: de queue is de waarheid, `embedding is null` is de voortgang,
//  de lease is de klok. Reaper-only enqueue: de tenant-upload schrijft geen job
//  (deny-by-default), dus deze worker ontdekt documenten met
//  verwerkingsstatus='embedding' + kale chunks en enqueued ze zelf.
//
//  TWEE BANEN (besluit D), gekozen op documenten.agendapunt_id:
//    - Live-baan (stuk bij een agendapunt): directe Messages-API prefixes.
//    - Batch-baan (bibliotheek/bulk): Message Batches API (goedkoper, eigen
//      rate limits), embedding blijft live.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  verrijkChunks,
  startPrefixBatch,
  pasPrefixBatchToe,
  embedBestaandeChunks,
  bouwChunkRecordsZonderVerrijking,
} from "@/core/lib/chunk-ingest";
import { extractTekstMetOcrFallback } from "@/core/lib/ocr";
import type { Bestandstype } from "@/core/lib/document-extractie";
import {
  overschrijdtChunkCap,
  MAX_OCR_PAGINAS,
  IngestCapError,
} from "@/core/lib/ingest-caps";
import { genereerSamenvatting } from "@/core/lib/samenvatting";

// ── Tunable constanten (§8b — stem af ná de dashboard-verificaties) ─────────
const TIJDBUDGET_MS = 240_000; // ruim binnen maxDuration 300s
const LEASE_SECONDS = 600; // > tijdbudget, zodat een tweede worker niet dubbelt
const CLAIM_LIMIET = 4; // jobs per claim-ronde
const MAX_PER_FONDS = 3; // eerlijke verdeling per invocatie
const MAX_INGEST_RETRIES = 3;
const LIVE_PREFIX_CONCURRENTIE = 8; // live-baan; ~30% van het Haiku-RPM (§7)
const VERRIJK_LIMIET = 200; // chunks per verrijk-/embed-ronde
const REAPER_LIMIET = 50; // documenten per invocatie te enqueuen
// Batch-baan poll-interval: KORTER dan de cron (60s), zodat de worker de Message
// Batch elke cyclus opnieuw pollt en afrondt zodra die klaar is. (De batch zelf
// heeft z'n eigen 24u-venster aan Anthropic-kant; deze lease is alleen ons
// re-poll-ritme — NIET de max batch-duur.)
const BATCH_POLL_SECONDS = 45;
const BACKOFF_SEC = [30, 120, 480]; // §4b verstoring 1 (30s → 2m → 8m)

// Batch-baan (Message Batches API, besluit D) AAN/UIT. Uit gezet voor de MVP:
// bij Scale tier (10K RPM Haiku) is het live-budget ruim genoeg, en de live-baan
// levert bibliotheekdocumenten in minuten i.p.v. de batch-latency (tot ~1u). De
// batch-code blijft staan; zet dit op true zodra het volume het live-budget raakt.
const BATCH_BAAN_AAN = false;

// Job-rij zoals documenten_claim_ingest_jobs die teruggeeft (relevante velden).
interface IngestJob {
  id: string;
  document_id: string;
  stap: string;
  status: string;
  retry_count: number | null;
  extern_batch_id: string | null;
  fonds_id: string | null;
}

interface DocumentRij {
  id: string;
  titel: string;
  agendapunt_id: string | null;
  actief: boolean;
  opslag_pad: string | null;
  bestandstype: string | null;
  verwerkingsstatus: string | null;
}

// Pipeline-statussen vóór de embedding-fase: de worker moet dan eerst extraheren
// (+ OCR) en kale chunks aanmaken. 'embedding' = chunks staan er, alleen embeddings
// resteren. Deze twee sets sturen de reaper-enqueue én de dispatch in verwerkJob.
const EXTRACTIE_STATUSSEN = ["ontvangen", "gevalideerd", "gescand", "extractie", "ocr", "chunking"];
const NEEDS_WORK_STATUSSEN = [...EXTRACTIE_STATUSSEN, "embedding"];

export interface IngestWorkerResultaat {
  geenqueued: number;
  claims: number;
  afgerond: number;
  bezig: number;
  overgeslagen: number;
  mislukt: number;
}

const nu = () => new Date().toISOString();
const leaseTijd = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();

export async function draaiIngestWorker(
  svc: SupabaseClient,
  opts: { workerId: string }
): Promise<IngestWorkerResultaat> {
  const deadline = Date.now() + TIJDBUDGET_MS;
  const res: IngestWorkerResultaat = {
    geenqueued: 0,
    claims: 0,
    afgerond: 0,
    bezig: 0,
    overgeslagen: 0,
    mislukt: 0,
  };

  // 1. Reaper: enqueue documenten die klaarstaan maar (nog) geen open job hebben.
  res.geenqueued = await reaper(svc);

  // 2. Claim + verwerk tot het tijdbudget op is of de queue leeg is.
  while (Date.now() < deadline) {
    const jobs = await claim(svc, opts.workerId);
    if (jobs.length === 0) break;
    res.claims += jobs.length;
    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      try {
        const uitkomst = await verwerkJob(svc, job, deadline);
        res[uitkomst] += 1;
      } catch (e) {
        // Poison-job-isolatie (§4b verstoring 4): één kapotte job laat nooit de
        // hele invocatie vallen. Behandel als tijdelijk (backoff → uiteindelijk
        // mislukt boven het retry-plafond).
        console.error(`[ingest-worker] job ${job.id} (doc ${job.document_id}) faalde:`, e);
        await backoff(svc, job, "onverwachte_fout");
        res.bezig += 1;
      }
    }
  }
  return res;
}

// ── Reaper (§4b verstoring 5, reaper-only enqueue) ──────────────────────────
// Enqueuet documenten die klaarstaan (verwerkingsstatus in de pipeline,
// geindexeerd=false, actief) maar nog geen OPEN job hebben. Eén job per document
// draagt de hele resterende pipeline (extractie→embedding); de stap-waarde is de
// beginfase (auditspoor). De partiële unieke index vangt concurrente dubbelen.
async function reaper(svc: SupabaseClient): Promise<number> {
  const { data: kandidaten, error } = await svc
    .from("documenten")
    .select("id, fonds_id, verwerkingsstatus")
    .in("verwerkingsstatus", NEEDS_WORK_STATUSSEN)
    .eq("geindexeerd", false)
    .eq("actief", true)
    .limit(REAPER_LIMIET);
  if (error || !kandidaten || kandidaten.length === 0) return 0;

  const ids = kandidaten.map((d) => d.id as string);
  const { data: openJobs } = await svc
    .from("document_processing_jobs")
    .select("document_id")
    .in("document_id", ids)
    .in("status", ["wachtend", "bezig"]);
  const heeftJob = new Set((openJobs ?? []).map((j) => j.document_id as string));

  let n = 0;
  for (const d of kandidaten) {
    if (heeftJob.has(d.id as string)) continue;
    const stap = d.verwerkingsstatus === "embedding" ? "embedding" : "extractie";
    const { error: insErr } = await svc.from("document_processing_jobs").insert({
      document_id: d.id,
      fonds_id: d.fonds_id,
      stap,
      status: "wachtend",
    });
    if (insErr) {
      // 23505 = partiële unieke index (concurrente enqueue) → onschadelijk.
      const dubbel = insErr.code === "23505" || /duplicate|unique/i.test(insErr.message ?? "");
      if (!dubbel) {
        console.error(`[ingest-worker] reaper enqueue mislukt voor ${d.id}:`, insErr.message);
      }
    } else {
      n += 1;
    }
  }
  return n;
}

// ── Claim ───────────────────────────────────────────────────────────────────
async function claim(svc: SupabaseClient, workerId: string): Promise<IngestJob[]> {
  const { data, error } = await svc.rpc("documenten_claim_ingest_jobs", {
    p_worker_id: workerId,
    p_limit: CLAIM_LIMIET,
    p_lease_seconds: LEASE_SECONDS,
    p_max_per_fonds: MAX_PER_FONDS,
  });
  if (error) throw new Error(`claim mislukt: ${error.message}`);
  return (data ?? []) as IngestJob[];
}

type Uitkomst = "afgerond" | "bezig" | "overgeslagen" | "mislukt";

async function verwerkJob(
  svc: SupabaseClient,
  job: IngestJob,
  deadline: number
): Promise<Uitkomst> {
  const { data: doc, error } = await svc
    .from("documenten")
    .select("id, titel, agendapunt_id, actief, opslag_pad, bestandstype, verwerkingsstatus")
    .eq("id", job.document_id)
    .single();
  if (error || !doc) throw new Error(`document ${job.document_id} niet gevonden`);
  const document = doc as DocumentRij;

  // Verstoring 9: gedeactiveerd tijdens verwerking → geen duur werk meer.
  if (!document.actief) {
    await svc
      .from("document_processing_jobs")
      .update({ status: "overgeslagen", eind: nu(), foutcode: "document_inactief" })
      .eq("id", job.id);
    return "overgeslagen";
  }

  // EXTRACTIE-fase (F6): download uit Storage → extractie (+OCR) → kale chunks →
  // AI-samenvatting → verwerkingsstatus='embedding'. Alleen als het document nog
  // vóór de embedding-fase staat.
  if (EXTRACTIE_STATUSSEN.includes(document.verwerkingsstatus ?? "")) {
    const r = await extracteerEnChunk(svc, job, document);
    if (r !== "door") return r; // mislukt / geweigerd / backoff → klaar voor nu
    document.verwerkingsstatus = "embedding";
  }

  // EMBEDDING-fase. Als het tijdbudget al op is na de (dure) extractie: yield,
  // een volgende invocatie doet de embedding.
  if (Date.now() >= deadline) return await yieldJob(svc, job);
  // Live-baan voor stukken bij een agendapunt (voorrang/snelheid) én — zolang de
  // batch-baan uit staat — voor alle documenten (MVP-keuze, zie BATCH_BAAN_AAN).
  const liveBaan = !BATCH_BAAN_AAN || document.agendapunt_id != null;
  return liveBaan
    ? await verwerkLive(svc, job, document, deadline)
    : await verwerkBatch(svc, job, document, deadline);
}

// ── Extractie-fase (F6) ──────────────────────────────────────────────────────
// Retourneert "door" wanneer het document klaar is voor de embedding-fase, of een
// terminale/backoff-Uitkomst.
async function extracteerEnChunk(
  svc: SupabaseClient,
  job: IngestJob,
  doc: DocumentRij
): Promise<Uitkomst | "door"> {
  if (!doc.opslag_pad) {
    // Zonder origineel is er niets te extraheren — permanente fout.
    return await markeerMislukt(svc, job, doc.id, "geen_origineel");
  }

  // Download het origineel (service-role) uit de leesbare bucket.
  const { data: blob, error: dlErr } = await svc.storage
    .from("documenten")
    .download(doc.opslag_pad);
  if (dlErr || !blob) {
    // Tijdelijke storage-fout → backoff (kan een netwerkhik zijn).
    return await backoff(svc, job, "storage_download");
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  const bestandstype = (doc.bestandstype ?? "pdf") as Bestandstype;

  // Extractie met OCR-fallback (async, hogere OCR-cap dan het oude sync-pad).
  let extractie;
  try {
    extractie = await extractTekstMetOcrFallback(buffer, bestandstype, {
      maxOcrPaginas: MAX_OCR_PAGINAS,
    });
  } catch (e) {
    if (e instanceof IngestCapError) {
      // Bewuste weigering (bv. xlsx-rijlimiet), geen fout.
      return await markeerGeweigerd(svc, job, doc.id, e.foutcode);
    }
    return await backoff(svc, job, "extractie_fout");
  }

  // Geen bruikbare tekst — ook niet ná OCR.
  if (!extractie.tekst || extractie.tekst.trim().length < 100) {
    if (extractie.ocrOvergeslagen === "te_veel_paginas") {
      return await markeerGeweigerd(svc, job, doc.id, "ocr_te_veel_paginas");
    }
    return await markeerMislukt(svc, job, doc.id, "geen_bruikbare_tekst");
  }

  // Kale chunks + cap-handhaving (in de worker, F6).
  const bareRecords = bouwChunkRecordsZonderVerrijking({
    documentId: doc.id,
    segmenten: extractie.segmenten,
  });
  if (overschrijdtChunkCap(bareRecords.length)) {
    return await markeerGeweigerd(svc, job, doc.id, "bestand_te_groot_voor_rag");
  }

  // Vervang chunks (fail-closed). Delete-then-insert maakt de extractie
  // herhaalbaar (een eerdere, half mislukte poging laat geen wees-chunks na).
  await svc.from("document_chunks").delete().eq("document_id", doc.id);
  const batch = 50;
  for (let i = 0; i < bareRecords.length; i += batch) {
    const { error: insErr } = await svc
      .from("document_chunks")
      .insert(bareRecords.slice(i, i + batch));
    if (insErr) {
      await svc.from("document_chunks").delete().eq("document_id", doc.id);
      return await backoff(svc, job, "chunk_insert");
    }
  }

  // AI-samenvatting van een vergaderstuk (besluit C): direct ná de extractie,
  // vóór de verrijking. Best-effort — een mislukte samenvatting blokkeert de
  // ingest niet.
  if (doc.agendapunt_id) {
    const samenvatting = await genereerSamenvatting(extractie.tekst);
    if (samenvatting) {
      await svc
        .from("documenten")
        .update({ samenvatting_ai: samenvatting, samengevat_op: nu() })
        .eq("id", doc.id);
    }
  }

  // Advance → embedding-fase.
  await svc
    .from("documenten")
    .update({
      verwerkingsstatus: "embedding",
      paginas: extractie.aantalPaginas,
      ocr_toegepast: extractie.ocrToegepast ?? null,
      ocr_engine: extractie.ocrEngine ?? null,
    })
    .eq("id", doc.id);
  return "door";
}

// Permanente fout (retry helpt niet): job mislukt + document mislukt.
async function markeerMislukt(
  svc: SupabaseClient,
  job: IngestJob,
  documentId: string,
  foutcode: string
): Promise<Uitkomst> {
  await svc
    .from("document_processing_jobs")
    .update({ status: "mislukt", foutcode, eind: nu() })
    .eq("id", job.id);
  await svc.from("documenten").update({ verwerkingsstatus: "mislukt" }).eq("id", documentId);
  return "mislukt";
}

// Bewuste weigering (cap): document geweigerd, job geslaagd (het is afgehandeld,
// geen fout). geindexeerd blijft false; het document is niet doorzoekbaar.
async function markeerGeweigerd(
  svc: SupabaseClient,
  job: IngestJob,
  documentId: string,
  foutcode: string
): Promise<Uitkomst> {
  await svc
    .from("document_processing_jobs")
    .update({ status: "geslaagd", foutcode, eind: nu() })
    .eq("id", job.id);
  await svc
    .from("documenten")
    .update({ verwerkingsstatus: "geweigerd" })
    .eq("id", documentId);
  return "overgeslagen";
}

// ── Live-baan ────────────────────────────────────────────────────────────────
async function verwerkLive(
  svc: SupabaseClient,
  job: IngestJob,
  doc: DocumentRij,
  deadline: number
): Promise<Uitkomst> {
  while (Date.now() < deadline) {
    const r = await verrijkChunks(svc, doc.id, {
      titel: doc.titel,
      prefixConcurrentie: LIVE_PREFIX_CONCURRENTIE,
      limiet: VERRIJK_LIMIET,
    });
    if (r.resterend === 0) return await finaliseer(svc, job, doc.id);
    if (r.verwerkt === 0) return await backoff(svc, job, "provider_tijdelijk");
    // voortgang geboekt, meer chunks resteren → volgende ronde binnen tijdbudget
  }
  return await yieldJob(svc, job); // tijdbudget op → prompte voortzetting
}

// ── Batch-baan ───────────────────────────────────────────────────────────────
async function verwerkBatch(
  svc: SupabaseClient,
  job: IngestJob,
  doc: DocumentRij,
  deadline: number
): Promise<Uitkomst> {
  // Fase 1 — prefixes via Message Batch (stateful over invocaties heen).
  if (job.extern_batch_id) {
    const st = await pasPrefixBatchToe(svc, doc.id, job.extern_batch_id);
    if (st === "bezig") {
      await svc
        .from("document_processing_jobs")
        .update({ lease_expires_at: leaseTijd(BATCH_POLL_SECONDS) })
        .eq("id", job.id);
      return "bezig";
    }
    if (st === "fout" || st === "verlopen") {
      await svc
        .from("document_processing_jobs")
        .update({ extern_batch_id: null })
        .eq("id", job.id);
      return await backoff(svc, job, st === "verlopen" ? "batch_verlopen" : "batch_fout");
    }
    // "klaar": prefixes staan; batch-id opruimen en door naar de embedding-fase.
    await svc.from("document_processing_jobs").update({ extern_batch_id: null }).eq("id", job.id);
  } else {
    const start = await startPrefixBatch(svc, doc.id, doc.titel);
    if (start.soort === "gestart") {
      await svc
        .from("document_processing_jobs")
        .update({ extern_batch_id: start.externBatchId, lease_expires_at: leaseTijd(BATCH_POLL_SECONDS) })
        .eq("id", job.id);
      return "bezig";
    }
    if (start.soort === "fout") {
      // Batch-API onbeschikbaar → val terug op de live-baan (synchrone prefixes)
      // i.p.v. baseline-embeddings zonder situering.
      return await verwerkLive(svc, job, doc, deadline);
    }
    // "leeg": geen units te prefixen (of alle prefixes al gezet) → ga embedden.
  }

  // Fase 2 — embedding over de (batch-)geschreven prefixes.
  while (Date.now() < deadline) {
    const e = await embedBestaandeChunks(svc, doc.id, VERRIJK_LIMIET);
    if (e.resterend === 0) return await finaliseer(svc, job, doc.id);
    if (e.verwerkt === 0) return await backoff(svc, job, "provider_tijdelijk");
  }
  return await yieldJob(svc, job);
}

// ── Afronden / backoff / yield ───────────────────────────────────────────────
async function finaliseer(
  svc: SupabaseClient,
  job: IngestJob,
  documentId: string
): Promise<Uitkomst> {
  // Invariant (F0.2): alleen afronden bij nul chunks met embedding is null.
  const { count: nogNull } = await svc
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .is("embedding", null);
  if ((nogNull ?? 0) > 0) {
    // Defensief: nog niet klaar — laat een volgende ronde afronden.
    await yieldJob(svc, job);
    return "bezig";
  }

  // Prefix-degradatie (§F0.3): geëmbedde chunks zonder prefix (prefix omgevallen).
  const { count: zonderPrefix } = await svc
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .not("embedding", "is", null)
    .is("context_prefix", null);
  const degradatie = (zonderPrefix ?? 0) > 0;

  await svc
    .from("documenten")
    .update({ geindexeerd: true, verwerkingsstatus: "beschikbaar" })
    .eq("id", documentId);
  await svc
    .from("document_processing_jobs")
    .update({ status: "geslaagd", eind: nu(), foutcode: degradatie ? "prefix_degradatie" : null })
    .eq("id", job.id);
  return "afgerond";
}

async function backoff(
  svc: SupabaseClient,
  job: IngestJob,
  foutcode: string
): Promise<Uitkomst> {
  const nieuweRetry = (job.retry_count ?? 0) + 1;
  if (nieuweRetry > MAX_INGEST_RETRIES) {
    // Definitief mislukt: dead-letter (de claim slaat 'mislukt' over). geindexeerd
    // blijft false; de gebruiker start herverwerking expliciet (F5).
    await svc
      .from("document_processing_jobs")
      .update({ status: "mislukt", retry_count: nieuweRetry, foutcode, eind: nu() })
      .eq("id", job.id);
    await svc
      .from("documenten")
      .update({ verwerkingsstatus: "mislukt" })
      .eq("id", job.document_id);
    return "mislukt";
  }
  // lease_expires_at in de toekomst = de backoff-klok (§3): de claim herpakt de
  // job pas als hij verlopen is.
  const sec = BACKOFF_SEC[Math.min(nieuweRetry - 1, BACKOFF_SEC.length - 1)];
  await svc
    .from("document_processing_jobs")
    .update({ status: "bezig", retry_count: nieuweRetry, foutcode, lease_expires_at: leaseTijd(sec) })
    .eq("id", job.id);
  return "bezig";
}

// Yield bij tijdbudget-afbreking: zet de job terug op 'wachtend' met vrije lease,
// zodat een volgende invocatie hem meteen kan herclaimen (geen lease-wachttijd).
async function yieldJob(svc: SupabaseClient, job: IngestJob): Promise<Uitkomst> {
  await svc
    .from("document_processing_jobs")
    .update({ status: "wachtend", lease_expires_at: null })
    .eq("id", job.id);
  return "bezig";
}
