import "server-only";
import { sharepointAccessToken } from "./microsoft-delegated-token";
import {
  graphJson,
  itemUrl,
  SharePointGraphError,
  type GraphDriveItem,
} from "./microsoft-sharepoint-graph-core";
import * as vault from "./microsoft-vault";
import {
  maakDirecteSharePointAdapter,
  MAX_DIRECTE_TOTAAL_BYTES,
  MAX_DIRECTE_TOTAAL_TEKENS,
  type DirectSharePointAdapterDeps,
} from "./microsoft-retrieval/direct-adapter";
import type { BronSnapshot, ItemLezer } from "./microsoft-retrieval/driveitem";
import type { GeregistreerdDocument } from "./microsoft-retrieval/mapping";
import type { Bronresultaat } from "./retrieval/contract";
import { maakDocumentIdentiteit } from "./retrieval/identiteit";
import { sharepointDocumenten } from "./microsoft-sharepoint";
import {
  selecteerSharePointMapDocumenten,
  type SharePointMapSelectie,
} from "./microsoft-sharepoint-map-ai-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DirecteSharePointScope = {
  soort: "document" | "map";
  ref: string;
};

export function leesDirecteSharePointScope(
  ruw: unknown
): DirecteSharePointScope | undefined | null {
  if (ruw === undefined || ruw === null) return undefined;
  if (!ruw || typeof ruw !== "object") return null;
  const scope = ruw as { soort?: unknown; refs?: unknown };
  if (
    (scope.soort !== "document" && scope.soort !== "map") ||
    !Array.isArray(scope.refs)
  ) return null;
  const refs = [...new Set(scope.refs.filter((ref): ref is string =>
    typeof ref === "string" && UUID.test(ref)
  ).map((ref) => ref.toLowerCase()))];
  return refs.length === 1 && refs.length === scope.refs.length
    ? { soort: scope.soort, ref: refs[0] }
    : null;
}

function alsBronSnapshot(bron: vault.SharePointBron): BronSnapshot {
  return {
    id: bron.id,
    tenantId: bron.tenant_id,
    siteHostnaam: bron.site_hostnaam,
    driveId: bron.drive_id,
    rootItemId: bron.root_item_id,
    configuratieversie: bron.configuratieversie,
    status: bron.status,
  };
}

function alsGeregistreerdDocument(
  document: vault.SharePointDocument
): GeregistreerdDocument {
  return {
    ref: document.id,
    bronId: document.bron_id,
    driveId: document.drive_id,
    itemId: document.item_id,
    rootItemId: document.root_item_id,
    naam: document.naam,
    bestandstype: document.bestandstype,
    mappad: document.mappad,
    status: document.status,
    bronStatus: document.bron_status,
    siteHostnaam: document.site_hostnaam,
    configuratieversie: document.configuratieversie,
  };
}

export interface ProductieSharePointAdapter {
  adapter: ReturnType<typeof maakDirecteSharePointAdapter>;
  documentIdentiteiten: string[];
  scopeSoort: DirecteSharePointScope["soort"];
  scopeRef: string;
  scopeLabel: string;
  mapSelectie?: SharePointMapSelectie;
  lokaleDocumentRefVoor(identiteit: string): string | undefined;
  /** Tijdelijke brug zolang de chatroute stroomafwaarts nog DocumentChunk leest. */
  chunksVoor(bronnen: Bronresultaat[]): SharePointPromptChunk[];
}

/** Structurele migratiebrug; bewust zonder import uit de Supabase-RAG-kern. */
interface SharePointPromptChunk {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  rang?: number | null;
  documenten: {
    titel: string;
    bron: string;
    bibliotheek: string;
    opslag_pad: string | null;
    fonds_id?: string | null;
    documentstatus?: string | null;
    bronstatus?: string | null;
    extern_url?: string | null;
    bestandstype?: string | null;
  };
}

export async function maakProductieDirecteSharePointAdapter(args: {
  fondsId: string;
  gebruikerId: string;
  correlationId: string;
  scope: DirecteSharePointScope;
  vraag: string;
  signal?: AbortSignal;
}): Promise<ProductieSharePointAdapter> {
  const [bronRij, token] = await Promise.all([
    vault.leesSharePointBron(args.fondsId),
    sharepointAccessToken({ fondsId: args.fondsId, gebruikerId: args.gebruikerId }),
  ]);
  if (!bronRij || bronRij.status !== "actief") {
    throw new SharePointGraphError("bron_niet_geconfigureerd");
  }
  if (token.tenantId !== bronRij.tenant_id) {
    throw new SharePointGraphError("toestemming_of_token");
  }
  const bron = alsBronSnapshot(bronRij);
  let scopeLabel: string;
  let mapSelectie: SharePointMapSelectie | undefined;
  let documentRijen: Array<vault.SharePointDocument | undefined>;

  if (args.scope.soort === "map") {
    // De registerref is alleen een locator. De volledige boom wordt per beurt
    // opnieuw met het delegated token van deze gebruiker gelezen. Alleen een map
    // die in die live, security-trimmed listing terugkomt mag context worden.
    const [mapRij, live] = await Promise.all([
      vault.leesSharePointMap(args.fondsId, args.scope.ref),
      sharepointDocumenten({
        fondsId: args.fondsId,
        gebruikerId: args.gebruikerId,
        correlationId: args.correlationId,
      }, args.signal),
    ]);
    const liveMap = live.mapRefs.find((map) => map.ref === args.scope.ref);
    if (
      !mapRij ||
      !liveMap ||
      mapRij.bron_id !== bron.id ||
      mapRij.drive_id !== bron.driveId ||
      mapRij.root_item_id !== bron.rootItemId ||
      mapRij.site_hostnaam !== bron.siteHostnaam ||
      mapRij.configuratieversie !== bron.configuratieversie ||
      mapRij.status !== "gezien" ||
      mapRij.bron_status !== "actief" ||
      mapRij.mappad !== liveMap.mappad
    ) {
      throw new SharePointGraphError("bron_niet_toegankelijk");
    }
    const selectie = selecteerSharePointMapDocumenten(
      live.documenten,
      liveMap.mappad,
      args.vraag
    );
    mapSelectie = {
      ...selectie,
      // Een afgeknotte Graph-boom betekent óók gedeeltelijke dekking, zelfs als
      // het zichtbare deel minder dan zes geschikte documenten bevat.
      afgekapt: selectie.afgekapt || live.afgekapt,
    };
    documentRijen = await Promise.all(
      mapSelectie.documenten.map((document) =>
        vault.leesSharePointDocument(args.fondsId, document.ref)
      )
    );
    scopeLabel = liveMap.naam;
  } else {
    documentRijen = [
      await vault.leesSharePointDocument(args.fondsId, args.scope.ref),
    ];
    scopeLabel = documentRijen[0]?.naam ?? "SharePoint-document";
  }

  const documenten = documentRijen.map((rij) => {
    if (!rij) throw new SharePointGraphError("niet_gevonden");
    const document = alsGeregistreerdDocument(rij);
    if (
      document.bronId !== bron.id ||
      document.driveId !== bron.driveId ||
      document.rootItemId !== bron.rootItemId ||
      document.siteHostnaam !== bron.siteHostnaam ||
      document.configuratieversie !== bron.configuratieversie ||
      document.status !== "gezien" ||
      document.bronStatus !== "actief"
    ) {
      throw new SharePointGraphError("bron_niet_toegankelijk");
    }
    return { document };
  });

  const leesItem: ItemLezer = (itemId, signal) =>
    graphJson<GraphDriveItem>(
      token.accessToken,
      itemUrl(bron.driveId, itemId),
      { signal }
    );
  const herleesBron: DirectSharePointAdapterDeps["herleesBron"] = async () => {
    const nu = await vault.leesSharePointBron(args.fondsId);
    return nu ? alsBronSnapshot(nu) : undefined;
  };
  const lokaalPerIdentiteit = new Map(
    documenten.map(({ document }) => [
      maakDocumentIdentiteit(`fonds:${args.fondsId}:sharepoint`, document.ref),
      document.ref,
    ])
  );

  return {
    adapter: maakDirecteSharePointAdapter({
      bron,
      tokenTenantId: token.tenantId,
      accessToken: token.accessToken,
      documenten,
      leesItem,
      herleesBron,
      ...(args.scope.soort === "map"
        ? {
            maxTotaalBytes: MAX_DIRECTE_TOTAAL_BYTES,
            maxTotaalTekens: MAX_DIRECTE_TOTAAL_TEKENS,
          }
        : {}),
    }),
    documentIdentiteiten: [...lokaalPerIdentiteit.keys()],
    scopeSoort: args.scope.soort,
    scopeRef: args.scope.ref,
    scopeLabel,
    ...(mapSelectie ? { mapSelectie } : {}),
    lokaleDocumentRefVoor: (identiteit) => lokaalPerIdentiteit.get(identiteit),
    chunksVoor: (bronnen) => bronnen.flatMap((resultaat, index) => {
      const lokaleRef = lokaalPerIdentiteit.get(resultaat.documentIdentiteit.id);
      if (!lokaleRef) return [];
      return [{
        id: resultaat.ref,
        document_id: lokaleRef,
        tekst: resultaat.passage,
        pagina: resultaat.locator.pagina ?? null,
        paragraaf: resultaat.locator.paragraaf ?? null,
        chunk_index: index,
        rang: resultaat.rang.score,
        documenten: {
          titel: resultaat.titel,
          bron: resultaat.documentIdentiteit.bron ?? "SharePoint",
          bibliotheek: "sharepoint",
          opslag_pad: null,
          fonds_id: args.fondsId,
          documentstatus: null,
          bronstatus: resultaat.status.bronstatus,
          extern_url: resultaat.weergave?.externUrl ?? null,
          bestandstype: resultaat.weergave?.bestandstype ?? null,
        },
      } satisfies SharePointPromptChunk];
    }),
  };
}
