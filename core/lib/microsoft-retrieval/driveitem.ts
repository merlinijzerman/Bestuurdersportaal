// ============================================================================
//  #413 T4-C — De VERSE DriveItem-bevestiging.
// ----------------------------------------------------------------------------
//  Het register is een index, geen bewijs. Het zegt wat wij bij de laatste
//  listing zagen; het zegt niets over nu. Deze module leest het item opnieuw en
//  toetst elke schakel die de keten draagt:
//
//    • de BRON is nog actief en de configuratieversie is niet verschoven;
//    • de TENANT van het token is de tenant van de bron;
//    • drive en site van het document horen bij die bron;
//    • het ITEM bestaat nog, is een bestand, hangt aan dezelfde drive en ligt
//      onder de opnieuw gelezen root;
//    • de `webUrl` van het VERSE item is exact de URL waarop Copilot ons stuurde.
//
//  DIE LAATSTE IS DE REDEN DAT DEZE STAP BESTAAT. `web_url` in het register is
//  een momentopname. Na een rename of verplaatsing kan een ANDER bestand die
//  oude URL overnemen; de registeropzoeking geeft dan keurig één rij terug, maar
//  voor het verkeerde document. Alleen Graph kan zeggen welke URL dit item nú
//  heeft, en die vergelijking sluit het gat.
//
//  Rechten worden niet apart gecontroleerd: de lezing gebeurt met het
//  DELEGATED token van de actor. Ziet hij het item niet, dan geeft Graph 403 of
//  404 en valt de kandidaat af — dat is een echte rechtencheck en geen
//  administratie in onze database.
// ============================================================================
import {
  itemOnderRoot,
  rootPadVanItem,
  type GraphDriveItem,
} from "../microsoft-sharepoint-graph-core";
import { canoniekeWebUrl, type GeregistreerdDocument } from "./mapping";

/** Waarom een kandidaat bij de verse lezing afvalt. Inhoudsvrij. */
export type ItemAfwijzing =
  | "root"
  | "binding"
  | "rechten_configuratie"
  | "versie";

/** De serververtrouwde bronregistratie, opnieuw gelezen binnen dit verzoek. */
export interface BronSnapshot {
  id: string;
  tenantId: string;
  siteHostnaam: string;
  driveId: string;
  rootItemId: string;
  configuratieversie: number;
  status: string;
}

/** Versiebewijs zoals Graph het levert; blijft adapterprivate. */
export interface Versiebewijs {
  soort: "etag" | "ctag";
  waarde: string;
}

export interface RootUitkomst {
  ok: true;
  /** De autoritatieve root-URL: uit Graph, niet uit onze database. */
  rootWebUrl: string;
  rootGraphPad: string;
}

export type RootResultaat = RootUitkomst | { ok: false; afwijzing: ItemAfwijzing };

/**
 * Leest de root ÉÉN KEER per verzoek en levert de twee waarden waarop alle
 * kandidaten worden getoetst: de webUrl (voor de scope en de rootgrens) en het
 * Graph-pad (voor de liggingscontrole).
 *
 * De root-URL komt bewust uit Graph en niet uit `sharepoint_bronnen.root_pad`:
 * Graph is de autoriteit over waar de map nú staat, en onze registratie kan
 * achterlopen na een verplaatsing.
 */
export async function leesRoot(
  bron: BronSnapshot,
  leesItem: (itemId: string) => Promise<GraphDriveItem>,
): Promise<RootResultaat> {
  if (bron.status !== "actief") return { ok: false, afwijzing: "rechten_configuratie" };
  let root: GraphDriveItem;
  try {
    root = await leesItem(bron.rootItemId);
  } catch {
    // Geen root betekent geen scope; er vertrekt dan ook geen retrievalcall.
    return { ok: false, afwijzing: "rechten_configuratie" };
  }
  if (root.id !== bron.rootItemId || !root.folder || root.parentReference?.driveId !== bron.driveId) {
    return { ok: false, afwijzing: "rechten_configuratie" };
  }
  const rootWebUrl = canoniekeWebUrl(root.webUrl);
  const rootGraphPad = rootPadVanItem(root, bron.driveId);
  if (!rootWebUrl || !rootGraphPad) return { ok: false, afwijzing: "rechten_configuratie" };
  return { ok: true, rootWebUrl, rootGraphPad };
}

export type ItemResultaat =
  | { ok: true; versie: Versiebewijs; naam: string }
  | { ok: false; afwijzing: ItemAfwijzing };

/**
 * Bevestigt één kandidaat op het verse item.
 *
 * `hitCanoniek` is de canonieke URL waarop Copilot ons stuurde. Hij wordt hier
 * vergeleken met de canonieke `webUrl` van het item ZOALS GRAPH HEM NU GEEFT —
 * de enige manier om URL-hergebruik na een rename te uit te sluiten.
 */
export async function bevestigKandidaatItem(
  args: {
    bron: BronSnapshot;
    /** Tenant van het DELEGATED token; moet die van de bron zijn. */
    tokenTenantId: string;
    document: GeregistreerdDocument;
    hitCanoniek: string;
    rootGraphPad: string;
  },
  leesItem: (itemId: string) => Promise<GraphDriveItem>,
): Promise<ItemResultaat> {
  const { bron, document, hitCanoniek, rootGraphPad } = args;

  // Configuratie- en tenantbinding, vóór de netwerkcall.
  if (bron.status !== "actief") return { ok: false, afwijzing: "rechten_configuratie" };
  if (bron.tenantId !== args.tokenTenantId) return { ok: false, afwijzing: "binding" };
  if (document.bronId !== bron.id) return { ok: false, afwijzing: "binding" };
  if (document.driveId !== bron.driveId) return { ok: false, afwijzing: "binding" };
  if (document.siteHostnaam !== bron.siteHostnaam) return { ok: false, afwijzing: "binding" };
  if (document.rootItemId !== bron.rootItemId) return { ok: false, afwijzing: "binding" };
  if (document.configuratieversie !== bron.configuratieversie) {
    // De bron is tijdens dit verzoek opnieuw geconfigureerd: de registratie
    // waarop deze kandidaat rust, bestaat niet meer.
    return { ok: false, afwijzing: "rechten_configuratie" };
  }

  let item: GraphDriveItem;
  try {
    item = await leesItem(document.itemId);
  } catch {
    // 403/404/410: de actor ziet dit item niet (meer). Een echte rechtencheck.
    return { ok: false, afwijzing: "rechten_configuratie" };
  }

  if (item.id !== document.itemId) return { ok: false, afwijzing: "binding" };
  if (item.parentReference?.driveId !== bron.driveId) return { ok: false, afwijzing: "binding" };
  if (!item.file) return { ok: false, afwijzing: "binding" };
  if (!itemOnderRoot(item, bron.driveId, rootGraphPad)) return { ok: false, afwijzing: "root" };

  // DE ANTI-HERGEBRUIKCONTROLE. Zonder deze regel kan een hit op de oude URL
  // van bestand A na een rename bij bestand B uitkomen.
  if (canoniekeWebUrl(item.webUrl) !== hitCanoniek) return { ok: false, afwijzing: "binding" };

  const etag = item.eTag?.trim();
  const ctag = item.cTag?.trim();
  const versie: Versiebewijs | null = etag
    ? { soort: "etag", waarde: etag }
    : ctag
      ? { soort: "ctag", waarde: ctag }
      : null;
  // Geen versiebewijs = geen kandidaat: wat het model straks ziet, moet later
  // aan een versie zijn terug te voeren.
  if (!versie) return { ok: false, afwijzing: "versie" };

  return { ok: true, versie, naam: item.name?.slice(0, 240) ?? document.naam };
}

/**
 * De tweede versielezing, ná download en extractie. Exacte gelijkheid met de
 * eerste is vereist.
 *
 * Waarom opnieuw lezen en niet de eerste waarde onthouden: tussen de eerste
 * lezing en de extractie zit een download. Wijzigt het bestand in dat venster,
 * dan hebben wij bytes van versie A en een bewijs van versie B — precies het
 * geval waarin een citaat later niet meer klopt met wat er stond.
 */
export async function bevestigVersieOngewijzigd(
  args: { document: GeregistreerdDocument; versieVoor: Versiebewijs },
  leesItem: (itemId: string) => Promise<GraphDriveItem>,
): Promise<{ ok: true } | { ok: false; afwijzing: ItemAfwijzing }> {
  let item: GraphDriveItem;
  try {
    item = await leesItem(args.document.itemId);
  } catch {
    return { ok: false, afwijzing: "rechten_configuratie" };
  }
  if (item.id !== args.document.itemId) return { ok: false, afwijzing: "binding" };
  const waarde = args.versieVoor.soort === "etag" ? item.eTag?.trim() : item.cTag?.trim();
  if (!waarde || waarde !== args.versieVoor.waarde) return { ok: false, afwijzing: "versie" };
  return { ok: true };
}
