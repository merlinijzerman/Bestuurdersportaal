// ============================================================
//  lib/document-metadata-service.ts — Increment C
//
//  PURE planner voor metadata-wijzigingen: gegeven de huidige
//  documentstaat, een wijzigingsverzoek en de capabilities van de
//  gebruiker, berekent hij blokkers (contextvereisten), fouten
//  (validatie/permissie), de per-veld wijzigingen (voor het append-only
//  auditlog) en de RAG-impact — ZONDER DB-toegang.
//
//  Routes (PATCH /metadata, bulk-metadata) resolven auth + capabilities
//  + DB-reads/-writes en delegeren de besluitvorming hierheen, zodat de
//  governance-logica testbaar is (lib/document-metadata-service.sanity.ts)
//  en server-side leidend blijft (niet alleen in de UI).
//
//  Bron: FO §6/§7, TO §3.1; transitiespec lib/document-status-transities.ts.
// ============================================================

import {
  magOvergaan,
  redenVerplicht,
  vindTransitie,
  magBronstatusOvergaan,
  bronstatusRedenVerplicht,
  bronstatusRagImpact,
  type DocumentStatus,
  type Bronstatus,
} from "./document-status-transities";
import {
  valideerContext,
  isRagImpactVeld,
  isGovernanceKritiekVeld,
  type DocumentContext,
  type Documenttype,
  type MetadataVeld,
} from "./document-metadata";
import { isGeldigNormgewicht, NORMGEWICHTEN, isVeiligeUrl } from "./bronsoort";

/** Huidige, relevante documentstaat (uit de DB gelezen). */
export interface HuidigDocument {
  status: DocumentStatus | null;
  bronstatus: Bronstatus | null;
  context: DocumentContext;
  procesinstantie_id: string | null;
  vergadering_id: string | null;
  agendapunt_id: string | null;
  documenttype: Documenttype | null;
  documentdatum: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  vervangt_document_id: string | null;
  vervangen_door_document_id: string | null;
  bronorganisatie: string | null;
  extern_url: string | null;
  normgewicht: string | null;
}

/** Wijzigingsverzoek: een partial van de bewerkbare velden + één reden die op
 *  alle reden-plichtige wijzigingen in dit verzoek wordt toegepast. */
export interface MetadataVerzoek {
  context?: DocumentContext;
  procesinstantie_id?: string | null;
  vergadering_id?: string | null;
  agendapunt_id?: string | null;
  documenttype?: Documenttype | null;
  status?: DocumentStatus;
  bronstatus?: Bronstatus;
  documentdatum?: string | null;
  geldig_vanaf?: string | null;
  geldig_tot?: string | null;
  vervangt_document_id?: string | null;
  vervangen_door_document_id?: string | null;
  // Increment C+/B13 — beschrijvende bronsoort-velden (platform-pad; tenants
  // worden door RLS geblokkeerd op generieke documenten).
  bronorganisatie?: string | null;
  extern_url?: string | null;
  normgewicht?: string | null;
  reden?: string;
}

export interface GebruikerCapabilities {
  metadataUpdate: boolean;
  statusChange: boolean;
  bronstatusChange: boolean;
}

export interface VeldWijziging {
  veld: MetadataVeld;
  oude_waarde: string | null;
  nieuwe_waarde: string | null;
  wijzig_type: "metadata" | "status" | "bronstatus" | "koppeling";
  rag_impact: boolean;
  redenplicht: boolean;
}

export interface MetadataPlan {
  /** true = veilig toe te passen; false = blokkers of fouten. */
  ok: boolean;
  /** Contextvereisten — toon VOORAF (UX-principe), HTTP 422-achtig. */
  blokkers: string[];
  /** Validatie-/permissiefouten — HTTP 400/403. */
  fouten: string[];
  /** Per gewijzigd veld één entry → één auditrecord. */
  wijzigingen: VeldWijziging[];
  /** Enige wijziging met RAG-impact? → herindexering + impact vooraf tonen. */
  ragImpact: boolean;
}

const CONTEXT_VELDEN: MetadataVeld[] = [
  "context",
  "procesinstantie_id",
  "vergadering_id",
  "agendapunt_id",
];

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

/**
 * Bereken het wijzigingsplan. Pure functie; geen DB. De DB-trigger
 * (fn_document_status_overgang_check) en fondsconsistentie-/agendapunt-
 * triggers vormen de laatste verdedigingslinie; deze planner levert de
 * gebruikersgerichte, vooraf-getoonde validatie.
 */
export function bouwMetadataPlan(
  huidig: HuidigDocument,
  verzoek: MetadataVerzoek,
  caps: GebruikerCapabilities
): MetadataPlan {
  const fouten: string[] = [];
  const wijzigingen: VeldWijziging[] = [];
  const reden = verzoek.reden?.trim() || null;

  // ── Voorgestelde context-eindstaat (voor contextvalidatie) ──
  const proposed = {
    context: verzoek.context ?? huidig.context,
    procesinstantie_id:
      verzoek.procesinstantie_id !== undefined
        ? verzoek.procesinstantie_id
        : huidig.procesinstantie_id,
    vergadering_id:
      verzoek.vergadering_id !== undefined
        ? verzoek.vergadering_id
        : huidig.vergadering_id,
    agendapunt_id:
      verzoek.agendapunt_id !== undefined
        ? verzoek.agendapunt_id
        : huidig.agendapunt_id,
  };
  const blokkers = valideerContext(proposed);

  // ── Statuswijziging (laag 2) ──
  if (verzoek.status !== undefined && verzoek.status !== huidig.status) {
    if (!caps.statusChange) {
      fouten.push("Geen rechten om de documentstatus te wijzigen (documents.status.change).");
    } else if (huidig.status === null) {
      // legacy zonder status → eerste expliciete zet toegestaan (geen transitie).
      wijzigingen.push({
        veld: "status",
        oude_waarde: null,
        nieuwe_waarde: verzoek.status,
        wijzig_type: "status",
        rag_impact: true,
        redenplicht: false,
      });
    } else if (!magOvergaan(huidig.status, verzoek.status)) {
      fouten.push(
        `Ongeldige statusovergang: ${huidig.status} → ${verzoek.status} (niet toegestaan volgens transitietabel).`
      );
    } else {
      const t = vindTransitie(huidig.status, verzoek.status);
      const moetReden = redenVerplicht(huidig.status, verzoek.status);
      if (moetReden && !reden) {
        fouten.push(
          `Een reden is verplicht bij de overgang ${huidig.status} → ${verzoek.status}.`
        );
      }
      if (t?.vereistVervangenDoor) {
        const doelDoc =
          verzoek.vervangen_door_document_id !== undefined
            ? verzoek.vervangen_door_document_id
            : huidig.vervangen_door_document_id;
        if (!doelDoc) {
          fouten.push(
            "Bij 'vervangen' is een 'vervangen door'-document verplicht."
          );
        }
      }
      wijzigingen.push({
        veld: "status",
        oude_waarde: huidig.status,
        nieuwe_waarde: verzoek.status,
        wijzig_type: "status",
        rag_impact: true,
        redenplicht: moetReden,
      });
    }
  }

  // ── Bronstatuswijziging (laag 3) ──
  if (
    verzoek.bronstatus !== undefined &&
    verzoek.bronstatus !== huidig.bronstatus
  ) {
    if (!caps.bronstatusChange) {
      fouten.push("Geen rechten om de bronstatus te wijzigen (documents.bronstatus.change).");
    } else if (huidig.bronstatus === null) {
      // NULL ≡ actief tijdens overgang; eerste expliciete zet toegestaan.
      wijzigingen.push({
        veld: "bronstatus",
        oude_waarde: null,
        nieuwe_waarde: verzoek.bronstatus,
        wijzig_type: "bronstatus",
        rag_impact: true,
        redenplicht: false,
      });
    } else if (!magBronstatusOvergaan(huidig.bronstatus, verzoek.bronstatus)) {
      fouten.push(
        `Ongeldige bronstatusovergang: ${huidig.bronstatus} → ${verzoek.bronstatus}.`
      );
    } else {
      const moetReden = bronstatusRedenVerplicht(
        huidig.bronstatus,
        verzoek.bronstatus
      );
      if (moetReden && !reden) {
        fouten.push(
          `Een reden is verplicht bij bronstatus ${huidig.bronstatus} → ${verzoek.bronstatus}.`
        );
      }
      wijzigingen.push({
        veld: "bronstatus",
        oude_waarde: huidig.bronstatus,
        nieuwe_waarde: verzoek.bronstatus,
        wijzig_type: "bronstatus",
        rag_impact: bronstatusRagImpact(huidig.bronstatus, verzoek.bronstatus),
        redenplicht: moetReden,
      });
    }
  }

  // ── Overige metadatavelden (incl. context-/koppelvelden) ──
  const overige: MetadataVeld[] = [
    "context",
    "procesinstantie_id",
    "vergadering_id",
    "agendapunt_id",
    "documenttype",
    "documentdatum",
    "geldig_vanaf",
    "geldig_tot",
    "vervangt_document_id",
    "vervangen_door_document_id",
    "bronorganisatie",
    "extern_url",
    "normgewicht",
  ];

  for (const veld of overige) {
    if (verzoek[veld] === undefined) continue;
    const nieuw = asString(verzoek[veld]);
    const oud = asString(huidig[veld as keyof HuidigDocument]);
    if (nieuw === oud) continue;

    if (!caps.metadataUpdate) {
      fouten.push("Geen rechten om metadata te wijzigen (documents.metadata.update).");
      // verdere velden niet apart blijven melden
      break;
    }
    // Enum-validatie normgewicht (DB-CHECK is de backstop; toon de fout vooraf).
    if (veld === "normgewicht" && nieuw !== null && !isGeldigNormgewicht(nieuw)) {
      fouten.push(
        `Ongeldig normgewicht: ${nieuw}. Toegestaan: ${NORMGEWICHTEN.join(", ")}.`
      );
      continue;
    }
    // extern_url: alleen http(s) opslaan — weert javascript:/data:-schema's die
    // bij het renderen als klikbare link tot XSS kunnen leiden.
    if (veld === "extern_url" && nieuw !== null && !isVeiligeUrl(nieuw)) {
      fouten.push("Ongeldige externe URL: alleen http(s)-adressen zijn toegestaan.");
      continue;
    }
    if (isGovernanceKritiekVeld(veld) && !reden) {
      fouten.push(
        `Een reden is verplicht bij wijziging van een governance-kritiek veld (${veld}).`
      );
    }
    wijzigingen.push({
      veld,
      oude_waarde: oud,
      nieuwe_waarde: nieuw,
      wijzig_type: CONTEXT_VELDEN.includes(veld) ? "koppeling" : "metadata",
      rag_impact: isRagImpactVeld(veld),
      redenplicht: isGovernanceKritiekVeld(veld),
    });
  }

  const ragImpact = wijzigingen.some((w) => w.rag_impact);
  const ok = blokkers.length === 0 && fouten.length === 0;

  return { ok, blokkers, fouten, wijzigingen, ragImpact };
}
