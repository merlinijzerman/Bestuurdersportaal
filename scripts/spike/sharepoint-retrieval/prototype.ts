import { createHash } from "node:crypto";
import { extractTekst, type Bestandstype, type TekstSegment } from "../../../core/lib/document-extractie";
import type {
  AdapterCapabilities,
  AdapterUitkomst,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalFoutcategorie,
  RetrievalQuery,
} from "../../../core/lib/retrieval/contract";
import type {
  DelegatedToken,
  GraphMeting,
  PermissionProbeUitkomst,
  SpikeBronresultaat,
  SpikeBronSnapshot,
  SpikeDocumentMapping,
  SpikeError as SpikeErrorType,
  SpikeFase,
  SpikeRoute,
  SpikeUitkomst,
  SpikeVraag,
  VeiligeMeetrij,
} from "./types";
import { SpikeError } from "./types";

const GRAPH_BASIS = "https://graph.microsoft.com/v1.0";
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT_BYTES = 25 * 1024 * 1024;
const MAX_PAGINAS = 3;
const MAX_CONCURRENCY = 3;
const MAX_PASSAGE_TEKENS = 1_200;
const MAX_RETRIES = 2;

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;
export interface SpikeDependencies {
  leesBron: () => Promise<SpikeBronSnapshot>;
  delegatedToken: () => Promise<DelegatedToken>;
  fetchImpl?: FetchImpl;
  klok?: () => number;
  nu?: () => Date;
  wacht?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Alleen voor hermetische intrekkings- en drifttests. */
  onFase?: (fase: SpikeFase, document?: SpikeDocumentMapping) => Promise<void>;
}

export interface SpikeOpdracht {
  route: SpikeRoute;
  correlationId: string;
  vraag: SpikeVraag;
  signal?: AbortSignal;
  timeoutMs?: number;
  concurrency?: number;
}

export interface PermissionProbeOpdracht {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type GraphDriveItem = {
  id?: string;
  name?: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string } | null;
  folder?: { childCount?: number } | null;
  parentReference?: { driveId?: string; id?: string; path?: string; siteId?: string } | null;
};

type ZoekHit = { itemId: string; positie: number; score: number | null; summary: string | null };

function nieuweMeting(): GraphMeting {
  return { calls: 0, responseBytes: 0, contentBytes: 0, throttles: 0, retries: 0 };
}

function veiligeGraphUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new SpikeError("providerfout", "ongeldige_graph_url", { cause });
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "graph.microsoft.com" || !parsed.pathname.startsWith("/v1.0/")) {
    throw new SpikeError("providerfout", "ongeldige_graph_url");
  }
  return parsed;
}

function veiligeSharePointUrl(url: string | undefined, hostnaam: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (parsed.hostname.toLowerCase() !== hostnaam.toLowerCase()) return null;
    if (!/^[a-z0-9-]+\.sharepoint\.com$/.test(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function veiligeMicrosoftDownloadUrl(url: string | null, sharePointHostnaam: string): URL {
  let parsed: URL;
  try {
    if (!url) throw new Error("ontbrekende Location-header");
    parsed = new URL(url);
  } catch (cause) {
    throw new SpikeError("providerfout", "ongeldige_download_url", { cause });
  }
  const host = parsed.hostname.toLowerCase();
  const isEigenSharePointHost = host === sharePointHostnaam.toLowerCase();
  const isMicrosoftDownloadCdn = /^[a-z0-9-]+\.files\.1drv\.com$/.test(host);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || parsed.hash
    || (!isEigenSharePointHost && !isMicrosoftDownloadCdn)
  ) throw new SpikeError("providerfout", "ongeldige_download_url");
  return parsed;
}

function retryNa(response: Response): number {
  const header = response.headers.get("Retry-After");
  const seconden = Number.parseInt(header ?? "", 10);
  if (Number.isFinite(seconden) && seconden >= 0) return Math.min(seconden * 1_000, 5_000);
  return 250;
}

export function standaardWacht(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new SpikeError("annulering", "graph_annulering"));
      return;
    }
    let afgerond = false;
    let timer: ReturnType<typeof setTimeout>;
    const opruimen = () => signal.removeEventListener("abort", bijAfbreken);
    function bijAfbreken() {
      if (afgerond) return;
      afgerond = true;
      clearTimeout(timer);
      opruimen();
      reject(new SpikeError("annulering", "graph_annulering"));
    }
    timer = setTimeout(() => {
      if (afgerond) return;
      afgerond = true;
      opruimen();
      resolve();
    }, ms);
    signal.addEventListener("abort", bijAfbreken, { once: true });
  });
}

async function leesBegrensd(response: Response, maxBytes: number): Promise<Uint8Array> {
  const lengte = Number.parseInt(response.headers.get("Content-Length") ?? "0", 10);
  if (Number.isSafeInteger(lengte) && lengte > maxBytes) throw new SpikeError("providerfout", "graph_response");
  if (!response.body) throw new SpikeError("providerfout", "graph_response");
  const reader = response.body.getReader();
  const delen: Uint8Array[] = [];
  let totaal = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totaal += value.byteLength;
      if (totaal > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SpikeError("providerfout", "graph_response");
      }
      delen.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const resultaat = new Uint8Array(totaal);
  let offset = 0;
  for (const deel of delen) {
    resultaat.set(deel, offset);
    offset += deel.byteLength;
  }
  return resultaat;
}

function normaliseerHttpFout(response: Response): SpikeError {
  if (response.status === 401 || response.status === 403) return new SpikeError("toestemming_geweigerd", "graph_toestemming");
  if (response.status === 404) return new SpikeError("buiten_scope", "document_verwijderd");
  if (response.status === 412) return new SpikeError("buiten_scope", "document_gewijzigd");
  if (response.status === 429) return new SpikeError("rate_limit", "graph_ratelimit");
  return new SpikeError("providerfout", "graph_response");
}

class GraphClient {
  readonly meting = nieuweMeting();

  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchImpl,
    private readonly signal: AbortSignal,
    private readonly timeoutMs: number,
    private readonly wacht: (ms: number, signal: AbortSignal) => Promise<void>,
  ) {}

  private async request(url: string, init: RequestInit, soort: "json" | "content_redirect"): Promise<Response> {
    const veilig = veiligeGraphUrl(url).toString();
    for (let poging = 0; ; poging += 1) {
      if (this.signal.aborted) throw new SpikeError("annulering", "graph_annulering");
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = AbortSignal.any([this.signal, timeout]);
      let response: Response;
      try {
        this.meting.calls += 1;
        response = await this.fetchImpl(veilig, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: soort === "json" ? "application/json" : "application/octet-stream",
            ...(init.headers ?? {}),
          },
          cache: "no-store",
          redirect: soort === "content_redirect" ? "manual" : "error",
          signal,
        });
      } catch (cause) {
        if (this.signal.aborted) throw new SpikeError("annulering", "graph_annulering", { cause });
        const naam = cause instanceof Error ? cause.name : "";
        if (naam === "AbortError" || naam === "TimeoutError") throw new SpikeError("timeout", "graph_timeout", { cause });
        throw new SpikeError("providerfout", "graph_response", { cause });
      }
      if (response.status === 429) this.meting.throttles += 1;
      if ((response.status === 429 || response.status === 503 || response.status === 504) && poging < MAX_RETRIES) {
        this.meting.retries += 1;
        await this.wacht(retryNa(response), this.signal);
        continue;
      }
      if (soort === "content_redirect" && response.status === 302) return response;
      if (!response.ok) throw normaliseerHttpFout(response);
      if (soort === "content_redirect") throw new SpikeError("providerfout", "ongeldige_download_url");
      return response;
    }
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(url, init, "json");
    const bytes = await leesBegrensd(response, MAX_JSON_BYTES);
    this.meting.responseBytes += bytes.byteLength;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch (cause) {
      throw new SpikeError("providerfout", "graph_response", { cause });
    }
  }

  async content(url: string, sharePointHostnaam: string): Promise<Buffer> {
    const redirect = await this.request(url, {}, "content_redirect");
    const downloadUrl = veiligeMicrosoftDownloadUrl(redirect.headers.get("Location"), sharePointHostnaam);
    if (this.signal.aborted) throw new SpikeError("annulering", "graph_annulering");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([this.signal, timeout]);
    let response: Response;
    try {
      this.meting.calls += 1;
      response = await this.fetchImpl(downloadUrl.toString(), {
        headers: { Accept: "application/octet-stream" },
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch (cause) {
      if (this.signal.aborted) throw new SpikeError("annulering", "graph_annulering", { cause });
      const naam = cause instanceof Error ? cause.name : "";
      if (naam === "AbortError" || naam === "TimeoutError") throw new SpikeError("timeout", "graph_timeout", { cause });
      throw new SpikeError("providerfout", "graph_response", { cause });
    }
    if (!response.ok) throw normaliseerHttpFout(response);
    const bytes = await leesBegrensd(response, MAX_CONTENT_BYTES);
    this.meting.contentBytes += bytes.byteLength;
    return Buffer.from(bytes);
  }
}

function bronVingerafdruk(bron: SpikeBronSnapshot): string {
  const docs = [...bron.documenten]
    .map((doc) => [doc.ref, doc.itemId, doc.fixtureCode, doc.titel, doc.bestandstype, doc.geregistreerdMappad ?? "", doc.verwachteMappad ?? ""].join("\u0000"))
    .sort()
    .join("\u0001");
  return [bron.fondsId, bron.actorId, bron.microsoftActorObjectId, bron.tenantId, bron.bronId, bron.status, bron.configuratieversie, bron.siteId, bron.siteHostnaam, bron.driveId, bron.driveNaam, bron.rootItemId, docs].join("\u0002");
}

function valideerBron(bron: SpikeBronSnapshot): void {
  if (bron.status !== "actief" || bron.configuratieversie < 1 || !bron.fondsId || !bron.actorId || !bron.microsoftActorObjectId || !bron.tenantId || !bron.bronId || !bron.siteId || !bron.driveId || !bron.rootItemId) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }
  if (!/^[a-z0-9-]+\.sharepoint\.com$/.test(bron.siteHostnaam)) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }
}

function eTagVan(item: GraphDriveItem): { soort: "etag" | "ctag"; waarde: string } {
  const etag = item.eTag?.trim();
  if (etag) return { soort: "etag", waarde: etag };
  const ctag = item.cTag?.trim();
  if (ctag) return { soort: "ctag", waarde: ctag };
  throw new SpikeError("versiebewijs_ontbreekt", "versie_ontbreekt");
}

function itemGeldig(item: GraphDriveItem, bron: SpikeBronSnapshot, mapping: SpikeDocumentMapping, rootWebUrl: string): boolean {
  if (item.id !== mapping.itemId || item.parentReference?.driveId !== bron.driveId || !item.file) return false;
  const veiligItem = item.webUrl ? veiligeSharePointUrl(item.webUrl, bron.siteHostnaam) : null;
  if (!veiligItem) return false;
  try {
    const itemUrl = new URL(veiligItem);
    const rootUrl = new URL(rootWebUrl);
    const rootPad = decodeURIComponent(rootUrl.pathname).replace(/\/$/, "");
    const itemPad = decodeURIComponent(itemUrl.pathname);
    return itemUrl.origin === rootUrl.origin && itemPad.startsWith(`${rootPad}/`);
  } catch {
    return false;
  }
}

function mappadVanItem(item: GraphDriveItem, rootWebUrl: string): string {
  if (!item.webUrl) return "";
  const itemPad = decodeURIComponent(new URL(item.webUrl).pathname);
  const rootPad = decodeURIComponent(new URL(rootWebUrl).pathname).replace(/\/$/, "");
  const relatief = itemPad.slice(rootPad.length + 1);
  const delen = relatief.split("/").filter(Boolean);
  return delen.slice(0, -1).join("/").slice(0, 1_000);
}

function escapeKql(waarde: string): string {
  return waarde.replace(/["\\]/g, (teken) => `\\${teken}`).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function schoneSummary(summary: string | null): string {
  return (summary ?? "")
    .replace(/<c\d+>/gi, "")
    .replace(/<\/c\d+>/gi, "")
    .replace(/<ddd\s*\/>/gi, " … ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PASSAGE_TEKENS);
}

function zoektermen(vraag: string): string[] {
  return [...new Set(vraag.toLocaleLowerCase("nl").normalize("NFKD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
}

function passageUitSegmenten(segmenten: TekstSegment[], vraag: string): { passage: string; pagina: number | null; paragraaf: string | null } | null {
  const termen = zoektermen(vraag);
  const kandidaten = segmenten.flatMap((segment, segmentIndex) => {
    const delen = segment.pagina === null
      ? segment.tekst.split(/\n\s*\n+/).map((tekst, index) => ({ tekst, paragraaf: `Alinea ${index + 1}` }))
      : [{ tekst: segment.tekst, paragraaf: segment.paragraaf }];
    return delen.map((deel, deelIndex) => {
      const normaal = deel.tekst.toLocaleLowerCase("nl").normalize("NFKD").replace(/\p{M}/gu, "");
      const score = termen.reduce((som, term) => som + (normaal.includes(term) ? 1 : 0), 0);
      return { ...deel, pagina: segment.pagina, score, index: segmentIndex * 10_000 + deelIndex };
    });
  }).filter((kandidaat) => kandidaat.tekst.trim().length > 0);
  kandidaten.sort((a, b) => b.score - a.score || a.index - b.index);
  const beste = kandidaten[0];
  if (!beste || beste.score === 0) return null;
  const tekst = beste.tekst.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const eersteTreffer = termen.map((term) => tekst.toLocaleLowerCase("nl").indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const begin = Math.max(0, eersteTreffer - 300);
  return {
    passage: tekst.slice(begin, begin + MAX_PASSAGE_TEKENS),
    pagina: beste.pagina,
    paragraaf: beste.paragraaf,
  };
}

function bestandstypeVoorExtractie(mapping: SpikeDocumentMapping): Bestandstype {
  if (mapping.bestandstype === "docx" || mapping.bestandstype === "pdf" || mapping.bestandstype === "pptx") return mapping.bestandstype;
  throw new SpikeError("onondersteund_bestand", "extractie_leeg");
}

async function parallelBegrensd<T, R>(items: T[], limiet: number, werk: (item: T) => Promise<R | null>): Promise<R[]> {
  const resultaat: R[] = [];
  let volgende = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limiet), items.length) }, async () => {
    for (;;) {
      const index = volgende++;
      if (index >= items.length) return;
      const waarde = await werk(items[index]);
      if (waarde !== null) resultaat.push(waarde);
    }
  });
  await Promise.all(workers);
  return resultaat;
}

async function zoekViaMicrosoftSearch(client: GraphClient, vraag: string, rootWebUrl: string, maxKandidaten: number): Promise<ZoekHit[]> {
  const hits: ZoekHit[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS && hits.length < maxKandidaten; pagina += 1) {
    const size = Math.min(50, maxKandidaten - hits.length);
    const body = await client.json<{
      value?: Array<{ hitsContainers?: Array<{ moreResultsAvailable?: boolean; hits?: Array<{ hitId?: string; rank?: number; summary?: string; resource?: GraphDriveItem }> }> }>;
    }>(`${GRAPH_BASIS}/search/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{
        entityTypes: ["driveItem"],
        query: { queryString: `${escapeKql(vraag)} path:"${escapeKql(rootWebUrl)}" isDocument=true` },
        from: pagina * 50,
        size,
        fields: ["id", "name", "webUrl", "parentReference", "file", "size", "lastModifiedDateTime", "eTag", "cTag"],
      }] }),
    });
    const container = body.value?.[0]?.hitsContainers?.[0];
    for (const hit of container?.hits ?? []) {
      const itemId = hit.resource?.id ?? hit.hitId;
      if (itemId) hits.push({ itemId, positie: hit.rank ?? hits.length + 1, score: hit.rank ? 1 / hit.rank : null, summary: hit.summary ?? null });
    }
    if (!container?.moreResultsAvailable) break;
  }
  return hits.slice(0, maxKandidaten);
}

async function zoekViaDrive(client: GraphClient, bron: SpikeBronSnapshot, vraag: string, maxKandidaten: number): Promise<ZoekHit[]> {
  const gecodeerdeVraag = encodeURIComponent(vraag.replace(/'/g, "''")).replace(/'/g, "%27");
  const pad = `/drives/${encodeURIComponent(bron.driveId)}/items/${encodeURIComponent(bron.rootItemId)}/search(q='${gecodeerdeVraag}')`;
  const eerste = `${GRAPH_BASIS}${pad}?$select=id,name,size,file,eTag,cTag,lastModifiedDateTime,parentReference,webUrl&$top=${Math.min(50, maxKandidaten)}`;
  const verwachtPad = veiligeGraphUrl(eerste).pathname;
  let volgende: string | undefined = eerste;
  const hits: ZoekHit[] = [];
  for (let pagina = 0; volgende && pagina < MAX_PAGINAS && hits.length < maxKandidaten; pagina += 1) {
    const body = await client.json<{ value?: GraphDriveItem[]; "@odata.nextLink"?: string }>(volgende);
    for (const item of body.value ?? []) if (item.id) hits.push({ itemId: item.id, positie: hits.length + 1, score: null, summary: null });
    if (body["@odata.nextLink"]) {
      const parsed = veiligeGraphUrl(body["@odata.nextLink"]);
      if (parsed.pathname !== verwachtPad) throw new SpikeError("providerfout", "onveilig_vervolgpad");
      volgende = parsed.toString();
    } else {
      volgende = undefined;
    }
  }
  return hits.slice(0, maxKandidaten);
}

function itemUrl(bron: SpikeBronSnapshot, itemId: string): string {
  return `${GRAPH_BASIS}/drives/${encodeURIComponent(bron.driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,folder,eTag,cTag,lastModifiedDateTime,parentReference,webUrl`;
}

function contentUrl(bron: SpikeBronSnapshot, itemId: string): string {
  return `${GRAPH_BASIS}/drives/${encodeURIComponent(bron.driveId)}/items/${encodeURIComponent(itemId)}/content`;
}

function previewUrl(bron: SpikeBronSnapshot, itemId: string): string {
  return `${GRAPH_BASIS}/drives/${encodeURIComponent(bron.driveId)}/items/${encodeURIComponent(itemId)}/preview`;
}

async function maakKandidaat(
  client: GraphClient,
  deps: SpikeDependencies,
  opdracht: SpikeOpdracht,
  bronEerst: SpikeBronSnapshot,
  bronFingerprint: string,
  rootWebUrl: string,
  mapping: SpikeDocumentMapping,
  hit: ZoekHit,
): Promise<SpikeBronresultaat | null> {
  const eersteCheck = await client.json<GraphDriveItem>(itemUrl(bronEerst, mapping.itemId));
  if (!itemGeldig(eersteCheck, bronEerst, mapping, rootWebUrl)) return null;
  const eersteVersie = eTagVan(eersteCheck);
  await deps.onFase?.("na_eerste_rechtencheck", mapping);

  let passage: string;
  let pagina: number | null = null;
  let paragraaf: string | null = null;
  if (opdracht.route === "microsoft_search") {
    passage = schoneSummary(hit.summary);
    if (!passage) return null;
  } else {
    const bytes = await client.content(contentUrl(bronEerst, mapping.itemId), bronEerst.siteHostnaam);
    try {
      const extractie = await extractTekst(bytes, bestandstypeVoorExtractie(mapping));
      const gevonden = passageUitSegmenten(extractie.segmenten, opdracht.vraag.vraag);
      if (!gevonden) return null;
      ({ passage, pagina, paragraaf } = gevonden);
    } finally {
      bytes.fill(0);
    }
  }
  await deps.onFase?.("na_content", mapping);
  await deps.onFase?.("voor_laatste_rechtencheck", mapping);

  const gecontroleerdOp = (deps.nu ?? (() => new Date()))().toISOString();
  const laatsteCheck = await client.json<GraphDriveItem>(itemUrl(bronEerst, mapping.itemId));
  if (!itemGeldig(laatsteCheck, bronEerst, mapping, rootWebUrl)) return null;
  const laatsteVersie = eTagVan(laatsteCheck);
  if (laatsteVersie.soort !== eersteVersie.soort || laatsteVersie.waarde !== eersteVersie.waarde) {
    throw new SpikeError("buiten_scope", "document_gewijzigd");
  }

  const bronLaatste = await deps.leesBron();
  valideerBron(bronLaatste);
  if (bronVingerafdruk(bronLaatste) !== bronFingerprint) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }

  const preview = await client.json<{ getUrl?: string }>(previewUrl(bronEerst, mapping.itemId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!veiligeSharePointUrl(preview.getUrl, bronEerst.siteHostnaam)) {
    throw new SpikeError("providerfout", "ongeldige_preview_url");
  }
  await deps.onFase?.("voor_toelating", mapping);
  const bronVoorToelating = await deps.leesBron();
  if (bronVingerafdruk(bronVoorToelating) !== bronFingerprint) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }

  return {
    ref: mapping.ref,
    fixtureCode: mapping.fixtureCode,
    bronsoort: "sharepoint",
    titel: (laatsteCheck.name ?? mapping.titel).slice(0, 240),
    documentIdentiteit: {
      documentId: mapping.ref,
      bibliotheek: bronEerst.driveNaam,
      bron: bronEerst.bronId,
      fondsId: bronEerst.fondsId,
    },
    versie: { ...laatsteVersie, gecontroleerdOp },
    toegangscontrole: {
      toegestaan: true,
      gebruikerId: bronEerst.actorId,
      correlationId: opdracht.correlationId,
      gecontroleerdOp,
      basis: "delegated_user",
      bronconfiguratieVersie: bronEerst.configuratieversie,
    },
    locator: { pagina, paragraaf, mappad: mappadVanItem(laatsteCheck, rootWebUrl) },
    passage,
    status: { bronstatus: "actief", actueel: true },
    rang: { positie: hit.positie, score: hit.score },
    previewMogelijk: true,
    weergave: {
      bestandstype: mapping.bestandstype,
      documentdatum: laatsteCheck.lastModifiedDateTime ?? null,
    },
  };
}

function alsSpikeError(fout: unknown): SpikeErrorType {
  return fout instanceof SpikeError ? fout : new SpikeError("providerfout", "graph_response", { cause: fout });
}

/**
 * Hoofdingang van de niet-aangesloten adapter. Elke fout levert nul kandidaten;
 * er bestaat hier geen providerfallback en er wordt geen modelcontext gebouwd.
 */
export async function voerSharePointRetrievalSpikeUit(deps: SpikeDependencies, opdracht: SpikeOpdracht): Promise<SpikeUitkomst> {
  const klok = deps.klok ?? (() => performance.now());
  const start = klok();
  const meting = nieuweMeting();
  let client: GraphClient | undefined;
  try {
    const bron = await deps.leesBron();
    valideerBron(bron);
    const token = await deps.delegatedToken();
    if (!token.accessToken || token.tenantId !== bron.tenantId || token.actorObjectId !== bron.microsoftActorObjectId) {
      throw new SpikeError("buiten_scope", "actor_of_tenant_mismatch");
    }

    const deadline = AbortSignal.timeout(opdracht.timeoutMs ?? 15_000);
    const signal = opdracht.signal ? AbortSignal.any([opdracht.signal, deadline]) : deadline;
    const graphClient = new GraphClient(
      token.accessToken,
      deps.fetchImpl ?? ((input, init) => fetch(input, init)),
      signal,
      opdracht.timeoutMs ?? 15_000,
      deps.wacht ?? standaardWacht,
    );
    client = graphClient;

    const root = await graphClient.json<GraphDriveItem>(itemUrl(bron, bron.rootItemId));
    const rootWebUrl = veiligeSharePointUrl(root.webUrl, bron.siteHostnaam);
    if (!root.id || !root.folder || root.id !== bron.rootItemId || !rootWebUrl) {
      throw new SpikeError("buiten_scope", "document_buiten_bron");
    }
    const maxKandidaten = Math.min(Math.max(1, opdracht.vraag.maxKandidaten ?? 20), 50);
    const hits = opdracht.route === "microsoft_search"
      ? await zoekViaMicrosoftSearch(graphClient, opdracht.vraag.vraag, rootWebUrl, maxKandidaten)
      : await zoekViaDrive(graphClient, bron, opdracht.vraag.vraag, maxKandidaten);
    await deps.onFase?.("na_zoeken");

    const mappingPerItem = new Map(bron.documenten.map((doc) => [doc.itemId, doc]));
    const bekendeHits = hits.flatMap((hit) => {
      const mapping = mappingPerItem.get(hit.itemId);
      return mapping ? [{ hit, mapping }] : [];
    });
    const fingerprint = bronVingerafdruk(bron);
    const kandidaten = await parallelBegrensd(
      bekendeHits,
      Math.min(Math.max(1, opdracht.concurrency ?? MAX_CONCURRENCY), MAX_CONCURRENCY),
      async ({ hit, mapping }) => maakKandidaat(graphClient, deps, opdracht, bron, fingerprint, rootWebUrl, mapping, hit),
    );
    kandidaten.sort((a, b) => a.rang.positie - b.rang.positie || a.ref.localeCompare(b.ref));
    Object.assign(meting, graphClient.meting);
    return {
      route: opdracht.route,
      provider: "microsoft",
      methode: "sharepoint_live",
      kandidaten,
      latencyMs: Math.max(0, Math.round(klok() - start)),
      ...(kandidaten.length === 0 ? { fout: "geen_resultaten" as const } : {}),
      meting,
    };
  } catch (fout) {
    if (client) Object.assign(meting, client.meting);
    let veilig = alsSpikeError(fout);
    if (veilig.categorie === "annulering" && !opdracht.signal?.aborted) {
      veilig = new SpikeError("timeout", "graph_timeout");
    }
    return {
      route: opdracht.route,
      provider: "microsoft",
      methode: "sharepoint_live",
      kandidaten: [],
      latencyMs: Math.max(0, Math.round(klok() - start)),
      fout: veilig.categorie,
      foutcode: veilig.code,
      meting,
    };
  }
}

/**
 * Eén inhoudsvrije drive/root-search om het bestaande delegated permissionprofiel
 * live te toetsen. Hits worden genegeerd en private identifiers worden niet
 * geretourneerd of gelogd.
 */
export async function voerSharePointPermissionProbeUit(
  deps: SpikeDependencies,
  opdracht: PermissionProbeOpdracht = {},
): Promise<PermissionProbeUitkomst> {
  const klok = deps.klok ?? (() => performance.now());
  const start = klok();
  let client: GraphClient | undefined;
  try {
    const bron = await deps.leesBron();
    valideerBron(bron);
    const token = await deps.delegatedToken();
    if (!token.accessToken || token.tenantId !== bron.tenantId || token.actorObjectId !== bron.microsoftActorObjectId) {
      throw new SpikeError("buiten_scope", "actor_of_tenant_mismatch");
    }
    const timeoutMs = opdracht.timeoutMs ?? 15_000;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = opdracht.signal ? AbortSignal.any([opdracht.signal, deadline]) : deadline;
    client = new GraphClient(
      token.accessToken,
      deps.fetchImpl ?? ((input, init) => fetch(input, init)),
      signal,
      timeoutMs,
      deps.wacht ?? standaardWacht,
    );
    const probeTerm = "m365-permission-probe-7f4c1d9e-no-match";
    const gecodeerdeVraag = encodeURIComponent(probeTerm).replace(/'/g, "%27");
    const url = `${GRAPH_BASIS}/drives/${encodeURIComponent(bron.driveId)}/items/${encodeURIComponent(bron.rootItemId)}/search(q='${gecodeerdeVraag}')?$select=id&$top=1`;
    await client.json<{ value?: Array<{ id?: string }> }>(url);
    return {
      status: "toegestaan",
      latencyMs: Math.max(0, Math.round(klok() - start)),
      microsoftCalls: client.meting.calls,
    };
  } catch (fout) {
    let veilig = alsSpikeError(fout);
    if (veilig.categorie === "annulering" && !opdracht.signal?.aborted) {
      veilig = new SpikeError("timeout", "graph_timeout");
    }
    return {
      status: veilig.categorie,
      latencyMs: Math.max(0, Math.round(klok() - start)),
      microsoftCalls: client?.meting.calls ?? 0,
    };
  }
}

function verhouding(teller: number, noemer: number): number {
  return noemer === 0 ? 1 : Number((teller / noemer).toFixed(3));
}

/** Maakt uitsluitend inhoudsvrij, commitbaar meetbewijs. */
export function maakVeiligeMeetrij(ronde: number, vraag: SpikeVraag, uitkomst: SpikeUitkomst): VeiligeMeetrij {
  const gevonden = [...new Set(uitkomst.kandidaten.map((k) => k.fixtureCode))].sort();
  const verwacht = new Set(vraag.verwachteFixtures);
  const raak = gevonden.filter((code) => verwacht.has(code)).length;
  return {
    ronde,
    vraagcode: vraag.code,
    route: uitkomst.route,
    resultaat: uitkomst.kandidaten.length > 0 ? "geslaagd" : uitkomst.fout === "geen_resultaten" ? "geen_resultaten" : "mislukt",
    foutcategorie: uitkomst.fout ?? null,
    foutcode: uitkomst.foutcode ?? null,
    gevondenFixtures: gevonden,
    recall: verhouding(raak, verwacht.size),
    locatorDekking: verhouding(uitkomst.kandidaten.filter((k) => k.locator.pagina !== null || k.locator.paragraaf !== null || Boolean(k.locator.mappad?.length)).length, uitkomst.kandidaten.length),
    versieDekking: verhouding(uitkomst.kandidaten.filter((k) => Boolean(k.versie.waarde && k.versie.gecontroleerdOp)).length, uitkomst.kandidaten.length),
    previewDekking: verhouding(uitkomst.kandidaten.filter((k) => k.previewMogelijk).length, uitkomst.kandidaten.length),
    latencyMs: uitkomst.latencyMs,
    microsoftCalls: uitkomst.meting.calls,
    responseBytes: uitkomst.meting.responseBytes,
    contentBytes: uitkomst.meting.contentBytes,
    throttles: uitkomst.meting.throttles,
    retries: uitkomst.meting.retries,
    versieVingerafdrukken: uitkomst.kandidaten.map((k) => createHash("sha256").update(k.versie.waarde).digest("hex").slice(0, 12)).sort(),
  };
}

const CONTRACT_CAPABILITIES: AdapterCapabilities = {
  bronsoorten: ["sharepoint"],
  strategieen: ["gericht", "volledig", "vergelijk"],
  ondersteundeFilters: [],
  versiebewijs: true,
  permissionProof: true,
  preview: true,
  cancellation: true,
  timeout: true,
};

function contractFout(fout: SpikeUitkomst["fout"]): RetrievalFoutcategorie | undefined {
  if (!fout) return undefined;
  if (fout === "versiebewijs_ontbreekt" || fout === "onondersteund_bestand") return "providerfout";
  return fout;
}

/**
 * Compile-time en runtime brug naar het definitieve contract uit PR #352.
 * Deze brug is alleen voor de spike; de boundarygate verbiedt productie-imports.
 */
export function alsContractUitkomst(uitkomst: SpikeUitkomst): AdapterUitkomst {
  const fout = contractFout(uitkomst.fout);
  return {
    kandidaten: uitkomst.kandidaten,
    methode: uitkomst.methode,
    provider: uitkomst.provider,
    latencyMs: uitkomst.latencyMs,
    opgehaald: uitkomst.kandidaten.length,
    ...(fout ? { fout } : {}),
    ...(fout === "timeout" ? { truncatie: { reden: "tijd" as const } } : {}),
    ...(fout === "annulering" ? { truncatie: { reden: "annulering" as const } } : {}),
  };
}

/**
 * Niet-aangesloten RetrievalAdapter voor contracttests en de live spike.
 * Geen enkele productiecompositie importeert deze factory.
 */
export function maakSharePointSpikeContractAdapter(deps: SpikeDependencies, route: SpikeRoute): RetrievalAdapter {
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => ({ ...CONTRACT_CAPABILITIES }),
    async zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst> {
      const actorId = ctx.actor.soort === "gebruiker" ? ctx.actor.id : null;
      const ondersteuntStrategie = CONTRACT_CAPABILITIES.strategieen.includes(query.strategie);
      const heeftFilter = query.filters !== undefined && Object.keys(query.filters).length > 0;
      if (!actorId || !ctx.bronbeleid.bronsoorten.includes("sharepoint") || !ondersteuntStrategie || heeftFilter) {
        return {
          kandidaten: [],
          methode: "sharepoint_live",
          provider: "microsoft",
          latencyMs: 0,
          opgehaald: 0,
          fout: actorId ? "configuratiefout" : "buiten_scope",
        };
      }
      const gecontroleerdeDeps: SpikeDependencies = {
        ...deps,
        leesBron: async () => {
          const bron = await deps.leesBron();
          if (bron.fondsId !== ctx.fondsId || bron.actorId !== actorId) {
            throw new SpikeError("buiten_scope", "actor_of_tenant_mismatch");
          }
          return bron;
        },
      };
      return alsContractUitkomst(await voerSharePointRetrievalSpikeUit(gecontroleerdeDeps, {
        route,
        correlationId: ctx.correlationId,
        vraag: {
          code: query.naam,
          soort: query.strategie === "volledig" ? "fondsbreed" : query.strategie === "vergelijk" ? "meerdere_documenten" : "gericht",
          vraag: query.zoekvraag,
          verwachteFixtures: [],
          maxKandidaten: query.maxKandidaten,
        },
        signal: ctx.signal,
      }));
    },
  };
}

export function vatMetingenSamen(rijen: VeiligeMeetrij[]) {
  const groepen = new Map<SpikeRoute, VeiligeMeetrij[]>();
  for (const rij of rijen) groepen.set(rij.route, [...(groepen.get(rij.route) ?? []), rij]);
  return [...groepen.entries()].map(([route, waarden]) => {
    const latencies = waarden.map((rij) => rij.latencyMs).sort((a, b) => a - b);
    const percentiel = (p: number) => latencies[Math.min(latencies.length - 1, Math.max(0, Math.ceil(latencies.length * p) - 1))] ?? 0;
    const gemiddeld = (veld: "recall" | "locatorDekking" | "versieDekking" | "previewDekking") => Number((waarden.reduce((som, rij) => som + rij[veld], 0) / Math.max(1, waarden.length)).toFixed(3));
    return {
      route,
      runs: waarden.length,
      geslaagd: waarden.filter((rij) => rij.resultaat === "geslaagd").length,
      recall: gemiddeld("recall"),
      locatorDekking: gemiddeld("locatorDekking"),
      versieDekking: gemiddeld("versieDekking"),
      previewDekking: gemiddeld("previewDekking"),
      mediaanLatencyMs: percentiel(0.5),
      p95LatencyMs: percentiel(0.95),
      microsoftCalls: waarden.reduce((som, rij) => som + rij.microsoftCalls, 0),
      contentBytes: waarden.reduce((som, rij) => som + rij.contentBytes, 0),
      throttles: waarden.reduce((som, rij) => som + rij.throttles, 0),
      foutcategorieen: Object.fromEntries([...new Set(waarden.map((rij) => rij.foutcategorie).filter(Boolean))].map((categorie) => [categorie, waarden.filter((rij) => rij.foutcategorie === categorie).length])),
    };
  });
}
