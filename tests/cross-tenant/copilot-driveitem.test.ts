// ============================================================================
//  #413 T4-C — De verse DriveItem-bevestiging.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database. De Graph-lezing wordt geïnjecteerd.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  bevestigKandidaatItem,
  bevestigVersieOngewijzigd,
  leesRoot,
  type BronSnapshot,
} from "../../core/lib/microsoft-retrieval/driveitem";
import type { GeregistreerdDocument } from "../../core/lib/microsoft-retrieval/mapping";
import { SharePointGraphError, type GraphDriveItem } from "../../core/lib/microsoft-sharepoint-graph-core";
import { RetrievalAfgebroken } from "../../core/lib/retrieval/afbreken";

const HOST = "check.sharepoint.com";
const DRIVE = "drive-1";
const ROOT_PAD = `/drives/${DRIVE}/root:/Documenten`;
const HIT = `https://${HOST}/sites/pgb/Documenten/A.docx`;

const BRON: BronSnapshot = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: "tenant-1",
  siteHostnaam: HOST,
  driveId: DRIVE,
  rootItemId: "root-1",
  configuratieversie: 3,
  status: "actief",
};

const DOCUMENT: GeregistreerdDocument = {
  ref: "11111111-1111-4111-8111-111111111111",
  bronId: BRON.id,
  driveId: DRIVE,
  itemId: "item-1",
  rootItemId: "root-1",
  naam: "A.docx",
  bestandstype: "docx",
  mappad: "",
  status: "gezien",
  bronStatus: "actief",
  siteHostnaam: HOST,
  configuratieversie: 3,
};

function item(extra: Partial<GraphDriveItem> = {}): GraphDriveItem {
  return {
    id: "item-1",
    name: "A.docx",
    eTag: 'W/"etag-1"',
    cTag: '"ctag-1"',
    webUrl: HIT,
    file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    parentReference: { driveId: DRIVE, id: "root-1", path: ROOT_PAD },
    ...extra,
  };
}

function rootItem(extra: Partial<GraphDriveItem> = {}): GraphDriveItem {
  return {
    id: "root-1",
    name: "Documenten",
    webUrl: `https://${HOST}/sites/pgb/Documenten`,
    folder: { childCount: 3 },
    parentReference: { driveId: DRIVE, id: "drive-root", path: `/drives/${DRIVE}/root:` },
    ...extra,
  };
}

const lees = (i: GraphDriveItem) => async () => i;
/** 404/403: gaat over DIT document en is dus een kandidaatweigering. */
const faalt = async (): Promise<GraphDriveItem> => { throw new SharePointGraphError("niet_gevonden"); };
const geenToegang = async (): Promise<GraphDriveItem> => { throw new SharePointGraphError("toestemming_of_token"); };

test("de root levert de autoritatieve webUrl en het Graph-pad", async () => {
  const uitkomst = await leesRoot(BRON, lees(rootItem()));
  assert.ok(uitkomst.ok);
  assert.equal(uitkomst.rootWebUrl, `https://${HOST}/sites/pgb/Documenten`);
  assert.equal(uitkomst.rootGraphPad, `/drives/${DRIVE}/root:/Documenten`);
});

test("een root die niet klopt levert geen scope op", async () => {
  const gevallen: [string, GraphDriveItem | null, BronSnapshot][] = [
    ["ander id", rootItem({ id: "root-2" }), BRON],
    ["geen map", rootItem({ folder: null }), BRON],
    ["andere drive", rootItem({ parentReference: { driveId: "drive-2", path: "/x" } }), BRON],
    ["geen webUrl", rootItem({ webUrl: undefined }), BRON],
    ["niet-sharepoint webUrl", rootItem({ webUrl: "https://evil.test/x" }), BRON],
    ["bron niet actief", rootItem(), { ...BRON, status: "ontkoppeld" }],
  ];
  for (const [waarom, graphItem, bron] of gevallen) {
    const uitkomst = await leesRoot(bron, graphItem ? lees(graphItem!) : faalt);
    assert.equal(uitkomst.ok, false, waarom);
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "rechten_configuratie", waarom);
  }
});

test("een falende ROOTLEZING stopt de beurt en wordt nooit een weigering", async () => {
  // De root is de scope zelf. Kan die niet worden vastgesteld, dan is er niets
  // te doorzoeken — en dan mag de beurt niet stil doorgaan op eigen bronnen.
  // Dit is ook de scheiding die 401 van 403 onderscheidbaar maakt: graphJson
  // kan ze niet uit elkaar houden, maar een kapot token sneuvelt hier al, vóór
  // er ook maar één kandidaat wordt beoordeeld.
  for (const bron of [faalt, geenToegang, async (): Promise<GraphDriveItem> => { throw new SharePointGraphError("graph_ratelimit"); }]) {
    await assert.rejects(() => leesRoot(BRON, bron), (e: unknown) => e instanceof SharePointGraphError);
  }
});

test("een kloppende kandidaat levert het versiebewijs", async () => {
  const uitkomst = await bevestigKandidaatItem(
    { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
    lees(item()),
  );
  assert.ok(uitkomst.ok);
  assert.deepEqual(uitkomst.versie, { soort: "etag", waarde: 'W/"etag-1"' });
  assert.equal(uitkomst.naam, "A.docx");
});

test("zonder eTag valt de keten terug op cTag; zonder beide is er geen kandidaat", async () => {
  const metCtag = await bevestigKandidaatItem(
    { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
    lees(item({ eTag: "  " })),
  );
  assert.ok(metCtag.ok);
  assert.deepEqual(metCtag.versie, { soort: "ctag", waarde: '"ctag-1"' });

  const zonder = await bevestigKandidaatItem(
    { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
    lees(item({ eTag: undefined, cTag: undefined })),
  );
  assert.equal(zonder.ok, false);
  assert.equal(zonder.ok === false && zonder.afwijzing, "versie");
});

test("URL-HERGEBRUIK: een item dat inmiddels een andere webUrl heeft, valt af", async () => {
  // Dit is de reden dat de verse lezing bestaat. Het register gaf één rij terug,
  // maar na een rename hoort die URL bij een ander bestand — of hoort dit
  // bestand bij een andere URL. Beide gevallen zijn hier dezelfde afwijzing.
  const uitkomst = await bevestigKandidaatItem(
    { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
    lees(item({ webUrl: `https://${HOST}/sites/pgb/Documenten/B.docx` })),
  );
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "binding");
});

test("de webUrl-vergelijking gebruikt de canonieke vorm", async () => {
  // Query, fragment, trailing slash en hoofdletterhost mogen de bevestiging niet
  // laten mislukken; ze horen niet bij het bibliotheekpad.
  for (const variant of [`${HIT}?web=1`, `${HIT}#x`, `${HIT}/`, `https://CHECK.sharepoint.com/sites/pgb/Documenten/A.docx`]) {
    const uitkomst = await bevestigKandidaatItem(
      { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
      lees(item({ webUrl: variant })),
    );
    assert.ok(uitkomst.ok, variant);
  }
});

test("tenant-, bron-, drive- en rootbinding worden opnieuw bewezen", async () => {
  const gevallen: [string, Parameters<typeof bevestigKandidaatItem>[0]][] = [
    ["andere tenant", { bron: BRON, tokenTenantId: "tenant-2", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD }],
    ["andere bron", { bron: BRON, tokenTenantId: "tenant-1", document: { ...DOCUMENT, bronId: "33333333-3333-4333-8333-333333333333" }, hitCanoniek: HIT, rootGraphPad: ROOT_PAD }],
    ["andere drive", { bron: BRON, tokenTenantId: "tenant-1", document: { ...DOCUMENT, driveId: "drive-2" }, hitCanoniek: HIT, rootGraphPad: ROOT_PAD }],
    ["andere host", { bron: BRON, tokenTenantId: "tenant-1", document: { ...DOCUMENT, siteHostnaam: "ander.sharepoint.com" }, hitCanoniek: HIT, rootGraphPad: ROOT_PAD }],
    ["andere root", { bron: BRON, tokenTenantId: "tenant-1", document: { ...DOCUMENT, rootItemId: "root-9" }, hitCanoniek: HIT, rootGraphPad: ROOT_PAD }],
  ];
  for (const [waarom, args] of gevallen) {
    const uitkomst = await bevestigKandidaatItem(args, lees(item()));
    assert.equal(uitkomst.ok, false, waarom);
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "binding", waarom);
  }
});

test("een configuratiewijziging TIJDENS het verzoek faalt gesloten", async () => {
  // De bron is opnieuw geconfigureerd nadat deze kandidaat uit het register
  // kwam: de registratie waarop hij rust, bestaat niet meer.
  const uitkomst = await bevestigKandidaatItem(
    { bron: { ...BRON, configuratieversie: 4 }, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
    lees(item()),
  );
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "rechten_configuratie");
});

test("404 en 403 op een ITEM zijn kandidaatweigeringen", async () => {
  for (const bron of [faalt, geenToegang]) {
    const uitkomst = await bevestigKandidaatItem(
      { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
      bron,
    );
    assert.equal(uitkomst.ok, false);
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "rechten_configuratie");
  }
});

test("een AFBREKING wordt doorgegooid, niet tot een weigering gereduceerd", async () => {
  // Zonder deze regel wordt een geannuleerde of verlopen beurt een gewone
  // kandidaatweigering, en gaat de assistent stil door met minder bronnen.
  for (const reden of ["annulering", "timeout"] as const) {
    const afbreking = new RetrievalAfgebroken(reden);
    await assert.rejects(
      () => bevestigKandidaatItem(
        { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
        async () => { throw afbreking; },
      ),
      (e: unknown) => e === afbreking,
      reden,
    );
  }
});

test("een PROVIDERSTORING wordt doorgegooid, niet tot een weigering gereduceerd", async () => {
  // 429, 5xx, timeout, onleesbaar antwoord en onbekende fouten zeggen niets over
  // dit document; ze zijn een storing en horen de beurt te stoppen.
  const storingen = [
    new SharePointGraphError("graph_ratelimit"),
    new SharePointGraphError("graph_timeout"),
    new SharePointGraphError("graph_response"),
    new SharePointGraphError("onverwachte_fout"),
    new TypeError("fetch failed"),
  ];
  for (const storing of storingen) {
    await assert.rejects(
      () => bevestigKandidaatItem(
        { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
        async () => { throw storing; },
      ),
      (e: unknown) => e === storing,
      String(storing),
    );
  }
});

test("een lezing die SLAAGT terwijl het signaal al af is, telt niet mee", async () => {
  // De afbreking viel terwijl de call onderweg was. Zonder een tweede bewaking
  // ná de I/O zou dit antwoord alsnog een kandidaat opleveren.
  const controller = new AbortController();
  const afbreking = new RetrievalAfgebroken("annulering");
  await assert.rejects(
    () => bevestigKandidaatItem(
      { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD, signal: controller.signal },
      async () => { controller.abort(afbreking); return item(); },
    ),
    (e: unknown) => e === afbreking,
  );

  // Hetzelfde voor de tweede versielezing en voor de root.
  const controller2 = new AbortController();
  const afbreking2 = new RetrievalAfgebroken("timeout");
  await assert.rejects(
    () => bevestigVersieOngewijzigd(
      { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' }, signal: controller2.signal },
      async () => { controller2.abort(afbreking2); return item(); },
    ),
    (e: unknown) => e === afbreking2,
  );

  const controller3 = new AbortController();
  const afbreking3 = new RetrievalAfgebroken("annulering");
  await assert.rejects(
    () => leesRoot(BRON, async () => { controller3.abort(afbreking3); return rootItem(); }, controller3.signal),
    (e: unknown) => e === afbreking3,
  );
});

test("een al afgebroken beurt kost geen enkele lezing", async () => {
  const controller = new AbortController();
  const afbreking = new RetrievalAfgebroken("annulering");
  controller.abort(afbreking);
  let gelezen = 0;
  await assert.rejects(
    () => bevestigKandidaatItem(
      { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD, signal: controller.signal },
      async () => { gelezen++; return item(); },
    ),
    (e: unknown) => e === afbreking,
  );
  assert.equal(gelezen, 0, "er is toch een Graph-lezing gedaan");
});

test("een item buiten de root, een map of een verwisseld id valt af", async () => {
  const gevallen: [string, GraphDriveItem, string][] = [
    ["buiten root", item({ parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/Andere map` } }), "root"],
    ["prefixlek", item({ parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/Documenten-geheim` } }), "root"],
    ["map in plaats van bestand", item({ file: null, folder: { childCount: 1 } }), "binding"],
    ["ander item-id", item({ id: "item-9" }), "binding"],
    ["andere drive", item({ parentReference: { driveId: "drive-2", path: ROOT_PAD } }), "binding"],
  ];
  for (const [waarom, graphItem, verwacht] of gevallen) {
    const uitkomst = await bevestigKandidaatItem(
      { bron: BRON, tokenTenantId: "tenant-1", document: DOCUMENT, hitCanoniek: HIT, rootGraphPad: ROOT_PAD },
      lees(graphItem),
    );
    assert.equal(uitkomst.ok, false, waarom);
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, verwacht, waarom);
  }
});

test("de tweede versielezing eist exacte gelijkheid", async () => {
  const gelijk = await bevestigVersieOngewijzigd(
    { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' } },
    lees(item()),
  );
  assert.ok(gelijk.ok);

  // Het bestand is tijdens download of extractie gewijzigd: wij hebben bytes van
  // versie A en een bewijs van versie B. Dat mag nooit een citaat worden.
  const gewijzigd = await bevestigVersieOngewijzigd(
    { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' } },
    lees(item({ eTag: 'W/"etag-2"' })),
  );
  assert.equal(gewijzigd.ok, false);
  assert.equal(gewijzigd.ok === false && gewijzigd.afwijzing, "versie");
});

test("de tweede lezing vergelijkt DEZELFDE soort, niet de andere", async () => {
  // Een cTag die toevallig gelijk blijft mag een gewijzigde eTag niet redden.
  const uitkomst = await bevestigVersieOngewijzigd(
    { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' } },
    lees(item({ eTag: undefined, cTag: 'W/"etag-1"' })),
  );
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "versie");
});

test("een verdwenen of verwisseld item bij de tweede lezing faalt gesloten", async () => {
  const verdwenen = await bevestigVersieOngewijzigd(
    { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' } },
    faalt,
  );
  // En een storing bij de tweede lezing stopt de beurt in plaats van de
  // kandidaat stil te laten vallen.
  await assert.rejects(
    () => bevestigVersieOngewijzigd(
      { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' } },
      async () => { throw new SharePointGraphError("graph_timeout"); },
    ),
    (e: unknown) => e instanceof SharePointGraphError,
  );
  assert.equal(verdwenen.ok, false);
  assert.equal(verdwenen.ok === false && verdwenen.afwijzing, "rechten_configuratie");

  const verwisseld = await bevestigVersieOngewijzigd(
    { document: DOCUMENT, versieVoor: { soort: "etag", waarde: 'W/"etag-1"' } },
    lees(item({ id: "item-9" })),
  );
  assert.equal(verwisseld.ok, false);
  assert.equal(verwisseld.ok === false && verwisseld.afwijzing, "binding");
});
