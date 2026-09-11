import "server-only";
import { MicrosoftConnectorError } from "@/core/lib/microsoft-connector-error-core";
import { sharepointAccessToken, type ConnectorContext } from "@/core/lib/microsoft-connector";
import * as vault from "@/core/lib/microsoft-vault";
import {
  SHAREPOINT_MAX_DOCUMENTEN,
  SHAREPOINT_MAX_KINDDIEPTE,
  SharePointGraphError,
  bouwDocumentboom,
  deltaUrl,
  driveRootUrl,
  drivesUrl,
  graphCollectie,
  graphJson,
  itemOnderRoot,
  itemUrl,
  kinderenUrl,
  normaliseerDrives,
  normaliseerMappen,
  normaliseerSite,
  previewActieUrl,
  rootPadVanItem,
  sharepointFoutcategorie,
  siteUrlVoorKandidaat,
  veiligeSharePointUrl,
  type DocumentProjectie,
  type GraphDrive,
  type GraphDriveItem,
  type GraphSite,
  type MapProjectie,
  type SiteProjectie,
} from "@/core/lib/microsoft-sharepoint-graph-core";

/** Maximale mapdiepte die een beheerder als rootmap kan aanwijzen. */
export const SHAREPOINT_MAX_ROOTMAP_DIEPTE = 8;

async function token(ctx: ConnectorContext) {
  try {
    return await sharepointAccessToken(ctx);
  } catch (fout) {
    if (fout instanceof MicrosoftConnectorError) throw new SharePointGraphError("toestemming_of_token", fout);
    throw fout;
  }
}

async function verifieerSite(accessToken: string, kandidaat: { hostnaam: string; server_relatief_pad: string }): Promise<SiteProjectie> {
  const site = await graphJson<GraphSite>(accessToken, siteUrlVoorKandidaat(kandidaat.hostnaam, kandidaat.server_relatief_pad));
  return normaliseerSite(site, kandidaat.hostnaam);
}

async function kandidaatVoor(ctx: ConnectorContext, kandidaatId: string) {
  const kandidaten = await vault.leesSharePointKandidaten(ctx.fondsId);
  const kandidaat = kandidaten.find((x) => x.id === kandidaatId);
  if (!kandidaat) throw new SharePointGraphError("kandidaat_onbekend");
  return kandidaat;
}

export async function sharepointStatus(ctx: ConnectorContext) {
  const [verbinding, bron] = await Promise.all([vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId), vault.leesSharePointBron(ctx.fondsId)]);
  return {
    toestemmingVereist: verbinding?.status !== "gekoppeld" || !verbinding.scopes.includes("Sites.Selected"),
    bron: bron && bron.status !== "ontkoppeld" ? {
      weergavenaam: bron.weergavenaam, site: bron.site_weergavenaam, bibliotheek: bron.drive_weergavenaam, map: bron.root_pad,
      status: bron.status, configuratieversie: bron.configuratieversie, laatstGecontroleerdOp: bron.laatst_gecontroleerd_op, foutcategorie: bron.laatst_foutcategorie,
    } : null,
  };
}

/** Alleen kandidaten die de server nú, met het token van de beheerder, echt kan
 * openen. Site-id's blijven server-side; de browser krijgt het lokale kandidaat-id. */
export async function sharepointKandidaten(ctx: ConnectorContext) {
  const { accessToken } = await token(ctx);
  const kandidaten = await vault.leesSharePointKandidaten(ctx.fondsId);
  const resultaat: Array<{ kandidaatId: string; weergavenaam: string; hostnaam: string; toegankelijk: boolean; foutcategorie: string | null }> = [];
  for (const kandidaat of kandidaten) {
    try {
      const site = await verifieerSite(accessToken, kandidaat);
      resultaat.push({ kandidaatId: kandidaat.id, weergavenaam: kandidaat.weergavenaam || site.weergavenaam, hostnaam: site.hostnaam, toegankelijk: true, foutcategorie: null });
    } catch (fout) {
      resultaat.push({ kandidaatId: kandidaat.id, weergavenaam: kandidaat.weergavenaam, hostnaam: kandidaat.hostnaam, toegankelijk: false, foutcategorie: sharepointFoutcategorie(fout) });
    }
  }
  return { kandidaten: resultaat };
}

export async function sharepointDrives(ctx: ConnectorContext, kandidaatId: string) {
  const { accessToken } = await token(ctx);
  const site = await verifieerSite(accessToken, await kandidaatVoor(ctx, kandidaatId));
  const { items } = await graphCollectie<GraphDrive>(accessToken, drivesUrl(site.siteId), { maxItems: 200, maxPaginas: 2 });
  return { site: site.weergavenaam, drives: normaliseerDrives(items) };
}

async function driveBinnenSite(accessToken: string, site: SiteProjectie, driveId: string) {
  const { items } = await graphCollectie<GraphDrive>(accessToken, drivesUrl(site.siteId), { maxItems: 200, maxPaginas: 2 });
  const drive = normaliseerDrives(items).find((x) => x.driveId === driveId);
  if (!drive) throw new SharePointGraphError("drive_niet_toegankelijk");
  return drive;
}

/** Wandelt de mapketen van de driveroot naar beneden en accepteert elk id
 * alleen als het een map is die de server zojuist als kind van de vorige heeft
 * gezien. Levert het rootitem en het weergavepad op. */
async function verifieerMapketen(accessToken: string, driveId: string, mapItemIds: string[]) {
  if (mapItemIds.length > SHAREPOINT_MAX_ROOTMAP_DIEPTE) throw new SharePointGraphError("map_niet_toegankelijk");
  const root = await graphJson<GraphDriveItem>(accessToken, driveRootUrl(driveId));
  if (!root.id || !root.folder) throw new SharePointGraphError("drive_niet_toegankelijk");
  let ouder: string | null = null;
  let rootItemId: string = root.id;
  const pad: string[] = [];
  for (const itemId of mapItemIds) {
    const kinderen: { items: GraphDriveItem[] } = await graphCollectie<GraphDriveItem>(accessToken, kinderenUrl(driveId, ouder), { maxItems: 2_000, maxPaginas: 10 });
    const map: MapProjectie | undefined = normaliseerMappen(kinderen.items, driveId).find((x) => x.itemId === itemId);
    if (!map) throw new SharePointGraphError("map_niet_toegankelijk");
    pad.push(map.naam);
    ouder = map.itemId;
    rootItemId = map.itemId;
  }
  return { rootItemId, rootPad: pad.join("/") };
}

export async function sharepointMappen(ctx: ConnectorContext, args: { kandidaatId: string; driveId: string; mapItemIds: string[] }) {
  const { accessToken } = await token(ctx);
  const site = await verifieerSite(accessToken, await kandidaatVoor(ctx, args.kandidaatId));
  await driveBinnenSite(accessToken, site, args.driveId);
  const keten = await verifieerMapketen(accessToken, args.driveId, args.mapItemIds);
  const ouder = args.mapItemIds.length > 0 ? keten.rootItemId : null;
  const { items, afgekapt } = await graphCollectie<GraphDriveItem>(accessToken, kinderenUrl(args.driveId, ouder), { maxItems: 2_000, maxPaginas: 10 });
  return { pad: keten.rootPad, mappen: normaliseerMappen(items, args.driveId), afgekapt };
}

export async function kiesSharePointBron(ctx: ConnectorContext, args: { kandidaatId: string; driveId: string; mapItemIds: string[]; weergavenaam?: string }) {
  const { accessToken, tenantId } = await token(ctx);
  const kandidaat = await kandidaatVoor(ctx, args.kandidaatId);
  const site = await verifieerSite(accessToken, kandidaat);
  const drive = await driveBinnenSite(accessToken, site, args.driveId);
  const keten = await verifieerMapketen(accessToken, drive.driveId, args.mapItemIds);
  const weergavenaam = (args.weergavenaam?.trim() || `${site.weergavenaam} · ${drive.weergavenaam}${keten.rootPad ? ` · ${keten.rootPad}` : ""}`).slice(0, 160);
  const id = await vault.configureerSharePointBron({
    fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, kandidaatId: kandidaat.id, tenantId,
    siteId: site.siteId, siteWeergavenaam: site.weergavenaam, siteHostnaam: site.hostnaam,
    driveId: drive.driveId, driveWeergavenaam: drive.weergavenaam, rootItemId: keten.rootItemId, rootPad: keten.rootPad, weergavenaam,
  });
  if (!id) throw new SharePointGraphError("bron_niet_geconfigureerd");
  return { ok: true as const };
}

/** Controleert of de vastgelegde bron met de actuele rechten van de beheerder
 * nog bereikbaar is. Het resultaat wordt met vaste categorie geregistreerd. */
export async function controleerSharePointBron(ctx: ConnectorContext) {
  const bron = await vault.leesSharePointBron(ctx.fondsId);
  if (!bron || bron.status === "ontkoppeld") throw new SharePointGraphError("bron_niet_geconfigureerd");
  try {
    const { accessToken } = await token(ctx);
    const site = await graphJson<GraphSite>(accessToken, `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(bron.site_id)}?$select=id,displayName,name,webUrl`);
    normaliseerSite(site, bron.site_hostnaam);
    const root = await graphJson<GraphDriveItem>(accessToken, `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(bron.drive_id)}/items/${encodeURIComponent(bron.root_item_id)}?$select=id,name,folder,parentReference`);
    if (!root.id || !root.folder || (root.parentReference?.driveId && root.parentReference.driveId !== bron.drive_id)) throw new SharePointGraphError("bron_niet_toegankelijk");
    await vault.registreerSharePointControle(ctx.fondsId, ctx.gebruikerId, true, null);
    return { ok: true as const };
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    await vault.registreerSharePointControle(ctx.fondsId, ctx.gebruikerId, false, categorie).catch(() => undefined);
    throw fout;
  }
}

export async function ontkoppelSharePointBron(ctx: ConnectorContext) {
  await vault.ontkoppelSharePointBron(ctx.fondsId, ctx.gebruikerId);
}

// ── Deel B (#321): documentenlijst en preview ───────────────────────────────

type BronContext = ConnectorContext & { correlationId: string };

async function actieveBron(fondsId: string) {
  const bron = await vault.leesSharePointBron(fondsId);
  if (!bron || bron.status === "ontkoppeld") throw new SharePointGraphError("bron_niet_geconfigureerd");
  return bron;
}

/** Volledige boom onder het rootitem via delta-enumeratie (één gepagineerde
 * stroom ongeacht diepte). Werkt delta niet onder de verleende scope, dan
 * volgt een begrensde recursieve children-listing; beide zijn read-only
 * metadata-calls zonder content. */
async function enumereerBoom(accessToken: string, driveId: string, rootItemId: string) {
  let afgekapt = false;
  let items: GraphDriveItem[];
  try {
    const delta = await graphCollectie<GraphDriveItem>(accessToken, deltaUrl(driveId, rootItemId), { maxItems: SHAREPOINT_MAX_DOCUMENTEN, maxPaginas: 30 });
    items = delta.items; afgekapt = delta.afgekapt;
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    if (categorie === "graph_timeout" || categorie === "graph_ratelimit" || categorie === "graph_paginering") throw fout;
    items = [];
    const wachtrij: Array<{ id: string; diepte: number }> = [{ id: rootItemId, diepte: 0 }];
    while (wachtrij.length > 0 && items.length < SHAREPOINT_MAX_DOCUMENTEN) {
      const { id, diepte } = wachtrij.shift()!;
      const kinderen = await graphCollectie<GraphDriveItem>(accessToken, kinderenUrl(driveId, id), { maxItems: SHAREPOINT_MAX_DOCUMENTEN - items.length, maxPaginas: 10 });
      afgekapt = afgekapt || kinderen.afgekapt;
      for (const kind of kinderen.items) {
        items.push(kind);
        if (kind.folder && kind.id) {
          if (diepte + 1 >= SHAREPOINT_MAX_KINDDIEPTE) afgekapt = true;
          else wachtrij.push({ id: kind.id, diepte: diepte + 1 });
        }
      }
    }
    if (wachtrij.length > 0) afgekapt = true;
  }
  return { ...bouwDocumentboom(items, driveId, rootItemId), afgekapt };
}

export async function sharepointDocumenten(ctx: BronContext) {
  const start = Date.now();
  const bron = await actieveBron(ctx.fondsId);
  try {
    const { accessToken } = await token(ctx);
    const boom = await enumereerBoom(accessToken, bron.drive_id, bron.root_item_id);
    const refs = await vault.upsertSharePointDocumenten({ fondsId: ctx.fondsId, bronId: bron.id, configuratieversie: bron.configuratieversie, documenten: boom.documenten });
    const refVan = new Map(refs.map((x) => [x.item_id, x.ref]));
    const documenten = boom.documenten.flatMap((doc: DocumentProjectie) => {
      const ref = refVan.get(doc.itemId);
      return ref ? [{ ref, naam: doc.naam, bestandstype: doc.bestandstype, grootte: doc.grootte, gewijzigdOp: doc.gewijzigdOp, mappad: doc.mappad, previewMogelijk: doc.bestandstype !== null, webUrl: doc.webUrl }] : [];
    });
    await vault.registreerSharePointGebeurtenis({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, gebeurtenis: "microsoft.sharepoint.lijst.geslaagd", correlationId: ctx.correlationId, foutcategorie: null, details: { bron_id: bron.id, aantal: documenten.length, mappen: boom.mappen.length, afgekapt: boom.afgekapt, latency_ms: Date.now() - start } }).catch(() => undefined);
    return { bron: { weergavenaam: bron.weergavenaam, site: bron.site_weergavenaam, bibliotheek: bron.drive_weergavenaam, map: bron.root_pad }, documenten, mappen: boom.mappen, afgekapt: boom.afgekapt };
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    await vault.registreerSharePointGebeurtenis({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, gebeurtenis: "microsoft.sharepoint.lijst.mislukt", correlationId: ctx.correlationId, foutcategorie: categorie, details: { bron_id: bron.id, latency_ms: Date.now() - start } }).catch(() => undefined);
    throw fout;
  }
}

/** Levert een kortlevende preview-URL op na een nieuwe server-side controle op
 * fonds (via de lokale referentie), bron, gebruiker (eigen token) en ligging
 * onder het rootitem. De URL wordt teruggegeven en nergens bewaard of gelogd. */
export async function sharepointPreview(ctx: BronContext, ref: string) {
  const start = Date.now();
  const document = await vault.leesSharePointDocument(ctx.fondsId, ref);
  if (!document || document.bron_status === "ontkoppeld") throw new SharePointGraphError("niet_gevonden");
  if (!document.bestandstype) throw new SharePointGraphError("graph_response");
  try {
    const { accessToken } = await token(ctx);
    let item: GraphDriveItem;
    try {
      item = await graphJson<GraphDriveItem>(accessToken, itemUrl(document.drive_id, document.item_id));
    } catch (fout) {
      if (sharepointFoutcategorie(fout) === "niet_gevonden") await vault.markeerSharePointDocument(ctx.fondsId, ref, "verwijderd").catch(() => undefined);
      throw fout;
    }
    const root = await graphJson<GraphDriveItem>(accessToken, itemUrl(document.drive_id, document.root_item_id));
    if (!root.id || !root.folder || !itemOnderRoot(item, document.drive_id, rootPadVanItem(root, document.drive_id))) {
      await vault.markeerSharePointDocument(ctx.fondsId, ref, "ontoegankelijk").catch(() => undefined);
      throw new SharePointGraphError("bron_niet_toegankelijk");
    }
    const preview = await graphJson<{ getUrl?: string; postUrl?: string }>(accessToken, previewActieUrl(document.drive_id, document.item_id), { method: "POST", body: {} });
    const url = veiligeSharePointUrl(preview.getUrl);
    if (!url) throw new SharePointGraphError("graph_response");
    await vault.registreerSharePointGebeurtenis({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, gebeurtenis: "microsoft.sharepoint.preview.geslaagd", correlationId: ctx.correlationId, foutcategorie: null, details: { document_ref: ref, latency_ms: Date.now() - start } }).catch(() => undefined);
    return { url, naam: item.name?.slice(0, 240) ?? document.naam, bestandstype: document.bestandstype, webUrl: veiligeSharePointUrl(item.webUrl) };
  } catch (fout) {
    const categorie = sharepointFoutcategorie(fout);
    await vault.registreerSharePointGebeurtenis({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, gebeurtenis: "microsoft.sharepoint.preview.mislukt", correlationId: ctx.correlationId, foutcategorie: categorie, details: { document_ref: ref, latency_ms: Date.now() - start } }).catch(() => undefined);
    throw fout;
  }
}
