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
//  ── WELKE FOUT IS EEN WEIGERING, EN WELKE STOPT DE BEURT ───────────────────
//  Een catch-all was hier fout: die maakt van een annulering, een verlopen
//  deadline, een 429 of een 5xx net zo goed een "kandidaat geweigerd", en dan
//  gaat de assistent stil door op een kleinere bronset. Precies de fail-open die
//  §3.5 van de planreview dichttimmert. De regels nu:
//
//    • AFBREKING (annulering of deadline) wordt ONMIDDELLIJK doorgegooid, en na
//      élke I/O wordt het signaal opnieuw bewaakt — ook als de lezing zelf
//      toevallig nog slaagde. Zonder die tweede controle telt een antwoord dat
//      ná de afbreking binnenkwam alsnog mee.
//    • `niet_gevonden` (404) en `toestemming_of_token` (401/403) op een ITEM zijn
//      kandidaatweigeringen: dit ene document is weg of onzichtbaar voor deze
//      actor.
//    • Al het andere — timeout, rate limit, onleesbaar antwoord, onbekende fout —
//      wordt DOORGEGOOID. Dat is een storing, geen uitspraak over dit document.
//
//  EN DE ROOT IS EEN GEVAL APART. `graphJson` kan 401 en 403 niet uit elkaar
//  houden (beide worden `toestemming_of_token`), dus op itemniveau zou een kapot
//  token eruitzien als "deze gebruiker mag dit document niet". Dat gat wordt
//  gedicht door de rootlezing: die is niet kandidaatspecifiek, dus dáár is élke
//  fout beurt-breed en wordt niets tot een weigering gereduceerd. Is het token
//  ongeldig, dan faalt de root als eerste en stopt de beurt vóór er ook maar één
//  kandidaat wordt beoordeeld. Een 403 ná een geslaagde rootlezing is daarmee
//  aantoonbaar kandidaatspecifiek.
// ============================================================================
import {
  itemOnderRoot,
  rootPadVanItem,
  sharepointFoutcategorie,
  type GraphDriveItem,
} from "../microsoft-sharepoint-graph-core";
import { bewaakNaIO, isAfbreking } from "../retrieval/afbreken";
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

/** Leest één DriveItem. Werpt de fouten van de Graph-laag ongewijzigd door. */
export type ItemLezer = (itemId: string) => Promise<GraphDriveItem>;

/**
 * De enige twee Graph-uitkomsten die over ÉÉN document gaan. Al het andere
 * treft de hele beurt en mag geen kandidaatweigering worden.
 */
function isKandidaatWeigering(fout: unknown): boolean {
  const categorie = sharepointFoutcategorie(fout);
  return categorie === "niet_gevonden" || categorie === "toestemming_of_token";
}

/**
 * Leest een item en scheidt de drie uitkomsten: gelukt, deze kandidaat valt af,
 * of de beurt stopt. Afbrekingen gaan er ongemoeid doorheen.
 */
async function leesItemVeilig(
  leesItem: ItemLezer,
  itemId: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; item: GraphDriveItem } | { ok: false }> {
  bewaakNaIO(signal);
  let item: GraphDriveItem;
  try {
    item = await leesItem(itemId);
  } catch (fout) {
    // Eerst de afbreking: een annulering die als providerfout wordt gelezen,
    // start alsnog een stille degradatie.
    bewaakNaIO(signal, fout);
    if (isAfbreking(fout)) throw fout;
    if (isKandidaatWeigering(fout)) return { ok: false };
    throw fout;
  }
  // En ook op het SUCCESPAD: het signaal kan zijn afgegaan terwijl deze lezing
  // onderweg was. Zonder deze controle telt een antwoord van ná de afbreking mee.
  bewaakNaIO(signal);
  return { ok: true, item };
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
 *
 * GEEN ENKELE GRAPH-FOUT WORDT HIER GEREDUCEERD. De root is de scope zelf; kan
 * die niet worden vastgesteld, dan is er niets te doorzoeken en stopt de beurt.
 * Alleen een bron die al vóór de call niet actief is, levert een gewone
 * configuratie-uitkomst op — daar is geen call voor nodig.
 */
export async function leesRoot(
  bron: BronSnapshot,
  leesItem: ItemLezer,
  signal?: AbortSignal,
): Promise<RootResultaat> {
  if (bron.status !== "actief") return { ok: false, afwijzing: "rechten_configuratie" };
  bewaakNaIO(signal);
  const root = await leesItem(bron.rootItemId);
  bewaakNaIO(signal);
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
 * de enige manier om URL-hergebruik na een rename uit te sluiten.
 */
export async function bevestigKandidaatItem(
  args: {
    bron: BronSnapshot;
    /** Tenant van het DELEGATED token; moet die van de bron zijn. */
    tokenTenantId: string;
    document: GeregistreerdDocument;
    hitCanoniek: string;
    rootGraphPad: string;
    signal?: AbortSignal;
  },
  leesItem: ItemLezer,
): Promise<ItemResultaat> {
  const { bron, document, hitCanoniek, rootGraphPad, signal } = args;

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

  const gelezen = await leesItemVeilig(leesItem, document.itemId, signal);
  // 404/403: de actor ziet dit item niet (meer). Een echte rechtencheck, en
  // uitsluitend over dit ene document.
  if (!gelezen.ok) return { ok: false, afwijzing: "rechten_configuratie" };
  const item = gelezen.item;

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
  args: { document: GeregistreerdDocument; versieVoor: Versiebewijs; signal?: AbortSignal },
  leesItem: ItemLezer,
): Promise<{ ok: true } | { ok: false; afwijzing: ItemAfwijzing }> {
  const gelezen = await leesItemVeilig(leesItem, args.document.itemId, args.signal);
  if (!gelezen.ok) return { ok: false, afwijzing: "rechten_configuratie" };
  const item = gelezen.item;
  if (item.id !== args.document.itemId) return { ok: false, afwijzing: "binding" };
  const waarde = args.versieVoor.soort === "etag" ? item.eTag?.trim() : item.cTag?.trim();
  if (!waarde || waarde !== args.versieVoor.waarde) return { ok: false, afwijzing: "versie" };
  return { ok: true };
}
