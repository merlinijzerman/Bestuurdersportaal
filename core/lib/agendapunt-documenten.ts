// ============================================================================
// Gedeelde read voor documenten die bij een agendapunt horen (#462, PR-1).
// ----------------------------------------------------------------------------
// Een stuk kan op twee manieren bij een agendapunt horen:
//   1. primair via documenten.agendapunt_id;
//   2. secundair/non-destructief via document_agendapunten.
//
// Deze read verenigt beide paden onder de RLS-client van de aanroeper. Daardoor
// gebruiken de client-chip, de server-side chatcontext en de portaalcontext
// dezelfde definitie. De chatroute past daarna haar strengere AI-toelating toe
// (actief + geindexeerd + chunks); deze helper bepaalt alleen de koppeling en
// sluit inactieve documenten uit.
// ============================================================================

export interface AgendapuntDocument {
  id: string;
  titel: string;
}

export interface AgendapuntDocumentKoppeling extends AgendapuntDocument {
  agendapunt_id: string;
}

interface LeesResultaat {
  data: unknown;
  error?: unknown;
}

export interface AgendapuntDocumentZoekbouwer extends PromiseLike<LeesResultaat> {
  eq(kolom: string, waarde: unknown): AgendapuntDocumentZoekbouwer;
  in(kolom: string, waarden: readonly string[]): AgendapuntDocumentZoekbouwer;
  abortSignal(signal: AbortSignal): AgendapuntDocumentZoekbouwer;
}

export interface AgendapuntDocumentLezer {
  from(tabel: string): { select(kolommen: string): AgendapuntDocumentZoekbouwer };
}

function metSignal(
  bouwer: AgendapuntDocumentZoekbouwer,
  signal?: AbortSignal
): AgendapuntDocumentZoekbouwer {
  return signal ? bouwer.abortSignal(signal) : bouwer;
}

async function lees(
  bouwer: AgendapuntDocumentZoekbouwer,
  signal?: AbortSignal
): Promise<unknown> {
  const resultaat = await metSignal(bouwer, signal);
  if (resultaat.error) throw resultaat.error;
  return resultaat.data;
}

function geldigeDocumentRijen(data: unknown): Array<{
  id: string;
  titel: string;
  agendapunt_id?: string;
}> {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (rij): rij is { id: string; titel?: unknown; agendapunt_id?: unknown } =>
        !!rij && typeof rij === "object" && typeof rij.id === "string"
    )
    .map((rij) => ({
      id: rij.id,
      titel: typeof rij.titel === "string" && rij.titel.length > 0 ? rij.titel : "stuk",
      ...(typeof rij.agendapunt_id === "string"
        ? { agendapunt_id: rij.agendapunt_id }
        : {}),
    }));
}

/**
 * Leest alle actieve primaire en secundaire documentkoppelingen voor één of
 * meer agendapunten. Primaire koppelingen winnen bij een eventueel dubbel paar;
 * de database-trigger voorkomt dat normaal al, maar de read blijft defensief.
 */
export async function haalAgendapuntDocumentKoppelingen(
  lezer: AgendapuntDocumentLezer,
  agendapuntIds: readonly string[],
  signal?: AbortSignal
): Promise<AgendapuntDocumentKoppeling[]> {
  const ids = [...new Set(agendapuntIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return [];

  const [primairRuw, koppelingenRuw] = await Promise.all([
    lees(
      lezer
        .from("documenten")
        .select("id, titel, agendapunt_id")
        .in("agendapunt_id", ids)
        .eq("actief", true),
      signal
    ),
    lees(
      lezer
        .from("document_agendapunten")
        .select("document_id, agendapunt_id")
        .in("agendapunt_id", ids),
      signal
    ),
  ]);

  const primair = geldigeDocumentRijen(primairRuw).filter(
    (rij): rij is AgendapuntDocumentKoppeling =>
      typeof rij.agendapunt_id === "string" && ids.includes(rij.agendapunt_id)
  );

  const koppelingen = Array.isArray(koppelingenRuw)
    ? koppelingenRuw.filter(
        (rij): rij is { document_id: string; agendapunt_id: string } =>
          !!rij &&
          typeof rij === "object" &&
          typeof rij.document_id === "string" &&
          typeof rij.agendapunt_id === "string" &&
          ids.includes(rij.agendapunt_id)
      )
    : [];
  const secundaireIds = [...new Set(koppelingen.map((rij) => rij.document_id))];
  const secundaireDocumenten =
    secundaireIds.length === 0
      ? []
      : geldigeDocumentRijen(
          await lees(
            lezer
              .from("documenten")
              .select("id, titel")
              .in("id", secundaireIds)
              .eq("actief", true),
            signal
          )
        );
  const secundairPerId = new Map(secundaireDocumenten.map((rij) => [rij.id, rij]));

  const resultaat = new Map<string, AgendapuntDocumentKoppeling>();
  for (const rij of primair) {
    resultaat.set(`${rij.agendapunt_id}:${rij.id}`, rij);
  }
  for (const koppeling of koppelingen) {
    const document = secundairPerId.get(koppeling.document_id);
    if (!document) continue;
    const sleutel = `${koppeling.agendapunt_id}:${document.id}`;
    if (!resultaat.has(sleutel)) {
      resultaat.set(sleutel, {
        agendapunt_id: koppeling.agendapunt_id,
        id: document.id,
        titel: document.titel,
      });
    }
  }
  return [...resultaat.values()];
}

export async function haalAgendapuntDocumenten(
  lezer: AgendapuntDocumentLezer,
  agendapuntId: string,
  signal?: AbortSignal
): Promise<AgendapuntDocument[]> {
  const koppelingen = await haalAgendapuntDocumentKoppelingen(
    lezer,
    [agendapuntId],
    signal
  );
  return koppelingen.map(({ id, titel }) => ({ id, titel }));
}

/**
 * B-1: bij een geldig agendapunt is de serveropgeloste set altijd leidend.
 * Een clientscope (ook uit een eerder opgeslagen gesprek) wordt dan genegeerd.
 */
export function bepaalGevraagdeDocumentIds(input: {
  agendapuntModusActief: boolean;
  actueleAgendapuntDocumentIds: readonly string[];
  volledigeAnalyseDocumentId?: string | null;
  clientDocumentIds?: readonly unknown[] | null;
}): string[] {
  if (input.agendapuntModusActief) {
    return [...new Set(input.actueleAgendapuntDocumentIds.filter((id) => id.length > 0))];
  }
  if (input.volledigeAnalyseDocumentId) return [input.volledigeAnalyseDocumentId];
  return [...new Set(
    (input.clientDocumentIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    )
  )];
}
