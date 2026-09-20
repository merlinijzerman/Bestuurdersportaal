// ============================================================================
//  #407 labsmoke — de read-only Graph-laag vóór de beslispoort.
// ----------------------------------------------------------------------------
//  Alles in dit bestand is een GET. Er wordt niets geüpload, verplaatst,
//  hernoemd, gedeeld of gedownload; er wordt geen instelling, consent, licentie
//  of featureflag geraakt. Dit is de laag die vaststelt OF de Copilot-call
//  überhaupt zinvol is — en die daarom zelf geen enkele blijvende sporen mag
//  achterlaten in de tenant.
//
//  DRIE HARDE GRENZEN, en ze gelden per call:
//    • een callbudget, geteld op FEITELIJKE netwerkpogingen;
//    • een bytegrens op het antwoord, incrementeel geteld;
//    • `redirect: "manual"`, zodat een omleiding een FOUT is en niet een stille
//      tweede host die ons bearer-token te zien krijgt.
//
//  De twee scans hieronder meten bewust IETS ANDERS, en dat verschil is het
//  hele punt van de stopregel:
//    • de INHOUDSCAN gaat door de SharePoint-zoekindex. Nul betekent: de index
//      kent de inhoud (nog) niet.
//    • de BESTANDSNAAMSCAN loopt de bibliotheek zélf af. Nul betekent: het
//      bestand staat er niet.
//  Wie beide op één mechanisme zou baseren, kan "nog niet geïndexeerd" niet van
//  "niet geüpload" onderscheiden — en dat is precies het onderscheid dat
//  bepaalt wat er daarna moet gebeuren.
// ============================================================================

import { graphPadIsGelijkOfOnder, normaliseerGraphPad } from "../../spike/sharepoint-retrieval/prototype";

const GRAPH_BASIS = "https://graph.microsoft.com/v1.0";

/** Bytegrens per Graph-antwoord. Ruim voor metadata, krap voor een verrassing. */
export const MAX_GRAPH_RESPONSE_BYTES = 1 * 1024 * 1024;

/** Harde grenzen op de bestandsnaamscan, zodat een grote bibliotheek hem niet laat ontsporen. */
export const MAX_SCAN_ITEMS = 2_000;
export const MAX_SCAN_MAPPEN = 200;
export const MAX_SCAN_DIEPTE = 8;

export class GraphFout extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(code: string, detail: string, httpStatus: number | null = null) {
    super(`${code}: ${detail}`);
    this.name = "GraphFout";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface GraphItem {
  id?: string;
  name?: string;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string; path?: string };
  remoteItem?: unknown;
}

export interface LeesClient {
  /** Eén GET; werpt bij elke niet-2xx status, ook bij een 3xx. */
  json<T>(pad: string): Promise<T>;
  /** Feitelijke netwerkpogingen tot nu toe. */
  pogingen(): number;
}

/**
 * Leest een antwoord met een grens op ONTVANGEN BYTES.
 *
 * Niet op `text.length`: dat telt UTF-16-code-units, waardoor een UTF-8-antwoord
 * van drie-byte-tekens ruim drie keer zo groot mag zijn als de grens suggereert.
 * En niet via `response.text()`: die buffert de hele body voordat er iets te
 * meten valt, dus bij een chunked antwoord zonder `content-length` is de grens
 * pas bereikt als het geheugen al vol staat.
 */
async function leesBegrensd(response: Response, maxBytes: number): Promise<string> {
  const gemeld = Number(response.headers.get("content-length"));
  if (Number.isFinite(gemeld) && gemeld > maxBytes) {
    throw new GraphFout("graph_respons_te_groot", `content-length ${gemeld} overschrijdt ${maxBytes}`);
  }
  const body = response.body;
  if (!body) {
    const tekst = await response.text();
    if (new TextEncoder().encode(tekst).byteLength > maxBytes) {
      throw new GraphFout("graph_respons_te_groot", `body overschrijdt ${maxBytes}`);
    }
    return tekst;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let bytes = 0;
  let tekst = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new GraphFout("graph_respons_te_groot", `body overschrijdt ${maxBytes}`);
      }
      tekst += decoder.decode(value, { stream: true });
    }
    return tekst + decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Een geannuleerde reader laat zich niet vrijgeven; dat mag de uitkomst
      // niet overschrijven.
    }
  }
}

export interface LeesClientOpties {
  accessToken: string;
  /** Maximaal aantal GET's in deze run. Overschrijden stopt de run. */
  callBudget: number;
  signal: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Een minimale, uitsluitend lezende Graph-client.
 *
 * Bewust geen retry. Deze laag draait vóór de beslispoort; een storing hoort de
 * run te stoppen, niet stilletjes een tweede en derde keer de tenant te raken
 * en daarmee het beeld te vertroebelen van hoeveel verkeer deze smoke kostte.
 */
export function maakLeesClient(opties: LeesClientOpties): LeesClient {
  const doeFetch = opties.fetchImpl ?? fetch;
  let gebruikt = 0;

  return {
    pogingen: () => gebruikt,
    async json<T>(pad: string): Promise<T> {
      if (gebruikt >= opties.callBudget) {
        throw new GraphFout("graph_callbudget", `budget van ${opties.callBudget} GET's is op`);
      }
      if (opties.signal.aborted) throw new GraphFout("graph_afgebroken", "de run is afgebroken");
      const url = pad.startsWith("https://") ? pad : `${GRAPH_BASIS}${pad}`;
      if (!url.startsWith(`${GRAPH_BASIS}/`)) {
        throw new GraphFout("graph_url_buiten_basis", "een Graph-pad wees buiten de v1.0-basis");
      }

      gebruikt++;
      let response: Response;
      try {
        response = await doeFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${opties.accessToken}`, Accept: "application/json" },
          signal: opties.signal,
          // Een 3xx is hier een fout, geen omleiding: volgen zou ons token naar
          // een host sturen die wij niet hebben gekozen.
          redirect: "manual",
        });
      } catch (fout) {
        throw new GraphFout("graph_netwerkfout", `GET mislukt (${(fout as Error).name})`);
      }
      if (response.status >= 300 && response.status <= 399) {
        throw new GraphFout("graph_omleiding", `Graph antwoordde met een omleiding`, response.status);
      }
      if (!response.ok) {
        // Uitsluitend de status: een Graph-foutbody draagt een correlatie-id en
        // soms de UPN of het pad, en die horen niet in onze uitvoer.
        throw new GraphFout("graph_http", `Graph antwoordde met HTTP ${response.status}`, response.status);
      }
      const tekst = await leesBegrensd(response, MAX_GRAPH_RESPONSE_BYTES);
      try {
        return JSON.parse(tekst) as T;
      } catch {
        throw new GraphFout("graph_responsvorm", "Graph-antwoord is geen geldige JSON");
      }
    },
  };
}

// ---------------------------------------------------------------------------
//  Actor, site en bibliotheek
// ---------------------------------------------------------------------------

export interface GraphActor {
  id: string;
  userPrincipalName: string;
}

/** Wie is er feitelijk aangemeld? Dit is het gezaghebbende antwoord, niet het id-token. */
export async function leesActor(client: LeesClient): Promise<GraphActor> {
  const me = await client.json<{ id?: string; userPrincipalName?: string }>("/me?$select=id,userPrincipalName");
  if (typeof me.id !== "string" || typeof me.userPrincipalName !== "string") {
    throw new GraphFout("actor_onleesbaar", "/me leverde geen id en userPrincipalName");
  }
  return { id: me.id.toLowerCase(), userPrincipalName: me.userPrincipalName };
}

export interface GraphBron {
  siteId: string;
  siteWebUrl: string;
  driveId: string;
  driveWebUrl: string;
}

export interface GraphRootItem {
  /** Het item-id van de GEREGISTREERDE bronroot; startpunt van elke scan. */
  rootItemId: string;
  rootWebUrl: string;
  rootGraphPad: string;
}

/**
 * Canonieke vergelijkingsvorm voor een SharePoint-URL: host in kleine letters,
 * pad gedecodeerd en genormaliseerd, trailing slash weg.
 *
 * Staat hier en niet in `smoke.ts`, omdat deze laag hem zelf nodig heeft om het
 * root-item te kunnen adresseren — en twee kopieën van een padvergelijking
 * lopen vroeg of laat uiteen.
 */
export function canoniekPad(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  try {
    const pad = decodeURIComponent(parsed.pathname).normalize("NFC").replace(/\/+$/, "");
    return `${parsed.hostname.toLowerCase()}${pad}`;
  } catch {
    return null;
  }
}

/**
 * Zoekt site en documentbibliotheek op via het GEREGISTREERDE pad.
 *
 * Er wordt niet gezocht op naam en er wordt geen lijst van sites doorlopen: het
 * adres komt letterlijk uit de registratie, zodat er geen tweede site kan zijn
 * die toevallig ook past.
 */
export async function leesBron(client: LeesClient, hostnaam: string, siteRelatiefPad: string): Promise<GraphBron> {
  // Het sitepad mag alleen onschuldige tekens bevatten: het gaat als
  // pad-adressering de Graph-URL in, niet als query.
  if (!/^(?:\/[A-Za-z0-9\-._~ ]+)+$/.test(siteRelatiefPad)) {
    throw new GraphFout("site_pad_onveilig", "het geregistreerde sitepad bevat onverwachte tekens");
  }
  const gecodeerdPad = siteRelatiefPad
    .split("/")
    .map((deel) => encodeURIComponent(deel))
    .join("/");

  const site = await client.json<{ id?: string; webUrl?: string }>(
    `/sites/${encodeURIComponent(hostnaam)}:${gecodeerdPad}?$select=id,webUrl`,
  );
  if (typeof site.id !== "string" || typeof site.webUrl !== "string") {
    throw new GraphFout("site_onleesbaar", "de site leverde geen id en webUrl");
  }
  const drive = await client.json<{ id?: string; webUrl?: string }>(
    `/sites/${encodeURIComponent(site.id)}/drive?$select=id,webUrl`,
  );
  if (typeof drive.id !== "string" || typeof drive.webUrl !== "string") {
    throw new GraphFout("drive_onleesbaar", "de documentbibliotheek leverde geen id en webUrl");
  }
  return { siteId: site.id, siteWebUrl: site.webUrl, driveId: drive.id, driveWebUrl: drive.webUrl };
}

/**
 * Zoekt het item op dat de GEREGISTREERDE bronroot is, en levert zijn item-id.
 *
 * Dit is geen formaliteit. Zonder deze stap zou elke scan bij de drive-root
 * beginnen, en dat is alleen toevallig hetzelfde zolang de geregistreerde root
 * de hele bibliotheek is. Zodra een profiel een SUBMAP als bronroot registreert
 * — `sharepoint_library_root` doet dat — leest een scan die bij de drive-root
 * begint de metadata van álles daarbuiten: namen, paden en mapstructuur van
 * stukken die niet bij deze meting horen. Dat is precies de grens die dit
 * ticket dichtzet.
 *
 * Het item-id komt uit een pad-adressering, niet uit een zoekopdracht, en de
 * teruggegeven `webUrl` moet daarna alsnog exact de geregistreerde root zijn.
 */
export async function leesRootItem(
  client: LeesClient,
  driveId: string,
  driveWebUrl: string,
  geregistreerdeRootUrl: string,
): Promise<GraphRootItem> {
  const drivePad = canoniekPad(driveWebUrl);
  const rootPad = canoniekPad(geregistreerdeRootUrl);
  if (!drivePad || !rootPad) {
    throw new GraphFout("root_url_onleesbaar", "bibliotheek- of root-URL is niet te canonicaliseren");
  }

  let pad: string;
  let rootGraphPad: string;
  if (rootPad.toLocaleLowerCase("nl") === drivePad.toLocaleLowerCase("nl")) {
    // De bronroot ís de bibliotheek.
    pad = `/drives/${encodeURIComponent(driveId)}/root?$select=id,webUrl,folder`;
    rootGraphPad = `/drives/${driveId}/root:`;
  } else if (rootPad.toLocaleLowerCase("nl").startsWith(`${drivePad.toLocaleLowerCase("nl")}/`)) {
    const rest = rootPad.slice(drivePad.length + 1);
    // Dezelfde allowlist als voor het sitepad: dit wordt pad-adressering in de
    // Graph-URL, en een `:` of `?` erin zou de adressering laten kantelen.
    if (!/^[A-Za-z0-9\-._~ ]+(?:\/[A-Za-z0-9\-._~ ]+)*$/.test(rest)) {
      throw new GraphFout("root_pad_onveilig", "het geregistreerde rootpad bevat onverwachte tekens");
    }
    const gecodeerd = rest.split("/").map((deel) => encodeURIComponent(deel)).join("/");
    pad = `/drives/${encodeURIComponent(driveId)}/root:/${gecodeerd}?$select=id,webUrl,folder`;
    rootGraphPad = `/drives/${driveId}/root:/${rest}`;
  } else {
    throw new GraphFout("root_buiten_bibliotheek", "de geregistreerde root ligt niet onder deze bibliotheek");
  }

  const item = await client.json<{ id?: string; webUrl?: string; folder?: unknown }>(pad);
  if (typeof item.id !== "string" || typeof item.webUrl !== "string") {
    throw new GraphFout("root_onleesbaar", "het root-item leverde geen id en webUrl");
  }
  if (!item.folder) {
    throw new GraphFout("root_geen_map", "het geregistreerde rootpad wijst niet naar een map");
  }
  // Het item dat wij terugkrijgen MOET de root zijn die in de registratie staat.
  // Een bibliotheek die een pad elders heen laat wijzen (een snelkoppeling, een
  // hernoemde map) mag geen bredere of andere scope opleveren.
  const gevonden = canoniekPad(item.webUrl);
  if (!gevonden || gevonden.toLocaleLowerCase("nl") !== rootPad.toLocaleLowerCase("nl")) {
    throw new GraphFout("root_wijst_elders", "het opgezochte root-item is niet de geregistreerde bronroot");
  }
  const genormaliseerdGraphPad = normaliseerGraphPad(rootGraphPad);
  if (!genormaliseerdGraphPad) {
    throw new GraphFout("root_graphpad_onleesbaar", "het Graph-pad van de bronroot is niet te canonicaliseren");
  }
  return { rootItemId: item.id, rootWebUrl: item.webUrl, rootGraphPad: genormaliseerdGraphPad };
}

function itemBinnenGraphRoot(item: GraphItem, driveId: string, rootGraphPad: string): boolean {
  if (item.remoteItem) return false;
  if (item.parentReference?.driveId !== driveId) return false;
  const ouderPad = normaliseerGraphPad(item.parentReference.path);
  return ouderPad !== null && graphPadIsGelijkOfOnder(ouderPad, rootGraphPad);
}

// ---------------------------------------------------------------------------
//  Scan 1 — inhoudscan via de zoekindex
// ---------------------------------------------------------------------------

/**
 * Wat een scanterm mag zijn. Een allowlist, ook al komt de term uit een
 * constante in de code: zo kan een latere wijziging van die constante geen
 * quote, wildcard of operator de OData-functie in schuiven.
 */
const VEILIGE_SCANTERM = /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,63}$/;

export interface InhoudscanUitkomst {
  term: string;
  /** Alle treffers die de index gaf, ook buiten de root. */
  treffers: number;
  /** Treffers die binnen de geregistreerde bronroot vallen. */
  binnenRoot: number;
  webUrls: string[];
}

/**
 * Zoekt de canaryterm binnen de bibliotheek. Dit is een INDEXMETING: nul hier
 * betekent dat de SharePoint-index de inhoud nog niet kent, niet dat het
 * bestand ontbreekt.
 */
export async function inhoudscan(
  client: LeesClient,
  driveId: string,
  rootItemId: string,
  rootGraphPad: string,
  term: string,
): Promise<InhoudscanUitkomst> {
  if (!VEILIGE_SCANTERM.test(term)) {
    throw new GraphFout("scanterm_onveilig", "de inhoudscanterm bevat onverwachte tekens");
  }
  // De OData-functieparameter staat tussen enkele quotes; die worden in OData
  // verdubbeld. De allowlist hierboven sluit ze al uit, dus dit is de tweede
  // grendel en niet de eerste.
  const gecodeerd = encodeURIComponent(term.replace(/'/g, "''"));
  // Zoeken ONDER het geregistreerde root-item, niet drive-breed. Nafilteren op
  // de root zou de telling wel kloppend maken, maar de metadata van alles
  // daarbuiten hebben we dan al binnengehaald.
  const antwoord = await client.json<{ value?: unknown }>(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootItemId)}/search(q='${gecodeerd}')?$select=id,name,webUrl,parentReference,remoteItem&$top=25`,
  );
  const rijen = Array.isArray(antwoord.value) ? (antwoord.value as GraphItem[]) : [];
  const binnen: string[] = [];
  for (const rij of rijen) {
    if (itemBinnenGraphRoot(rij, driveId, rootGraphPad) && typeof rij.webUrl === "string") binnen.push(rij.webUrl);
  }
  return { term, treffers: rijen.length, binnenRoot: binnen.length, webUrls: binnen };
}

// ---------------------------------------------------------------------------
//  Scan 2 — bestandsnaamscan door de bibliotheek zelf
// ---------------------------------------------------------------------------

export interface BestandsnaamscanUitkomst {
  prefix: string;
  /** Bestanden waarvan de naam met de prefix begint, binnen de root. */
  treffers: number;
  /** Hoeveel items er in totaal langsgekomen zijn; voor de budgetverantwoording. */
  bekeken: number;
  /** Is de scan op een grens gestopt in plaats van op het einde van de map? */
  afgekapt: boolean;
  webUrls: string[];
}

/**
 * Loopt de bibliotheek af en zoekt bestanden waarvan de NAAM met `prefix`
 * begint. Deze scan raakt de zoekindex niet: nul hier betekent dat het bestand
 * er niet staat.
 */
export async function bestandsnaamscan(
  client: LeesClient,
  driveId: string,
  rootItemId: string,
  rootGraphPad: string,
  prefix: string,
): Promise<BestandsnaamscanUitkomst> {
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-_]{0,63}$/.test(prefix)) {
    throw new GraphFout("scanprefix_onveilig", "de bestandsnaamprefix bevat onverwachte tekens");
  }
  const genormaliseerdePrefix = prefix.toLocaleLowerCase("nl");
  const treffers: string[] = [];
  let bekeken = 0;
  let mappen = 0;
  let afgekapt = false;

  // Breedte-eerst, met expliciete grenzen op items, mappen en diepte. Geen
  // recursie zonder plafond: een bibliotheek die groeit mag deze scan niet
  // stilletjes in een callbudget-fout laten eindigen.
  // START BIJ HET GEREGISTREERDE ROOT-ITEM, niet bij de drive-root. Zodra de
  // bronroot een submap is, zou dat laatste de hele bibliotheek aflopen.
  const wachtrij: Array<{ pad: string; diepte: number }> = [
    { pad: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootItemId)}/children`, diepte: 0 },
  ];

  while (wachtrij.length > 0) {
    const huidig = wachtrij.shift()!;
    let volgende: string | null = `${huidig.pad}?$select=id,name,webUrl,folder,file,parentReference,remoteItem&$top=200`;
    while (volgende) {
      const antwoord: { value?: unknown; "@odata.nextLink"?: unknown } = await client.json(volgende);
      const rijen = Array.isArray(antwoord.value) ? (antwoord.value as GraphItem[]) : [];
      for (const rij of rijen) {
        bekeken++;
        if (bekeken > MAX_SCAN_ITEMS) {
          afgekapt = true;
          break;
        }
        if (rij.folder) {
          if (!itemBinnenGraphRoot(rij, driveId, rootGraphPad)) continue;
          if (huidig.diepte + 1 > MAX_SCAN_DIEPTE || mappen >= MAX_SCAN_MAPPEN) {
            afgekapt = true;
            continue;
          }
          if (typeof rij.id !== "string") continue;
          mappen++;
          wachtrij.push({
            pad: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rij.id)}/children`,
            diepte: huidig.diepte + 1,
          });
          continue;
        }
        if (!rij.file || typeof rij.name !== "string") continue;
        if (!rij.name.toLocaleLowerCase("nl").startsWith(genormaliseerdePrefix)) continue;
        // `driveItem.webUrl` mag een Office-weergavelink (`/:w:/r/...`) zijn
        // en is daarom geen padbewijs. De parentReference hoort bij dezelfde
        // structureel gescopete traversal. Shortcuts (`remoteItem`) en een
        // ander drive-id vallen hier fail-closed af.
        if (!itemBinnenGraphRoot(rij, driveId, rootGraphPad)) continue;
        if (typeof rij.webUrl === "string") treffers.push(rij.webUrl);
      }
      if (afgekapt) break;
      const link = antwoord["@odata.nextLink"];
      volgende = typeof link === "string" && link.startsWith(`${GRAPH_BASIS}/`) ? link : null;
    }
    if (afgekapt) break;
  }

  return { prefix, treffers: treffers.length, bekeken, afgekapt, webUrls: treffers };
}
