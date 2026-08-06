// ============================================================
//  lib/document-status-transities.ts — Increment C
//
//  GATE-deliverable: de statustransitietabel (TO v1.2 §3.1) als
//  TESTBARE SPECIFICATIE. Pure constante + functies, géén Supabase-
//  imports, zodat de regressietests er rechtstreeks tegenaan kunnen
//  (patroon lib/stemming.ts / lib/dossier.ts).
//
//  Deze module is de bron-van-waarheid die zowel server-side (routes,
//  metadata-PATCH) als de DB-trigger-spiegel (fn_document_status_transitie
//  in de migratie) volgen. Bij wijziging: pas BEIDE aan en draai de
//  sanity-tests (lib/document-status-transities.sanity.ts).
//
//  Drie statuslagen (TO §3):
//   Laag 1 = documenten.actief (harde uitsluiting, hier NIET gemodelleerd —
//            overrulet alles, zit in de retrieval/UI-laag).
//   Laag 2 = documentstatus (deze module: STATUS_TRANSITIES).
//   Laag 3 = bronstatus (deze module: BRONSTATUS_TRANSITIES).
//
//  Harde conceptregel (FO §6 / TO §3.1): concept/ter_bespreking/
//  ter_besluitvorming zijn NOOIT een actuele bron, ook niet bij
//  bronstatus=actief. Geborgd als apart predikaat isActueleBronStatus()
//  náást de transitietabel.
// ============================================================

// ── Statuswaarden (laag 2 + laag 3) ───────────────────────────────────

export type DocumentStatus =
  | "concept"
  | "ter_bespreking"
  | "ter_besluitvorming"
  | "vastgesteld"
  | "van_kracht"
  | "vervangen"
  | "alleen_historisch"
  | "gearchiveerd";

export const DOCUMENT_STATUSSEN: DocumentStatus[] = [
  "concept",
  "ter_bespreking",
  "ter_besluitvorming",
  "vastgesteld",
  "van_kracht",
  "vervangen",
  "alleen_historisch",
  "gearchiveerd",
];

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  concept: "Concept",
  ter_bespreking: "Ter bespreking",
  ter_besluitvorming: "Ter besluitvorming",
  vastgesteld: "Vastgesteld",
  van_kracht: "Van kracht",
  vervangen: "Vervangen",
  alleen_historisch: "Alleen historisch",
  gearchiveerd: "Gearchiveerd",
};

export type Bronstatus =
  | "actief"
  | "historisch"
  | "uitgesloten"
  | "actief_na_vaststelling";

export const BRONSTATUSSEN: Bronstatus[] = [
  "actief",
  "historisch",
  "uitgesloten",
  "actief_na_vaststelling",
];

export const BRONSTATUS_LABEL: Record<Bronstatus, string> = {
  actief: "Actief",
  historisch: "Historisch",
  uitgesloten: "Uitgesloten",
  actief_na_vaststelling: "Actief na vaststelling",
};

// ── Harde conceptregel — los van de transitietabel ────────────────────

/**
 * Alléén deze statussen kunnen een actuele normatieve bron zijn — ONAFHANKELIJK
 * van bronstatus. Dit is de harde conceptregel (FO §6 / TO §3.1): een
 * conceptdocument met bronstatus=actief is GEEN actuele bron.
 *
 * NB: dit is een NOODZAKELIJKE voorwaarde op laag 2. De volledige "actuele
 * bron"-definitie (TO §6.1) voegt in Increment G nog actief=true, bronstatus,
 * geldigheid (peildatum) en niet-vervangen toe. Deze functie borgt het
 * status-deel dat bronstatus niet mag overrulen.
 */
export const ACTUELE_BRON_STATUSSEN: DocumentStatus[] = [
  "vastgesteld",
  "van_kracht",
];

export function isActueleBronStatus(status: DocumentStatus): boolean {
  return ACTUELE_BRON_STATUSSEN.includes(status);
}

// ── Documentstatus-transities (laag 2, TO §3.1) ───────────────────────

/** Wie mag de overgang uitvoeren. `upload` = systeem bij upload; `admin` =
 *  uitsluitend via admin-herstel (buiten de normale flow). */
export type TransitieCapability =
  | "upload"
  | "documents.status.change"
  | "admin";

export interface StatusTransitie {
  van: DocumentStatus | "upload";
  naar: DocumentStatus;
  /** false = expliciet verboden overgang die toch benoemd is (sprong/terug). */
  toegestaan: boolean;
  capability: TransitieCapability | null;
  /** Mag de uploader van het eigen document deze overgang ook doen (zonder
   *  documents.status.change)? Alleen concept → ter_bespreking. */
  uploaderEigenToegestaan?: boolean;
  redenplicht: boolean;
  /** Vereist dat vervangen_door_document_id gezet wordt (van_kracht → vervangen). */
  vereistVervangenDoor?: boolean;
  herindexering: boolean;
  /** Is het document ná deze overgang bruikbaar als ACTUELE bron (modus
   *  Actueel)? Concept-statussen: altijd nee. */
  bruikbaarInActueleRagNaOvergang: boolean;
  /** Overgang loopt uitsluitend via admin-herstel, niet via de normale UI. */
  viaAdminHerstel?: boolean;
  toelichting?: string;
}

/**
 * De volledige, expliciete transitietabel (TO §3.1). Elke NIET-genoemde
 * (van, naar)-combinatie is impliciet verboden — zie magOvergaan().
 *
 * `*` → gearchiveerd is uitgevouwen naar één rij per bronstatus zodat de
 * lookup deterministisch blijft (geen wildcard-magie in de spec).
 */
const ARCHIVEERBARE_BRONNEN: DocumentStatus[] = [
  "concept",
  "ter_bespreking",
  "ter_besluitvorming",
  "vastgesteld",
  "van_kracht",
  "vervangen",
  "alleen_historisch",
];

export const STATUS_TRANSITIES: StatusTransitie[] = [
  {
    van: "upload",
    naar: "concept",
    toegestaan: true,
    capability: "upload",
    redenplicht: false,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: false,
    toelichting:
      "Upload zonder statusverklaring start als concept; nooit actuele bron.",
  },
  // ── Ingest van een REEDS BUITEN HET PORTAAL VASTGESTELD document ──────────
  // Besluit 0136. De keten concept -> ter_bespreking -> ter_besluitvorming ->
  // vastgesteld modelleert een document dat IN het portaal ontstaat en via
  // bestuurlijke besluitvorming rijpt. Een pensioenreglement of jaarverslag dat
  // je uploadt, is buiten het portaal al vastgesteld; dat door die keten duwen
  // laat in document_metadata_log een spoor achter van bestuurlijke overgangen
  // die nooit hebben plaatsgevonden. Voor de aantoonbaarheid is dat slechter,
  // niet beter: je fabriceert een besluitvormingsgeschiedenis.
  //
  // Daarom een aparte, expliciete ingest-verklaring. Bewust zo vormgegeven:
  //   - alleen vanaf de pseudo-herkomst `upload` -- de keten vanuit `concept`
  //     blijft ongemoeid, er ontstaat geen sprong binnen de keten;
  //   - redenplicht = true: de uploader verklaart WAAROM dit al vastgesteld is
  //     (bv. "vastgesteld in bestuursvergadering 12-03-2026, buiten portaal");
  //   - capability documents.status.change, dus niet elke uploader mag dit.
  // De DB-trigger raakt dit pad niet (`before update of status`), maar de
  // SQL-spiegel fn_document_status_transitie krijgt dezelfde rijen zodat de
  // tweeling 1-op-1 blijft -- zie migratie 2026_08_06_status_bij_ingest.sql.
  {
    van: "upload",
    naar: "vastgesteld",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: true,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: true,
    toelichting:
      "Ingest van een buiten het portaal vastgesteld document; reden verplicht.",
  },
  {
    van: "upload",
    naar: "van_kracht",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: true,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: true,
    toelichting:
      "Ingest van een buiten het portaal geldend document; reden verplicht.",
  },
  {
    van: "concept",
    naar: "ter_bespreking",
    toegestaan: true,
    capability: "documents.status.change",
    uploaderEigenToegestaan: true,
    redenplicht: false,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: false,
    toelichting: "Conceptregel: nooit actuele bron.",
  },
  {
    van: "ter_bespreking",
    naar: "ter_besluitvorming",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: false,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: false,
    toelichting: "Conceptregel: nooit actuele bron.",
  },
  {
    van: "ter_besluitvorming",
    naar: "vastgesteld",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: true,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: true,
    toelichting:
      "Vaststelling: bronstatus actief_na_vaststelling wordt nu effectief actief (mits geldigheid).",
  },
  {
    van: "vastgesteld",
    naar: "van_kracht",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: false,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: true,
  },
  {
    van: "van_kracht",
    naar: "vervangen",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: true,
    vereistVervangenDoor: true,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: false,
    toelichting: "Alleen nog historisch bruikbaar.",
  },
  {
    van: "van_kracht",
    naar: "alleen_historisch",
    toegestaan: true,
    capability: "documents.status.change",
    redenplicht: true,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: false,
  },
  // * → gearchiveerd (uitgevouwen per bronstatus)
  ...ARCHIVEERBARE_BRONNEN.map(
    (van): StatusTransitie => ({
      van,
      naar: "gearchiveerd",
      toegestaan: true,
      capability: "documents.status.change",
      redenplicht: true,
      herindexering: true,
      bruikbaarInActueleRagNaOvergang: false,
    })
  ),
  // Expliciet verboden, maar benoemd (documentatie + testdekking):
  {
    van: "vervangen",
    naar: "van_kracht",
    toegestaan: false,
    capability: "admin",
    viaAdminHerstel: true,
    redenplicht: true,
    herindexering: true,
    bruikbaarInActueleRagNaOvergang: false,
    toelichting: "Niet via normale flow; uitsluitend admin-herstel.",
  },
  {
    van: "concept",
    naar: "vastgesteld",
    toegestaan: false,
    capability: null,
    redenplicht: false,
    herindexering: false,
    bruikbaarInActueleRagNaOvergang: false,
    toelichting: "Sprong verboden: geen overslaan van tussenstatussen.",
  },
];

// ── Lookup-/beslisfuncties ────────────────────────────────────────────

export function vindTransitie(
  van: DocumentStatus | "upload",
  naar: DocumentStatus
): StatusTransitie | null {
  return (
    STATUS_TRANSITIES.find((t) => t.van === van && t.naar === naar) ?? null
  );
}

/**
 * Mag deze overgang via de normale flow? Een no-op (van === naar) is geen
 * overgang en dus niet "toegestaan" in transitiezin. Niet in de tabel of
 * toegestaan=false → false.
 */
export function magOvergaan(
  van: DocumentStatus | "upload",
  naar: DocumentStatus
): boolean {
  if (van === naar) return false;
  const t = vindTransitie(van, naar);
  return t !== null && t.toegestaan === true;
}

export function redenVerplicht(
  van: DocumentStatus | "upload",
  naar: DocumentStatus
): boolean {
  return vindTransitie(van, naar)?.redenplicht ?? false;
}

export function vereisteCapability(
  van: DocumentStatus | "upload",
  naar: DocumentStatus
): TransitieCapability | null {
  return vindTransitie(van, naar)?.capability ?? null;
}

/**
 * Statussen die bij UPLOAD direct verklaard mogen worden (besluit 0136).
 * `concept` staat hier bewust NIET bij: dat is de default en vergt geen
 * verklaring. Alles hier vraagt een reden en de capability uit de tabel.
 */
export function toegestaneIngestStatussen(): DocumentStatus[] {
  return STATUS_TRANSITIES.filter(
    (t) => t.van === "upload" && t.toegestaan && t.naar !== "concept"
  ).map((t) => t.naar);
}

/** Toegestane vervolgstatussen vanuit een huidige status (voor UI: toon
 *  vereisten/keuzes vooraf, niet als foutmelding erna). */
export function toegestaneVervolgstatussen(
  van: DocumentStatus
): DocumentStatus[] {
  return STATUS_TRANSITIES.filter((t) => t.van === van && t.toegestaan).map(
    (t) => t.naar
  );
}

// ── Bronstatus-transities (laag 3, TO §3.1) ───────────────────────────

export interface BronstatusTransitie {
  van: Bronstatus;
  naar: Bronstatus;
  toegestaan: boolean;
  capability: "documents.bronstatus.change" | "afgeleid";
  /** Reden verplicht bij blootstelling-verhogende overgang (→ actief). */
  redenplicht: boolean;
  ragImpact: boolean;
  herindexering: boolean;
  toelichting?: string;
}

export const BRONSTATUS_TRANSITIES: BronstatusTransitie[] = [
  {
    van: "historisch",
    naar: "actief",
    toegestaan: true,
    capability: "documents.bronstatus.change",
    redenplicht: true,
    ragImpact: true,
    herindexering: true,
    toelichting: "Blootstelling verhogend: reden + RAG-impact vooraf.",
  },
  {
    van: "uitgesloten",
    naar: "actief",
    toegestaan: true,
    capability: "documents.bronstatus.change",
    redenplicht: true,
    ragImpact: true,
    herindexering: true,
    toelichting: "Blootstelling verhogend: reden + RAG-impact vooraf.",
  },
  {
    van: "actief",
    naar: "historisch",
    toegestaan: true,
    capability: "documents.bronstatus.change",
    redenplicht: false,
    ragImpact: true,
    herindexering: true,
  },
  {
    van: "actief",
    naar: "uitgesloten",
    toegestaan: true,
    capability: "documents.bronstatus.change",
    redenplicht: false,
    ragImpact: true,
    herindexering: true,
  },
  {
    van: "historisch",
    naar: "uitgesloten",
    toegestaan: true,
    capability: "documents.bronstatus.change",
    redenplicht: false,
    ragImpact: false,
    herindexering: true,
  },
  {
    van: "uitgesloten",
    naar: "historisch",
    toegestaan: true,
    capability: "documents.bronstatus.change",
    redenplicht: false,
    ragImpact: false,
    herindexering: true,
  },
  {
    van: "actief_na_vaststelling",
    naar: "actief",
    toegestaan: true,
    capability: "afgeleid",
    redenplicht: false,
    ragImpact: true,
    herindexering: true,
    toelichting:
      "Afgeleid: gevolg van documentstatus → vastgesteld, niet handmatig.",
  },
];

export function vindBronstatusTransitie(
  van: Bronstatus,
  naar: Bronstatus
): BronstatusTransitie | null {
  return (
    BRONSTATUS_TRANSITIES.find((t) => t.van === van && t.naar === naar) ?? null
  );
}

export function magBronstatusOvergaan(
  van: Bronstatus,
  naar: Bronstatus
): boolean {
  if (van === naar) return false;
  const t = vindBronstatusTransitie(van, naar);
  return t !== null && t.toegestaan === true;
}

export function bronstatusRedenVerplicht(
  van: Bronstatus,
  naar: Bronstatus
): boolean {
  return vindBronstatusTransitie(van, naar)?.redenplicht ?? false;
}

export function bronstatusRagImpact(
  van: Bronstatus,
  naar: Bronstatus
): boolean {
  return vindBronstatusTransitie(van, naar)?.ragImpact ?? false;
}
