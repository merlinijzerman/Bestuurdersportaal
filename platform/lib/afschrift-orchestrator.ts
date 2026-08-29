// ============================================================================
// T6 — Afschrift-worker-orkestrator (service-role, beheer-project).
// ----------------------------------------------------------------------------
// De DETERMINISTISCHE bundelbouw leeft in core/lib/afschrift-bundel (puur). Deze
// orkestrator doet de I/O die de worker nodig heeft: dossierviews laden, bijlagen
// uit storage halen, de zip wegschrijven en de rij afronden.
//
// ADR-5: de worker draait onder service-role (geen sessie → RLS-bypass). De
// gezichtshoek blijft daarom *fonds + rol*: elke query wordt EXPLICIET op de
// fonds_id/procedure_id van de afschrift-rij gescoopt. De bureau-uitsluiting is
// bij het aanmaken al afgedwongen (route-403 + RLS-insertpolicy); de worker
// bouwt wat is aangevraagd.
//
// Idempotent + lease-gebaseerd (claim-RPC afschriften_claim_jobs, FOR UPDATE SKIP
// LOCKED). Een crash laat de lease verlopen → herclaim; poging<8 remt crash-loops.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecisionDossierView } from "@/core/lib/decision";
import { renderAuditdossierHtml } from "@/core/lib/auditdossier-html";
import type { DecisionDossierView } from "@/core/lib/decision-view";
import {
  bouwBundel,
  MAX_BIJLAGEN,
  MAX_BIJLAGE_BYTES,
  MAX_TOTAAL_BYTES,
  type BijlageInvoer,
} from "@/core/lib/afschrift-bundel";
import type {
  AfschriftBron,
  AfschriftContext,
  ProcedureLogEntry,
} from "@/core/lib/afschrift-types";
import type { GovernanceEvent } from "@/core/lib/decision-view";
import type { ManifestWaarschuwing, SnapshotHash } from "@/core/lib/afschrift-manifest";

export const GENERATOR_VERSIE = "t6-1.0";
// Lease ruim BOVEN maxDuration (300) van de route: een in-flight build mag niet
// door een gelijktijdige cron-tick worden herclaimd (code-review M5). Vercel
// kapt de functie bij 300s af; de lease houdt de rij daarna nog even vast tot
// herclaim.
const LEASE_SECONDS = 600;
const MAX_POGINGEN = 8; // spiegelt de crash-loop-rem in de claim-RPC.
const AFSCHRIFTEN_BUCKET = "afschriften";
const DOCUMENTEN_BUCKET = "documenten";

interface AfschriftRow {
  id: string;
  procedure_id: string;
  fonds_id: string;
  versie: "actueel" | "besluitmoment";
  aanleiding: string | null;
  gebouwd_onder_rol: string | null;
  aangemaakt_op: string;
  aangemaakt_door: string | null;
  // Fase 2 — de vastgestelde AI/sjabloon-leeswijzer (§2–4) + herkomst.
  ai_leeswijzer: boolean;
  ai_leeswijzer_tekst: { hoeVerlopen: string; watVastgelegd: string; bijzonderheden: string } | null;
  ai_model: string | null;
  ai_promptversie: string | null;
  ai_tekst_hash: string | null;
  ai_vastgesteld_op: string | null;
}

interface WorkerResultaat {
  geclaimd: number;
  gereed: number;
  mislukt: number;
}

/** Drain-lus: claim tot `limit` jobs en bouw ze. */
export async function draaiAfschriftWorker(
  svc: SupabaseClient,
  opties: { workerId: string; limit?: number }
): Promise<WorkerResultaat> {
  const limit = opties.limit ?? 3;

  // Sweeper (code-review M6): rijen die na harde crashes op 'bezig' vastzitten —
  // pogingcap bereikt én lease verlopen — alsnog op 'mislukt' zetten, zodat ze
  // niet eeuwig 'bezig' blijven en de UI niet eindeloos pollt. De service-role
  // omzeilt de kolom-freeze-trigger (auth.uid() IS NULL).
  await svc
    .from("procedure_afschriften")
    .update({ status: "mislukt", laatste_fout: "vastgelopen: maximale pogingen bereikt" })
    .eq("status", "bezig")
    .gte("poging", MAX_POGINGEN)
    .lt("lease_tot", new Date().toISOString());

  const { data: rows, error } = await svc.rpc("afschriften_claim_jobs", {
    p_worker_id: opties.workerId,
    p_limit: limit,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error(`claim mislukte: ${error.message}`);

  const jobs = (rows ?? []) as AfschriftRow[];
  let gereed = 0;
  let mislukt = 0;
  for (const row of jobs) {
    try {
      await bouwEnBewaarAfschrift(svc, row);
      gereed += 1;
    } catch (e) {
      mislukt += 1;
      const melding = e instanceof Error ? e.message : String(e);
      // Status op mislukt (best effort — een falende update mag de andere jobs
      // in deze invocatie niet meesleuren).
      try {
        await svc
          .from("procedure_afschriften")
          .update({ status: "mislukt", laatste_fout: melding.slice(0, 2000) })
          .eq("id", row.id);
        await svc.from("procedure_log").insert({
          procedure_id: row.procedure_id,
          event_type: "afschrift_mislukt",
          actor_id: row.aangemaakt_door,
          actor_naam: null,
          payload: { afschrift_id: row.id, fout: melding.slice(0, 500) },
        });
      } catch (logErr) {
        console.error("afschrift mislukt-status/log wegschrijven faalde:", logErr);
      }
    }
  }
  return { geclaimd: jobs.length, gereed, mislukt };
}

/** Bouwt en bewaart één afschrift. Gooit bij een harde fout (→ status mislukt). */
async function bouwEnBewaarAfschrift(svc: SupabaseClient, row: AfschriftRow): Promise<void> {
  // ── 1. Procesbrede context (expliciet op fonds_id + procedure_id gescoopt) ──
  const { data: decisionRows, error: decErr } = await svc
    .from("decision_objects")
    .select("id, besluit_code, titel, besluitvraag, scope, is_primary_decision")
    .eq("procedure_id", row.procedure_id)
    .eq("fonds_id", row.fonds_id)
    .order("is_primary_decision", { ascending: false });
  if (decErr) throw new Error(`decision_objects laden: ${decErr.message}`);
  const decisionsMeta = (decisionRows ?? []) as {
    id: string;
    besluit_code: string;
    titel: string;
    besluitvraag: string;
    scope: string | null;
    is_primary_decision: boolean;
  }[];
  if (decisionsMeta.length === 0) {
    throw new Error("geen decision objects voor deze procedure gevonden");
  }

  const aanvragerNaam = await haalNaam(svc, row.aangemaakt_door);

  const decisions: DecisionDossierView[] = [];
  const auditdossiers: { besluitCode: string; html: string }[] = [];
  const snapshotHashes: SnapshotHash[] = [];
  const besluitvragen: { besluitCode: string; titel: string; besluitvraag: string; scope: string | null }[] = [];
  const extraWaarschuwingen: ManifestWaarschuwing[] = [];

  for (const dm of decisionsMeta) {
    let view: DecisionDossierView;
    let snapshotHash: string | null = null;
    let snapshotAangemaaktOp: string | null = null;

    if (row.versie === "besluitmoment") {
      const { data: snap } = await svc
        .from("decision_audit_snapshots")
        .select("trigger_status, hash, aangemaakt_op, snapshot")
        .eq("decision_id", dm.id)
        .order("aangemaakt_op", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snap) {
        view = normaliseerView(snap.snapshot as DecisionDossierView);
        snapshotHash = snap.hash as string;
        snapshotAangemaaktOp = snap.aangemaakt_op as string;
        snapshotHashes.push({
          besluit_code: dm.besluit_code,
          trigger_status: (snap.trigger_status as string) ?? "",
          hash: snap.hash as string,
        });
      } else {
        // Geen snapshot → val terug op de live toestand. M3: dit expliciet
        // benoemen, anders lijkt het besluit bevroren terwijl het dat niet is.
        view = await buildDecisionDossierView(svc, dm.id, { autoUpgraded: false });
        view.events = await haalAlleEvents(svc, dm.id); // H1: ongelimiteerd auditspoor
        extraWaarschuwingen.push({
          pad: "01_Auditdossier",
          melding: `Besluit ${dm.besluit_code}: geen audit-snapshot beschikbaar; de live toestand op het generatiemoment is opgenomen in plaats van het bevroren besluitmoment.`,
        });
      }
    } else {
      view = await buildDecisionDossierView(svc, dm.id, { autoUpgraded: false });
      // H1: de dossierview capt governance_events op 100 (decision.ts). Voor een
      // afschrift dat volledigheid claimt vervangen we het besluit-spoor door de
      // ONGELIMITEERDE reeks, zodat de oudste events niet stilzwijgend wegvallen.
      view.events = await haalAlleEvents(svc, dm.id);
    }

    decisions.push(view);
    auditdossiers.push({
      besluitCode: dm.besluit_code,
      html: renderAuditdossierHtml(view, {
        versie: row.versie,
        gegenereerdOp: new Date(row.aangemaakt_op),
        aanvragerNaam,
        snapshotHash,
        snapshotAangemaaktOp,
      }),
    });
    besluitvragen.push({
      besluitCode: dm.besluit_code,
      titel: dm.titel,
      besluitvraag: dm.besluitvraag,
      scope: dm.scope,
    });
  }

  // ── 2. Procedure_log (procesniveau-spoor) ──────────────────────────────────
  const { data: logRows } = await svc
    .from("procedure_log")
    .select("id, procedure_id, event_type, actor_naam, payload, tijdstip")
    .eq("procedure_id", row.procedure_id)
    .order("tijdstip", { ascending: true });
  const procedureLog = (logRows ?? []) as ProcedureLogEntry[];

  // ── 3. Bijlagen (documenten via procedure_bewijs.document_id) ──────────────
  const bijlagen = await verzamelBijlagen(svc, decisions[0], row.fonds_id);

  // ── 4. Bundel bouwen (puur) ────────────────────────────────────────────────
  const primaire = decisionsMeta.find((d) => d.is_primary_decision) ?? decisionsMeta[0];
  const procescode = primaire.besluit_code || `PROC-${row.procedure_id.slice(0, 8)}`;
  const context: AfschriftContext = {
    afschriftId: row.id,
    procescode,
    versie: row.versie,
    aanleiding: row.aanleiding,
    aangemaaktOp: row.aangemaakt_op,
    aangemaaktDoorNaam: aanvragerNaam,
    gebouwdOnderRol: row.gebouwd_onder_rol,
    generatorVersie: GENERATOR_VERSIE,
  };
  // Fase 2: vastgestelde leeswijzer (§2–4) + herkomstblok. Leeg ⇒ sjabloon.
  const proza = row.ai_leeswijzer_tekst ?? null;
  const herkomst =
    row.ai_leeswijzer && row.ai_leeswijzer_tekst
      ? {
          model: row.ai_model ?? "onbekend",
          promptversie: row.ai_promptversie ?? "onbekend",
          gegenereerdOp: row.aangemaakt_op,
          tekstHash: row.ai_tekst_hash ?? "",
          vastgesteldDoor: aanvragerNaam ?? "onbekend",
          vastgesteldOp: row.ai_vastgesteld_op ?? row.aangemaakt_op,
        }
      : null;

  const bron: AfschriftBron = { context, decisions, procedureLog };
  const resultaat = await bouwBundel({
    bron,
    auditdossiers,
    snapshotHashes,
    bijlagen,
    besluitvragen,
    extraWaarschuwingen,
    proza,
    herkomst,
  });

  // ── 5. Opslaan (pad = <fonds_id>/<procedure_id>/<afschrift_id>.zip) ─────────
  const pad = `${row.fonds_id}/${row.procedure_id}/${row.id}.zip`;
  const { error: uploadErr } = await svc.storage
    .from(AFSCHRIFTEN_BUCKET)
    .upload(pad, resultaat.zipBytes, { contentType: "application/zip", upsert: true });
  if (uploadErr) throw new Error(`upload mislukte: ${uploadErr.message}`);

  // ── 6. Rij afronden (service-role → freeze-trigger laat dit door) ──────────
  const { error: updErr } = await svc
    .from("procedure_afschriften")
    .update({
      status: "gereed",
      opslag_pad: pad,
      sha256: resultaat.sha256,
      bytes: resultaat.bytes,
      bestandsaantal: resultaat.bestandsaantal,
      bevat_stemgedrag: resultaat.bevatStemgedrag,
      uitgesloten_items: resultaat.uitgeslotenItems,
      waarschuwingen: resultaat.waarschuwingen,
      laatste_fout: null,
    })
    .eq("id", row.id);
  if (updErr) throw new Error(`rij bijwerken mislukte: ${updErr.message}`);

  // ── 7. Auditspoor: gereed (best effort) ────────────────────────────────────
  // Nadrukkelijk ná de 'gereed'-update en in een eigen try: een DB-hik op het
  // logspoor mag een reeds gebouwd + opgeslagen afschrift niet alsnog naar
  // 'mislukt' laten kantelen (code-review M4).
  try {
    await svc.from("procedure_log").insert({
      procedure_id: row.procedure_id,
      event_type: "afschrift_gereed",
      actor_id: row.aangemaakt_door,
      actor_naam: aanvragerNaam,
      payload: {
        afschrift_id: row.id,
        bestandsaantal: resultaat.bestandsaantal,
        sha256: resultaat.sha256,
        uitgesloten: resultaat.uitgeslotenItems.length,
      },
    });
  } catch (logErr) {
    console.error("afschrift_gereed loggen mislukt (genegeerd):", logErr);
  }
}

// ── Hulp ─────────────────────────────────────────────────────────────────────

/**
 * Haalt ALLE governance_events van een besluit op (zonder de 100-cap die de
 * dossierview hanteert). Nodig omdat het afschrift volledigheid van het
 * besluit-spoor claimt (audit-evidence-review H1).
 */
async function haalAlleEvents(svc: SupabaseClient, decisionId: string): Promise<GovernanceEvent[]> {
  const { data } = await svc
    .from("governance_events")
    .select("id, decision_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde, reden, hash, tijdstip")
    .eq("decision_id", decisionId)
    .order("tijdstip", { ascending: true });
  return (data ?? []) as GovernanceEvent[];
}

async function haalNaam(svc: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await svc.from("profielen").select("naam").eq("id", userId).maybeSingle();
  return (data?.naam as string | null) ?? null;
}

/** Vult ontbrekende array-velden aan (oudere snapshots), net als de export-route. */
function normaliseerView(v: DecisionDossierView): DecisionDossierView {
  return {
    ...v,
    assumptions: v.assumptions ?? [],
    risks: v.risks ?? [],
    conditions: v.conditions ?? [],
    actions: v.actions ?? [],
    dissent: v.dissent ?? [],
    aiOutputs: v.aiOutputs ?? [],
    evaluations: v.evaluations ?? [],
    events: v.events ?? [],
    snapshots: v.snapshots ?? [],
    steps: v.steps ?? [],
    // Een bevroren snapshot (fn_build_decision_dossier) draagt GEEN evidence-key —
    // evidence wordt alleen live door buildDecisionDossierView toegevoegd. Zonder
    // deze default zou de feitenkaart-terugval (readiness weg → evidence) op een
    // nieuw snapshot crashen. Zie ook #208 (snapshot-vervulling).
    evidence: v.evidence ?? [],
    bewijs: v.bewijs ?? [],
    besluiten: v.besluiten ?? [],
    stemverslagen: v.stemverslagen ?? [],
  };
}

/**
 * Verzamelt de bijlagen uit procedure_bewijs.document_id. ADR-3: ingetrokken
 * documenten (actief=false) worden NOOIT meegenomen (uitsluiting 'ingetrokken').
 * Bewijs zonder document_id → 'geen_bestand'. Niet-leesbaar/ontbrekend bestand →
 * 'geen_toegang'.
 */
async function verzamelBijlagen(
  svc: SupabaseClient,
  view: DecisionDossierView,
  fondsId: string
): Promise<BijlageInvoer[]> {
  const bijlagen: BijlageInvoer[] = [];
  // Caps DURING het ophalen afdwingen (code-review M3): zo blijft het
  // geheugengebruik begrensd door MAX_TOTAAL_BYTES i.p.v. de som van alle
  // documenten. bouwBundel dwingt dezelfde caps nog eens af (idempotent).
  let opgenomen = 0;
  let totaalBytes = 0;
  for (const bewijs of view.bewijs) {
    if (!bewijs.document_id) {
      bijlagen.push({
        bewijsId: bewijs.id,
        titel: bewijs.titel,
        documenttype: bewijs.documenttype,
        extensie: "",
        bytes: null,
        uitsluiting: { reden: "geen_bestand" },
      });
      continue;
    }
    const { data: doc } = await svc
      .from("documenten")
      .select("id, titel, documenttype, opslag_pad, actief, bestandsnaam, vervangen_door_document_id, fonds_id")
      .eq("id", bewijs.document_id)
      .maybeSingle();

    if (!doc || doc.fonds_id !== fondsId) {
      bijlagen.push({
        bewijsId: bewijs.id, titel: bewijs.titel, documenttype: bewijs.documenttype,
        extensie: "", bytes: null, uitsluiting: { reden: "geen_toegang" },
      });
      continue;
    }
    if (doc.actief === false) {
      // ADR-3: nooit meenemen.
      bijlagen.push({
        bewijsId: bewijs.id, titel: bewijs.titel, documenttype: bewijs.documenttype,
        extensie: "", bytes: null,
        uitsluiting: { reden: "ingetrokken", detail: "documenten.actief = false" },
      });
      continue;
    }
    if (!doc.opslag_pad) {
      bijlagen.push({
        bewijsId: bewijs.id, titel: bewijs.titel, documenttype: bewijs.documenttype,
        extensie: "", bytes: null, uitsluiting: { reden: "geen_bestand", detail: "geen opslag_pad" },
      });
      continue;
    }
    // Aantal-cap vóór de download: eenmaal vol niet verder ophalen (geheugen).
    if (opgenomen >= MAX_BIJLAGEN) {
      bijlagen.push({
        bewijsId: bewijs.id, titel: doc.titel ?? bewijs.titel, documenttype: bewijs.documenttype,
        extensie: "", bytes: null,
        uitsluiting: { reden: "cap_overschreden", detail: `meer dan ${MAX_BIJLAGEN} bijlagen` },
      });
      continue;
    }

    const { data: blob, error: dlErr } = await svc.storage
      .from(DOCUMENTEN_BUCKET)
      .download(doc.opslag_pad as string);
    if (dlErr || !blob) {
      bijlagen.push({
        bewijsId: bewijs.id, titel: bewijs.titel, documenttype: bewijs.documenttype,
        extensie: "", bytes: null, uitsluiting: { reden: "geen_toegang", detail: "download mislukt" },
      });
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const titel = (doc.titel as string | null) ?? bewijs.titel;
    if (bytes.length > MAX_BIJLAGE_BYTES) {
      bijlagen.push({
        bewijsId: bewijs.id, titel, documenttype: bewijs.documenttype, extensie: "", bytes: null,
        uitsluiting: { reden: "te_groot", detail: `${bytes.length} bytes > ${MAX_BIJLAGE_BYTES}` },
      });
      continue;
    }
    if (totaalBytes + bytes.length > MAX_TOTAAL_BYTES) {
      bijlagen.push({
        bewijsId: bewijs.id, titel, documenttype: bewijs.documenttype, extensie: "", bytes: null,
        uitsluiting: { reden: "cap_overschreden", detail: `overschrijdt totaalcap ${MAX_TOTAAL_BYTES} bytes` },
      });
      continue;
    }
    opgenomen += 1;
    totaalBytes += bytes.length;
    bijlagen.push({
      bewijsId: bewijs.id,
      titel,
      documenttype: (doc.documenttype as string | null) ?? bewijs.documenttype,
      extensie: bepaalExtensie(doc.opslag_pad as string, doc.bestandsnaam as string | null),
      bytes,
      vervangenDoorDocumentId: (doc.vervangen_door_document_id as string | null) ?? null,
    });
  }
  return bijlagen;
}

function bepaalExtensie(opslagPad: string, bestandsnaam: string | null): string {
  const bron = bestandsnaam || opslagPad;
  const punt = bron.lastIndexOf(".");
  if (punt < 0 || punt === bron.length - 1) return "pdf";
  return bron.slice(punt + 1).toLowerCase();
}
