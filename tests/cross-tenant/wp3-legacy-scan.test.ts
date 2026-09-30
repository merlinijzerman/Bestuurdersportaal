// ============================================================================
//  WP3 — legacy-documenten met uitgesteld scanbewijs (Refs #500).
// ----------------------------------------------------------------------------
//  S*  selectiepredicaat (positief/negatief) + voorfilterpariteit
//  B*  batchgrootte, deterministische volgorde, dedupe, afkoeling
//  W*  worker-kern met een in-memory Supabase: scan vóór wissen
//  N*  negatieve controle: de oude volgorde (wissen vóór scan) is rood
//  P*  Pensioenwet-fixture: centrale chunkbouw (artikel 150d) + versiebewijs
//  L*  leespoorten: fondsdiscipline + scanbewijs op de chunkpaden
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  kiesLegacyScanBatch,
  leesLegacyScanBatch,
  legacyScanCategorie,
  scanLegacyOrigineel,
  LEGACY_SCAN_AFKOELING_MS,
  LEGACY_SCAN_VOORFILTER,
  type LegacyScanDeps,
  type LegacyScanDocument,
  type LegacyJobRij,
} from "../../platform/lib/legacy-scan";
import { handhaafScanbewijs, heeftSchoonScanbewijs } from "../../core/lib/document-scan-poort";
import { bouwChunkRecordsZonderVerrijking } from "../../core/lib/chunk-bouw";
import { bewijsUitVersierij } from "../../core/lib/retrieval/supabase-versie";
import type { MalwareScanResult, ScannerHealth } from "../../core/lib/malware-scan-beleid";

const PENSIOENWET = "a62e757b-9102-4ba3-ba6b-b33b21705fbd";
const BYTES = Buffer.from("%PDF-1.7\n% Pensioenwet (synthetische fixture)\n");
const HASH = createHash("sha256").update(BYTES).digest("hex");
const ANDERE_HASH = "b".repeat(64);
const NU = Date.parse("2026-09-30T12:00:00Z");

function doc(p: Partial<LegacyScanDocument> = {}): LegacyScanDocument {
  return {
    id: PENSIOENWET,
    fonds_id: null,
    actief: true,
    verwerkingsstatus: "beschikbaar",
    opslag_pad: `generiek/${PENSIOENWET}.pdf`,
    quarantaine_pad: null,
    bestand_hash: HASH,
    scan_resultaat: { scan: "uitgesteld_wp3" },
    ...p,
  };
}

// ── S: selectiepredicaat ─────────────────────────────────────────────────────
test("S1 — uitgesteld_wp3 + geldige hash + opslag_pad + actief ⇒ kandidaat", () => {
  assert.equal(legacyScanCategorie(doc()), "uitgesteld_scanbewijs");
  // Een technisch verdict van een eerdere legacypoging blijft kandidaat.
  for (const verdict of ["scanner_unreachable", "error", "stale_definitions"]) {
    assert.equal(legacyScanCategorie(doc({ scan_resultaat: { verdict, sha256: HASH } })), "uitgesteld_scanbewijs", verdict);
  }
});

test("S2 — bestaande legacyregel (hash of scan ontbreekt) blijft ongewijzigd", () => {
  assert.equal(legacyScanCategorie(doc({ bestand_hash: null })), "zonder_hash_of_scan");
  assert.equal(legacyScanCategorie(doc({ scan_resultaat: null })), "zonder_hash_of_scan");
  assert.equal(legacyScanCategorie(doc({ bestand_hash: null, scan_resultaat: null, verwerkingsstatus: null })), "zonder_hash_of_scan");
  assert.equal(legacyScanCategorie(doc({ bestand_hash: "niet-hex", scan_resultaat: null })), "zonder_hash_of_scan");
});

test("S3 — negatieve gevallen vallen buiten de selectie", () => {
  const negatief: Array<[string, Partial<LegacyScanDocument>]> = [
    ["clean hashgebonden", { scan_resultaat: { verdict: "clean", sha256: HASH } }],
    ["clean met afwijkende hash (bewijsconflict)", { scan_resultaat: { verdict: "clean", sha256: ANDERE_HASH } }],
    ["infected", { scan_resultaat: { verdict: "infected", sha256: HASH } }],
    ["policy_blocked", { scan_resultaat: { verdict: "policy_blocked", sha256: HASH } }],
    ["infected zonder hash", { bestand_hash: null, scan_resultaat: { verdict: "infected" } }],
    ["onbekend verdict", { scan_resultaat: { verdict: "iets_nieuws" } }],
    ["geweigerd", { verwerkingsstatus: "geweigerd" }],
    ["gequarantineerd", { verwerkingsstatus: "gequarantineerd" }],
    ["mislukt", { verwerkingsstatus: "mislukt" }],
    ["inactief", { actief: false }],
    ["geen opslag_pad", { opslag_pad: null }],
    ["leeg opslag_pad", { opslag_pad: "" }],
    ["ongeldige hash", { bestand_hash: "ABC" + "a".repeat(61) }],
    ["hash te kort", { bestand_hash: "a".repeat(63) }],
  ];
  for (const [naam, p] of negatief) assert.equal(legacyScanCategorie(doc(p)), null, naam);
});

// De reaper vraagt PostgREST met LEGACY_SCAN_VOORFILTER; het predicaat mag
// nooit iets accepteren dat dat voorfilter wegfiltert (anders valt het stil af).
function voldoetAanVoorfilter(d: LegacyScanDocument): boolean {
  const verdict = typeof d.scan_resultaat?.verdict === "string" ? d.scan_resultaat.verdict : null;
  return LEGACY_SCAN_VOORFILTER.split(/,(?![^(]*\))/).some((term) => {
    if (term === "bestand_hash.is.null") return d.bestand_hash === null;
    if (term === "scan_resultaat.is.null") return d.scan_resultaat === null;
    if (term === "scan_resultaat->>verdict.is.null") return verdict === null;
    const m = /^scan_resultaat->>verdict\.in\.\((.*)\)$/.exec(term);
    if (m) return verdict !== null && m[1].split(",").includes(verdict);
    throw new Error(`onbekende voorfilterterm ${term}`);
  });
}

test("S4 — het PostgREST-voorfilter is nooit strenger dan het predicaat", () => {
  const varianten: LegacyScanDocument[] = [];
  for (const hash of [HASH, null, "niet-hex"]) {
    for (const scan of [null, { scan: "uitgesteld_wp3" }, { verdict: "clean", sha256: HASH },
      { verdict: "clean", sha256: ANDERE_HASH }, { verdict: "infected" }, { verdict: "error" },
      { verdict: "scanner_unreachable" }, { verdict: "stale_definitions" }, { verdict: "raar" }]) {
      varianten.push(doc({ bestand_hash: hash, scan_resultaat: scan as Record<string, unknown> | null }));
    }
  }
  let geaccepteerd = 0;
  for (const d of varianten) {
    if (legacyScanCategorie(d)) {
      geaccepteerd += 1;
      assert.ok(voldoetAanVoorfilter(d), JSON.stringify(d));
    }
  }
  assert.ok(geaccepteerd >= 10);
  // En het voorfilter laat de schone en negatieve documenten al in de DB weg.
  assert.equal(voldoetAanVoorfilter(doc({ scan_resultaat: { verdict: "clean", sha256: HASH } })), false);
  assert.equal(voldoetAanVoorfilter(doc({ scan_resultaat: { verdict: "infected", sha256: HASH } })), false);
});

// ── B: batch, volgorde, dedupe, afkoeling ────────────────────────────────────
test("B1 — LEGACY_SCAN_BATCH: standaard 1, 0 = pauze, maximaal 2, ongeldig ⇒ 1", () => {
  assert.equal(leesLegacyScanBatch(undefined), 1);
  assert.equal(leesLegacyScanBatch(""), 1);
  assert.equal(leesLegacyScanBatch("0"), 0);
  assert.equal(leesLegacyScanBatch("1"), 1);
  assert.equal(leesLegacyScanBatch("2"), 2);
  assert.equal(leesLegacyScanBatch("50"), 2);
  assert.equal(leesLegacyScanBatch("-1"), 1);
  assert.equal(leesLegacyScanBatch("twee"), 1);
  assert.equal(leesLegacyScanBatch("1.5"), 1);
});

const veertien = [
  "2745d314", "2dad013e", "2eae7da4", "35152d52", "35e24850", "59ddc312", "65afa089",
  "97c57653", "a62e757b", "c1462151", "c60fed60", "c78b86f6", "c9d61347", "f80fb6f3",
].map((p) => doc({ id: `${p}-0000-4000-8000-000000000000` }));

test("B2 — deterministische volgorde op id; batch begrenst, ongeacht invoervolgorde", () => {
  const geschud = [...veertien].reverse();
  const a = kiesLegacyScanBatch({ documenten: veertien, jobs: [], lopend: 0, batch: 1, nuMs: NU });
  const b = kiesLegacyScanBatch({ documenten: geschud, jobs: [], lopend: 0, batch: 1, nuMs: NU });
  assert.deepEqual(a.gekozen.map((d) => d.id), ["2745d314-0000-4000-8000-000000000000"]);
  assert.deepEqual(b.gekozen.map((d) => d.id), a.gekozen.map((d) => d.id));
  const twee = kiesLegacyScanBatch({ documenten: geschud, jobs: [], lopend: 0, batch: 2, nuMs: NU });
  assert.deepEqual(twee.gekozen.map((d) => d.id.slice(0, 8)), ["2745d314", "2dad013e"]);
  assert.equal(twee.uitgesloten.filter((u) => u.reden === "batch_vol").length, 12);
});

test("B3 — lopende legacy-scans tellen mee: nooit meer dan de batch tegelijk", () => {
  assert.equal(kiesLegacyScanBatch({ documenten: veertien, jobs: [], lopend: 1, batch: 1, nuMs: NU }).gekozen.length, 0);
  assert.equal(kiesLegacyScanBatch({ documenten: veertien, jobs: [], lopend: 1, batch: 2, nuMs: NU }).gekozen.length, 1);
  assert.equal(kiesLegacyScanBatch({ documenten: veertien, jobs: [], lopend: 0, batch: 0, nuMs: NU }).gekozen.length, 0);
});

test("B4 — open job, eerder conflict, afkoeling en al geplande documenten worden overgeslagen", () => {
  const [d1, d2, d3, d4, d5] = veertien;
  const jobs: LegacyJobRij[] = [
    { document_id: d1.id, stap: "scan", status: "wachtend", foutcode: null, eind: null },
    { document_id: d2.id, stap: "scan", status: "mislukt", foutcode: "legacy_hash_mismatch", eind: "2026-01-01T00:00:00Z" },
    { document_id: d3.id, stap: "scan", status: "mislukt", foutcode: "scanner_onbereikbaar",
      eind: new Date(NU - LEGACY_SCAN_AFKOELING_MS + 60_000).toISOString() },
    // Oude P1-registratie: geen mislukking, telt niet.
    { document_id: d4.id, stap: "scan", status: "overgeslagen", foutcode: "scan_uitgesteld_wp3", eind: "2026-08-12T05:28:07Z" },
  ];
  const keuze = kiesLegacyScanBatch({
    documenten: [d1, d2, d3, d4, d5], jobs, lopend: 0, batch: 2, nuMs: NU, alGepland: new Set([d5.id]),
  });
  assert.deepEqual(keuze.gekozen.map((d) => d.id), [d4.id]);
  const reden = Object.fromEntries(keuze.uitgesloten.map((u) => [u.id, u.reden]));
  assert.equal(reden[d1.id], "open_job");
  assert.equal(reden[d2.id], "eerder_conflict");
  assert.equal(reden[d3.id], "afkoeling");
  assert.equal(reden[d5.id], "al_gepland");
  // Na de afkoeltermijn komt een technisch mislukt document terug.
  const later = kiesLegacyScanBatch({ documenten: [d3], jobs, lopend: 0, batch: 1, nuMs: NU + 120_000 });
  assert.deepEqual(later.gekozen.map((d) => d.id), [d3.id]);
});

// ── In-memory Supabase voor de worker-kern ───────────────────────────────────
type Rij = Record<string, unknown>;
interface Db { documenten: Rij[]; document_chunks: Rij[]; document_processing_jobs: Rij[] }

function maakSvc(db: Db, storage: Record<string, Buffer>, log: string[]) {
  function builder(tabel: keyof Db) {
    let soort: "select" | "update" | "delete" = "select";
    let patch: Rij = {};
    const filters: Array<(r: Rij) => boolean> = [];
    let metSelect = false;
    const b = {
      select() { metSelect = true; return b; },
      update(p: Rij) { soort = "update"; patch = p; return b; },
      delete() { soort = "delete"; return b; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
      then(res: (v: { data: unknown; error: null }) => unknown) {
        const geraakt = db[tabel].filter((r) => filters.every((f) => f(r)));
        if (soort === "update") {
          for (const r of geraakt) Object.assign(r, patch);
          log.push(`update ${tabel} ${Object.keys(patch).join(",")}`);
        } else if (soort === "delete") {
          db[tabel] = db[tabel].filter((r) => !geraakt.includes(r));
          log.push(`delete ${tabel} ${geraakt.length}`);
        }
        return Promise.resolve({ data: metSelect || soort === "select" ? geraakt.map((r) => ({ ...r })) : null, error: null }).then(res);
      },
    };
    return b;
  }
  return {
    from: (t: keyof Db) => builder(t),
    storage: {
      from: (bucket: string) => ({
        download: async (pad: string) => {
          log.push(`download ${bucket}`);
          const bytes = bucket === "documenten" ? storage[pad] : undefined;
          return bytes
            ? { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null }
            : { data: null, error: { message: "not found" } };
        },
        createSignedUrl: async (pad: string, sec: number) => {
          log.push(`signed ${bucket} ${sec}`);
          return { data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${pad}?token=x` }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
}

const HEALTH: ScannerHealth = {
  engine: "clamav", engineVersion: "1.4", signatureVersion: "27000",
  signaturePublishedAt: new Date(NU - 3_600_000).toISOString(),
  imageBuiltAt: new Date(NU - 3_600_000).toISOString(), deploymentId: "dpl_scanner_1",
  ready: true, eicarOk: true,
};
function scanResultaat(p: Partial<MalwareScanResult>): MalwareScanResult {
  return {
    verdict: "clean", engine: "clamav", engineVersion: "1.4", signatureVersion: "27000",
    signaturePublishedAt: HEALTH.signaturePublishedAt, imageBuiltAt: HEALTH.imageBuiltAt,
    deploymentId: "dpl_scanner_1", sha256: HASH, durationMs: 12, ...p,
  };
}

interface Scenario {
  db: Db;
  log: string[];
  aanroepen: string[];
  svc: SupabaseClient;
  deps: LegacyScanDeps;
  job: { id: string; document_id: string; retry_count: number | null };
}

function scenario(opts: {
  health?: ScannerHealth | null;
  scan?: MalwareScanResult;
  bytes?: Buffer;
  retry?: number;
  bestandHash?: string | null;
} = {}): Scenario {
  const db: Db = {
    documenten: [{
      id: PENSIOENWET, actief: true, bibliotheek: "generiek", verwerkingsstatus: "beschikbaar",
      geindexeerd: true, opslag_pad: `generiek/${PENSIOENWET}.pdf`, bestandsnaam: "pensioenwet.pdf",
      bestandstype: "pdf", bestand_hash: opts.bestandHash === undefined ? HASH : opts.bestandHash,
      scan_resultaat: { scan: "uitgesteld_wp3" },
    }],
    document_chunks: Array.from({ length: 968 }, (_, i) => ({
      id: `chunk-${i}`, document_id: PENSIOENWET, chunk_index: i, tekst: `oude passage ${i}`,
    })),
    document_processing_jobs: [{ id: "job-1", document_id: PENSIOENWET, stap: "scan", status: "bezig", retry_count: opts.retry ?? 0 }],
  };
  const log: string[] = [];
  const aanroepen: string[] = [];
  const svc = maakSvc(db, { [`generiek/${PENSIOENWET}.pdf`]: opts.bytes ?? BYTES }, log);
  const job = { id: "job-1", document_id: PENSIOENWET, retry_count: opts.retry ?? 0 };
  const zetJob = (p: Rij) => Object.assign(db.document_processing_jobs[0], p);
  const zetDoc = (p: Rij) => Object.assign(db.documenten[0], p);
  const deps: LegacyScanDeps = {
    oidcToken: "oidc",
    leesScannerHealth: async () => { aanroepen.push("health"); return opts.health === undefined ? HEALTH : opts.health; },
    scanSignedUrl: async () => { aanroepen.push("scan"); log.push("scan"); return opts.scan ?? scanResultaat({}); },
    valideerUpload: async ({ buffer }) => {
      aanroepen.push("valideer");
      if (!buffer.subarray(0, 4).equals(Buffer.from("%PDF"))) {
        return { ok: false, foutcode: "magic_bytes_mismatch", melding: "x" };
      }
      return { ok: true, bestandstype: "pdf", veiligeNaam: "pensioenwet.pdf",
        hash: createHash("sha256").update(buffer).digest("hex"), mimeGedetecteerd: "application/pdf", grootte: buffer.length };
    },
    contentTypeVoor: () => "application/pdf",
    // Zelfde transities als de orchestrator (ingest-orchestrator.ts).
    markeerGeweigerd: async (foutcode) => { zetJob({ status: "geslaagd", foutcode }); zetDoc({ verwerkingsstatus: "geweigerd", geindexeerd: false }); return "overgeslagen"; },
    securityConflict: async (foutcode) => { zetJob({ status: "mislukt", foutcode }); zetDoc({ verwerkingsstatus: "gequarantineerd", geindexeerd: false }); return "mislukt"; },
    markeerMislukt: async (foutcode) => { zetJob({ status: "mislukt", foutcode }); zetDoc({ verwerkingsstatus: "mislukt", geindexeerd: false }); return "mislukt"; },
    yieldJob: async () => { zetJob({ status: "wachtend", lease_expires_at: null, claim_count: 0 }); return "bezig"; },
    nuMs: () => NU,
  };
  return { db, log, aanroepen, svc, deps, job };
}

const draai = (s: Scenario) =>
  scanLegacyOrigineel(s.svc, s.job, s.db.documenten[0] as never, s.deps);

const docVan = (s: Scenario) => s.db.documenten[0] as { bestand_hash: string | null; scan_resultaat: Record<string, unknown> | null; verwerkingsstatus: string; geindexeerd: boolean };

// Controles als functies, zodat de negatieve controle (N1) dezelfde toets gebruikt.
function schendingenTechnischeFout(s: Scenario, uitkomst: string): string[] {
  const f: string[] = [];
  if (s.db.document_chunks.length !== 968) f.push(`chunks ${s.db.document_chunks.length} ≠ 968`);
  if (heeftSchoonScanbewijs(docVan(s))) f.push("document open zonder schone scan");
  if (docVan(s).verwerkingsstatus !== "beschikbaar") f.push(`status ${docVan(s).verwerkingsstatus}`);
  if (uitkomst !== "bezig") f.push(`uitkomst ${uitkomst}`);
  return f;
}
function schendingenClean(s: Scenario): string[] {
  const f: string[] = [];
  const scanPos = s.log.indexOf("scan");
  const deletePos = s.log.findIndex((r) => r.startsWith("delete document_chunks"));
  if (deletePos >= 0 && (scanPos < 0 || deletePos < scanPos)) f.push("chunks gewist vóór de scan");
  if (s.db.document_chunks.length !== 968) f.push(`chunks ${s.db.document_chunks.length} ≠ 968 vóór herindex`);
  return f;
}

// ── W: worker-kern ───────────────────────────────────────────────────────────
test("W1 — scanner onbereikbaar (health) ⇒ chunks behouden, document dicht, backoff", async () => {
  const s = scenario({ health: null });
  const uitkomst = await draai(s);
  assert.deepEqual(schendingenTechnischeFout(s, uitkomst), []);
  assert.equal(s.db.document_processing_jobs[0].foutcode, "scanner_onbereikbaar");
  assert.equal(s.db.document_processing_jobs[0].status, "bezig");
  assert.deepEqual(docVan(s).scan_resultaat, { scan: "uitgesteld_wp3" });
  assert.ok(!s.aanroepen.includes("scan"));
});

test("W2 — scannerverdict error/scanner_unreachable ⇒ verdict vastgelegd, chunks behouden", async () => {
  for (const verdict of ["scanner_unreachable", "error"] as const) {
    const s = scenario({ scan: scanResultaat({ verdict, code: "timeout" }) });
    const uitkomst = await draai(s);
    assert.deepEqual(schendingenTechnischeFout(s, uitkomst), [], verdict);
    assert.equal(docVan(s).scan_resultaat?.verdict, verdict);
    assert.equal(s.db.document_processing_jobs[0].foutcode, "timeout");
  }
});

test("W3 — retries uitgeput ⇒ job mislukt, document ongemoeid (geen 'mislukt'), chunks behouden", async () => {
  const s = scenario({ health: null, retry: 3 });
  const uitkomst = await draai(s);
  assert.equal(uitkomst, "mislukt");
  assert.equal(s.db.document_processing_jobs[0].status, "mislukt");
  assert.equal(s.db.document_processing_jobs[0].eind, new Date(NU).toISOString());
  assert.equal(docVan(s).verwerkingsstatus, "beschikbaar");
  assert.equal(s.db.document_chunks.length, 968);
  assert.equal(heeftSchoonScanbewijs(docVan(s)), false);
});

test("W4 — verouderde definities ⇒ signature-backoff, chunks behouden", async () => {
  const oud = { ...HEALTH, signaturePublishedAt: new Date(NU - 8 * 86_400_000).toISOString() };
  const s = scenario({ health: oud });
  assert.equal(await draai(s), "bezig");
  assert.equal(s.db.document_processing_jobs[0].foutcode, "signatures_verouderd");
  assert.equal(s.db.document_chunks.length, 968);
  const s2 = scenario({ scan: scanResultaat({ verdict: "stale_definitions" }) });
  assert.equal(await draai(s2), "bezig");
  assert.equal(s2.db.document_chunks.length, 968);
});

test("W5 — clean ⇒ scanbewijs hash-gebonden, chunks pas daarna (door de herindex) vervangen", async () => {
  const s = scenario();
  const uitkomst = await draai(s);
  assert.equal(uitkomst, "bezig"); // yield → extractie in een volgende invocatie
  assert.deepEqual(schendingenClean(s), []);
  const d = docVan(s);
  assert.equal(heeftSchoonScanbewijs(d), true);
  assert.equal(d.scan_resultaat?.sha256, HASH);
  assert.equal(d.bestand_hash, HASH);
  assert.equal(d.verwerkingsstatus, "gescand");
  assert.equal(d.geindexeerd, false);
  assert.equal(s.db.document_processing_jobs[0].status, "wachtend");
  // Volgorde: download → validatie → health → signed URL → scan → bewijs.
  assert.deepEqual(s.aanroepen, ["valideer", "health", "scan"]);
  assert.ok(s.log.indexOf("signed documenten 90") < s.log.indexOf("scan"));
});

test("W6 — infected/policy_blocked ⇒ gequarantineerd én afgeleide chunks verwijderd", async () => {
  for (const verdict of ["infected", "policy_blocked"] as const) {
    const s = scenario({ scan: scanResultaat({ verdict, detection: "Eicar-Test-Signature" }) });
    assert.equal(await draai(s), "mislukt");
    assert.equal(s.db.document_chunks.length, 0, verdict);
    assert.equal(docVan(s).verwerkingsstatus, "gequarantineerd");
    assert.equal(docVan(s).geindexeerd, false);
    assert.equal(docVan(s).scan_resultaat?.verdict, verdict);
    assert.equal(s.db.document_processing_jobs[0].foutcode, verdict);
    assert.equal(heeftSchoonScanbewijs(docVan(s)), false);
  }
});

test("W7 — clean over andere bytes (hash-mismatch) ⇒ gequarantineerd, chunks geblokkeerd bewaard", async () => {
  const s = scenario({ scan: scanResultaat({ sha256: ANDERE_HASH }) });
  assert.equal(await draai(s), "mislukt");
  assert.equal(s.db.document_processing_jobs[0].foutcode, "legacy_hash_mismatch");
  assert.equal(docVan(s).verwerkingsstatus, "gequarantineerd");
  assert.equal(heeftSchoonScanbewijs(docVan(s)), false);
  assert.equal(s.db.document_chunks.length, 968);
});

test("W8 — origineel wijkt af van het vastgelegde bestand_hash ⇒ conflict vóór de scan", async () => {
  const s = scenario({ bestandHash: ANDERE_HASH });
  assert.equal(await draai(s), "mislukt");
  assert.equal(s.db.document_processing_jobs[0].foutcode, "legacy_bestandshash_mismatch");
  assert.ok(!s.aanroepen.includes("scan"));
  assert.equal(docVan(s).verwerkingsstatus, "gequarantineerd");
  assert.equal(s.db.document_chunks.length, 968);
});

test("W9 — clean van een andere scannerdeployment ⇒ niet als bewijs vastgelegd, backoff", async () => {
  const s = scenario({ scan: scanResultaat({ deploymentId: "dpl_scanner_2" }) });
  assert.equal(await draai(s), "bezig");
  assert.equal(s.db.document_processing_jobs[0].foutcode, "scanner_deployment_gewijzigd");
  assert.deepEqual(docVan(s).scan_resultaat, { scan: "uitgesteld_wp3" });
  assert.equal(heeftSchoonScanbewijs(docVan(s)), false);
  assert.equal(s.db.document_chunks.length, 968);
});

test("W10 — ongeldige magic bytes ⇒ geweigerd zonder scan, chunks geblokkeerd bewaard", async () => {
  const s = scenario({ bytes: Buffer.from("MZ\x90\x00 geen pdf"), bestandHash: null });
  assert.equal(await draai(s), "overgeslagen");
  assert.equal(s.db.document_processing_jobs[0].foutcode, "legacy_magic_bytes_mismatch");
  assert.equal(docVan(s).verwerkingsstatus, "geweigerd");
  assert.ok(!s.aanroepen.includes("scan"));
  assert.equal(s.db.document_chunks.length, 968);
});

test("W11 — bestaande legacyregel zonder hash: clean legt de hash pas bij het bewijs vast", async () => {
  const s = scenario({ bestandHash: null });
  assert.equal(await draai(s), "bezig");
  assert.equal(docVan(s).bestand_hash, HASH);
  assert.equal(heeftSchoonScanbewijs(docVan(s)), true);
  assert.equal(s.db.document_chunks.length, 968);
});

// ── N: negatieve controle ────────────────────────────────────────────────────
test("N1 — de oude volgorde (chunks wissen vóór de scan) maakt W1 en W5 rood", async () => {
  const oudeVolgorde = async (s: Scenario) => {
    // Exact de oude stap: delete ná validatie, vóór health/scan.
    await (s.svc as unknown as { from(t: string): { delete(): { eq(k: string, v: string): PromiseLike<unknown> } } })
      .from("document_chunks").delete().eq("document_id", PENSIOENWET);
    return scanLegacyOrigineel(s.svc, s.job, s.db.documenten[0] as never, s.deps);
  };
  const tech = scenario({ health: null });
  assert.notDeepEqual(schendingenTechnischeFout(tech, await oudeVolgorde(tech)), []);
  const clean = scenario();
  await oudeVolgorde(clean);
  assert.notDeepEqual(schendingenClean(clean), []);
});

// ── P: Pensioenwet-fixture ──────────────────────────────────────────────────
function pensioenwetSegmenten() {
  const nummers: string[] = [];
  for (let i = 1; i <= 240; i++) {
    nummers.push(String(i));
    if (i === 150) nummers.push("150a", "150b", "150c", "150d", "150e");
  }
  const lid = (n: string, k: number) =>
    `${k}. De pensioenuitvoerder verstrekt de deelnemer op grond van artikel ${n} tijdig, duidelijk en ` +
    `begrijpelijk informatie over de aanspraken, de wijze van toeslagverlening en de risico's die ` +
    `daarmee samenhangen, waarbij de toezichthouder nadere regels kan stellen over vorm en inhoud.`;
  return nummers.map((n, i) => ({
    pagina: Math.floor(i / 3) + 1,
    paragraaf: null,
    tekst: `Artikel ${n}. Informatieverstrekking ${n}\n\n` +
      Array.from({ length: i % 3 === 0 ? 14 : 4 }, (_, k) => lid(n, k + 1)).join("\n\n"),
  }));
}

test("P1 — herindex via de centrale chunkbouw zet de artikelkoppen (o.a. 150d) opnieuw", () => {
  const records = bouwChunkRecordsZonderVerrijking({
    documentId: PENSIOENWET, segmenten: pensioenwetSegmenten(), documenttype: "wetgeving",
  });
  assert.ok(records.length >= 300, `slechts ${records.length} chunks`);
  const labels = new Set(records.map((r) => r.structuur_label));
  assert.ok(labels.has("Artikel 150d"));
  assert.ok(labels.has("Artikel 150") && labels.has("Artikel 150e"));
  assert.ok(records.every((r) => r.structuur_type === "artikel" && r.structuur_label));
  assert.ok(records.every((r) => r.indexering_versie === "r1-structuur-contextueel"));
  // Kale records: prefix + embedding volgen in de embeddingfase (finaliseer
  // rondt pas af bij nul chunks zonder embedding).
  assert.ok(records.every((r) => r.context_prefix === null && r.embedding === undefined));
  assert.deepEqual(records.map((r) => r.chunk_index), records.map((_, i) => i));
});

test("P2 — retrieval: zonder clean-bewijs onbekend (⇒ versiebewijs_ontbreekt), na clean + herindex hash", () => {
  const rij = (scan: Record<string, unknown> | null) => ({
    id: "chunk-150d", document_id: PENSIOENWET, indexering_versie: "r1-structuur-contextueel",
    documenten: { id: PENSIOENWET, fonds_id: null, bibliotheek: "generiek", bestand_hash: HASH,
      documentdatum: "2026-01-01", scan_resultaat: scan },
  });
  const voor = bewijsUitVersierij(rij({ scan: "uitgesteld_wp3" }), PENSIOENWET, "fonds-1", "t", true);
  assert.equal(voor.soort, "onbekend");
  const technisch = bewijsUitVersierij(rij({ verdict: "scanner_unreachable" }), PENSIOENWET, "fonds-1", "t", true);
  assert.equal(technisch.soort, "onbekend");
  const na = bewijsUitVersierij(rij({ verdict: "clean", sha256: HASH }), PENSIOENWET, "fonds-1", "t", true);
  assert.equal(na.soort, "hash");
  assert.match(String(na.waarde), /\S/);
});

// ── L: leespoort op chunkpaden ──────────────────────────────────────────────
test("L1 — handhaafScanbewijs laat onder WP3 alleen chunks met schoon bewijs door", () => {
  const chunks = [
    { id: "a", documenten: { bestand_hash: HASH, scan_resultaat: { verdict: "clean", sha256: HASH } } },
    { id: "b", documenten: { bestand_hash: HASH, scan_resultaat: { scan: "uitgesteld_wp3" } } },
    { id: "c", documenten: { bestand_hash: HASH } },
    { id: "d", documenten: { bestand_hash: HASH, scan_resultaat: { verdict: "clean", sha256: ANDERE_HASH } } },
  ];
  const aan = handhaafScanbewijs(chunks, true);
  assert.deepEqual(aan.chunks.map((c) => c.id), ["a"]);
  assert.equal(aan.gedropt, 3);
  const uit = handhaafScanbewijs(chunks, false);
  assert.equal(uit.chunks.length, 4);
  assert.equal(uit.gedropt, 0);
});

test("L2 — bevroren reflectieset: een chunk zonder scanbewijs lost niet op ⇒ hele set leeg", async () => {
  const { finaliseerBevrorenChunks } = await import("../../core/lib/rag");
  const chunk = {
    id: "11111111-1111-4111-8111-111111111111", document_id: PENSIOENWET, tekst: "Artikel 150d", pagina: 1,
    paragraaf: null, chunk_index: 0, indexering_versie: "r1-structuur-contextueel",
    documenten: { titel: "Pensioenwet", bron: "Extern", bibliotheek: "generiek", opslag_pad: "x",
      bestand_hash: HASH, scan_resultaat: { scan: "uitgesteld_wp3" } },
  };
  const toegestaan = handhaafScanbewijs([chunk], true).chunks;
  const uit = finaliseerBevrorenChunks(toegestaan, [chunk.id], 1);
  assert.equal(uit.status.volledig, false);
  assert.deepEqual(uit.chunks, []);
});

test("L3 — artikelspoor: een juridisch document zonder scanbewijs levert onder WP3 geen kandidaten", async () => {
  const { vulAanMetArtikelkandidaten } = await import("../../core/lib/rag");
  const vorige = process.env.WP3_MALWARESCAN_AAN;
  const draaiMet = async (scan: Record<string, unknown>) => {
    const tabellen: string[] = [];
    const client = {
      from(tabel: string) {
        tabellen.push(tabel);
        const b: Record<string, unknown> = {};
        for (const m of ["select", "in", "or", "order", "limit", "eq", "textSearch"]) b[m] = () => b;
        b.abortSignal = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve(
          tabel === "documenten"
            ? { data: [{ id: PENSIOENWET, bestand_hash: HASH, scan_resultaat: scan }], error: null }
            : { data: [], error: null }
        ).then(res);
        return b;
      },
    };
    const uit = await vulAanMetArtikelkandidaten([], {
      focus: { artikelen: ["150d"], wet: "pw" }, fondsId: "fonds-1", scope: null,
      filters: { modus: "actueel" }, maxKandidaten: 30, supabase: client,
    });
    return { uit, tabellen };
  };
  try {
    process.env.WP3_MALWARESCAN_AAN = "true";
    const dicht = await draaiMet({ scan: "uitgesteld_wp3" });
    assert.deepEqual(dicht.uit, []);
    assert.deepEqual(dicht.tabellen, ["documenten"], "zonder scanbewijs geen chunkopzoeking");
    const open = await draaiMet({ verdict: "clean", sha256: HASH });
    assert.deepEqual(open.tabellen, ["documenten", "document_chunks"]);
  } finally {
    if (vorige === undefined) delete process.env.WP3_MALWARESCAN_AAN;
    else process.env.WP3_MALWARESCAN_AAN = vorige;
  }
});

// Leespaden die createServerSupabase/server-only gebruiken en dus niet los te
// draaien zijn: het contract staat in de bron en wordt hier vastgepind.
test("L4 — elke chunkleesweg naar model of gebruiker dwingt het scanbewijs af (broncontract)", async () => {
  const { readFileSync } = await import("node:fs");
  const lees = (pad: string) => readFileSync(new URL(`../../${pad}`, import.meta.url), "utf8");
  const rag = lees("core/lib/rag.ts");
  const naVerwerking = rag.slice(rag.indexOf("async function naVerwerking("), rag.indexOf("// B2 — relevantie-ondergrens"));
  assert.ok(naVerwerking.indexOf("filterOpScanbewijs") >= 0, "naVerwerking filtert op scanbewijs");
  assert.ok(naVerwerking.indexOf("filterOpScanbewijs") < naVerwerking.indexOf("rerankChunks("), "vóór de reranker");
  const dekking = rag.slice(rag.indexOf("export async function haalDocumentChunksMetDekking"), rag.indexOf("export async function haalDocumentChunks("));
  assert.match(dekking, /documenten!inner\([^)]*bestand_hash, scan_resultaat\)/);
  assert.equal((dekking.match(/= bewaakDekking\(/g) ?? []).length, 2, "beide returnpaden via de scanpoort");
  assert.match(rag, /function bewaakDekking[\s\S]{0,400}handhaafScanbewijs/);
  assert.match(rag, /const REFLECTIE_SELECT = [^;]*bestand_hash, scan_resultaat\)/);
  const bevroren = rag.slice(rag.indexOf("export async function haalBevrorenChunks"), rag.indexOf("// Increment D — verrijk opgehaalde chunks"));
  assert.equal((bevroren.match(/handhaafScanbewijs\(/g) ?? []).length, 2, "legacy- én opaque-resolutie");
  assert.match(rag, /\.select\("id, bestand_hash, scan_resultaat"\)\s*\.in\("documenttype"/);

  const t8 = lees("platform/lib/semantische-extractie-job.ts");
  assert.equal((t8.match(/isMalwarescanAan\(\) && !heeftSchoonScanbewijs\(doc\)/g) ?? []).length, 2, "enqueue én worker");
  assert.ok(t8.indexOf('"scanbewijs_ontbreekt"') < t8.indexOf('.from("document_chunks")'), "vóór de chunklezing");

  const evidence = lees("core/lib/retrieval/supabase-evidence.ts");
  assert.match(evidence, /DOCUMENT_VERSIE_SELECT = "[^"]*scan_resultaat"/);
  assert.match(evidence, /if \(scanbewijsOntbreekt\(document\)\) return geweigerd/);
  assert.match(evidence, /!scanbewijsOntbreekt\(v5Document\)/);

  const reindex = lees("core/lib/reindex.ts");
  assert.ok(reindex.indexOf("scanbewijs_ontbreekt") > 0);
  assert.ok(reindex.indexOf("scanbewijs_ontbreekt") < reindex.indexOf(".download(doc.opslag_pad)"), "vóór download/parser");

  // Downloads/inzage en de UI-projecties blijven via de centrale poort.
  const download = lees("app/api/documents/[id]/bestand/route.ts");
  assert.match(download, /isOrigineelBeschikbaar/);
  const versie = lees("core/lib/retrieval/supabase-versie.ts");
  assert.match(versie, /vereisScanbewijs && !heeftSchoonScanbewijs/);
});
