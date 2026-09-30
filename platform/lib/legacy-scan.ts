// ============================================================================
//  platform/lib/legacy-scan.ts — WP3: legacy-originelen gecontroleerd scannen.
// ----------------------------------------------------------------------------
//  Twee delen, bewust zonder "server-only" zodat ze onder node:test/tsx met een
//  nep-client toetsbaar zijn (tests/cross-tenant/wp3-legacy-scan.test.ts):
//
//  1. SELECTIE (puur). Welke bestaande originelen in de leesbucket de reaper
//     automatisch naar een scan-job stuurt, en hoeveel per sweep.
//       • "zonder_hash_of_scan"   — de bestaande legacyregel (hash of
//         scanresultaat ontbreekt). Ongewijzigd in reikwijdte.
//       • "uitgesteld_scanbewijs" — geldig SHA-256 `bestand_hash`, maar een
//         scanresultaat zonder verdict (de P1-vorm `{scan:'uitgesteld_wp3'}`)
//         of met een technisch verdict van een eerdere legacypoging. Dit zijn de
//         14 generieke documenten die onder WP3 stil uit retrieval vielen.
//     Nooit: inactief, zonder opslag_pad, een negatieve verwerkingsstatus, een
//     schoon hashgebonden bewijs, een negatief verdict (infected/
//     policy_blocked), een clean-verdict met afwijkende hash (bewijsconflict),
//     een onbekend verdict, een eerder hash-/promotieconflict in de jobhistorie,
//     een open job, of een technische mislukking binnen de afkoeltermijn.
//     Begrenzing: LEGACY_SCAN_BATCH (standaard 1, max 2) LOPENDE legacy-scans
//     tegelijk, deterministisch op document-id. Los van REAPER_LIMIET.
//
//  2. WORKER-KERN. scanLegacyOrigineel: valideer → hashcheck → scan → pas bij
//     `clean` + gelijke SHA-256 + zelfde scannerdeployment het scanbewijs
//     vastleggen. Bestaande chunks worden NIET vooraf gewist:
//       • technische scanfout → chunks blijven (herstel), document blijft dicht
//         omdat een schoon hashgebonden bewijs ontbreekt; de documentstatus
//         wordt niet op 'mislukt' gezet zodat de afkoelregel later herprobeert;
//       • infected/policy_blocked → gequarantineerd + chunks verwijderd
//         (inhoud aantoonbaar onveilig);
//       • hash-/typeconflict → gequarantineerd/geweigerd, chunks geblokkeerd
//         bewaard voor handmatige analyse (conflict ≠ bewezen schadelijk);
//       • clean → scanbewijs + 'gescand'; de normale extractie vervangt de
//         chunks daarna (delete-then-insert in extracteerEnChunk).
//     Veiligheidsbewijs dat bewaarde chunks zonder scanbewijs nergens gelezen
//     worden: MALWARESCAN-WP3-ONTWERP.md §"Bestaande originelen".
// ============================================================================

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { heeftSchoonScanbewijs } from "@/core/lib/document-scan-poort";
import {
  signatureOordeel,
  type MalwareScanResult,
  type ScannerHealth,
} from "@/core/lib/malware-scan-beleid";
import type { ValidatieResultaat } from "@/core/lib/bestand-validatie";

// ── Selectie ────────────────────────────────────────────────────────────────

export const LEGACY_SCAN_BATCH_STANDAARD = 1;
export const LEGACY_SCAN_BATCH_MAX = 2;
/** Technisch mislukte legacy-scan: pas na deze termijn opnieuw automatisch. */
export const LEGACY_SCAN_AFKOELING_MS = 24 * 3_600_000;
/** Documentvenster per sweep (goedkope metadata-select, geen chunks). */
export const LEGACY_SCAN_VENSTER = 200;
/** Kandidaten per sweep waarvan de jobhistorie wordt gelezen (id-lijst in de URL). */
export const LEGACY_SCAN_JOBVENSTER = 50;

export const NEGATIEVE_VERWERKINGSSTATUSSEN = ["geweigerd", "gequarantineerd", "mislukt"] as const;
export const TECHNISCHE_SCAN_VERDICTS = ["scanner_unreachable", "error", "stale_definitions"] as const;
export const NEGATIEVE_SCAN_VERDICTS = ["infected", "policy_blocked"] as const;
/** Foutcodes die een document definitief uit de automatische selectie halen. */
export const DEFINITIEVE_CONFLICT_FOUTCODES = [
  "infected",
  "policy_blocked",
  "hash_mismatch",
  "legacy_hash_mismatch",
  "legacy_bestandshash_mismatch",
  "promotie_conflict",
  "legacy_scan_db_update",
] as const;

/**
 * PostgREST-voorfilter voor de reaper. Ruimer dan het predicaat (statussen en
 * jobhistorie worden in JS getoetst), nooit strenger: elk document dat
 * `legacyScanCategorie` accepteert voldoet hieraan.
 */
export const LEGACY_SCAN_VOORFILTER =
  "bestand_hash.is.null,scan_resultaat.is.null,scan_resultaat->>verdict.is.null," +
  `scan_resultaat->>verdict.in.(${TECHNISCHE_SCAN_VERDICTS.join(",")})`;

const SHA256 = /^[a-f0-9]{64}$/;

export interface LegacyScanDocument {
  id: string;
  fonds_id: string | null;
  actief: boolean;
  verwerkingsstatus: string | null;
  opslag_pad: string | null;
  quarantaine_pad: string | null;
  bestand_hash: string | null;
  scan_resultaat: Record<string, unknown> | null;
}

export type LegacyScanCategorie = "zonder_hash_of_scan" | "uitgesteld_scanbewijs";

function verdictVan(scan: Record<string, unknown> | null): string | null {
  const v = scan?.verdict;
  return typeof v === "string" ? v : null;
}

/** Puur selectiepredicaat op documentniveau (zonder jobhistorie). */
export function legacyScanCategorie(doc: LegacyScanDocument): LegacyScanCategorie | null {
  if (!doc.actief || !doc.opslag_pad) return null;
  if ((NEGATIEVE_VERWERKINGSSTATUSSEN as readonly string[]).includes(doc.verwerkingsstatus ?? "")) {
    return null;
  }
  if (heeftSchoonScanbewijs(doc)) return null;
  const verdict = verdictVan(doc.scan_resultaat);
  if (verdict && (NEGATIEVE_SCAN_VERDICTS as readonly string[]).includes(verdict)) return null;

  // Bestaande legacyregel: hash of scanresultaat ontbreekt.
  if (!doc.bestand_hash || !doc.scan_resultaat) return "zonder_hash_of_scan";

  // Uitgesteld scanbewijs: alleen met een geldige hash en zonder verdict of
  // met een technisch verdict. Clean-met-afwijkende-hash en onbekende
  // verdicts zijn bewijsconflicten en vragen een expliciete beheeractie.
  if (!SHA256.test(doc.bestand_hash)) return null;
  if (verdict === null) return "uitgesteld_scanbewijs";
  if ((TECHNISCHE_SCAN_VERDICTS as readonly string[]).includes(verdict)) {
    return "uitgesteld_scanbewijs";
  }
  return null;
}

/** LEGACY_SCAN_BATCH: standaard 1, 0 = pauze, maximaal 2; ongeldig → 1. */
export function leesLegacyScanBatch(waarde: string | undefined | null): number {
  if (waarde === undefined || waarde === null || waarde.trim() === "") {
    return LEGACY_SCAN_BATCH_STANDAARD;
  }
  if (!/^\d+$/.test(waarde.trim())) return LEGACY_SCAN_BATCH_STANDAARD;
  return Math.min(Number.parseInt(waarde.trim(), 10), LEGACY_SCAN_BATCH_MAX);
}

export interface LegacyJobRij {
  document_id: string;
  stap: string;
  status: string;
  foutcode: string | null;
  eind: string | null;
}

export type LegacyUitsluitreden =
  | "geen_kandidaat"
  | "al_gepland"
  | "open_job"
  | "eerder_conflict"
  | "afkoeling"
  | "batch_vol";

export interface LegacyBatchKeuze<D extends LegacyScanDocument> {
  gekozen: D[];
  uitgesloten: Array<{ id: string; reden: LegacyUitsluitreden }>;
}

/**
 * Kiest deterministisch (oplopend document-id) de legacy-scanjobs voor deze
 * sweep. `lopend` = al openstaande legacy-scans; die tellen mee in de batch,
 * zodat er nooit meer dan `batch` tegelijk lopen, ook niet over sweeps heen.
 */
export function kiesLegacyScanBatch<D extends LegacyScanDocument>(p: {
  documenten: readonly D[];
  jobs: readonly LegacyJobRij[];
  lopend: number;
  batch: number;
  nuMs: number;
  alGepland?: ReadonlySet<string>;
}): LegacyBatchKeuze<D> {
  const uitgesloten: LegacyBatchKeuze<D>["uitgesloten"] = [];
  const perDoc = new Map<string, LegacyJobRij[]>();
  for (const j of p.jobs) {
    const lijst = perDoc.get(j.document_id) ?? [];
    lijst.push(j);
    perDoc.set(j.document_id, lijst);
  }
  const gesorteerd = [...p.documenten].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let ruimte = Math.max(0, p.batch - Math.max(0, p.lopend));
  const gekozen: D[] = [];
  for (const d of gesorteerd) {
    if (!legacyScanCategorie(d)) {
      uitgesloten.push({ id: d.id, reden: "geen_kandidaat" });
      continue;
    }
    if (p.alGepland?.has(d.id)) {
      uitgesloten.push({ id: d.id, reden: "al_gepland" });
      continue;
    }
    const jobs = perDoc.get(d.id) ?? [];
    if (jobs.some((j) => j.status === "wachtend" || j.status === "bezig")) {
      uitgesloten.push({ id: d.id, reden: "open_job" });
      continue;
    }
    if (jobs.some((j) => (DEFINITIEVE_CONFLICT_FOUTCODES as readonly string[]).includes(j.foutcode ?? ""))) {
      uitgesloten.push({ id: d.id, reden: "eerder_conflict" });
      continue;
    }
    const recentMislukt = jobs.some((j) => {
      if (j.stap !== "scan" || j.status !== "mislukt" || !j.eind) return false;
      const eind = Date.parse(j.eind);
      return Number.isFinite(eind) && p.nuMs - eind < LEGACY_SCAN_AFKOELING_MS;
    });
    if (recentMislukt) {
      uitgesloten.push({ id: d.id, reden: "afkoeling" });
      continue;
    }
    if (ruimte <= 0) {
      uitgesloten.push({ id: d.id, reden: "batch_vol" });
      continue;
    }
    gekozen.push(d);
    ruimte -= 1;
  }
  return { gekozen, uitgesloten };
}

// ── Worker-kern ─────────────────────────────────────────────────────────────

export type LegacyUitkomst = "afgerond" | "bezig" | "overgeslagen" | "mislukt";

export interface LegacyScanJob {
  id: string;
  document_id: string;
  retry_count: number | null;
}

export interface LegacyScanDocRij {
  id: string;
  opslag_pad: string | null;
  bestandsnaam: string | null;
  bestandstype: string | null;
  bestand_hash: string | null;
}

export interface LegacyScanDeps {
  oidcToken: string | null;
  leesScannerHealth(oidcToken: string): Promise<ScannerHealth | null>;
  scanSignedUrl(p: { signedUrl: string; oidcToken: string }): Promise<MalwareScanResult>;
  valideerUpload(p: { naam: string; mimeType: string; buffer: Buffer }): Promise<ValidatieResultaat>;
  contentTypeVoor(bestandstype: string): string;
  /** Bestaande terminale transities van de orchestrator (zelfde semantiek). */
  markeerGeweigerd(foutcode: string): Promise<LegacyUitkomst>;
  securityConflict(foutcode: string): Promise<LegacyUitkomst>;
  markeerMislukt(foutcode: string): Promise<LegacyUitkomst>;
  yieldJob(): Promise<LegacyUitkomst>;
  nuMs?: () => number;
}

export const LEGACY_MAX_RETRIES = 3;
export const LEGACY_BACKOFF_SEC = [30, 120, 480];
export const LEGACY_MAX_SIGNATURE_RETRIES = 12;
export const LEGACY_SIGNATURE_BACKOFF_SEC = 15 * 60;

export function gelijkeSha256(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || !SHA256.test(a) || !SHA256.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

const nuIso = (deps: LegacyScanDeps) => new Date(deps.nuMs ? deps.nuMs() : Date.now()).toISOString();

/**
 * Technische fout in het legacypad. Zelfde oplopende backoff als het gewone
 * pad, maar bij uitputting blijft het document ongemoeid: geen 'mislukt'
 * (dat zou het definitief uit de selectie halen) en geen chunkmutatie. Het
 * document blijft dicht omdat er geen schoon hashgebonden scanbewijs is; de
 * afkoelregel in kiesLegacyScanBatch probeert het later opnieuw.
 */
async function legacyBackoff(
  svc: SupabaseClient,
  job: LegacyScanJob,
  deps: LegacyScanDeps,
  foutcode: string,
  soort: "normaal" | "signatures" = "normaal"
): Promise<LegacyUitkomst> {
  const nieuweRetry = (job.retry_count ?? 0) + 1;
  const max = soort === "signatures" ? LEGACY_MAX_SIGNATURE_RETRIES : LEGACY_MAX_RETRIES;
  if (nieuweRetry > max) {
    await svc.from("document_processing_jobs").update({
      status: "mislukt", retry_count: nieuweRetry, foutcode, eind: nuIso(deps),
    }).eq("id", job.id);
    return "mislukt";
  }
  const sec = soort === "signatures"
    ? LEGACY_SIGNATURE_BACKOFF_SEC
    : LEGACY_BACKOFF_SEC[Math.min(nieuweRetry - 1, LEGACY_BACKOFF_SEC.length - 1)];
  const nu = deps.nuMs ? deps.nuMs() : Date.now();
  await svc.from("document_processing_jobs").update({
    status: "bezig", retry_count: nieuweRetry, claim_count: 0, foutcode,
    lease_expires_at: new Date(nu + sec * 1000).toISOString(),
  }).eq("id", job.id);
  return "bezig";
}

/**
 * Legacy-origineel in de leesbucket → validatie → scan → scanbewijs. Wist
 * bestaande chunks uitsluitend na een definitief schadelijk verdict; bij
 * `clean` vervangt de normale extractie ze in een volgende invocatie.
 */
export async function scanLegacyOrigineel(
  svc: SupabaseClient,
  job: LegacyScanJob,
  doc: LegacyScanDocRij,
  deps: LegacyScanDeps
): Promise<LegacyUitkomst> {
  if (!doc.opslag_pad) return await deps.markeerMislukt("geen_origineel");
  const opslagPad = doc.opslag_pad;

  // 1. Origineel ophalen en opnieuw valideren (magic bytes, type, grootte).
  const naam = doc.bestandsnaam ?? opslagPad.split("/").pop() ?? "document";
  const { data: blob, error: dlErr } = await svc.storage.from("documenten").download(opslagPad);
  if (dlErr || !blob) return await legacyBackoff(svc, job, deps, "legacy_storage_download");
  const buffer = Buffer.from(await blob.arrayBuffer());
  const validatie = await deps.valideerUpload({
    naam,
    mimeType: doc.bestandstype ? deps.contentTypeVoor(doc.bestandstype) : "",
    buffer,
  });
  // Definitief, maar geen bewezen schadelijke inhoud: geweigerd, chunks
  // geblokkeerd bewaard (geen scanbewijs ⇒ elke leesweg weigert ze).
  if (!validatie.ok) return await deps.markeerGeweigerd(`legacy_${validatie.foutcode}`);
  if (doc.bestandstype && validatie.bestandstype !== doc.bestandstype) {
    return await deps.markeerGeweigerd("legacy_extensie_inhoud_mismatch");
  }

  // 2. Hashbinding met het vastgelegde bestand_hash (alleen als dat er is;
  //    de bestaande legacyregel zonder hash legt hem pas bij clean vast).
  if (doc.bestand_hash && SHA256.test(doc.bestand_hash) && !gelijkeSha256(validatie.hash, doc.bestand_hash)) {
    return await deps.securityConflict("legacy_bestandshash_mismatch");
  }

  // 3. Scanner gezond en actueel?
  if (!deps.oidcToken) return await legacyBackoff(svc, job, deps, "scanner_oidc_ontbreekt");
  const health = await deps.leesScannerHealth(deps.oidcToken);
  if (!health) return await legacyBackoff(svc, job, deps, "scanner_onbereikbaar");
  const nu = deps.nuMs ? deps.nuMs() : Date.now();
  if (signatureOordeel(health, nu) === "verouderd") {
    return await legacyBackoff(svc, job, deps, "signatures_verouderd", "signatures");
  }

  // 4. Scan via een kortlevende signed URL op de bestaande bucket.
  const { data: signed, error: signErr } = await svc.storage
    .from("documenten")
    .createSignedUrl(opslagPad, 90);
  if (signErr || !signed?.signedUrl) return await legacyBackoff(svc, job, deps, "signed_url_mislukt");
  const scan = await deps.scanSignedUrl({ signedUrl: signed.signedUrl, oidcToken: deps.oidcToken });

  // 5a. Technisch: verdict vastleggen (herleidbaar), chunks ongemoeid.
  //     Nooit signed URL of bestandsnaam bewaren; alleen het scannercontract.
  if (scan.verdict === "scanner_unreachable" || scan.verdict === "error") {
    await svc.from("documenten").update({ scan_resultaat: scan }).eq("id", doc.id).eq("opslag_pad", opslagPad);
    return await legacyBackoff(svc, job, deps, scan.code ?? "scanner_onbereikbaar");
  }
  if (scan.verdict === "stale_definitions") {
    await svc.from("documenten").update({ scan_resultaat: scan }).eq("id", doc.id).eq("opslag_pad", opslagPad);
    return await legacyBackoff(svc, job, deps, "signatures_verouderd", "signatures");
  }

  // 5b. Definitief schadelijk: fail-closed en de afgeleide inhoud weg.
  if (scan.verdict === "infected" || scan.verdict === "policy_blocked") {
    await svc.from("documenten").update({
      scan_resultaat: scan,
      bestand_hash: doc.bestand_hash ?? validatie.hash,
      geindexeerd: false,
      verwerkingsstatus: "gequarantineerd",
    }).eq("id", doc.id).eq("opslag_pad", opslagPad);
    await svc.from("document_processing_jobs").update({
      status: "mislukt", eind: nuIso(deps), foutcode: scan.verdict,
    }).eq("id", job.id);
    const { error: delErr } = await svc.from("document_chunks").delete().eq("document_id", doc.id);
    if (delErr) {
      // Blijft dicht (gequarantineerd, geen scanbewijs); de chunktelling in de
      // releasecheck maakt een achtergebleven rest zichtbaar.
      console.error(`[ingest-worker] legacy-chunks na ${scan.verdict} niet verwijderd (doc ${doc.id})`);
    }
    return "mislukt";
  }
  if (scan.verdict !== "clean") return await legacyBackoff(svc, job, deps, "scanner_verdict_onbekend");

  // 5c. Clean, maar niet over deze bytes of niet door dezelfde deployment.
  if (!gelijkeSha256(scan.sha256, validatie.hash)) {
    await svc.from("documenten").update({ scan_resultaat: scan }).eq("id", doc.id).eq("opslag_pad", opslagPad);
    return await deps.securityConflict("legacy_hash_mismatch");
  }
  if (scan.deploymentId !== health.deploymentId) {
    // Bewust NIET vastleggen: een clean-resultaat met gelijke hash zou anders
    // al als scanbewijs tellen terwijl de deploymentbinding faalt.
    return await legacyBackoff(svc, job, deps, "scanner_deployment_gewijzigd");
  }

  // 6. Schoon: scanbewijs + herindexeringsstatus in één conditionele update.
  let update = svc.from("documenten").update({
    scan_resultaat: scan,
    bestand_hash: validatie.hash,
    bestandstype: validatie.bestandstype,
    mime_gedetecteerd: validatie.mimeGedetecteerd,
    geindexeerd: false,
    verwerkingsstatus: "gescand",
  }).eq("id", doc.id).eq("opslag_pad", opslagPad);
  if (doc.bestand_hash) update = update.eq("bestand_hash", doc.bestand_hash);
  const { data: geraakt, error: updateErr } = await update.select("id");
  if (updateErr || !geraakt?.length) return await deps.securityConflict("legacy_scan_db_update");

  // Herindexering (extractie → chunkvervanging → embedding) in een volgende
  // invocatie via het gewone pad. Tot dan blijven de bestaande chunks staan;
  // hun bron is nu aantoonbaar schoon.
  return await deps.yieldJob();
}
