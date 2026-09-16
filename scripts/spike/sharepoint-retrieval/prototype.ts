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
  SpikeAfwijscategorie,
  SpikeAfwijzingen,
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

function nieuweAfwijzingen(): SpikeAfwijzingen {
  return {
    mapping: 0,
    binding: 0,
    root: 0,
    rechten_configuratie: 0,
    versie: 0,
    extractie: 0,
    preview: 0,
    actualiteit: 0,
  };
}

function wijsKandidaatAf(afwijzingen: SpikeAfwijzingen, categorie: SpikeAfwijscategorie): null {
  afwijzingen[categorie] += 1;
  return null;
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
  if (response.status === 400) return new SpikeError("providerfout", "graph_bad_request");
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
    .map((doc) => [doc.ref, doc.itemId, doc.fixtureCode, doc.titel, doc.bestandstype, doc.fixtureStatus, doc.geregistreerdMappad ?? "", doc.verwachteMappad ?? ""].join("\u0000"))
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

async function leesGeldigeBron(deps: SpikeDependencies): Promise<SpikeBronSnapshot> {
  try {
    const bron = await deps.leesBron();
    valideerBron(bron);
    return bron;
  } catch (fout) {
    if (fout instanceof SpikeError) throw fout;
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd", { cause: fout });
  }
}

function eTagVan(item: GraphDriveItem): { soort: "etag" | "ctag"; waarde: string } {
  const etag = item.eTag?.trim();
  if (etag) return { soort: "etag", waarde: etag };
  const ctag = item.cTag?.trim();
  if (ctag) return { soort: "ctag", waarde: ctag };
  throw new SpikeError("versiebewijs_ontbreekt", "versie_ontbreekt");
}

function normaliseerGraphPad(pad: string | null | undefined): string | null {
  const waarde = pad?.trim();
  if (!waarde) return null;
  try {
    const genormaliseerd = decodeURIComponent(waarde).normalize("NFC").replace(/\/+$/, "");
    return genormaliseerd && !/[\u0000-\u001f\u007f]/.test(genormaliseerd) ? genormaliseerd : null;
  } catch {
    return null;
  }
}

function graphPadVanRoot(root: GraphDriveItem): string | null {
  const ouderPad = normaliseerGraphPad(root.parentReference?.path);
  const naam = root.name?.trim();
  if (!ouderPad || !naam || naam.includes("/") || naam.includes("\\")) return null;
  return normaliseerGraphPad(`${ouderPad}/${naam}`);
}

function graphPadIsGelijkOfOnder(pad: string, rootPad: string): boolean {
  const vergelijking = pad.toLocaleLowerCase("nl");
  const rootVergelijking = rootPad.toLocaleLowerCase("nl");
  return vergelijking === rootVergelijking || vergelijking.startsWith(`${rootVergelijking}/`);
}

function itemAfwijscategorie(
  item: GraphDriveItem,
  bron: SpikeBronSnapshot,
  mapping: SpikeDocumentMapping,
  rootGraphPad: string,
): "binding" | "root" | null {
  if (item.id !== mapping.itemId || item.parentReference?.driveId !== bron.driveId || !item.file) return "binding";
  const ouderId = item.parentReference.id;
  const ouderPad = normaliseerGraphPad(item.parentReference.path);
  if (!ouderId) return "root";
  if (ouderId === bron.rootItemId) return !ouderPad || graphPadIsGelijkOfOnder(ouderPad, rootGraphPad) ? null : "root";
  return ouderPad && graphPadIsGelijkOfOnder(ouderPad, rootGraphPad) ? null : "root";
}

function actualiteitToegestaan(mapping: SpikeDocumentMapping, vraag: SpikeVraag): boolean {
  if (mapping.fixtureStatus !== "actueel" && mapping.fixtureStatus !== "historisch") return false;
  if (vraag.actualiteitsbeleid === "alleen_actueel") return mapping.fixtureStatus === "actueel";
  if (vraag.actualiteitsbeleid === "alleen_historisch") return mapping.fixtureStatus === "historisch";
  return vraag.actualiteitsbeleid === "actueel_en_historisch";
}

function isFataleKandidaatFout(fout: unknown): boolean {
  return fout instanceof SpikeError
    && (
      fout.categorie === "configuratiefout"
      || fout.categorie === "timeout"
      || fout.categorie === "annulering"
      || fout.categorie === "rate_limit"
      || (fout.categorie === "providerfout" && (
        fout.code === "graph_bad_request"
        || fout.code === "graph_response"
        || fout.code === "ongeldige_graph_url"
        || fout.code === "onveilig_vervolgpad"
      ))
      || fout.code === "actor_of_tenant_mismatch"
    );
}

function mappadVanItem(item: GraphDriveItem, rootGraphPad: string): string {
  const ouderPad = normaliseerGraphPad(item.parentReference?.path);
  if (!ouderPad || !graphPadIsGelijkOfOnder(ouderPad, rootGraphPad)) return "";
  if (ouderPad.toLocaleLowerCase("nl") === rootGraphPad.toLocaleLowerCase("nl")) return "";
  return ouderPad.slice(rootGraphPad.length + 1).slice(0, 1_000);
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

async function parallelBegrensd<T, R>(
  items: T[],
  limiet: number,
  werk: (item: T) => Promise<R | null>,
  stopSignal?: AbortSignal,
): Promise<R[]> {
  const resultaat: R[] = [];
  let volgende = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limiet), items.length) }, async () => {
    for (;;) {
      if (stopSignal?.aborted) return;
      const index = volgende++;
      if (index >= items.length) return;
      const waarde = await werk(items[index]);
      if (waarde !== null) resultaat.push(waarde);
    }
  });
  // Wacht ook na de eerste fout op alle reeds gestarte workers. Daardoor kunnen
  // Graph-calls en afwijstellingen niet meer veranderen nadat de veilige
  // meetprojectie en audit zijn opgebouwd.
  const uitkomsten = await Promise.allSettled(workers);
  const eersteFout = uitkomsten.find((uitkomst): uitkomst is PromiseRejectedResult => uitkomst.status === "rejected");
  if (eersteFout) throw eersteFout.reason;
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

async function zoekViaDrive(client: GraphClient, bron: SpikeBronSnapshot, vragen: readonly string[], maxKandidaten: number): Promise<ZoekHit[]> {
  if (vragen.length < 1 || vragen.length > 4 || vragen.some((vraag) => !vraag.trim() || vraag.length > 120 || /[\u0000-\u001f\u007f]/.test(vraag))) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }
  const hits: ZoekHit[] = [];
  const gezien = new Set<string>();
  for (const vraag of vragen) {
    if (hits.length >= maxKandidaten) break;
    const gecodeerdeVraag = encodeURIComponent(vraag.replace(/'/g, "''")).replace(/'/g, "%27");
    const pad = `/drives/${encodeURIComponent(bron.driveId)}/items/${encodeURIComponent(bron.rootItemId)}/search(q='${gecodeerdeVraag}')`;
    const eerste = `${GRAPH_BASIS}${pad}?$select=id,name,size,file,eTag,cTag,lastModifiedDateTime,parentReference,webUrl&$top=${Math.min(50, maxKandidaten - hits.length)}`;
    const verwachtPad = veiligeGraphUrl(eerste).pathname;
    let volgende: string | undefined = eerste;
    for (let pagina = 0; volgende && pagina < MAX_PAGINAS && hits.length < maxKandidaten; pagina += 1) {
      const body = await client.json<{ value?: GraphDriveItem[]; "@odata.nextLink"?: string }>(volgende);
      for (const item of body.value ?? []) {
        if (!item.id || gezien.has(item.id)) continue;
        gezien.add(item.id);
        hits.push({ itemId: item.id, positie: hits.length + 1, score: null, summary: null });
        if (hits.length >= maxKandidaten) break;
      }
      if (body["@odata.nextLink"] && hits.length < maxKandidaten) {
        const parsed = veiligeGraphUrl(body["@odata.nextLink"]);
        if (parsed.pathname !== verwachtPad) throw new SpikeError("providerfout", "onveilig_vervolgpad");
        volgende = parsed.toString();
      } else {
        volgende = undefined;
      }
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
  rootGraphPad: string,
  mapping: SpikeDocumentMapping,
  hit: ZoekHit,
  afwijzingen: SpikeAfwijzingen,
): Promise<SpikeBronresultaat | null> {
  // Vaste fase 1: serververtrouwde fixturestatus. Historische of onbekende
  // status valt af vóór een content- of previewcall.
  if (!actualiteitToegestaan(mapping, opdracht.vraag)) return wijsKandidaatAf(afwijzingen, "actualiteit");

  // Vaste fase 2: eerste actuele item-, drive-, bestands- en rootbinding.
  let eersteCheck: GraphDriveItem;
  try {
    eersteCheck = await client.json<GraphDriveItem>(itemUrl(bronEerst, mapping.itemId));
  } catch (fout) {
    if (isFataleKandidaatFout(fout)) throw fout;
    return wijsKandidaatAf(afwijzingen, "rechten_configuratie");
  }
  const eersteBindingFout = itemAfwijscategorie(eersteCheck, bronEerst, mapping, rootGraphPad);
  if (eersteBindingFout) return wijsKandidaatAf(afwijzingen, eersteBindingFout);
  let eersteVersie: ReturnType<typeof eTagVan>;
  try {
    eersteVersie = eTagVan(eersteCheck);
  } catch {
    return wijsKandidaatAf(afwijzingen, "versie");
  }
  await deps.onFase?.("na_eerste_rechtencheck", mapping);

  // Vaste fase 3: passage of begrensde in-memory extractie.
  let passage: string;
  let pagina: number | null = null;
  let paragraaf: string | null = null;
  if (opdracht.route === "microsoft_search") {
    passage = schoneSummary(hit.summary);
    if (!passage) return wijsKandidaatAf(afwijzingen, "extractie");
  } else {
    let bytes: Buffer;
    try {
      bytes = await client.content(contentUrl(bronEerst, mapping.itemId), bronEerst.siteHostnaam);
    } catch (fout) {
      if (isFataleKandidaatFout(fout)) throw fout;
      const categorie = fout instanceof SpikeError && fout.categorie === "toestemming_geweigerd"
        ? "rechten_configuratie"
        : "extractie";
      return wijsKandidaatAf(afwijzingen, categorie);
    }
    try {
      try {
        const extractie = await extractTekst(bytes, bestandstypeVoorExtractie(mapping));
        const gevonden = passageUitSegmenten(extractie.segmenten, opdracht.vraag.vraag);
        if (!gevonden) return wijsKandidaatAf(afwijzingen, "extractie");
        ({ passage, pagina, paragraaf } = gevonden);
      } catch (fout) {
        if (isFataleKandidaatFout(fout)) throw fout;
        return wijsKandidaatAf(afwijzingen, "extractie");
      }
    } finally {
      bytes.fill(0);
    }
  }
  await deps.onFase?.("na_content", mapping);
  await deps.onFase?.("voor_laatste_rechtencheck", mapping);

  // Vaste fase 4: laatste actuele rechten-, binding- en versiecontrole.
  const gecontroleerdOp = (deps.nu ?? (() => new Date()))().toISOString();
  let laatsteCheck: GraphDriveItem;
  try {
    laatsteCheck = await client.json<GraphDriveItem>(itemUrl(bronEerst, mapping.itemId));
  } catch (fout) {
    if (isFataleKandidaatFout(fout)) throw fout;
    return wijsKandidaatAf(afwijzingen, "rechten_configuratie");
  }
  const laatsteBindingFout = itemAfwijscategorie(laatsteCheck, bronEerst, mapping, rootGraphPad);
  if (laatsteBindingFout) return wijsKandidaatAf(afwijzingen, laatsteBindingFout);
  let laatsteVersie: ReturnType<typeof eTagVan>;
  try {
    laatsteVersie = eTagVan(laatsteCheck);
  } catch {
    return wijsKandidaatAf(afwijzingen, "versie");
  }
  if (laatsteVersie.soort !== eersteVersie.soort || laatsteVersie.waarde !== eersteVersie.waarde) {
    return wijsKandidaatAf(afwijzingen, "versie");
  }

  // Bronconfiguratiedrift is verzoekfataal en mag nooit lokaal worden geteld.
  const bronLaatste = await leesGeldigeBron(deps);
  if (bronVingerafdruk(bronLaatste) !== bronFingerprint) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }

  // Vaste fase 5: previewbewijs.
  let preview: { getUrl?: string };
  try {
    preview = await client.json<{ getUrl?: string }>(previewUrl(bronEerst, mapping.itemId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (fout) {
    if (isFataleKandidaatFout(fout)) throw fout;
    return wijsKandidaatAf(afwijzingen, "preview");
  }
  if (!veiligeSharePointUrl(preview.getUrl, bronEerst.siteHostnaam)) {
    return wijsKandidaatAf(afwijzingen, "preview");
  }
  await deps.onFase?.("voor_toelating", mapping);
  const bronVoorToelating = await leesGeldigeBron(deps);
  if (bronVingerafdruk(bronVoorToelating) !== bronFingerprint) {
    throw new SpikeError("configuratiefout", "configuratie_gewijzigd");
  }

  return {
    ref: mapping.ref,
    fixtureCode: mapping.fixtureCode,
    bronsoort: "sharepoint",
    titel: (laatsteCheck.name ?? mapping.titel).slice(0, 240),
    documentIdentiteit: {
      id: mapping.ref,
      bibliotheek: bronEerst.driveNaam,
      bron: bronEerst.bronId,
      fondsId: bronEerst.fondsId,
    },
    passageIdentiteit: { id: `${mapping.ref}:live` },
    versie: { ...laatsteVersie, gecontroleerdOp },
    bronregistratieRef: bronEerst.bronId,
    toegangscontrole: {
      toegestaan: true,
      resultaatRef: mapping.ref,
      bronregistratieRef: bronEerst.bronId,
      gebruikerId: bronEerst.actorId,
      correlationId: opdracht.correlationId,
      gecontroleerdOp,
      basis: "delegated_user",
      bronconfiguratieVersie: bronEerst.configuratieversie,
    },
    locator: { pagina, paragraaf, mappad: mappadVanItem(laatsteCheck, rootGraphPad) },
    passage,
    status: {
      documentstatus: mapping.fixtureStatus,
      bronstatus: "actief",
      actueel: mapping.fixtureStatus === "actueel",
    },
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
 * Hoofdingang van het geïsoleerde prototype. Elke fout levert nul kandidaten;
 * er bestaat hier geen providerfallback en er wordt geen modelcontext gebouwd.
 */
export async function voerSharePointRetrievalSpikeUit(deps: SpikeDependencies, opdracht: SpikeOpdracht): Promise<SpikeUitkomst> {
  const klok = deps.klok ?? (() => performance.now());
  const start = klok();
  const meting = nieuweMeting();
  const afwijzingen = nieuweAfwijzingen();
  let client: GraphClient | undefined;
  let fataleKandidaatFout: SpikeErrorType | null = null;
  try {
    const bron = await leesGeldigeBron(deps);
    const token = await deps.delegatedToken();
    if (!token.accessToken || token.tenantId !== bron.tenantId || token.actorObjectId !== bron.microsoftActorObjectId) {
      throw new SpikeError("buiten_scope", "actor_of_tenant_mismatch");
    }

    const deadline = AbortSignal.timeout(opdracht.timeoutMs ?? 15_000);
    const fataleAfbreking = new AbortController();
    const signal = AbortSignal.any([
      ...(opdracht.signal ? [opdracht.signal] : []),
      deadline,
      fataleAfbreking.signal,
    ]);
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
    const rootGraphPad = graphPadVanRoot(root);
    if (!root.id || !root.folder || root.id !== bron.rootItemId || root.parentReference?.driveId !== bron.driveId || !rootWebUrl || !rootGraphPad) {
      throw new SpikeError("buiten_scope", "document_buiten_bron");
    }
    const maxKandidaten = Math.min(Math.max(1, opdracht.vraag.maxKandidaten ?? 20), 50);
    const hits = opdracht.route === "microsoft_search"
      ? await zoekViaMicrosoftSearch(graphClient, opdracht.vraag.vraag, rootWebUrl, maxKandidaten)
      : await zoekViaDrive(graphClient, bron, opdracht.vraag.driveZoektermen ?? [opdracht.vraag.vraag], maxKandidaten);
    await deps.onFase?.("na_zoeken");

    const uniekeHits = hits.filter((hit, index) => hits.findIndex((kandidaat) => kandidaat.itemId === hit.itemId) === index);
    const mappingPerItem = new Map<string, SpikeDocumentMapping[]>();
    for (const document of bron.documenten) {
      mappingPerItem.set(document.itemId, [...(mappingPerItem.get(document.itemId) ?? []), document]);
    }
    const bekendeHits: Array<{ hit: ZoekHit; mapping: SpikeDocumentMapping }> = [];
    for (const hit of uniekeHits) {
      const mappings = mappingPerItem.get(hit.itemId) ?? [];
      if (mappings.length === 0) {
        wijsKandidaatAf(afwijzingen, "mapping");
        continue;
      }
      if (mappings.length !== 1) {
        const statussen = new Set(mappings.map((mapping) => mapping.fixtureStatus));
        wijsKandidaatAf(afwijzingen, statussen.size === 1 ? "mapping" : "actualiteit");
        continue;
      }
      bekendeHits.push({ hit, mapping: mappings[0] });
    }
    const fingerprint = bronVingerafdruk(bron);
    const kandidaten = await parallelBegrensd(
      bekendeHits,
      Math.min(Math.max(1, opdracht.concurrency ?? MAX_CONCURRENCY), MAX_CONCURRENCY),
      async ({ hit, mapping }) => {
        try {
          return await maakKandidaat(graphClient, deps, opdracht, bron, fingerprint, rootGraphPad, mapping, hit, afwijzingen);
        } catch (fout) {
          if (isFataleKandidaatFout(fout)) {
            fataleKandidaatFout ??= fout as SpikeErrorType;
            fataleAfbreking.abort("fatale_kandidaatfout");
            throw fout;
          }
          return wijsKandidaatAf(afwijzingen, "rechten_configuratie");
        }
      },
      signal,
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
      afwijzingen,
      meting,
    };
  } catch (fout) {
    if (client) Object.assign(meting, client.meting);
    let veilig = fataleKandidaatFout ?? alsSpikeError(fout);
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
      afwijzingen,
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
      foutcode: null,
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
      foutcode: veilig.code,
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
    afwijzingMapping: uitkomst.afwijzingen.mapping,
    afwijzingBinding: uitkomst.afwijzingen.binding,
    afwijzingRoot: uitkomst.afwijzingen.root,
    afwijzingRechtenConfiguratie: uitkomst.afwijzingen.rechten_configuratie,
    afwijzingVersie: uitkomst.afwijzingen.versie,
    afwijzingExtractie: uitkomst.afwijzingen.extractie,
    afwijzingPreview: uitkomst.afwijzingen.preview,
    afwijzingActualiteit: uitkomst.afwijzingen.actualiteit,
  };
}

const CONTRACT_CAPABILITIES: AdapterCapabilities = {
  bronsoorten: ["sharepoint"],
  strategieen: ["gericht", "volledig", "vergelijk"],
  ondersteundeFilters: [],
  versiebewijs: true,
  versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
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
 * Deze brug is alleen voor de spike; de boundarygate staat uitsluitend de
 * Preview-smokerunner toe en verbiedt de gewone productiepaden.
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
 * RetrievalAdapter voor contracttests en de geïsoleerde live spike.
 * Geen chat-, zoek-, vergelijk- of productiecompositie importeert deze factory.
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
          actualiteitsbeleid: "alleen_actueel",
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
