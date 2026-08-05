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

/**
 * Welke maatstaf de agendapunt-telling gebruikt (T1 bureau-rol, ontwerp §6.6).
 *
 * `eigen_inbreng` — de bestuurdersstand, ongewijzigd: hoeveel punten wachten nog
 *   op de eigen inbreng van de ingelogde gebruiker (besluit 0085).
 * `gekoppeld_stuk` — de bureau-variant. Voor `bestuursbureau` is de eerste
 *   maatstaf betekenisloos én misleidend: het bureau plaatst geen inbreng, en
 *   sinds migratie 2026_08_05_bestuursbureau_rol.sql leest het geen inbrengrijen,
 *   dus de teller zou altijd "alle agendapunten" tonen. In plaats daarvan telt de
 *   kaart wat voor het bureau wél betekenis heeft: agendapunten van de
 *   eerstvolgende vergadering waaraan nog geen stuk is gekoppeld.
 */
export type AgendapuntMaatstaf = "eigen_inbreng" | "gekoppeld_stuk";

export interface AgendapuntTelling {
  /** Welke van de twee tellingen hieronder betekenis draagt. */
  maatstaf: AgendapuntMaatstaf;
  /** Aantal agendapunten in de eerstvolgende vergadering. */
  totaal: number;
  /** Aantal daarvan waarop de INGELOGDE gebruiker zelf nog geen inbreng plaatste.
   *  Alleen betekenisvol bij maatstaf `eigen_inbreng`; anders 0. */
  zonderEigenInbreng: number;
  /** Het eerste agendapunt zonder eigen inbreng — deeplink-doel voor "voorbereiden".
   *  Alleen betekenisvol bij maatstaf `eigen_inbreng`; anders null. */
  eersteZonderInbreng: { id: string; titel: string } | null;
  /** Aantal agendapunten zonder gekoppeld stuk.
   *  Alleen betekenisvol bij maatstaf `gekoppeld_stuk`; anders 0. */
  zonderGekoppeldStuk: number;
  /** Het eerste agendapunt zonder gekoppeld stuk — deeplink-doel voor het bureau.
   *  Alleen betekenisvol bij maatstaf `gekoppeld_stuk`; anders null. */
  eersteZonderStuk: { id: string; titel: string } | null;
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
    maatstaf: "eigen_inbreng",
    totaal: agendapunten.length,
    zonderEigenInbreng: zonder.length,
    eersteZonderInbreng: eerste ? { id: eerste.id, titel: eerste.titel } : null,
    zonderGekoppeldStuk: 0,
    eersteZonderStuk: null,
  };
}

/**
 * Bureau-variant van de telling (T1, ontwerp §6.6). Telt, gegeven de
 * agendapunten van de eerstvolgende vergadering en de agendapunt-id's waaraan
 * ten minste één stuk is gekoppeld, hoeveel punten nog zonder stuk zijn en welk
 * punt het eerste zo'n punt is (deeplink-doel).
 *
 * Spiegelbeeld van `telEigenInbreng` — bewust een aparte functie in plaats van
 * een vlag: de twee tellingen meten iets wezenlijk anders en horen los
 * narekenbaar te zijn. Puur: geen DB.
 */
export function telZonderGekoppeldStuk(
  agendapunten: readonly { id: string; titel: string }[],
  agendapuntIdsMetStuk: readonly string[]
): AgendapuntTelling {
  const metStuk = new Set(agendapuntIdsMetStuk);
  const zonder = agendapunten.filter((a) => !metStuk.has(a.id));
  const eerste = zonder[0];
  return {
    maatstaf: "gekoppeld_stuk",
    totaal: agendapunten.length,
    zonderEigenInbreng: 0,
    eersteZonderInbreng: null,
    zonderGekoppeldStuk: zonder.length,
    eersteZonderStuk: eerste ? { id: eerste.id, titel: eerste.titel } : null,
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
