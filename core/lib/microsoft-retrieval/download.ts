// ============================================================================
//  #413 T4-C — Begrensde, in-memory download van één geverifieerd DriveItem.
// ----------------------------------------------------------------------------
//  Deze module draait PAS nadat `bevestigKandidaatItem()` het item aan bron,
//  tenant, drive, root en URL heeft gebonden. Zij haalt bytes op, verder niets:
//  geen rechtenoordeel, geen mapping, geen extractie, geen opslag. De bytes
//  blijven in het geheugen en verlaten deze beurt niet.
//
//  ── WAAROM DIT IN TWEE STAPPEN GAAT ────────────────────────────────────────
//  `GET /drives/{d}/items/{i}/content` antwoordt met een 302 naar een
//  PRE-AUTHENTICATED URL op een andere host (de SharePointhost zelf of een
//  Microsoft-downloadCDN). Die URL draagt zijn eigen autorisatie in de query.
//
//  Daarom volgt deze code de omleiding NOOIT automatisch. `redirect: "manual"`
//  houdt de 302 tegen, de `Location` wordt gevalideerd, en de tweede aanroep
//  vertrekt ZONDER `Authorization`-header. Zou de fetch de omleiding zelf
//  volgen, dan stuurt hij het delegated token mee naar een host waarvoor het
//  niet bedoeld is — een tokenlek waar geen foutmelding bij hoort.
//
//  ── DE GRENS TELT BYTES, NIET TEKENS ───────────────────────────────────────
//  De body wordt incrementeel gelezen en per chunk op `byteLength` geteld; bij
//  overschrijding wordt de reader geannuleerd. `content-length` wordt vooraf
//  getoetst, zodat een te groot bestand wordt geweigerd zonder er één byte van
//  te lezen. (Dezelfde les als bij de Copilot-client: `text().length` telt
//  UTF-16-code-units en zegt niets over wat er binnenkomt.)
//
//  ── ÉÉN DEADLINE OVER DE HELE KETEN ────────────────────────────────────────
//  Eerst gold de deadline alleen voor stap 2, en die begon pas te lopen NADAT
//  stap 1 klaar was. De totale tijd kon daarmee ruim het dubbele worden van wat
//  de grens suggereert — en dat gaat ten koste van de beurtdeadline, die alle
//  kandidaten samen moeten delen. Nu start één klok vóór stap 1 en dekt die de
//  omleiding, de download én het uitlezen van de body.
//
//  Die klok is een EIGEN controller en geen `AbortSignal.timeout()`. Die laatste
//  levert een `TimeoutError`, en `isAfbreking()` leest dat als een afbreking van
//  de BEURT — dan zou één traag document de hele beurt als geannuleerd laten
//  eindigen. Met een eigen reden blijft het onderscheid zichtbaar: de beurt
//  afgebroken is iets anders dan deze download te traag.
//
//  ── FOUTREGELS, GELIJK AAN DE ITEMLEZING ───────────────────────────────────
//  Afbreking gaat er onmiddellijk doorheen en wordt na élke I/O opnieuw
//  bewaakt; 404/403 is een kandidaatweigering; al het andere is een storing en
//  wordt doorgeworpen zodat de beurt stopt.
// ============================================================================
import {
  GRAPH_BASIS,
  SharePointGraphError,
  type GraphFetch,
} from "../microsoft-sharepoint-graph-core";
import { bewaakNaIO, isAfbreking } from "../retrieval/afbreken";

/** Harde bovengrens op ONTVANGEN BYTES per document. */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** Deadline over de VOLLEDIGE keten: omleiding, download en uitlezen samen. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

export type DownloadAfwijzing = "rechten_configuratie" | "download";

export type DownloadResultaat =
  | { ok: true; bytes: Buffer }
  | { ok: false; afwijzing: DownloadAfwijzing };

export function contentUrl(driveId: string, itemId: string): string {
  return `${GRAPH_BASIS}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;
}

/**
 * Valideert de `Location` van de 302.
 *
 * Toegestaan is uitsluitend: de SharePointhost van de GEREGISTREERDE bron, of
 * een Microsoft-downloadCDN. Alles anders — een andere tenant, een
 * http-omleiding, een URL met credentials of een afwijkende poort — is geen
 * download maar een omleiding naar iets wat wij niet kennen.
 *
 * De URL draagt zijn eigen autorisatie in de query; hij wordt daarom nooit
 * gelogd, nooit bewaard en nooit teruggegeven.
 */
export function veiligeDownloadUrl(locatie: string | null, siteHostnaam: string): URL | null {
  if (!locatie) return null;
  let parsed: URL;
  try {
    parsed = new URL(locatie);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  if (parsed.hash) return null;
  const host = parsed.hostname.toLowerCase();
  const eigenHost = host === siteHostnaam.trim().toLowerCase();
  // De downloadCDN van Microsoft; SharePoint Online leidt hier regelmatig heen.
  const microsoftCdn = /^[a-z0-9-]+\.files\.1drv\.com$/.test(host);
  if (!eigenHost && !microsoftCdn) return null;
  return parsed;
}

async function leesBegrensdeBytes(response: Response, keten: AbortSignal): Promise<Buffer | null> {
  const lengte = Number(response.headers.get("content-length"));
  if (Number.isFinite(lengte) && lengte > MAX_DOWNLOAD_BYTES) return null;

  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength > MAX_DOWNLOAD_BYTES ? null : buffer;
  }

  const reader = body.getReader();
  const delen: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      // Het UITLEZEN valt onder dezelfde klok: een body die traag binnendruppelt
      // zou anders buiten elke grens vallen.
      if (keten.aborted) {
        await reader.cancel().catch(() => {});
        throw keten.reason ?? new SharePointGraphError("graph_timeout");
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_DOWNLOAD_BYTES) {
        // Annuleren, niet doorlezen: de rest hoeft niet meer binnen te komen.
        await reader.cancel().catch(() => {});
        return null;
      }
      delen.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Een geannuleerde reader laat zich niet vrijgeven; dat is geen fout.
    }
  }
  return Buffer.concat(delen);
}

export interface DownloadOpdracht {
  accessToken: string;
  driveId: string;
  itemId: string;
  /** `site_hostnaam` van de geregistreerde bron; bepaalt welke redirect mag. */
  siteHostnaam: string;
  signal?: AbortSignal;
  /** Uitsluitend voor tests; productie gebruikt de globale `fetch`. */
  fetchImpl?: GraphFetch;
  /**
   * Uitsluitend voor tests. Productie gebruikt `DOWNLOAD_TIMEOUT_MS`; een test
   * die op de echte klok wacht, wacht dertig seconden per geval.
   */
  timeoutMs?: number;
}

/**
 * Haalt de bytes van één item op. Levert `ok: false` als deze kandidaat afvalt,
 * en WERPT bij een storing of afbreking — de beurt stopt dan.
 */
export async function downloadItem(opdracht: DownloadOpdracht): Promise<DownloadResultaat> {
  const doeFetch = opdracht.fetchImpl ?? ((input, init) => fetch(input, init));

  // ÉÉN klok over de hele keten, gestart vóór de eerste aanroep. Een eigen
  // controller met een eigen reden, zodat "deze download is te traag" niet als
  // "de beurt is afgebroken" wordt gelezen.
  const verlopen = new SharePointGraphError("graph_timeout");
  const eigenKlok = new AbortController();
  const timer = setTimeout(() => eigenKlok.abort(verlopen), opdracht.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const keten = opdracht.signal
    ? AbortSignal.any([opdracht.signal, eigenKlok.signal])
    : eigenKlok.signal;

  /** Beurtafbreking wint; daarna onze eigen klok; dan pas een providerfout. */
  const vertaal = (fout: unknown): never => {
    bewaakNaIO(opdracht.signal, fout);
    if (isAfbreking(fout)) throw fout;
    if (eigenKlok.signal.aborted) throw verlopen;
    throw new SharePointGraphError("graph_response", fout);
  };

  try {
    return await haalOp(opdracht, doeFetch, keten, vertaal);
  } finally {
    // Zonder dit blijft de timer het proces vasthouden nadat de download al
    // lang klaar is.
    clearTimeout(timer);
  }
}

async function haalOp(
  opdracht: DownloadOpdracht,
  doeFetch: GraphFetch,
  keten: AbortSignal,
  vertaal: (fout: unknown) => never,
): Promise<DownloadResultaat> {
  // ── Stap 1: de omleiding ophalen, MET token, naar graph.microsoft.com ──────
  bewaakNaIO(opdracht.signal);
  let omleiding: Response;
  try {
    omleiding = await doeFetch(contentUrl(opdracht.driveId, opdracht.itemId), {
      method: "GET",
      headers: { Authorization: `Bearer ${opdracht.accessToken}` },
      cache: "no-store",
      // NOOIT automatisch volgen: dan zou het token naar de redirecthost gaan.
      redirect: "manual",
      signal: keten,
    });
  } catch (fout) {
    vertaal(fout);
  }
  bewaakNaIO(opdracht.signal);

  if (omleiding.status !== 302 && omleiding.status !== 301 && omleiding.status !== 307) {
    // 404/403 gaan over dit ene document; al het andere is een storing.
    if (omleiding.status === 404 || omleiding.status === 403 || omleiding.status === 401) {
      return { ok: false, afwijzing: "rechten_configuratie" };
    }
    throw new SharePointGraphError("graph_response");
  }

  const downloadUrl = veiligeDownloadUrl(omleiding.headers.get("location"), opdracht.siteHostnaam);
  // Geen bruikbare omleiding: dit document is niet op te halen. Dat is een
  // uitkomst voor deze kandidaat, geen storing van de provider.
  if (!downloadUrl) return { ok: false, afwijzing: "download" };

  // ── Stap 2: de bytes, ZONDER token ────────────────────────────────────────
  // Dezelfde klok als stap 1: de deadline geldt de KETEN, niet elke stap apart.
  let inhoud: Response;
  try {
    inhoud = await doeFetch(downloadUrl.toString(), {
      method: "GET",
      // Bewust GEEN Authorization: de URL draagt zijn eigen autorisatie, en het
      // delegated token hoort niet op een andere host thuis.
      headers: { Accept: "application/octet-stream" },
      cache: "no-store",
      redirect: "error",
      signal: keten,
    });
  } catch (fout) {
    vertaal(fout);
  }
  bewaakNaIO(opdracht.signal);

  if (!inhoud.ok) {
    if (inhoud.status === 404 || inhoud.status === 403 || inhoud.status === 401) {
      return { ok: false, afwijzing: "rechten_configuratie" };
    }
    throw new SharePointGraphError("graph_response");
  }

  const bytes = await leesBegrensdeBytes(inhoud, keten).catch(vertaal);
  bewaakNaIO(opdracht.signal);
  // Te groot is geen storing en geen rechtenkwestie: dit document doet niet mee.
  if (!bytes || bytes.byteLength === 0) return { ok: false, afwijzing: "download" };
  return { ok: true, bytes };
}
