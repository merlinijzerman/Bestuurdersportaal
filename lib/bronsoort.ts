// ============================================================================
//  lib/bronsoort.ts — Increment C+/B13.
// ----------------------------------------------------------------------------
//  Pure helpers rond de BRONSOORT van een document. De bronsoort zelf IS het
//  bestaande veld `documenten.bibliotheek` (generiek|fonds) — besluit 0006 B12;
//  er is bewust GEEN apart bronsoort-veld. Daarnaast dragen generieke documenten
//  3 beschrijvende velden: bronorganisatie, extern_url, normgewicht.
//
//  Geen DB-toegang; testbaar via lib/bronsoort.sanity.ts. De labels worden in de
//  tenant-UI gebruikt om generiek read-only te tonen (badge + "Vervallen per …").
//  Retrievalweging op bronsoort komt in Increment G/H; dit bestand weegt niet.
// ============================================================================

/** Bronsoort = de bibliotheek-discriminator. */
export type Bronsoort = "generiek" | "fonds";

export const BRONSOORTEN: Bronsoort[] = ["generiek", "fonds"];

export const BRONSOORT_LABEL: Record<Bronsoort, string> = {
  generiek: "Generiek / extern kader",
  fonds: "Fondsdocument",
};

/** Normgewicht-enum — spiegelt de DB-CHECK (documenten_normgewicht_check). */
export type Normgewicht =
  | "bindend"
  | "toezichtverwachting"
  | "sector_guidance"
  | "informatief"
  | "onbekend";

export const NORMGEWICHTEN: Normgewicht[] = [
  "bindend",
  "toezichtverwachting",
  "sector_guidance",
  "informatief",
  "onbekend",
];

export const NORMGEWICHT_LABEL: Record<Normgewicht, string> = {
  bindend: "Bindend",
  toezichtverwachting: "Toezichtverwachting",
  sector_guidance: "Sector-guidance",
  informatief: "Informatief",
  onbekend: "Onbekend",
};

/** True als `waarde` een geldig normgewicht is (voor server-side validatie). */
export function isGeldigNormgewicht(waarde: unknown): waarde is Normgewicht {
  return typeof waarde === "string" && (NORMGEWICHTEN as string[]).includes(waarde);
}

/** Label voor een (mogelijk NULL) normgewicht. NULL/onbekend → "Onbekend". */
export function normgewichtLabel(waarde: string | null | undefined): string {
  if (waarde && isGeldigNormgewicht(waarde)) return NORMGEWICHT_LABEL[waarde];
  return NORMGEWICHT_LABEL.onbekend;
}

/**
 * Veilige externe URL: alleen http(s). Weert `javascript:`/`data:`-schema's die
 * — als een generiek document zo'n waarde zou dragen — bij het renderen als
 * klikbare link tot XSS kunnen leiden. Gebruikt als server-side validatie (de
 * platform-/curatie-route mag geen onveilige URL opslaan) én als render-gate.
 */
export function isVeiligeUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.trim() === "") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Is dit document vervallen op de peildatum? Vervallen = er is een `geldig_tot`
 * én die ligt vóór de peildatum. Geen `geldig_tot` ≡ niet vervallen.
 * Datums als ISO-strings (YYYY-MM-DD); peildatum default = vandaag.
 */
export function isVervallen(
  geldigTot: string | null | undefined,
  peildatum: Date = new Date()
): boolean {
  if (!geldigTot) return false;
  const tot = new Date(geldigTot);
  if (Number.isNaN(tot.getTime())) return false;
  // Vergelijk op kalenderdag: geldig_tot is inclusief; vervallen pas DAARNA.
  const peilDag = peildatum.toISOString().slice(0, 10);
  return geldigTot < peilDag;
}

export interface BronkaartInput {
  bibliotheek: string | null | undefined;
  normgewicht?: string | null;
  geldig_tot?: string | null;
}

export interface BronkaartLabels {
  /** Toon de bronsoort-badge alleen bij generiek (fonds = impliciet). */
  isGeneriek: boolean;
  bronsoortLabel: string | null;
  normgewichtLabel: string;
  vervallen: boolean;
  /** Bv. "Vervallen per 2025-01-01"; null als niet vervallen. */
  vervallenLabel: string | null;
}

/**
 * Bouw de labels voor een bronkaart/badge. Pure afleiding voor de tenant-UI
 * (read-only weergave van generieke documenten).
 */
export function bronkaartLabels(
  doc: BronkaartInput,
  peildatum: Date = new Date()
): BronkaartLabels {
  const isGeneriek = doc.bibliotheek === "generiek";
  const vervallen = isVervallen(doc.geldig_tot, peildatum);
  return {
    isGeneriek,
    bronsoortLabel: isGeneriek ? BRONSOORT_LABEL.generiek : null,
    normgewichtLabel: normgewichtLabel(doc.normgewicht),
    vervallen,
    vervallenLabel: vervallen ? `Vervallen per ${doc.geldig_tot}` : null,
  };
}
