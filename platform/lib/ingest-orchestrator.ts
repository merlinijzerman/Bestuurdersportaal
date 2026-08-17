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
import { timingSafeEqual } from "node:crypto";
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
import {
  preflightSysteem,
  systeemSleutel,
  vingerafdruk,
} from "@/core/lib/ai-preflight";
import { verwerkSemantischeExtractieJob } from "@/platform/lib/semantische-extractie-job";
import { valideerUpload } from "@/core/lib/bestand-validatie";
import { CONTENT_TYPE_PER_BESTANDSTYPE } from "@/core/lib/document-extractie";
import { leesScannerHealth, scanSignedUrl } from "@/platform/lib/malware-scan-client";
import { signatureOordeel } from "@/core/lib/malware-scan-beleid";
import { heeftSchoonScanbewijs } from "@/core/lib/document-scan-poort";
import { isProviderAuthenticatieFout } from "@/core/lib/provider-fout";

// ── Tunable constanten (§8b — stem af ná de dashboard-verificaties) ─────────
const TIJDBUDGET_MS = 240_000; // ruim binnen maxDuration 300s
const LEASE_SECONDS = 600; // > tijdbudget, zodat een tweede worker niet dubbelt
const CLAIM_LIMIET = 4; // jobs per claim-ronde
const MAX_PER_FONDS = 3; // eerlijke verdeling per invocatie
const MAX_INGEST_RETRIES = 3;
const MAX_VEROUDERDE_SIGNATURE_RETRIES = 12;
const VEROUDERDE_SIGNATURE_BACKOFF_SEC = 15 * 60;
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

// ── Orphan-sweep (F7 direct-to-storage) ─────────────────────────────────────
// Bij direct-to-storage upload de browser eerst het bestand, en pas de
// complete-stap maakt de documentrij. Een afgebroken of afgekeurde upload laat
// dus een origineel in 'documenten' achter zónder documentrij. De app-surface
// heeft geen service-role en mag niet uit Storage verwijderen (Variant C); de
// worker (beheer, wél service-role) ruimt die wezen op. Alleen objecten ouder
// dan de drempel (een jonge upload kan nog tussen upload en complete zitten).
const ORPHAN_MIN_LEEFTIJD_MS = 60 * 60 * 1000; // 1 uur
const ORPHAN_FONDS_LIMIET = 100; // fonds-mappen per sweep
const ORPHAN_OBJECT_LIMIET = 200; // te verwijderen objecten per sweep

// Job-rij zoals documenten_claim_ingest_jobs die teruggeeft (relevante velden).
interface IngestJob {
  id: string;
  document_id: string;
  stap: string;
  status: string;
  retry_count: number | null;
  claim_count: number | null;
  extern_batch_id: string | null;
  fonds_id: string | null;
}

interface DocumentRij {
  id: string;
  titel: string;
  agendapunt_id: string | null;
  actief: boolean;
  opslag_pad: string | null;
  quarantaine_pad: string | null;
  bestand_hash: string | null;
  scan_resultaat: Record<string, unknown> | null;
  bibliotheek: string | null;
  bestandsnaam: string | null;
  opgeslagen_door: string | null;
  vervangt_na_scan_document_id: string | null;
  vervangt_na_scan_reden: string | null;
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
  verweesd_opgeruimd: number;
}

const nu = () => new Date().toISOString();
const leaseTijd = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();

export async function draaiIngestWorker(
  svc: SupabaseClient,
  opts: { workerId: string; oidcToken?: string | null }
): Promise<IngestWorkerResultaat> {
  const deadline = Date.now() + TIJDBUDGET_MS;
  const res: IngestWorkerResultaat = {
    geenqueued: 0,
    claims: 0,
    afgerond: 0,
    bezig: 0,
    overgeslagen: 0,
    mislukt: 0,
    verweesd_opgeruimd: 0,
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
        const uitkomst = await verwerkJob(svc, job, deadline, opts.oidcToken ?? null);
        res[uitkomst] += 1;
      } catch (e) {
        // Poison-job-isolatie (§4b verstoring 4): één kapotte job laat nooit de
        // hele invocatie vallen. Behandel als tijdelijk (backoff → uiteindelijk
        // mislukt boven het retry-plafond).
        console.error(`[ingest-worker] job ${job.id} (doc ${job.document_id}) faalde:`, e);
        if (isProviderAuthenticatieFout(e)) {
          // Configuratiefout: retries maken alleen opnieuw kosten en dezelfde
          // sleutel blijft binnen deze deployment ongeldig. Markeer direct
          // zichtbaar als mislukt; na herstel kan de gebruiker herverwerken.
          await markeerMislukt(svc, job, job.document_id, "provider_authenticatie");
          res.mislukt += 1;
        } else {
          await backoff(svc, job, "onverwachte_fout");
          res.bezig += 1;
        }
      }
    }
  }

  // 3. Orphan-sweep (F7): ruim verweesde originelen op van afgebroken/afgekeurde
  // direct-to-storage-uploads. Best-effort; een fout mag de invocatie niet vellen.
  try {
    res.verweesd_opgeruimd =
      (await ruimVerweesdeOriginelenOp(svc)) +
      (await ruimVerweesdeQuarantaineUploadsOp(svc)) +
      (await ruimGepromoveerdeQuarantaineOp(svc));
  } catch (e) {
    console.error("[ingest-worker] orphan-sweep faalde:", e);
  }
  return res;
}

async function ruimGepromoveerdeQuarantaineOp(svc: SupabaseClient): Promise<number> {
  const { data: rijen, error } = await svc.from("documenten")
    .select("id, quarantaine_pad, opslag_pad, verwerkingsstatus")
    .not("quarantaine_pad", "is", null)
    .not("opslag_pad", "is", null)
    .neq("verwerkingsstatus", "gequarantineerd")
    .limit(ORPHAN_OBJECT_LIMIET);
  if (error || !rijen?.length) return 0;
  let verwijderd = 0;
  for (const rij of rijen) {
    const pad = rij.quarantaine_pad as string;
    const { error: rmErr } = await svc.storage.from("documenten-quarantaine").remove([pad]);
    if (rmErr) continue;
    const { data: geraakt } = await svc.from("documenten").update({ quarantaine_pad: null })
      .eq("id", rij.id).eq("quarantaine_pad", pad).select("id");
    if (geraakt?.length) verwijderd += 1;
  }
  return verwijderd;
}

// Afgebroken direct-to-quarantine-uploads hebben nog geen documentenrij. Bewaar
// bekende paden (dus ook besmette bestanden) en verwijder alleen oude wezen.
async function ruimVerweesdeQuarantaineUploadsOp(svc: SupabaseClient): Promise<number> {
  const { data: topLevel, error } = await svc.storage
    .from("documenten-quarantaine")
    .list("", { limit: ORPHAN_FONDS_LIMIET });
  if (error || !topLevel) return 0;

  const drempel = Date.now() - ORPHAN_MIN_LEEFTIJD_MS;
  const kandidaten: string[] = [];
  for (const map of topLevel) {
    if (map.id !== null || kandidaten.length >= ORPHAN_OBJECT_LIMIET) continue;
    const { data: objecten } = await svc.storage
      .from("documenten-quarantaine")
      .list(map.name, { limit: ORPHAN_OBJECT_LIMIET });
    if (!objecten) continue;
    for (const obj of objecten) {
      if (obj.id === null) continue;
      const gemaakt = obj.created_at ? Date.parse(obj.created_at) : Date.now();
      if (gemaakt > drempel) continue;
      kandidaten.push(`${map.name}/${obj.name}`);
      if (kandidaten.length >= ORPHAN_OBJECT_LIMIET) break;
    }
  }
  if (kandidaten.length === 0) return 0;

  const { data: rijen } = await svc.from("documenten")
    .select("quarantaine_pad")
    .in("quarantaine_pad", kandidaten);
  const bekend = new Set((rijen ?? []).map((r) => r.quarantaine_pad as string));
  const wees = kandidaten.filter((pad) => !bekend.has(pad));
  if (wees.length === 0) return 0;
  const { error: rmErr } = await svc.storage.from("documenten-quarantaine").remove(wees);
  if (rmErr) return 0;
  return wees.length;
}

// ── Orphan-sweep ────────────────────────────────────────────────────────────
// Verwijdert originelen in de 'documenten'-bucket zonder bijbehorende
// documentrij (afgebroken/afgekeurde F7-uploads). Alleen objecten ouder dan de
// drempel — een jong object kan nog tussen de directe upload en de complete-stap
// zitten. 'generiek/' (platform-gecureerd) wordt overgeslagen. Objecten van
// gedeactiveerde documenten blijven staan: die hebben nog een documentrij.
async function ruimVerweesdeOriginelenOp(svc: SupabaseClient): Promise<number> {
  const { data: topLevel, error } = await svc.storage
    .from("documenten")
    .list("", { limit: ORPHAN_FONDS_LIMIET });
  if (error || !topLevel) return 0;

  const drempel = Date.now() - ORPHAN_MIN_LEEFTIJD_MS;
  const kandidaten: string[] = [];
  for (const map of topLevel) {
    // Mappen hebben id === null; alleen fonds-mappen, niet 'generiek'.
    if (map.id !== null || map.name === "generiek") continue;
    if (kandidaten.length >= ORPHAN_OBJECT_LIMIET) break;
    const { data: objecten } = await svc.storage
      .from("documenten")
      .list(map.name, { limit: ORPHAN_OBJECT_LIMIET });
    if (!objecten) continue;
    for (const obj of objecten) {
      if (obj.id === null) continue; // geen sub-mappen verwachten
      const gemaakt = obj.created_at ? Date.parse(obj.created_at) : Date.now();
      if (gemaakt > drempel) continue; // te jong → mogelijk nog in-flight
      kandidaten.push(`${map.name}/${obj.name}`);
      if (kandidaten.length >= ORPHAN_OBJECT_LIMIET) break;
    }
  }
  if (kandidaten.length === 0) return 0;

  // Welke kandidaatpaden hebben (nog) een documentrij? Die NIET verwijderen —
  // ongeacht actief/gedeactiveerd. De rest is echt verweesd.
  const { data: rijen } = await svc
    .from("documenten")
    .select("opslag_pad")
    .in("opslag_pad", kandidaten);
  const bekend = new Set((rijen ?? []).map((r) => r.opslag_pad as string));
  const wees = kandidaten.filter((p) => !bekend.has(p));
  if (wees.length === 0) return 0;

  const { error: rmErr } = await svc.storage.from("documenten").remove(wees);
  if (rmErr) {
    console.error("[ingest-worker] orphan-sweep remove mislukt:", rmErr.message);
    return 0;
  }
  console.log(
    JSON.stringify({ tag: "ingest-meting", fase: "orphan-sweep", verwijderd: wees.length })
  );
  return wees.length;
}

// ── Reaper (§4b verstoring 5, reaper-only enqueue) ──────────────────────────
// Enqueuet documenten die klaarstaan (verwerkingsstatus in de pipeline,
// geindexeerd=false, actief) maar nog geen OPEN job hebben. Eén job per document
// draagt de hele resterende pipeline (extractie→embedding); de stap-waarde is de
// beginfase (auditspoor). De partiële unieke index vangt concurrente dubbelen.
async function reaper(svc: SupabaseClient): Promise<number> {
  const { data: kandidaten, error } = await svc
    .from("documenten")
    .select("id, fonds_id, verwerkingsstatus, quarantaine_pad, opslag_pad")
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
    const stap = d.quarantaine_pad && !d.opslag_pad
      ? "scan"
      : d.verwerkingsstatus === "embedding" ? "embedding" : "extractie";
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
  deadline: number,
  oidcToken: string | null
): Promise<Uitkomst> {
  // T8 — semantische-extractie-jobs lopen langs een eigen handler (eigen document-
  // laadpad, geen verwerkingsstatus-/embedding-semantiek). Zelfde claim-RPC en
  // Uitkomst-buckets, dus de teller/back-off van de worker blijven ongewijzigd.
  if (job.stap === "semantische_extractie") {
    return await verwerkSemantischeExtractieJob(svc, job, deadline);
  }

  const { data: doc, error } = await svc
    .from("documenten")
    .select("id, titel, agendapunt_id, actief, opslag_pad, quarantaine_pad, bestand_hash, scan_resultaat, bibliotheek, bestandsnaam, bestandstype, verwerkingsstatus, opgeslagen_door, vervangt_na_scan_document_id, vervangt_na_scan_reden")
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

  if (document.quarantaine_pad && !document.opslag_pad) {
    return await scanEnPromoveer(svc, job, document, oidcToken);
  }

  // EXTRACTIE-fase (F6): download uit Storage → extractie (+OCR) → kale chunks →
  // AI-samenvatting → verwerkingsstatus='embedding'. Alleen als het document nog
  // vóór de embedding-fase staat.
  if (EXTRACTIE_STATUSSEN.includes(document.verwerkingsstatus ?? "")) {
    // Expliciete parserpoort. De storagepromotie is al hash-gebonden, maar deze
    // tweede controle maakt dat een foutieve status/transitie nooit alsnog
    // ongescande bytes aan xlsx/unpdf/mammoth voert.
    if (
      process.env.WP3_MALWARESCAN_AAN === "true" &&
      !heeftSchoonScanbewijs(document)
    ) {
      return await backoff(svc, job, "scanbewijs_ontbreekt");
    }
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

// ── WP3: quarantaine → validatie → scan → promotie ─────────────────────────
async function scanEnPromoveer(
  svc: SupabaseClient,
  job: IngestJob,
  doc: DocumentRij,
  oidcToken: string | null
): Promise<Uitkomst> {
  if (!doc.quarantaine_pad || !doc.bestandstype || !doc.bestandsnaam) {
    return await markeerMislukt(svc, job, doc.id, "quarantaine_metadata_ontbreekt");
  }

  const { data: blob, error: dlErr } = await svc.storage
    .from("documenten-quarantaine")
    .download(doc.quarantaine_pad);
  if (dlErr || !blob) return await backoff(svc, job, "quarantaine_download");
  const buffer = Buffer.from(await blob.arrayBuffer());
  const validatie = await valideerUpload({
    naam: doc.bestandsnaam,
    mimeType: CONTENT_TYPE_PER_BESTANDSTYPE[doc.bestandstype as Bestandstype] ?? "",
    buffer,
  });
  if (!validatie.ok) {
    await verwijderQuarantaine(svc, doc.id, doc.quarantaine_pad);
    return await markeerGeweigerd(svc, job, doc.id, validatie.foutcode);
  }
  if (validatie.bestandstype !== doc.bestandstype) {
    await verwijderQuarantaine(svc, doc.id, doc.quarantaine_pad);
    return await markeerGeweigerd(svc, job, doc.id, "extensie_inhoud_mismatch");
  }

  const dupQuery = svc
    .from("documenten")
    .select("id")
    .eq("bestand_hash", validatie.hash)
    .eq("actief", true)
    .neq("id", doc.id);
  const { data: duplicaat } = doc.bibliotheek === "generiek"
    ? await dupQuery.eq("bibliotheek", "generiek").limit(1).maybeSingle()
    : await dupQuery.eq("fonds_id", job.fonds_id).limit(1).maybeSingle();
  if (duplicaat) {
    await verwijderQuarantaine(svc, doc.id, doc.quarantaine_pad);
    return await markeerGeweigerd(svc, job, doc.id, "duplicaat");
  }

  if (!oidcToken) return await backoff(svc, job, "scanner_oidc_ontbreekt");
  const health = await leesScannerHealth(oidcToken);
  if (!health) return await backoff(svc, job, "scanner_onbereikbaar");
  if (signatureOordeel(health) === "verouderd") {
    return await backoffVerouderdeSignatures(svc, job);
  }
  const { data: signed, error: signErr } = await svc.storage
    .from("documenten-quarantaine")
    .createSignedUrl(doc.quarantaine_pad, 90);
  if (signErr || !signed?.signedUrl) return await backoff(svc, job, "signed_url_mislukt");

  const scan = await scanSignedUrl({ signedUrl: signed.signedUrl, oidcToken });
  // Nooit de signed URL of de bestandsnaam in scan_resultaat/logs opnemen.
  await svc.from("documenten").update({ scan_resultaat: scan }).eq("id", doc.id);
  if (scan.verdict === "scanner_unreachable" || scan.verdict === "error") {
    return await backoff(svc, job, scan.code ?? "scanner_onbereikbaar");
  }
  if (scan.verdict === "stale_definitions") {
    return await backoffVerouderdeSignatures(svc, job);
  }
  if (scan.verdict === "infected" || scan.verdict === "policy_blocked") {
    await svc.from("document_processing_jobs").update({
      status: "mislukt", eind: nu(), foutcode: scan.verdict,
    }).eq("id", job.id);
    await svc.from("documenten").update({
      bestand_hash: validatie.hash,
      verwerkingsstatus: "gequarantineerd",
    }).eq("id", doc.id);
    return "mislukt";
  }
  if (scan.verdict !== "clean") return await backoff(svc, job, "scanner_verdict_onbekend");
  if (!gelijkeHash(scan.sha256, validatie.hash)) {
    return await securityConflict(svc, job, doc.id, "hash_mismatch");
  }
  if (scan.deploymentId !== health.deploymentId) {
    return await backoff(svc, job, "scanner_deployment_gewijzigd");
  }

  const doelpad = doc.bibliotheek === "generiek"
    ? `generiek/${doc.id}.${validatie.bestandstype}`
    : `${job.fonds_id}/${doc.id}.${validatie.bestandstype}`;
  const { error: uploadErr } = await svc.storage.from("documenten").upload(doelpad, buffer, {
    contentType: CONTENT_TYPE_PER_BESTANDSTYPE[validatie.bestandstype],
    upsert: false,
  });
  if (uploadErr) {
    // Crash-window: doel kan door een vorige poging al zijn geschreven.
    const { data: bestaand } = await svc.storage.from("documenten").download(doelpad);
    if (!bestaand) return await securityConflict(svc, job, doc.id, "promotie_conflict");
    const bestaandOordeel = await valideerUpload({
      naam: doc.bestandsnaam,
      mimeType: CONTENT_TYPE_PER_BESTANDSTYPE[validatie.bestandstype],
      buffer: Buffer.from(await bestaand.arrayBuffer()),
    });
    if (!bestaandOordeel.ok || !gelijkeHash(bestaandOordeel.hash, validatie.hash)) {
      return await securityConflict(svc, job, doc.id, "promotie_conflict");
    }
  }

  const { data: geraakt, error: updateErr } = await svc.from("documenten").update({
    opslag_pad: doelpad,
    bestand_hash: validatie.hash,
    bestandstype: validatie.bestandstype,
    mime_gedetecteerd: validatie.mimeGedetecteerd,
    verwerkingsstatus: "gescand",
  }).eq("id", doc.id).is("opslag_pad", null).eq("quarantaine_pad", doc.quarantaine_pad).select("id");
  if (updateErr) return await backoff(svc, job, "promotie_db_update");
  if (!geraakt || geraakt.length === 0) {
    const { data: huidig } = await svc.from("documenten")
      .select("opslag_pad, quarantaine_pad, bestand_hash, scan_resultaat, verwerkingsstatus")
      .eq("id", doc.id).maybeSingle();
    const scanHash = (huidig?.scan_resultaat as { sha256?: string } | null)?.sha256;
    if (huidig?.opslag_pad !== doelpad || huidig?.bestand_hash !== validatie.hash ||
        scanHash !== validatie.hash || huidig?.verwerkingsstatus !== "gescand") {
      return await securityConflict(svc, job, doc.id, "promotie_conflict");
    }
  }

  // Vervanging pas nu: de nieuwe bytes zijn schoon en duurzaam gepromoveerd.
  if (doc.vervangt_na_scan_document_id) {
    const { data: oud } = await svc.from("documenten").update({
      status: "historisch", vervangen_door_document_id: doc.id,
    }).eq("id", doc.vervangt_na_scan_document_id).neq("status", "historisch").select("id");
    if (oud && oud.length > 0) {
      await svc.from("document_metadata_log").insert({
        document_id: doc.vervangt_na_scan_document_id,
        document_titel_snapshot: doc.titel,
        fonds_id: job.fonds_id,
        gewijzigd_door: doc.opgeslagen_door,
        gewijzigd_door_naam: null,
        veld_naam: "status",
        oude_waarde: "actueel",
        nieuwe_waarde: "historisch",
        wijzig_reden: doc.vervangt_na_scan_reden ?? "Vervangen na geslaagde malwarescan",
        wijzig_type: "status",
        rag_impact: true,
      });
      await svc.from("documenten").update({
        vervangt_document_id: doc.vervangt_na_scan_document_id,
        vervangt_na_scan_document_id: null,
        vervangt_na_scan_reden: null,
      }).eq("id", doc.id);
    }
  }

  await verwijderQuarantaine(svc, doc.id, doc.quarantaine_pad, doelpad);
  // Extractie krijgt een eigen invocatie en begint nooit in dezelfde crash-window.
  return await yieldJob(svc, job);
}

async function verwijderQuarantaine(
  svc: SupabaseClient, documentId: string, pad: string, verwachtDoelpad?: string
): Promise<void> {
  const { error } = await svc.storage.from("documenten-quarantaine").remove([pad]);
  if (error) return;
  let q = svc.from("documenten").update({ quarantaine_pad: null })
    .eq("id", documentId).eq("quarantaine_pad", pad);
  if (verwachtDoelpad) q = q.eq("opslag_pad", verwachtDoelpad);
  await q;
}

function gelijkeHash(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

async function securityConflict(
  svc: SupabaseClient, job: IngestJob, documentId: string, foutcode: string
): Promise<Uitkomst> {
  await svc.from("document_processing_jobs").update({ status: "mislukt", foutcode, eind: nu() }).eq("id", job.id);
  await svc.from("documenten").update({ verwerkingsstatus: "gequarantineerd" }).eq("id", documentId);
  return "mislukt";
}

// ── Extractie-fase (F6) ──────────────────────────────────────────────────────
// Retourneert "door" wanneer het document klaar is voor de embedding-fase, of een
// terminale/backoff-Uitkomst.
async function extracteerEnChunk(
  svc: SupabaseClient,
  job: IngestJob,
  doc: DocumentRij
): Promise<Uitkomst | "door"> {
  if (doc.quarantaine_pad && !doc.opslag_pad) {
    return await backoff(svc, job, "quarantaine_niet_afgerond");
  }
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

  // AI-BEGRENZING (besluit 0180). Eén document-ingest is ÉÉN AI-actie, ongeacht
  // hoeveel modelcalls (samenvatting, tientallen prefixes, embeddings) eruit
  // voortkomen. Het fonds komt van de job-rij, niet van een sessie; er is hier
  // geen gebruiker om tegen af te rekenen. De reservering staat vóór de eerste
  // providercall en is idempotent op (job, stap): een hervatte job na een
  // backoff reserveert niet opnieuw zolang dezelfde poging loopt.
  const ingestPf = await preflightSysteem(svc, {
    actietype: "document_ingest",
    fondsId: job.fonds_id ?? null,
    provider: "anthropic",
    idempotentie: systeemSleutel(job.id, "document_ingest", (job.retry_count ?? 0) + 1),
    vingerafdruk: vingerafdruk({ documentId: doc.id, opslagPad: doc.opslag_pad }),
  });
  if (ingestPf.uitkomst === "geweigerd") {
    // Quotum op of kill switch om: parkeren, niet mislukken. Een geweigerde
    // ingest is een beleidsuitkomst en mag de retries van deze job niet
    // opbranden — volgende maand of na heractivering kan hij gewoon door.
    return await markeerGeweigerd(svc, job, doc.id, `ai_begrenzing_${ingestPf.reden}`);
  }
  if (ingestPf.uitkomst === "onbereikbaar") {
    return await backoff(svc, job, "ai_preflight_onbereikbaar");
  }

  const poort = { supabase: svc, label: "ingest-worker" };

  // Extractie met OCR-fallback (async, hogere OCR-cap dan het oude sync-pad).
  let extractie;
  try {
    extractie = await extractTekstMetOcrFallback(buffer, bestandstype, {
      maxOcrPaginas: MAX_OCR_PAGINAS,
      poort,
      // OCR-pagina's zijn een EIGEN grootheid met een eigen fondsquotum. Elke
      // poging reserveert opnieuw: Mistral factureert een retry ook opnieuw.
      reserveerOcr: async (paginas, poging) => {
        const uitkomst = await preflightSysteem(svc, {
          actietype: "ocr",
          fondsId: job.fonds_id ?? null,
          provider: "mistral",
          model: "mistral-ocr-latest",
          ocrPaginas: paginas,
          idempotentie: systeemSleutel(job.id, "ocr", poging),
          vingerafdruk: vingerafdruk({ documentId: doc.id, paginas }),
        });
        return uitkomst.uitkomst === "nieuw";
      },
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
    // AI-BEGRENZING: OCR is overgeslagen omdat het paginaquotum op was, de
    // Mistral-schakelaar uit stond of het paginaaantal niet vast te stellen was.
    // Dat zijn geen extractiefouten maar beleids-/dataconditie-uitkomsten; het
    // document parkeert met een verklaarbare code in plaats van als "mislukt".
    if (extractie.ocrOvergeslagen) {
      return await markeerGeweigerd(svc, job, doc.id, `ocr_${extractie.ocrOvergeslagen}`);
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
    const samenvatting = await genereerSamenvatting(poort, extractie.tekst);
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
  await svc
    .from("documenten")
    .update({ verwerkingsstatus: "mislukt", geindexeerd: false })
    .eq("id", documentId);
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
      prefixFailClosed: true,
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
    .update({
      status: "bezig", retry_count: nieuweRetry, claim_count: 0,
      foutcode, lease_expires_at: leaseTijd(sec),
    })
    .eq("id", job.id);
  return "bezig";
}

async function backoffVerouderdeSignatures(
  svc: SupabaseClient,
  job: IngestJob
): Promise<Uitkomst> {
  const nieuweRetry = (job.retry_count ?? 0) + 1;
  if (nieuweRetry > MAX_VEROUDERDE_SIGNATURE_RETRIES) {
    await svc.from("document_processing_jobs").update({
      status: "mislukt", retry_count: nieuweRetry,
      foutcode: "signatures_verouderd", eind: nu(),
    }).eq("id", job.id);
    await svc.from("documenten").update({ verwerkingsstatus: "mislukt" })
      .eq("id", job.document_id);
    return "mislukt";
  }
  await svc.from("document_processing_jobs").update({
    status: "bezig", retry_count: nieuweRetry, claim_count: 0,
    foutcode: "signatures_verouderd",
    lease_expires_at: leaseTijd(VEROUDERDE_SIGNATURE_BACKOFF_SEC),
  }).eq("id", job.id);
  return "bezig";
}

// Yield bij tijdbudget-afbreking: zet de job terug op 'wachtend' met vrije lease,
// zodat een volgende invocatie hem meteen kan herclaimen (geen lease-wachttijd).
async function yieldJob(svc: SupabaseClient, job: IngestJob): Promise<Uitkomst> {
  await svc
    .from("document_processing_jobs")
    .update({ status: "wachtend", lease_expires_at: null, claim_count: 0 })
    .eq("id", job.id);
  return "bezig";
}
