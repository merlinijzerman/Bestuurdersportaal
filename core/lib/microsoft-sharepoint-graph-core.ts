// ============================================================================
//  Microsoft 365 fase 3 (#321) — pure SharePoint/Drive-adapter op Graph v1.0.
// ----------------------------------------------------------------------------
//  Geen server-only imports: alles hier is met een injecteerbare fetch
//  testbaar. De adapter kent uitsluitend https://graph.microsoft.com/v1.0,
//  volgt vervolgpaginering alleen binnen het pad dat de aanroeper verwacht,
//  begrenst timeouts en retries en vertaalt elke storing naar één vaste,
//  inhoudsarme foutcategorie. Tokens, Graph-bodies en preview-URL's komen
//  nooit in de foutobjecten terecht.
// ============================================================================
import { retryNa } from "@/core/lib/microsoft-outlook-graph-core";

export const SHAREPOINT_FOUTCATEGORIEEN = [
  "graph_url",
  "graph_timeout",
  "graph_ratelimit",
  "graph_paginering",
  "graph_response",
  "toestemming_of_token",
  "niet_gevonden",
  "kandidaat_onbekend",
  "site_niet_toegankelijk",
  "drive_niet_toegankelijk",
  "map_niet_toegankelijk",
  "bron_niet_geconfigureerd",
  "bron_niet_toegankelijk",
  "onverwachte_fout",
] as const;
export type SharePointFoutcategorie = typeof SHAREPOINT_FOUTCATEGORIEEN[number];

export class SharePointGraphError extends Error {
  readonly categorie: SharePointFoutcategorie;
  constructor(categorie: SharePointFoutcategorie, cause?: unknown) {
    super(`SharePoint-adapter: ${categorie}`, { cause });
    this.name = "SharePointGraphError";
    this.categorie = categorie;
  }
}

export function sharepointFoutcategorie(fout: unknown): SharePointFoutcategorie {
  return fout instanceof SharePointGraphError ? fout.categorie : "onverwachte_fout";
}

export type GraphFetch = (input: string, init: RequestInit) => Promise<Response>;

export const GRAPH_BASIS = "https://graph.microsoft.com/v1.0";
export const GRAPH_PAGINAGROOTTE = 200;
export const GRAPH_MAX_PAGINAS = 30;
export const GRAPH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Alleen Graph v1.0 over https; alles anders (beta, andere host, http) is een fout. */
export function veiligeSharePointGraphUrl(url: string): URL {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new SharePointGraphError("graph_url"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "graph.microsoft.com" || !parsed.pathname.startsWith("/v1.0/")) {
    throw new SharePointGraphError("graph_url");
  }
  return parsed;
}

/** Een @odata.nextLink komt uit de Graph-respons en wordt nooit blind gevolgd:
 * hij moet binnen hetzelfde pad blijven als de oorspronkelijke opvraag, zodat
 * een gemanipuleerde of cross-tenant vervolglink geen andere drive of site
 * kan ontsluiten. */
export function veiligeVervolgLink(link: string, verwachtPad: string): string {
  const parsed = veiligeSharePointGraphUrl(link);
  const verwacht = veiligeSharePointGraphUrl(verwachtPad).pathname;
  if (parsed.pathname !== verwacht) throw new SharePointGraphError("graph_paginering");
  return parsed.toString();
}

export type GraphJsonOpties = {
  method?: "GET" | "POST";
  body?: unknown;
  fetchImpl?: GraphFetch;
  wacht?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function graphJson<T>(accessToken: string, url: string, opties: GraphJsonOpties = {}): Promise<T> {
  const veilig = veiligeSharePointGraphUrl(url).toString();
  const fetchImpl = opties.fetchImpl ?? ((input, init) => fetch(input, init));
  const wacht = opties.wacht ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = opties.maxRetries ?? 2;
  const timeoutMs = opties.timeoutMs ?? GRAPH_TIMEOUT_MS;
  const method = opties.method ?? "GET";

  for (let poging = 0; ; poging += 1) {
    if (opties.signal?.aborted) throw new SharePointGraphError("graph_timeout");
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opties.signal ? AbortSignal.any([opties.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(veilig, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(opties.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opties.body !== undefined ? JSON.stringify(opties.body) : undefined,
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch (fout) {
      const naam = fout instanceof Error ? fout.name : "";
      if (naam === "AbortError" || naam === "TimeoutError") throw new SharePointGraphError("graph_timeout", fout);
      throw new SharePointGraphError("graph_response", fout);
    }
    if ((response.status === 429 || response.status === 503 || response.status === 504) && poging < maxRetries) {
      await wacht(retryNa(response));
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new SharePointGraphError("toestemming_of_token");
      if (response.status === 404) throw new SharePointGraphError("niet_gevonden");
      if (response.status === 429) throw new SharePointGraphError("graph_ratelimit");
      throw new SharePointGraphError("graph_response");
    }
    const lengte = Number.parseInt(response.headers.get("Content-Length") ?? "0", 10);
    if (Number.isSafeInteger(lengte) && lengte > MAX_BODY_BYTES) throw new SharePointGraphError("graph_response");
    try {
      return await response.json() as T;
    } catch (fout) {
      throw new SharePointGraphError("graph_response", fout);
    }
  }
}

/** Haalt een gepagineerde collectie op binnen een vast pad, met plafond op het
 * aantal pagina's én items. Retourneert of het plafond is geraakt. */
export async function graphCollectie<T>(
  accessToken: string,
  eersteUrl: string,
  opties: GraphJsonOpties & { maxItems?: number; maxPaginas?: number } = {},
): Promise<{ items: T[]; afgekapt: boolean }> {
  const maxItems = opties.maxItems ?? 5_000;
  const maxPaginas = opties.maxPaginas ?? GRAPH_MAX_PAGINAS;
  const items: T[] = [];
  const bezocht = new Set<string>();
  let volgende: string | undefined = veiligeSharePointGraphUrl(eersteUrl).toString();
  for (let pagina = 0; volgende; pagina += 1) {
    if (pagina >= maxPaginas) return { items, afgekapt: true };
    if (bezocht.has(volgende)) throw new SharePointGraphError("graph_paginering");
    bezocht.add(volgende);
    const body: { value?: T[]; "@odata.nextLink"?: string } = await graphJson(accessToken, volgende, opties);
    for (const item of body.value ?? []) {
      if (items.length >= maxItems) return { items, afgekapt: true };
      items.push(item);
    }
    volgende = body["@odata.nextLink"] ? veiligeVervolgLink(body["@odata.nextLink"], eersteUrl) : undefined;
  }
  return { items, afgekapt: false };
}

// ── Normalisatie van Graph-objecten naar minimale, veilige projecties ────────

export type GraphSite = { id?: string; displayName?: string; name?: string; webUrl?: string };
export type GraphDrive = { id?: string; name?: string; driveType?: string; webUrl?: string };
export type GraphDriveItem = {
  id?: string; name?: string; size?: number; eTag?: string; cTag?: string; webUrl?: string;
  lastModifiedDateTime?: string; folder?: { childCount?: number } | null; file?: { mimeType?: string } | null;
  parentReference?: { driveId?: string; id?: string; path?: string } | null;
};

export type SiteProjectie = { siteId: string; weergavenaam: string; hostnaam: string };
export type DriveProjectie = { driveId: string; weergavenaam: string };
export type MapProjectie = { itemId: string; naam: string; aantalKinderen: number };

const HOSTNAAM_PATROON = /^[a-z0-9-]+\.sharepoint\.com$/;
const PAD_PATROON = /^\/[A-Za-z0-9._~/-]*$/;

/** Een geregistreerde kandidaatsite is alleen bruikbaar als hostnaam en pad
 * strikt zijn; de waarden komen uit de private tabel, niet uit de browser. */
export function kandidaatGeldig(hostnaam: string, serverRelatiefPad: string): boolean {
  return HOSTNAAM_PATROON.test(hostnaam) && PAD_PATROON.test(serverRelatiefPad) && !serverRelatiefPad.includes("//") && !serverRelatiefPad.includes("/../");
}

export function siteUrlVoorKandidaat(hostnaam: string, serverRelatiefPad: string): string {
  if (!kandidaatGeldig(hostnaam, serverRelatiefPad)) throw new SharePointGraphError("kandidaat_onbekend");
  const pad = serverRelatiefPad.replace(/\/$/, "");
  return `${GRAPH_BASIS}/sites/${hostnaam}:${pad}?$select=id,displayName,name,webUrl`;
}

/** De site-id van Graph is "hostnaam,guid,guid"; de hostnaam erin moet gelijk
 * zijn aan de geregistreerde kandidaat, anders is de respons niet de site die
 * de beheerder heeft aangewezen. */
export function normaliseerSite(site: GraphSite, verwachteHostnaam: string): SiteProjectie {
  const id = site.id?.trim() ?? "";
  const hostnaamUitId = id.split(",")[0]?.toLowerCase() ?? "";
  let hostnaamUitUrl = "";
  try { hostnaamUitUrl = site.webUrl ? new URL(site.webUrl).hostname.toLowerCase() : ""; } catch { hostnaamUitUrl = ""; }
  if (!id || id.split(",").length !== 3 || hostnaamUitId !== verwachteHostnaam.toLowerCase() || (hostnaamUitUrl && hostnaamUitUrl !== verwachteHostnaam.toLowerCase())) {
    throw new SharePointGraphError("site_niet_toegankelijk");
  }
  return { siteId: id, weergavenaam: (site.displayName ?? site.name ?? "SharePoint-site").slice(0, 160), hostnaam: verwachteHostnaam.toLowerCase() };
}

export function normaliseerDrives(drives: GraphDrive[]): DriveProjectie[] {
  const uniek = new Map<string, string>();
  for (const drive of drives) {
    if (drive.id && drive.driveType === "documentLibrary") uniek.set(drive.id, (drive.name ?? "Documentbibliotheek").slice(0, 160));
  }
  return [...uniek].map(([driveId, weergavenaam]) => ({ driveId, weergavenaam }));
}

/** Alleen mappen die aantoonbaar in de opgegeven drive liggen; bestanden en
 * items met een afwijkende parentReference vallen af. */
export function normaliseerMappen(items: GraphDriveItem[], driveId: string): MapProjectie[] {
  const uniek = new Map<string, MapProjectie>();
  for (const item of items) {
    if (!item.id || !item.folder || !item.name) continue;
    if (item.parentReference?.driveId && item.parentReference.driveId !== driveId) continue;
    uniek.set(item.id, { itemId: item.id, naam: item.name.slice(0, 160), aantalKinderen: Math.max(0, item.folder.childCount ?? 0) });
  }
  return [...uniek.values()];
}

export function drivesUrl(siteId: string): string {
  return `${GRAPH_BASIS}/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,driveType,webUrl&$top=${GRAPH_PAGINAGROOTTE}`;
}
export function driveRootUrl(driveId: string): string {
  return `${GRAPH_BASIS}/drives/${encodeURIComponent(driveId)}/root?$select=id,name,folder,parentReference`;
}
export function kinderenUrl(driveId: string, ouderItemId: string | null): string {
  const basis = `${GRAPH_BASIS}/drives/${encodeURIComponent(driveId)}`;
  const pad = ouderItemId ? `/items/${encodeURIComponent(ouderItemId)}/children` : "/root/children";
  return `${basis}${pad}?$select=id,name,folder,file,size,eTag,cTag,lastModifiedDateTime,parentReference&$top=${GRAPH_PAGINAGROOTTE}`;
}
