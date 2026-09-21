// ============================================================================
//  #413 T4-C deel 2b — De keten van kandidaat naar eigen passage.
// ----------------------------------------------------------------------------
//  Volledig hermetisch: geen netwerk, geen database, geen token, geen vlag.
//  Graph-lezing, registeropzoeking, kandidatenbron, download en extractie zijn
//  alle vijf geïnjecteerd.
//
//  De nadruk ligt op de NEGATIEVE gevallen. Een keten die op de gelukkige weg
//  werkt bewijst weinig; wat deze arm moet waarmaken is dat er geen enkele weg
//  is waarlangs een passage naar buiten komt zonder dat scope, versie en
//  uniciteit alle drie zijn vastgesteld.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  KETEN_AFWIJZINGEN,
  KETEN_GRENZEN,
  extractieType,
  voerKetenUit,
  type KetenGrenzen,
  type KetenOpdracht,
  type KetenResultaat,
  type KetenTelling,
} from "../../core/lib/microsoft-retrieval/keten";
import { canoniekeWebUrl, type GeregistreerdDocument } from "../../core/lib/microsoft-retrieval/mapping";
import type { BronSnapshot } from "../../core/lib/microsoft-retrieval/driveitem";
import type { DownloadOpdracht, DownloadResultaat } from "../../core/lib/microsoft-retrieval/download";
import { MAX_DOWNLOAD_BYTES } from "../../core/lib/microsoft-retrieval/download";
import type { CopilotKandidaat } from "../../core/lib/microsoft-retrieval/client";
import type { Bestandstype, ExtractieResultaat, TekstSegment } from "../../core/lib/document-extractie";
import { SharePointGraphError, type GraphDriveItem } from "../../core/lib/microsoft-sharepoint-graph-core";
import { RetrievalAfgebroken, isAfbreking } from "../../core/lib/retrieval/afbreken";

// ── De wereld ───────────────────────────────────────────────────────────────

const HOST = "check.sharepoint.com";
const DRIVE = "drive-1";
const ROOT_ITEM = "root-1";
const ROOT_URL = `https://${HOST}/sites/pgb/Documenten`;
const ROOT_PAD = `/drives/${DRIVE}/root:/Documenten`;
const TENANT = "tenant-1";

const BRON: BronSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: TENANT,
  siteHostnaam: HOST,
  driveId: DRIVE,
  rootItemId: ROOT_ITEM,
  configuratieversie: 3,
  status: "actief",
};

const ZIN = "De hersteltermijn voor Koraalmaat 47 bedraagt twaalf maanden na vaststelling.";
/** Het extract zoals Microsoft het levert: andere kapitalisatie, andere streepjes. */
const EXTRACT = "DE HERSTELTERMIJN VOOR KORAALMAAT 47 BEDRAAGT TWAALF MAANDEN";

function rootItem(extra: Partial<GraphDriveItem> = {}): GraphDriveItem {
  return {
    id: ROOT_ITEM,
    name: "Documenten",
    webUrl: ROOT_URL,
    folder: { childCount: 9 },
    parentReference: { driveId: DRIVE, id: "drive-root", path: `/drives/${DRIVE}/root:` },
    ...extra,
  };
}

interface DocOpties {
  itemId: string;
  naam: string;
  /** Zoals het REGISTER het kent; kan een type zijn dat wij niet extraheren. */
  bestandstype?: string | null;
  /** De canonieke URL waaronder het document in het register staat. */
  url?: string;
  etag?: string;
  tekst?: string;
  bytes?: number;
  /** Per lezing een afwijking op het Graph-item; index 0 = eerste lezing. */
  lezingen?: (Partial<GraphDriveItem> | "niet_gevonden" | "storing")[];
  /** Registerrij-afwijkingen. */
  registratie?: Partial<GeregistreerdDocument>;
}

interface Wereld {
  leesItem: KetenOpdracht["leesItem"];
  zoekRegister: KetenOpdracht["zoekRegister"];
  downloadImpl: (opdracht: DownloadOpdracht) => Promise<DownloadResultaat>;
  extractImpl: (bytes: Buffer, type: Bestandstype) => Promise<ExtractieResultaat>;
  log: {
    lezingen: string[];
    lezingSignalen: (AbortSignal | undefined)[];
    opzoekingen: string[];
    downloads: DownloadOpdracht[];
    extracties: Bestandstype[];
  };
  url: (naam: string) => string;
}

function wereld(docs: DocOpties[], opties: { rootAfwijking?: Partial<GraphDriveItem> } = {}): Wereld {
  const log = {
    lezingen: [] as string[],
    lezingSignalen: [] as (AbortSignal | undefined)[],
    opzoekingen: [] as string[],
    downloads: [] as DownloadOpdracht[],
    extracties: [] as Bestandstype[],
  };
  const register = new Map<string, GeregistreerdDocument>();
  const graafItems = new Map<string, DocOpties>();
  const urls = new Map<string, string>();
  const tellingPerItem = new Map<string, number>();

  for (const doc of docs) {
    const url = doc.url ?? `${ROOT_URL}/${doc.naam}`;
    urls.set(doc.naam, url);
    graafItems.set(doc.itemId, doc);
    const canoniek = canoniekeWebUrl(url);
    assert.ok(canoniek, `geen canonieke vorm voor ${url}`);
    register.set(canoniek, {
      ref: `ref-${doc.itemId}`,
      bronId: BRON.id,
      driveId: DRIVE,
      itemId: doc.itemId,
      rootItemId: ROOT_ITEM,
      naam: doc.naam,
      bestandstype: doc.bestandstype === undefined ? "docx" : doc.bestandstype,
      mappad: "/Documenten",
      status: "gezien",
      bronStatus: "actief",
      siteHostnaam: HOST,
      configuratieversie: 3,
      ...(doc.registratie ?? {}),
    });
  }

  const leesItem: KetenOpdracht["leesItem"] = async (itemId, signal) => {
    log.lezingen.push(itemId);
    log.lezingSignalen.push(signal);
    if (itemId === ROOT_ITEM) return rootItem(opties.rootAfwijking);
    const doc = graafItems.get(itemId);
    if (!doc) throw new SharePointGraphError("niet_gevonden");
    const keer = (tellingPerItem.get(itemId) ?? 0) + 1;
    tellingPerItem.set(itemId, keer);
    const afwijking = doc.lezingen?.[keer - 1];
    if (afwijking === "niet_gevonden") throw new SharePointGraphError("niet_gevonden");
    if (afwijking === "storing") throw new SharePointGraphError("graph_response");
    return {
      id: doc.itemId,
      name: doc.naam,
      eTag: doc.etag ?? `W/"etag-${doc.itemId}"`,
      cTag: `"ctag-${doc.itemId}"`,
      webUrl: urls.get(doc.naam)!,
      file: { mimeType: "application/octet-stream" },
      parentReference: { driveId: DRIVE, id: ROOT_ITEM, path: ROOT_PAD },
      ...(afwijking ?? {}),
    };
  };

  const zoekRegister: KetenOpdracht["zoekRegister"] = async (canoniek) => {
    log.opzoekingen.push(canoniek);
    return register.get(canoniek);
  };

  // De extractie krijgt alleen bytes te zien en weet dus niet welk document dit
  // is. De keten downloadt en extraheert strikt na elkaar per document, dus het
  // laatst gedownloade item IS het item dat nu wordt geëxtraheerd.
  let laatsteItem: string | null = null;

  const downloadImpl = async (opdracht: DownloadOpdracht): Promise<DownloadResultaat> => {
    log.downloads.push(opdracht);
    laatsteItem = opdracht.itemId;
    const doc = graafItems.get(opdracht.itemId);
    const grootte = doc?.bytes ?? 1_000;
    return { ok: true, bytes: Buffer.alloc(grootte, 1) };
  };

  const extractImpl = async (_bytes: Buffer, type: Bestandstype): Promise<ExtractieResultaat> => {
    log.extracties.push(type);
    const doc = laatsteItem ? graafItems.get(laatsteItem) : undefined;
    const tekst = doc?.tekst ?? ZIN;
    return { tekst, aantalPaginas: 1, segmenten: [segment(tekst)] };
  };

  return {
    leesItem,
    zoekRegister,
    downloadImpl,
    extractImpl,
    log,
    url: (naam) => urls.get(naam)!,
  };
}

/** Eén segment met de gegeven tekst; de normale uitkomst van onze extractie. */
const segment = (tekst: string, pagina: number | null = 4, paragraaf: string | null = "2.1"): TekstSegment =>
  ({ tekst, pagina, paragraaf });

/** Een extractie die per ITEM andere tekst oplevert. */
function extractiePerItem(tekstPerItem: Record<string, TekstSegment[]>, volgorde: string[]) {
  let i = 0;
  return async (_bytes: Buffer, _type: Bestandstype): Promise<ExtractieResultaat> => {
    const itemId = volgorde[Math.min(i++, volgorde.length - 1)];
    return { tekst: "", aantalPaginas: 1, segmenten: tekstPerItem[itemId] ?? [] };
  };
}

function hit(webUrl: string, ...extracts: string[]): CopilotKandidaat {
  return { webUrl, extracts };
}

function opdrachtVoor(
  w: Wereld,
  kandidaten: CopilotKandidaat[],
  extra: Partial<KetenOpdracht> = {},
): KetenOpdracht {
  return {
    bron: BRON,
    tokenTenantId: TENANT,
    accessToken: "stub-token",
    leesItem: w.leesItem,
    zoekRegister: w.zoekRegister,
    haalKandidaten: async () => kandidaten,
    downloadImpl: w.downloadImpl,
    extractImpl: w.extractImpl,
    ...extra,
  };
}

/** Beide balansen uit `KetenTelling`. Ze moeten ALTIJD sluiten. */
function controleerBalans(resultaat: KetenResultaat): void {
  const t: KetenTelling = resultaat.telling;
  const a = t.afwijzingen;
  for (const grond of KETEN_AFWIJZINGEN) {
    assert.equal(typeof a[grond], "number", `grond ${grond} ontbreekt`);
    assert.ok(a[grond] >= 0, `grond ${grond} is negatief`);
  }
  assert.equal(
    t.hitsAfgewezen + t.hitsBuitenGrens + t.hitsGegroepeerd,
    t.hits,
    `hitsbalans sluit niet: ${JSON.stringify(t)}`,
  );
  const treffers = resultaat.ok ? resultaat.treffers.length : 0;
  assert.equal(
    treffers + t.documentenAfgewezen,
    t.documenten,
    `documentbalans sluit niet: ${JSON.stringify(t)}`,
  );
  // En de gronden moeten samen precies die twee totalen dekken. Zonder deze
  // derde controle kan een grond worden overgeslagen terwijl beide balansen
  // gewoon sluiten.
  const somGronden = KETEN_AFWIJZINGEN.reduce((som, grond) => som + a[grond], 0);
  assert.equal(
    somGronden,
    t.hitsAfgewezen + t.documentenAfgewezen,
    `de gronden dekken de totalen niet: ${JSON.stringify(t)}`,
  );
}


// ── 1. De gelukkige weg ─────────────────────────────────────────────────────

test("één hit levert één treffer, met de passage UIT DE EIGEN EXTRACTIE", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));

  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 1);
  const treffer = resultaat.treffers[0];
  assert.equal(treffer.ref, "ref-item-a");
  assert.equal(treffer.naam, "A.docx");
  assert.equal(treffer.bestandstype, "docx");
  assert.equal(treffer.passage, ZIN);
  assert.equal(treffer.pagina, 4);
  assert.equal(treffer.paragraaf, "2.1");
  assert.equal(treffer.versie.soort, "etag");
  controleerBalans(resultaat);

  // De root is ÉÉN keer gelezen, het item twee keer: vóór en ná de download.
  assert.deepEqual(w.log.lezingen, [ROOT_ITEM, "item-a", "item-a"]);
  assert.equal(w.log.downloads.length, 1);
  assert.equal(w.log.extracties.length, 1);
});

test("de kandidatenbron krijgt DE ZOJUIST GELEZEN root, niet de registratie", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  let gezien: { rootWebUrl: string; siteHostnaam: string } | null = null;
  await voerKetenUit(
    opdrachtVoor(w, [], {
      haalKandidaten: async (root) => {
        gezien = root;
        return [];
      },
    }),
  );
  // Zouden filter en rootgrens uit twee verschillende lezingen komen, dan is het
  // filter op root A gebouwd en de grens tegen root B getoetst.
  assert.deepEqual(gezien, { rootWebUrl: ROOT_URL, siteHostnaam: HOST });
});

test("een lege uitslag is een geldige uitkomst, geen fout", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx" }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, []));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.hits, 0);
  assert.equal(resultaat.telling.deadlineVerlopen, false);
  controleerBalans(resultaat);
});

// ── 2. Deduplicatie VÓÓR de downloads ───────────────────────────────────────

test("drie hits op hetzelfde document zijn ÉÉN download en ÉÉN extractie", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const url = w.url("A.docx");
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(url, "niet te vinden hier"), hit(url, "ook al niet aanwezig"), hit(url, EXTRACT)]),
  );

  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 1);
  assert.equal(resultaat.telling.hits, 3);
  assert.equal(resultaat.telling.documenten, 1);
  assert.equal(resultaat.telling.hitsGegroepeerd, 3);
  assert.equal(w.log.downloads.length, 1, "er is meer dan één keer gedownload");
  assert.equal(w.log.extracties.length, 1);
  controleerBalans(resultaat);
});

test("een weergave-URL en een normale URL zijn HETZELFDE document", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const viewer = `https://${HOST}/:w:/r/sites/pgb/Documenten/A.docx`;
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(viewer, "staat er niet in"), hit(w.url("A.docx"), EXTRACT)]),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.documenten, 1, "de weergave-URL is als apart document geteld");
  assert.equal(w.log.downloads.length, 1);
  controleerBalans(resultaat);
});

test("identieke extracts tellen als ÉÉN aanwijzer (ontdubbeling)", async () => {
  // Twintig keer exact hetzelfde extract, dán de bruikbare. Bij een grens van
  // drie aanwijzers haalt de bruikbare het ALLEEN als de twintig tot één zijn
  // samengetrokken. Zonder ontdubbeling valt hij buiten de grens en blijft deze
  // test rood.
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const url = w.url("A.docx");
  const zelfde = Array.from({ length: 20 }, () => hit(url, "precies dezelfde aanwijzer, telkens weer"));
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [...zelfde, hit(url, EXTRACT)], { grenzen: { maxExtractsPerDocument: 3 } }),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 1, "de bruikbare aanwijzer is buiten de grens gevallen");
  assert.equal(resultaat.telling.hitsGegroepeerd, 21);
  controleerBalans(resultaat);
});

test("het AANTAL aanwijzers per document is begrensd", async () => {
  // Nu twintig VERSCHILLENDE aanwijzers vóór de bruikbare. Die kunnen niet
  // worden samengetrokken, dus de grens moet hem eruit houden — anders doet
  // één document met veel hits alsnog eenentwintig zoekacties.
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const url = w.url("A.docx");
  const verschillend = Array.from({ length: 20 }, (_, i) =>
    hit(url, `aanwijzer nummer ${i} die nergens in deze tekst voorkomt`),
  );
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [...verschillend, hit(url, EXTRACT)], { grenzen: { maxExtractsPerDocument: 3 } }),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0, "de grens op aanwijzers doet niets");
  assert.equal(resultaat.telling.afwijzingen.lokalisatie, 1);
  controleerBalans(resultaat);

  // Positieve controle: met ruimte voor alle aanwijzers wordt hij wél gevonden.
  const ruim = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const tweede = await voerKetenUit(
    opdrachtVoor(ruim, [...verschillend, hit(url, EXTRACT)], { grenzen: { maxExtractsPerDocument: 30 } }),
  );
  assert.ok(tweede.ok);
  assert.equal(tweede.treffers.length, 1);
});

test("TWEE canonieke URL's naar HETZELFDE document zijn ambigu en vallen beide af", async () => {
  // Het register dwingt één rij per canonieke URL af, maar twee rijen kunnen
  // naar hetzelfde item wijzen. Dan is niet aan te wijzen welke locator geldt.
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN },
    { itemId: "item-a", naam: "A-kopie.docx", tekst: ZIN, registratie: { ref: "ref-item-a" } },
  ]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT), hit(w.url("A-kopie.docx"), EXTRACT)]),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.documenten, 0);
  assert.equal(resultaat.telling.afwijzingen.mapping, 2);
  assert.equal(w.log.downloads.length, 0, "er is gedownload ondanks ambiguïteit");
  assert.equal(w.log.lezingen.length, 1, "alleen de root had gelezen mogen worden");
  controleerBalans(resultaat);
});

// ── 3. Rootgrens en register ────────────────────────────────────────────────

test("een hit buiten de root valt af zonder registeropzoeking", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx" }]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(`https://${HOST}/sites/anders/Geheim/A.docx`, EXTRACT)]),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.root, 1);
  assert.equal(w.log.opzoekingen.length, 0, "er is toch in het register gezocht");
  controleerBalans(resultaat);
});

test("een sharinglink blijft fail-closed: hij staat niet in het register", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx" }]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(`https://${HOST}/:w:/s/Eg7aTokenTokenToken`, EXTRACT)]),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.documenten, 0);
  assert.equal(w.log.downloads.length, 0);
  controleerBalans(resultaat);
});

test("een onbekende URL binnen de root valt af onder mapping", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx" }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(`${ROOT_URL}/Onbekend.docx`, EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.mapping, 1);
  assert.equal(w.log.downloads.length, 0);
  controleerBalans(resultaat);
});

test("een document dat niet meer 'gezien' is, of een bron die niet actief is, valt af", async () => {
  for (const registratie of [{ status: "verwijderd" }, { bronStatus: "gepauzeerd" }]) {
    const w = wereld([{ itemId: "item-a", naam: "A.docx", registratie }]);
    const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
    assert.ok(resultaat.ok);
    assert.equal(resultaat.telling.afwijzingen.mapping, 1, JSON.stringify(registratie));
    assert.equal(w.log.downloads.length, 0);
  }
});

// ── 4. De root zelf ─────────────────────────────────────────────────────────

test("is de root niet vast te stellen, dan worden er GEEN kandidaten opgehaald", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx" }]);
  let geroepen = false;
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [], {
      bron: { ...BRON, status: "gepauzeerd" },
      haalKandidaten: async () => {
        geroepen = true;
        return [];
      },
    }),
  );
  assert.equal(resultaat.ok, false);
  assert.equal(resultaat.ok === false && resultaat.afwijzing, "rechten_configuratie");
  assert.equal(geroepen, false, "er is toch een kandidatenronde gestart zonder scope");
});

test("een root die zelf een snelkoppeling is, levert geen scope op", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx" }], {
    rootAfwijking: { remoteItem: { id: "elders" } },
  });
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(`${ROOT_URL}/A.docx`, EXTRACT)]));
  assert.equal(resultaat.ok, false);
});

// ── 5. De verse bevestiging ─────────────────────────────────────────────────

test("een token uit een ANDERE tenant komt niet langs de bindingscontrole", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], { tokenTenantId: "tenant-2" }),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.afwijzingen.binding, 1);
  assert.equal(w.log.downloads.length, 0, "er is gedownload met een vreemd token");
  controleerBalans(resultaat);
});

test("een item dat bij de EERSTE lezing buiten de root blijkt te liggen, valt af", async () => {
  const w = wereld([
    {
      itemId: "item-a",
      naam: "A.docx",
      tekst: ZIN,
      lezingen: [{ parentReference: { driveId: DRIVE, id: "elders", path: `/drives/${DRIVE}/root:/Prive` } }],
    },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.root, 1);
  assert.equal(w.log.downloads.length, 0);
  controleerBalans(resultaat);
});

test("een snelkoppeling is geen kandidaat", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN, lezingen: [{ remoteItem: { id: "elders" } }] },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.binding, 1);
  assert.equal(w.log.downloads.length, 0);
});

test("URL-HERGEBRUIK na een rename: de verse webUrl wijkt af van de hit", async () => {
  // De hit wijst naar A.docx; Graph geeft voor dit item inmiddels een andere
  // webUrl. Zonder deze controle zou een oude hit bij een ander bestand uitkomen.
  const w = wereld([
    {
      itemId: "item-a",
      naam: "A.docx",
      tekst: ZIN,
      lezingen: [{ webUrl: `${ROOT_URL}/Heel-iets-anders.docx` }],
    },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.binding, 1);
  assert.equal(w.log.downloads.length, 0);
});

test("404 of 403 op één document is een kandidaatweigering, geen beurtstoring", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", lezingen: ["niet_gevonden"] },
    { itemId: "item-b", naam: "B.docx", tekst: ZIN },
  ]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT), hit(w.url("B.docx"), EXTRACT)]),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.rechten_configuratie, 1);
  assert.equal(resultaat.treffers.length, 1, "de beurt is gestopt op één ontoegankelijk document");
  controleerBalans(resultaat);
});

test("zonder eTag én zonder cTag is er geen versiebewijs en dus geen kandidaat", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN, lezingen: [{ eTag: undefined, cTag: undefined }] },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.versie, 1);
  assert.equal(w.log.downloads.length, 0);
});

// ── 6. Download ─────────────────────────────────────────────────────────────

test("een mislukte download is een uitkomst van DIT document", async () => {
  for (const afwijzing of ["download", "rechten_configuratie"] as const) {
    const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
    const resultaat = await voerKetenUit(
      opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], {
        downloadImpl: async () => ({ ok: false, afwijzing }),
      }),
    );
    assert.ok(resultaat.ok);
    assert.equal(resultaat.telling.afwijzingen[afwijzing], 1);
    assert.equal(w.log.extracties.length, 0, "er is geëxtraheerd zonder bytes");
    controleerBalans(resultaat);
  }
});

test("de download krijgt de RESTERENDE beurtruimte mee, niet steeds 25 MiB", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN, bytes: 900 },
    { itemId: "item-b", naam: "B.docx", tekst: ZIN, bytes: 50 },
  ]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT), hit(w.url("B.docx"), EXTRACT)], {
      grenzen: { maxTotaalBytes: 1_000 },
    }),
  );
  assert.ok(resultaat.ok);
  assert.equal(w.log.downloads.length, 2);
  assert.equal(w.log.downloads[0].maxBytes, 1_000);
  // Na 900 bytes is er nog 100 over — en dát is de grens voor het tweede
  // document. Zou hier 25 MiB staan, dan begrenst het beurtbudget niets.
  assert.equal(w.log.downloads[1].maxBytes, 100);
  assert.equal(resultaat.telling.gedownloadeBytes, 950);
  controleerBalans(resultaat);
});

test("het token gaat naar de download en nergens anders heen", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(w.log.downloads[0].accessToken, "stub-token");
  assert.equal(w.log.downloads[0].driveId, DRIVE);
  assert.equal(w.log.downloads[0].siteHostnaam, HOST);
  // En het komt in geen enkel veld van de uitkomst voor.
  assert.equal(JSON.stringify(resultaat).includes("stub-token"), false);
});

// ── 7. Extractie ────────────────────────────────────────────────────────────

test("een formaat dat wij niet lezen valt af VÓÓR elke netwerkstap", async () => {
  for (const type of ["doc", "ppt", "xls", null, "txt"]) {
    const w = wereld([{ itemId: "item-a", naam: "A.doc", bestandstype: type, tekst: ZIN }]);
    const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.doc"), EXTRACT)]));
    assert.ok(resultaat.ok);
    assert.equal(resultaat.telling.afwijzingen.extractie, 1, String(type));
    assert.deepEqual(w.log.lezingen, [ROOT_ITEM], `er is gelezen voor type ${type}`);
    assert.equal(w.log.downloads.length, 0);
  }
  // En de vier die wij wél lezen, komen ongewijzigd terug.
  for (const type of ["pdf", "docx", "pptx", "xlsx"] as const) {
    assert.equal(extractieType(type), type);
  }
});

test("een hit zonder aanwijzer kost geen enkele call", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"))]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.extractie, 1);
  assert.deepEqual(w.log.lezingen, [ROOT_ITEM]);
});

test("een mislukte extractie stopt de beurt niet", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN },
    { itemId: "item-b", naam: "B.docx", tekst: ZIN },
  ]);
  let eerste = true;
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT), hit(w.url("B.docx"), EXTRACT)], {
      extractImpl: async () => {
        if (eerste) {
          eerste = false;
          throw new Error("pdf-parser stuk");
        }
        return { tekst: ZIN, aantalPaginas: 1, segmenten: [segment(ZIN)] };
      },
    }),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.extractie, 1);
  assert.equal(resultaat.treffers.length, 1);
  controleerBalans(resultaat);
});

test("een AFBREKING in de extractie is geen mislukte extractie maar een beurtstop", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  await assert.rejects(
    voerKetenUit(
      opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], {
        extractImpl: async () => {
          throw new RetrievalAfgebroken("annulering");
        },
      }),
    ),
    (fout: unknown) => isAfbreking(fout),
  );
});

// ── 8. De TWEEDE controle: volledige scope ÉN versie ────────────────────────

test("een versiewijziging tussen de twee lezingen laat geen passage door", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN, lezingen: [{}, { eTag: 'W/"etag-NIEUW"' }] },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0, "er is geciteerd uit bytes van een andere versie");
  assert.equal(resultaat.telling.afwijzingen.versie, 1);
  // De bytes zijn wél opgehaald; dat is precies waarom de tweede lezing bestaat.
  assert.equal(w.log.downloads.length, 1);
  controleerBalans(resultaat);
});

test("TOCTOU: verplaatst tijdens de download, mét gelijke eTag", async () => {
  // De versie is ongewijzigd, maar het bestand ligt inmiddels buiten de root.
  // Zou de tweede lezing alleen de eTag vergelijken, dan lekte hier een passage
  // uit een document dat op het moment van citeren buiten onze grens ligt.
  const w = wereld([
    {
      itemId: "item-a",
      naam: "A.docx",
      tekst: ZIN,
      lezingen: [{}, { parentReference: { driveId: DRIVE, id: "x", path: `/drives/${DRIVE}/root:/Prive` } }],
    },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.afwijzingen.root, 1);
  controleerBalans(resultaat);
});

test("TOCTOU: naar een ANDERE drive verplaatst tijdens de download", async () => {
  const w = wereld([
    {
      itemId: "item-a",
      naam: "A.docx",
      tekst: ZIN,
      lezingen: [{}, { parentReference: { driveId: "drive-2", id: ROOT_ITEM, path: ROOT_PAD } }],
    },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.binding, 1);
});

test("de tweede controle komt VÓÓR de lokalisatie, zodat de grond klopt", async () => {
  // Het bestand is gewijzigd én het extract is niet terug te vinden. Beide
  // gronden zouden passen; alleen `versie` benoemt de OORZAAK. Andersom zou een
  // beheerder een wijzigend document als een extractieprobleem lezen.
  const w = wereld([
    {
      itemId: "item-a",
      naam: "A.docx",
      tekst: "Een heel andere tekst waarin de aanwijzer niet voorkomt.",
      lezingen: [{}, { eTag: 'W/"etag-NIEUW"' }],
    },
  ]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.versie, 1);
  assert.equal(resultaat.telling.afwijzingen.lokalisatie, 0);
});

// ── 9. Lokalisatie ──────────────────────────────────────────────────────────

test("een extract dat niet in de eigen tekst staat, levert geen citaat", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: "Volstrekt andere inhoud." }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.afwijzingen.lokalisatie, 1);
  controleerBalans(resultaat);
});

test("een extract dat TWEE keer voorkomt is ambigu", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: `${ZIN} Verderop nogmaals: ${ZIN}` }]);
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.afwijzingen.lokalisatie, 1);
});

// ── 10. De vertrouwensgrens ─────────────────────────────────────────────────

test("de RUWE Microsoft-tekst komt in geen enkel veld van de uitkomst voor", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const ruweUrl = `https://${HOST}/:w:/r/sites/pgb/Documenten/A.docx`;
  const resultaat = await voerKetenUit(opdrachtVoor(w, [hit(ruweUrl, EXTRACT)]));

  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 1);
  const serie = JSON.stringify(resultaat);
  // Het extract is een AANWIJZER. Wat het model ziet is onze eigen zin.
  assert.equal(serie.includes(EXTRACT), false, "het ruwe extract staat in de uitkomst");
  assert.equal(resultaat.treffers[0].passage, ZIN);
  assert.notEqual(resultaat.treffers[0].passage, EXTRACT);
  // En de ruwe webUrl evenmin: die is locatorbewijs, geen inhoud.
  assert.equal(serie.includes(":w:"), false, "de ruwe weergave-URL staat in de uitkomst");
  assert.equal(serie.includes(HOST), false, "de ruwe host staat in de uitkomst");
});

test("de telling bevat uitsluitend getallen, booleans en vaste sleutels", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN },
    { itemId: "item-b", naam: "B.docx", tekst: "iets anders" },
  ]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT), hit(w.url("B.docx"), EXTRACT), hit(`${ROOT_URL}/X.docx`, EXTRACT)]),
  );
  const telling = resultaat.telling as unknown as Record<string, unknown>;
  for (const [sleutel, waarde] of Object.entries(telling)) {
    if (sleutel === "afwijzingen") {
      for (const [grond, getal] of Object.entries(waarde as Record<string, unknown>)) {
        assert.ok(KETEN_AFWIJZINGEN.includes(grond as never), `onbekende grond ${grond}`);
        assert.equal(typeof getal, "number");
      }
      continue;
    }
    assert.ok(
      typeof waarde === "number" || typeof waarde === "boolean",
      `${sleutel} is geen getal of boolean maar ${typeof waarde}`,
    );
  }
});

// ── 11. Beurtbrede grenzen ──────────────────────────────────────────────────

test("hits boven maxKandidaten worden NIET beoordeeld en niet afgewezen", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const url = w.url("A.docx");
  const dertig = Array.from({ length: 30 }, () => hit(url, EXTRACT));
  const resultaat = await voerKetenUit(opdrachtVoor(w, dertig, { grenzen: { maxKandidaten: 5 } }));
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.hits, 30);
  assert.equal(resultaat.telling.hitsBuitenGrens, 25);
  assert.equal(resultaat.telling.hitsGegroepeerd, 5);
  assert.equal(w.log.opzoekingen.length, 5, "er is doorgezocht voorbij de grens");
  controleerBalans(resultaat);
});

test("documenten boven maxDocumenten worden niet opgehaald", async () => {
  const docs = ["A", "B", "C", "D"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN }));
  const w = wereld(docs);
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      { grenzen: { maxDocumenten: 2 } },
    ),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 2);
  assert.equal(resultaat.telling.afwijzingen.grens, 2);
  assert.equal(w.log.downloads.length, 2, "er is meer opgehaald dan het budget toestond");
  controleerBalans(resultaat);
});

test("een GRATIS afwijzing verbruikt geen plek van het documentbudget", async () => {
  // Drie bestanden die wij niet kunnen lezen kosten geen call. Zouden zij toch
  // een plek opsouperen, dan haalt het bruikbare document het budget niet.
  const docs = [
    { itemId: "item-1", naam: "1.doc", bestandstype: "doc", tekst: ZIN },
    { itemId: "item-2", naam: "2.ppt", bestandstype: "ppt", tekst: ZIN },
    { itemId: "item-3", naam: "3.xls", bestandstype: "xls", tekst: ZIN },
    { itemId: "item-a", naam: "A.docx", tekst: ZIN },
    { itemId: "item-b", naam: "B.docx", tekst: ZIN },
  ];
  const w = wereld(docs);
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      { grenzen: { maxDocumenten: 2 } },
    ),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.treffers.length, 2);
  assert.equal(resultaat.telling.afwijzingen.extractie, 3);
  assert.equal(resultaat.telling.afwijzingen.grens, 0);
  controleerBalans(resultaat);
});

test("het bytebudget van de BEURT stopt verdere downloads", async () => {
  const docs = ["A", "B", "C"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN, bytes: 600 }));
  const w = wereld(docs);
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      { grenzen: { maxTotaalBytes: 1_000 } },
    ),
  );
  assert.ok(resultaat.ok);
  // Document 1 past (600). Document 2 krijgt nog 400 mee en levert in deze
  // stub 600 — de echte download zou hem op 400 afkappen. Document 3 vindt
  // geen ruimte meer en wordt niet eens geprobeerd.
  assert.equal(w.log.downloads.length, 2);
  assert.equal(w.log.downloads[1].maxBytes, 400);
  assert.equal(resultaat.telling.afwijzingen.grens, 1);
  controleerBalans(resultaat);
});

test("het extractiebudget van de BEURT stopt verder extractiewerk", async () => {
  const lang = `${ZIN} ${"vulling ".repeat(500)}`;
  const docs = ["A", "B", "C"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: lang }));
  const w = wereld(docs);
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      { grenzen: { maxExtractieTekens: lang.length + 1 } },
    ),
  );
  assert.ok(resultaat.ok);
  assert.equal(w.log.extracties.length, 2);
  assert.equal(resultaat.telling.afwijzingen.grens, 1);
  assert.ok(resultaat.telling.geextraheerdeTekens >= lang.length);
  controleerBalans(resultaat);
});

test("een onbruikbare grenswaarde betekent NOOIT 'geen grens'", async () => {
  const docs = ["A", "B", "C"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN }));
  const w = wereld(docs);
  const kapot = { maxDocumenten: 0, maxTotaalBytes: Number.NaN } as unknown as Partial<KetenGrenzen>;
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      { grenzen: kapot },
    ),
  );
  assert.ok(resultaat.ok);
  // De defaults nemen het over; drie documenten passen daar ruim binnen.
  assert.equal(resultaat.treffers.length, 3);
  assert.ok(KETEN_GRENZEN.maxDocumenten >= 3);
});

// ── 12. Eén deadline door iedere stap ───────────────────────────────────────

/**
 * Blijft hangen tot het meegegeven signaal afgaat. Zónder signaal faalt hij
 * METEEN en luid: dat betekent dat een stap buiten de ketendeadline valt, en
 * een test die daarop eeuwig zou wachten meldt precies niets.
 */
function hangt(signaal: AbortSignal | undefined, stap: string): Promise<never> {
  if (!signaal) return Promise.reject(new Error(`stap '${stap}' kreeg geen ketensignaal mee`));
  if (signaal.aborted) return Promise.reject(signaal.reason);
  return new Promise((_, reject) => {
    signaal.addEventListener("abort", () => reject(signaal.reason), { once: true });
  });
}

test("de deadline bereikt de DOWNLOAD en kapt de rest af", async () => {
  const docs = ["A", "B", "C"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN }));
  const w = wereld(docs);
  let nummer = 0;
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      {
        grenzen: { deadlineMs: 400 },
        downloadImpl: async (o) => {
          nummer += 1;
          if (nummer === 1) return w.downloadImpl(o);
          return hangt(o.signal, "download");
        },
      },
    ),
  );

  assert.ok(resultaat.ok, "een verlopen ketenbudget mag niet als fout naar buiten komen");
  assert.equal(resultaat.telling.deadlineVerlopen, true);
  // Het eerste document is volledig getoetst en blijft staan.
  assert.equal(resultaat.treffers.length, 1);
  // Het tweede (waar wij in hingen) en het derde zijn niet beoordeeld.
  assert.equal(resultaat.telling.afwijzingen.grens, 2);
  controleerBalans(resultaat);
});

test("IEDERE Graph-lezing krijgt het ketensignaal mee", async () => {
  // Zonder deze parameter kan geen enkele deadline een lezing afkappen die
  // nooit terugkomt: `bewaakNaIO()` kijkt TUSSEN de stappen, niet erin.
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  await voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)]));
  assert.equal(w.log.lezingen.length, 3);
  for (const [i, signaal] of w.log.lezingSignalen.entries()) {
    assert.ok(signaal instanceof AbortSignal, `lezing ${i} kreeg geen signaal`);
  }
});

test("de deadline bereikt de GRAPH-LEZING en kapt haar af", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], {
      grenzen: { deadlineMs: 300 },
      leesItem: async (itemId, signal) =>
        itemId === ROOT_ITEM ? w.leesItem(itemId, signal) : hangt(signal, "lezing"),
    }),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.deadlineVerlopen, true);
  assert.equal(resultaat.treffers.length, 0);
  assert.equal(resultaat.telling.afwijzingen.grens, 1);
  controleerBalans(resultaat);
});

test("verloopt de deadline al bij de ROOT, dan is er niets opgehaald en niets afgewezen", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  let geroepen = false;
  const ctrl = new AbortController();
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [], {
      grenzen: { deadlineMs: 150 },
      signal: ctrl.signal,
      leesItem: async (_itemId, signal) => hangt(signal, "root"),
      haalKandidaten: async () => {
        geroepen = true;
        return [];
      },
    }),
  );
  // Het beurtsignaal gaat hier NIET af: de keten breekt af op haar eigen klok.
  // Dat onderscheid is de kern — een trage bron is geen geannuleerde beurt.
  assert.equal(ctrl.signal.aborted, false);
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.deadlineVerlopen, true);
  assert.equal(resultaat.telling.hits, 0);
  assert.equal(resultaat.telling.documenten, 0);
  assert.equal(geroepen, false);
  controleerBalans(resultaat);
});

test("de ketendeadline is GEEN beurtafbreking", async () => {
  // Zou zij dat wel zijn, dan zou een trage SharePoint de hele beurt als
  // geannuleerd laten eindigen terwijl de andere sporen nog resultaat hadden.
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const ctrl = new AbortController();
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], {
      grenzen: { deadlineMs: 150 },
      signal: ctrl.signal,
      downloadImpl: async (o) => hangt(o.signal, "download"),
    }),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.deadlineVerlopen, true);
  assert.equal(ctrl.signal.aborted, false, "het beurtsignaal is meegesleept");
});

// ── 13. Afbreking van de BEURT ──────────────────────────────────────────────

test("een afgebroken beurt WERPT en levert nooit stil een lege uitslag", async () => {
  const w = wereld([
    { itemId: "item-a", naam: "A.docx", tekst: ZIN },
    { itemId: "item-b", naam: "B.docx", tekst: ZIN },
  ]);
  const ctrl = new AbortController();
  await assert.rejects(
    voerKetenUit(
      opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT), hit(w.url("B.docx"), EXTRACT)], {
        signal: ctrl.signal,
        downloadImpl: async (o) => {
          ctrl.abort(new RetrievalAfgebroken("annulering"));
          return hangt(o.signal, "download");
        },
      }),
    ),
    (fout: unknown) => isAfbreking(fout),
  );
});

test("een beurt die AL is afgebroken doet geen enkele call", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  const ctrl = new AbortController();
  ctrl.abort(new RetrievalAfgebroken("annulering"));
  await assert.rejects(
    voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], { signal: ctrl.signal })),
    (fout: unknown) => isAfbreking(fout),
  );
  assert.equal(w.log.lezingen.length, 0, "er is gelezen na een afbreking");
});

// ── 14. Providerstoringen mogen niet tot een kwaliteitsuitkomst degraderen ──

test("een storing in de kandidatenronde werpt", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  await assert.rejects(
    voerKetenUit(
      opdrachtVoor(w, [], {
        haalKandidaten: async () => {
          throw new SharePointGraphError("graph_response");
        },
      }),
    ),
    SharePointGraphError,
  );
});

test("een STORING op één document werpt; alleen 404/403 is een weigering", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN, lezingen: ["storing"] }]);
  await assert.rejects(
    voerKetenUit(opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)])),
    SharePointGraphError,
  );
});

test("een storing op de ROOT werpt: zonder scope is er niets te doorzoeken", async () => {
  const w = wereld([{ itemId: "item-a", naam: "A.docx", tekst: ZIN }]);
  await assert.rejects(
    voerKetenUit(
      opdrachtVoor(w, [hit(w.url("A.docx"), EXTRACT)], {
        leesItem: async () => {
          throw new SharePointGraphError("graph_response");
        },
      }),
    ),
    SharePointGraphError,
  );
});

// ── 15. Deterministische resultaatvolgorde ──────────────────────────────────

test("de volgorde volgt de EERSTE hit, niet het alfabet en niet het register", async () => {
  const docs = ["C", "A", "B"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN }));
  const w = wereld(docs);
  // Hits in de volgorde C, A, B — bewust ongelijk aan de alfabetische volgorde
  // van de canonieke URL's, zodat een sortering op URL zou opvallen.
  const resultaat = await voerKetenUit(
    opdrachtVoor(w, [hit(w.url("C.docx"), EXTRACT), hit(w.url("A.docx"), EXTRACT), hit(w.url("B.docx"), EXTRACT)]),
  );
  assert.ok(resultaat.ok);
  assert.deepEqual(
    resultaat.treffers.map((t) => t.naam),
    ["C.docx", "A.docx", "B.docx"],
  );
  assert.deepEqual(
    resultaat.treffers.map((t) => t.volgorde),
    [0, 1, 2],
  );
});

test("wisselende antwoordtijden van het register veranderen de volgorde niet", async () => {
  const docs = ["C", "A", "B"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN }));
  const w = wereld(docs);
  const vertragingen = [30, 1, 15];
  let i = 0;
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      {
        zoekRegister: async (canoniek) => {
          await new Promise((r) => setTimeout(r, vertragingen[Math.min(i++, 2)]));
          return w.zoekRegister(canoniek);
        },
      },
    ),
  );
  assert.ok(resultaat.ok);
  assert.deepEqual(
    resultaat.treffers.map((t) => t.naam),
    ["C.docx", "A.docx", "B.docx"],
  );
});

test("dezelfde invoer levert twee keer exact dezelfde uitkomst", async () => {
  const docs = [
    { itemId: "item-a", naam: "A.docx", tekst: ZIN },
    { itemId: "item-b", naam: "B.docx", tekst: "geen aanwijzer hier" },
    { itemId: "item-c", naam: "C.doc", bestandstype: "doc", tekst: ZIN },
  ];
  const kandidaten = (w: Wereld) => [
    hit(w.url("A.docx"), EXTRACT),
    hit(w.url("B.docx"), EXTRACT),
    hit(w.url("C.doc"), EXTRACT),
    hit(`${ROOT_URL}/Weg.docx`, EXTRACT),
    hit(`https://${HOST}/sites/anders/X.docx`, EXTRACT),
  ];
  const eerste = wereld(docs);
  const tweede = wereld(docs);
  const a = await voerKetenUit(opdrachtVoor(eerste, kandidaten(eerste)));
  const b = await voerKetenUit(opdrachtVoor(tweede, kandidaten(tweede)));
  assert.deepEqual(a, b);
  controleerBalans(a);
  assert.ok(a.ok);
  assert.equal(a.treffers.length, 1);
  assert.equal(a.telling.afwijzingen.root, 1);
  assert.equal(a.telling.afwijzingen.mapping, 1);
  assert.equal(a.telling.afwijzingen.extractie, 1);
  assert.equal(a.telling.afwijzingen.lokalisatie, 1);
});

test("een deadline TIJDENS de registerfase laat de balans niet scheef staan", async () => {
  // Deze fase heeft geen eigen catch: bij een verlopen budget springt de
  // uitvoering rechtstreeks naar de afhandeling. Alles wat "na de lus" zou
  // worden geteld, wordt dan nooit geteld — en een balans die alleen klopt als
  // de lus zijn einde haalt, klopt precies niet wanneer je hem nodig hebt.
  const docs = ["A", "B", "C", "D"].map((n) => ({ itemId: `item-${n}`, naam: `${n}.docx`, tekst: ZIN }));
  const w = wereld(docs);
  let nummer = 0;
  const resultaat = await voerKetenUit(
    opdrachtVoor(
      w,
      docs.map((d) => hit(w.url(d.naam), EXTRACT)),
      {
        grenzen: { deadlineMs: 300 },
        zoekRegister: async (canoniek) => {
          nummer += 1;
          if (nummer >= 3) await new Promise((r) => setTimeout(r, 5_000));
          return w.zoekRegister(canoniek);
        },
      },
    ),
  );
  assert.ok(resultaat.ok);
  assert.equal(resultaat.telling.deadlineVerlopen, true);
  assert.equal(resultaat.telling.hits, 4);
  assert.equal(resultaat.telling.hitsGegroepeerd, 2, "de gegroepeerde hits zijn niet meegeteld");
  assert.equal(resultaat.telling.hitsBuitenGrens, 2);
  assert.equal(resultaat.treffers.length, 0);
  controleerBalans(resultaat);
});

test("de ketendeadline houdt het PROCES open tot zij heeft gevuurd", async () => {
  // Deze eigenschap is binnen `node:test` niet te meten: de runner houdt zelf
  // handles open en maskeert het. Daarom een EIGEN proces, waarin de enige
  // openstaande zaken de ketenklok en een hangende lezing zijn.
  //
  // Met `unref()` op die klok verliet Node het proces na 2 ms terwijl de keten
  // 600 ms te gaan had: geen deadline, geen uitkomst, geen fout. In de CI-draai
  // sloeg dat veertien tests over onder de kop "cancelled" — nul gefaald, dus
  // volkomen stil.
  //
  // Het kindscript gaat naar een BESTAND en importeert de module via een
  // absolute file-URL. Een `-e`-script heeft geen eigen pad, waardoor relatieve
  // specifiers tegen de werkmap worden opgelost — en dat gedrag verschilt per
  // Node-versie. Deze test draait op Node 22 in CI en op 24 lokaal; hij mag
  // niet op dat verschil struikelen.
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");

  const hier = dirname(fileURLToPath(import.meta.url));
  const moduleUrl = pathToFileURL(join(hier, "..", "..", "core", "lib", "microsoft-retrieval", "keten.ts")).href;
  const map = mkdtempSync(join(tmpdir(), "keten-deadline-"));
  const scriptPad = join(map, "proef.mts");

  try {
    writeFileSync(
      scriptPad,
      [
        `import { voerKetenUit } from ${JSON.stringify(moduleUrl)};`,
        'const hangt = (s) => new Promise((_, rej) => s?.addEventListener("abort", () => rej(s.reason), { once: true }));',
        "const t0 = Date.now();",
        "voerKetenUit({",
        '  bron: { id: "b", tenantId: "t", siteHostnaam: "h.sharepoint.com", driveId: "d", rootItemId: "r", configuratieversie: 1, status: "actief" },',
        '  tokenTenantId: "t", accessToken: "x",',
        "  leesItem: async (_id, signal) => hangt(signal),",
        "  zoekRegister: async () => undefined,",
        "  haalKandidaten: async () => [],",
        "  grenzen: { deadlineMs: 400 },",
        '}).then((r) => console.log("KLAAR", Date.now() - t0, r.telling.deadlineVerlopen));',
      ].join("\n"),
      "utf8",
    );

    let uit = "";
    try {
      uit = execFileSync(process.execPath, ["--import", "tsx", scriptPad], {
        cwd: join(hier, "..", ".."),
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (fout) {
      // Niet stil laten vallen: de uitvoer van het kind IS de diagnose.
      const f = fout as { stdout?: string; stderr?: string; message?: string };
      assert.fail(`kindproces faalde: ${f.message}\nstdout: ${f.stdout ?? ""}\nstderr: ${f.stderr ?? ""}`);
    }

    const regel = uit.split("\n").find((r) => r.startsWith("KLAAR"));
    assert.ok(regel, `de keten heeft het proces niet overleefd; uitvoer: ${JSON.stringify(uit)}`);
    const [, msRuw, verlopen] = regel.split(" ");
    assert.equal(verlopen, "true");
    assert.ok(Number(msRuw) >= 350, `de deadline vuurde te vroeg: ${msRuw}ms`);
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});
