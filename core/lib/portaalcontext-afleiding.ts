// ============================================================================
//  Pure afleidingslogica voor de portaalcontext (AI-startpunt P1, besluit 0085).
// ----------------------------------------------------------------------------
//  BEWUST GESCHEIDEN van core/lib/portaalcontext.ts: dat bestand doet server-side
//  I/O (`server-only` + RLS-client) en is daardoor niet los uitvoerbaar onder
//  `tsx`. De tellingen/selectie/kaartkeuze hieronder zijn puur (geen DB, geen
//  React) en worden door portaalcontext.sanity.ts zonder DB narekend. De
//  server-helper importeert deze functies en typen.
// ============================================================================

// ── Vormtypes ───────────────────────────────────────────────────────────────

export interface VergaderingCtx {
  id: string;
  titel: string;
  datum: string;
  locatie: string | null;
}

export interface AgendapuntTelling {
  /** Aantal agendapunten in de eerstvolgende vergadering. */
  totaal: number;
  /** Aantal daarvan waarop de INGELOGDE gebruiker zelf nog geen inbreng plaatste. */
  zonderEigenInbreng: number;
  /** Het eerste agendapunt zonder eigen inbreng — deeplink-doel voor "voorbereiden". */
  eersteZonderInbreng: { id: string; titel: string } | null;
}

export interface OpenStapCtx {
  id: string;
  naam: string;
  deadline: string | null;
  procedure_id: string;
  procedure_titel: string;
}

export interface DocumentCtx {
  id: string;
  titel: string;
  aangemaakt: string;
}

export interface PortaalContext {
  volgendeVergadering: VergaderingCtx | null;
  agendapunten: AgendapuntTelling;
  /** Eigen open procedurestappen (co-eigenaar), oplopend op deadline. Max 5. */
  openStappen: OpenStapCtx[];
  /** Meest recent toegevoegde, actieve document uit de FONDSbibliotheek (niet generiek). */
  recentDocument: DocumentCtx | null;
}

// ── Pure afleidingslogica ────────────────────────────────────────────────────

/**
 * Telt, gegeven de agendapunten van een vergadering en de agendapunt-id's
 * waarop de gebruiker ZELF inbreng plaatste, hoeveel punten nog zonder eigen
 * inbreng zijn en welk punt het eerste zo'n punt is (deeplink-doel).
 * Puur: geen DB, volledig narekenbaar.
 */
export function telEigenInbreng(
  agendapunten: readonly { id: string; titel: string }[],
  eigenInbrengAgendapuntIds: readonly string[]
): AgendapuntTelling {
  const inbrengSet = new Set(eigenInbrengAgendapuntIds);
  const zonder = agendapunten.filter((a) => !inbrengSet.has(a.id));
  const eerste = zonder[0];
  return {
    totaal: agendapunten.length,
    zonderEigenInbreng: zonder.length,
    eersteZonderInbreng: eerste ? { id: eerste.id, titel: eerste.titel } : null,
  };
}

export type StartpuntKaartSoort = "vergadering" | "procedurestap" | "document";

/**
 * Bepaalt welke contextkaarten het startpunt toont — kaarten zonder inhoud
 * worden weggelaten (acceptatiecriterium 4), niet leeg getoond. Volgorde:
 * vergadering → procedurestap → document.
 */
export function startpuntKaarten(ctx: PortaalContext): StartpuntKaartSoort[] {
  const kaarten: StartpuntKaartSoort[] = [];
  if (ctx.volgendeVergadering) kaarten.push("vergadering");
  if (ctx.openStappen.length > 0) kaarten.push("procedurestap");
  if (ctx.recentDocument) kaarten.push("document");
  return kaarten;
}

/** Heeft de gebruiker enige context? Zo niet: startpunt toont alleen de taakknoppen. */
export function heeftEnigeContext(ctx: PortaalContext): boolean {
  return startpuntKaarten(ctx).length > 0;
}
