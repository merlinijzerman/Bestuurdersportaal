export type OutlookGraphFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type OutlookDatumTijd = {
  dateTime?: string;
  timeZone?: string;
};

export type OutlookDeelnemer = {
  emailAddress?: { address?: string | null } | null;
};

export class OutlookGraphError extends Error {
  constructor(readonly categorie: string, cause?: unknown) {
    super(categorie, { cause });
    this.name = "OutlookGraphError";
  }
}

const MAX_RETRY_WACHTTIJD_MS = 30_000;
const MAX_GRAPH_FOUT_BYTES = 8_192;
const GRAPH_V1 = "https://graph.microsoft.com/v1.0";

export function berekenVastOutlookVenster(nu = new Date()): {
  start: string;
  eind: string;
} {
  const start = new Date(nu);
  const eind = new Date(nu);
  start.setUTCDate(start.getUTCDate() - 90);
  eind.setUTCDate(eind.getUTCDate() + 270);
  return {
    start: start.toISOString().slice(0, 10),
    eind: eind.toISOString().slice(0, 10),
  };
}

async function leesBegrensdeGraphFout(
  response: Response,
): Promise<{ code?: string; message?: string } | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const delen: Uint8Array[] = [];
  let totaal = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      totaal += value.byteLength;
      if (totaal > MAX_GRAPH_FOUT_BYTES) {
        await reader.cancel();
        return undefined;
      }
      delen.push(value);
    }
    const bytes = new Uint8Array(totaal);
    let positie = 0;
    for (const deel of delen) { bytes.set(deel, positie); positie += deel.byteLength; }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      error?: { code?: unknown; message?: unknown };
    };
    return {
      code: typeof parsed.error?.code === "string" ? parsed.error.code : undefined,
      message: typeof parsed.error?.message === "string" ? parsed.error.message : undefined,
    };
  } catch {
    return undefined;
  }
}

async function graphFoutcategorie(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) return "toestemming_of_token";
  if (response.status === 429) return "graph_ratelimit";
  if (response.status === 410) return "delta_verlopen";
  if (response.status === 404) return "graph_bron_niet_gevonden";
  if (response.status === 405) return "graph_methode_niet_toegestaan";
  if (response.status >= 500) return "graph_serverfout";
  if (response.status === 400 || response.status === 422) {
    const fout = await leesBegrensdeGraphFout(response);
    const bericht = fout?.message ?? "";
    if (
      /startdatetime.{0,120}enddatetime.{0,120}(required|missing|specified|provided)/i.test(bericht)
      || /enddatetime.{0,120}startdatetime.{0,120}(required|missing|specified|provided)/i.test(bericht)
    ) return "graph_tijdvenster_ontbreekt";
    if (
      /startdatetime.{0,120}(invalid|not valid|iso.?8601|format)/i.test(bericht)
      || /(invalid|not valid).{0,120}startdatetime/i.test(bericht)
    ) return "graph_startdatum_ongeldig";
    if (
      /enddatetime.{0,120}(invalid|not valid|iso.?8601|format)/i.test(bericht)
      || /(invalid|not valid).{0,120}enddatetime/i.test(bericht)
    ) return "graph_einddatum_ongeldig";
    if (
      /(startdatetime|start date).{0,120}(before|earlier|less than).{0,120}(enddatetime|end date)/i.test(bericht)
      || /(enddatetime|end date).{0,120}(after|later|greater than).{0,120}(startdatetime|start date)/i.test(bericht)
    ) return "graph_tijdvenster_volgorde";
    if (
      /(time interval|date range).{0,120}(too large|too long|exceed|maximum|limit)/i.test(bericht)
      || /(maximum|limit).{0,120}(time interval|date range)/i.test(bericht)
    ) return "graph_tijdvenster_te_ruim";
    if (/startdatetime|enddatetime|time interval|date range/i.test(bericht)) {
      return "graph_tijdvenster_ongeldig";
    }
    if (/prefer|header/i.test(bericht)) return "graph_header_ongeldig";
    if (/odata|query/i.test(bericht)) return "graph_query_ongeldig";
    const code = fout?.code?.toLowerCase();
    if (code === "errorinvalidrequest") return "graph_code_errorinvalidrequest";
    if (code === "errorinvalidparameter") return "graph_code_errorinvalidparameter";
    if (code === "invalidargument") return "graph_code_invalidargument";
    if (code === "invalidrequest") return "graph_code_invalidrequest";
    return "graph_verzoek_ongeldig";
  }
  return "graph_response";
}

export function bouwStandaardAgendaDeltaUrl(
  vensterStart: string,
  vensterEind: string,
): URL {
  const url = new URL(`${GRAPH_V1}/me/calendarView/delta`);
  url.searchParams.set("startDateTime", `${vensterStart}T00:00:00Z`);
  url.searchParams.set("endDateTime", `${vensterEind}T00:00:00Z`);
  return url;
}

export function veiligeGraphUrl(url: string): URL {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "graph.microsoft.com"
    || !parsed.pathname.startsWith("/v1.0/")
  ) {
    throw new OutlookGraphError("graph_url");
  }
  return parsed;
}

export function retryNa(response: Response, nuMs = Date.now()): number {
  const raw = response.headers.get("Retry-After")?.trim();
  if (!raw) return 1_000;
  const seconden = Number.parseInt(raw, 10);
  if (Number.isSafeInteger(seconden) && seconden >= 0) {
    return Math.min(seconden * 1_000, MAX_RETRY_WACHTTIJD_MS);
  }
  const datumMs = Date.parse(raw);
  if (Number.isNaN(datumMs)) return 1_000;
  return Math.min(Math.max(datumMs - nuMs, 0), MAX_RETRY_WACHTTIJD_MS);
}

export async function graphGet(
  accessToken: string,
  url: string,
  opties: {
    fetchImpl?: OutlookGraphFetch;
    wacht?: (ms: number) => Promise<void>;
    maxRetries?: number;
  } = {},
): Promise<Response> {
  const veilig = veiligeGraphUrl(url).toString();
  const fetchImpl = opties.fetchImpl ?? ((input, init) => fetch(input, init));
  const wacht = opties.wacht ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = opties.maxRetries ?? 2;

  for (let poging = 0; ; poging += 1) {
    const response = await fetchImpl(veilig, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: 'IdType="ImmutableId"',
      },
      cache: "no-store",
    });
    if (
      (response.status === 429 || response.status === 503 || response.status === 504)
      && poging < maxRetries
    ) {
      await wacht(retryNa(response));
      continue;
    }
    if (!response.ok) {
      throw new OutlookGraphError(await graphFoutcategorie(response));
    }
    return response;
  }
}

export function normaliseerGraphUtc(
  value: OutlookDatumTijd | undefined,
): { iso: string; tijdzone: "Etc/UTC" } | undefined {
  if (!value?.dateTime || value.timeZone?.toUpperCase() !== "UTC") return undefined;
  const raw = value.dateTime.endsWith("Z") ? value.dateTime : `${value.dateTime}Z`;
  const datum = new Date(raw);
  if (Number.isNaN(datum.getTime())) return undefined;
  return { iso: datum.toISOString(), tijdzone: "Etc/UTC" };
}

export function normaliseerSensitivity(
  value: string | undefined,
): "normal" | "personal" | "private" | "confidential" {
  return value === "personal" || value === "private" || value === "confidential"
    ? value
    : "normal";
}

export function projecteerDeelnemers(
  attendees: OutlookDeelnemer[] | undefined,
  userPrincipalName: string | null,
): { huidigeGebruikerIsDeelnemer: boolean; onbekend: number } {
  const adressen = attendees
    ?.map((x) => x.emailAddress?.address?.trim().toLowerCase())
    .filter((x): x is string => !!x) ?? [];
  const eigen = userPrincipalName?.trim().toLowerCase() ?? null;
  return {
    huidigeGebruikerIsDeelnemer: eigen !== null && adressen.includes(eigen),
    onbekend: adressen.filter((x) => x !== eigen).length,
  };
}

export function veiligeTeamsLink(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || !["teams.microsoft.com", "teams.live.com"].includes(url.hostname.toLowerCase())
    ) return "";
    return url.toString();
  } catch {
    return "";
  }
}
