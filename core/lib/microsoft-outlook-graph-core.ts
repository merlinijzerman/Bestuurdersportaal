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
        Prefer: 'IdType="ImmutableId", outlook.timezone="UTC", odata.maxpagesize=50',
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
      if (response.status === 401 || response.status === 403) {
        throw new OutlookGraphError("toestemming_of_token");
      }
      if (response.status === 429) throw new OutlookGraphError("graph_ratelimit");
      if (response.status === 410) throw new OutlookGraphError("delta_verlopen");
      throw new OutlookGraphError("graph_response");
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
