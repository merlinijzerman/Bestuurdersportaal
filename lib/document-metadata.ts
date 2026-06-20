// ============================================================
//  lib/document-metadata.ts — Increment C
//
//  Metadata-model voor documenten: context, documenttype en review-status
//  als constanten + labels, plus PURE validatie- en classificatiefuncties
//  die zowel de routes (server-side leidend) als de UI gebruiken.
//
//  Geen Supabase-imports → testbaar (lib/document-metadata.sanity.ts).
//  Statuslagen (status/bronstatus + transities) leven in
//  lib/document-status-transities.ts; deze module verwijst ernaar.
//
//  Bron: FO v1.2 §6 (context/documenttype/contextvalidatie) en §7
//  (metadata-beheer, redenplicht, RAG-impact); TO v1.2 §2.4.
// ============================================================

// ── Context (FO §6) ────────────────────────────────────────────────────

export type DocumentContext = "dossier" | "vergadering" | "algemeen";

export const DOCUMENT_CONTEXTEN: DocumentContext[] = [
  "dossier",
  "vergadering",
  "algemeen",
];

export const DOCUMENT_CONTEXT_LABEL: Record<DocumentContext, string> = {
  dossier: "Dossier",
  vergadering: "Vergadering",
  algemeen: "Algemeen",
};

// ── Documenttype (uitgebreid voor besluitvorming, FO §6) ───────────────

export type Documenttype =
  | "beleid"
  | "besluit"
  | "besluitdocument"
  | "besluitregistratie"
  | "bestuursvoorstel"
  | "notulen"
  | "advies"
  | "memo"
  | "analyse"
  | "bijlage"
  | "overig";

export const DOCUMENTTYPEN: Documenttype[] = [
  "beleid",
  "besluit",
  "besluitdocument",
  "besluitregistratie",
  "bestuursvoorstel",
  "notulen",
  "advies",
  "memo",
  "analyse",
  "bijlage",
  "overig",
];

export const DOCUMENTTYPE_LABEL: Record<Documenttype, string> = {
  beleid: "Beleid",
  besluit: "Besluit",
  besluitdocument: "Besluitdocument",
  besluitregistratie: "Besluitregistratie",
  bestuursvoorstel: "Bestuursvoorstel",
  notulen: "Notulen",
  advies: "Advies",
  memo: "Memo",
  analyse: "Analyse",
  bijlage: "Bijlage",
  overig: "Overig",
};

// ── Metadata-review-status (FO §7 / TO §2.4) ───────────────────────────

export type MetadataReviewStatus =
  | "niet_nodig"
  | "te_controleren"
  | "gecontroleerd"
  | "afgewezen";

export const METADATA_REVIEW_STATUSSEN: MetadataReviewStatus[] = [
  "niet_nodig",
  "te_controleren",
  "gecontroleerd",
  "afgewezen",
];

export const METADATA_REVIEW_STATUS_LABEL: Record<MetadataReviewStatus, string> =
  {
    niet_nodig: "Niet nodig",
    te_controleren: "Nog niet verrijkt",
    gecontroleerd: "Gecontroleerd",
    afgewezen: "Afgewezen",
  };

/** Redenen waarom een document in de review-queue staat (TO §2.4). */
export type ReviewQueueReden =
  | "backfill"
  | "ontbrekende_metadata"
  | "onzekere_status"
  | "handmatig";

export type ReviewQueueStatus =
  | "open"
  | "in_behandeling"
  | "gecontroleerd"
  | "afgewezen";

// ── Contextvalidatie (FO §6, ook server-side afgedwongen) ──────────────

export interface ContextInvoer {
  context: DocumentContext;
  procesinstantie_id?: string | null;
  vergadering_id?: string | null;
  agendapunt_id?: string | null;
}

/**
 * Geeft de lijst BLOKKERS terug voor een (voorgestelde) contextcombinatie —
 * leeg = geldig. UX-principe: toon deze vereisten VOORAF, niet als foutmelding
 * achteraf.
 *
 * Structurele presentieregels (FO §6 punten 1–4). De regel "agendapunt hoort
 * bij die vergadering" vereist een DB-lookup en wordt DB-side afgedwongen door
 * de trigger `fn_document_agendapunt_vergadering_check` (migratie
 * 2026_06_19_documenten_agendapunt_vergadering_trigger.sql), niet hier.
 */
export function valideerContext(invoer: ContextInvoer): string[] {
  const blokkers: string[] = [];
  const { context, procesinstantie_id, vergadering_id, agendapunt_id } = invoer;

  if (context === "dossier" && !procesinstantie_id) {
    blokkers.push("Context 'dossier' vereist een gekoppelde procesinstantie.");
  }
  if (context === "vergadering" && !vergadering_id) {
    blokkers.push("Context 'vergadering' vereist een gekoppelde vergadering.");
  }
  if (agendapunt_id && !vergadering_id) {
    blokkers.push(
      "Een agendapunt kan alleen worden gekoppeld bij een gekoppelde vergadering."
    );
  }
  return blokkers;
}

export function contextIsGeldig(invoer: ContextInvoer): boolean {
  return valideerContext(invoer).length === 0;
}

// ── Veld-classificatie: RAG-impact + governance-kritiek (FO §7) ────────

/** De metadatavelden die via PATCH/bulk bewerkt kunnen worden. */
export type MetadataVeld =
  | "context"
  | "procesinstantie_id"
  | "vergadering_id"
  | "agendapunt_id"
  | "documenttype"
  | "status"
  | "bronstatus"
  | "documentdatum"
  | "geldig_vanaf"
  | "geldig_tot"
  | "vervangt_document_id"
  | "vervangen_door_document_id"
  // Increment C+/B13 — beschrijvende bronsoort-velden (alleen generiek; beheerd
  // op het platform-pad). Geen RAG-impact en niet governance-kritiek.
  | "bronorganisatie"
  | "extern_url"
  | "normgewicht";

/**
 * Velden die de RAG-uitkomst beïnvloeden → herindexering nodig + RAG-impact
 * vooraf tonen (FO §7). Wijzigingen aan deze velden zetten rag_impact=true in
 * het auditlog. In C is herindexering log-only (denormalisatie op chunks +
 * filtering komen in Increment E/G); de impact wordt wel vastgelegd en getoond.
 */
export const RAG_IMPACT_VELDEN: MetadataVeld[] = [
  "context",
  "procesinstantie_id",
  "documenttype",
  "status",
  "bronstatus",
  "documentdatum",
  "geldig_vanaf",
  "geldig_tot",
  "vervangen_door_document_id",
];

export function isRagImpactVeld(veld: MetadataVeld): boolean {
  return RAG_IMPACT_VELDEN.includes(veld);
}

/**
 * Governance-kritieke velden waarvoor een reden ALTIJD verplicht is bij
 * wijziging (FO §7 acceptatiecriterium 2), náást de status-/bronstatus-as die
 * hun eigen redenplicht uit de transitiespec halen.
 */
export const GOVERNANCE_KRITIEKE_VELDEN: MetadataVeld[] = [
  "geldig_vanaf",
  "geldig_tot",
  "vervangt_document_id",
  "vervangen_door_document_id",
];

export function isGovernanceKritiekVeld(veld: MetadataVeld): boolean {
  return GOVERNANCE_KRITIEKE_VELDEN.includes(veld);
}

export const METADATA_VELD_LABEL: Record<MetadataVeld, string> = {
  context: "Context",
  procesinstantie_id: "Primaire procesinstantie",
  vergadering_id: "Vergadering",
  agendapunt_id: "Agendapunt",
  documenttype: "Documenttype",
  status: "Documentstatus",
  bronstatus: "Bronstatus",
  documentdatum: "Documentdatum",
  geldig_vanaf: "Geldig vanaf",
  geldig_tot: "Geldig tot",
  vervangt_document_id: "Vervangt document",
  vervangen_door_document_id: "Vervangen door document",
  bronorganisatie: "Bronorganisatie",
  extern_url: "Externe URL",
  normgewicht: "Normgewicht",
};
