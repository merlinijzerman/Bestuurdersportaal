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
  type DirectSharePointAdapterDeps,
} from "./microsoft-retrieval/direct-adapter";
import type { BronSnapshot, ItemLezer } from "./microsoft-retrieval/driveitem";
import type { GeregistreerdDocument } from "./microsoft-retrieval/mapping";
import type { Bronresultaat } from "./retrieval/contract";
import { maakDocumentIdentiteit } from "./retrieval/identiteit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function leesDirecteSharePointRefs(ruw: unknown): string[] | null {
  if (ruw === undefined || ruw === null) return [];
  if (!ruw || typeof ruw !== "object") return null;
  const scope = ruw as { soort?: unknown; refs?: unknown };
  if (scope.soort !== "document" || !Array.isArray(scope.refs)) return null;
  const refs = [...new Set(scope.refs.filter((ref): ref is string =>
    typeof ref === "string" && UUID.test(ref)
  ).map((ref) => ref.toLowerCase()))];
  // PR-3 is bewust één direct document. Mappen en meerdere documenten volgen
  // in PR-4 met eigen kandidatenselectie en afkapmeldingen.
  return refs.length === 1 && refs.length === scope.refs.length ? refs : null;
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
  refs: string[];
}): Promise<ProductieSharePointAdapter> {
  const [bronRij, token, documentRijen] = await Promise.all([
    vault.leesSharePointBron(args.fondsId),
    sharepointAccessToken({ fondsId: args.fondsId, gebruikerId: args.gebruikerId }),
    Promise.all(args.refs.map((ref) => vault.leesSharePointDocument(args.fondsId, ref))),
  ]);
  if (!bronRij || bronRij.status !== "actief") {
    throw new SharePointGraphError("bron_niet_geconfigureerd");
  }
  if (token.tenantId !== bronRij.tenant_id) {
    throw new SharePointGraphError("toestemming_of_token");
  }
  const bron = alsBronSnapshot(bronRij);
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
    }),
    documentIdentiteiten: [...lokaalPerIdentiteit.keys()],
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
