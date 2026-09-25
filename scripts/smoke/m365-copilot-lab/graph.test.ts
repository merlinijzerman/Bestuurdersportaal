// ============================================================================
//  #407 labsmoke — hermetische tests op de read-only Graph-laag.
// ----------------------------------------------------------------------------
//  Deze laag draait VÓÓR de beslispoort en bepaalt dus of er überhaupt betaald
//  verkeer volgt. De grenzen die hij belooft — geen omleiding, een bytegrens,
//  een callbudget, en scans die op twee verschillende mechanismen meten —
//  worden hier stuk voor stuk afgedwongen met een gestubde `fetch`.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import {
  GraphFout,
  MAX_GRAPH_RESPONSE_BYTES,
  bestandsnaamscan,
  inhoudscan,
  leesActor,
  leesBron,
  leesRootItem,
  maakLeesClient,
  MAX_VERSE_HERLEZINGEN,
} from "./graph";

const HOST = "bestuurdersportaaltest.sharepoint.com";
const ROOT_PAD = "/sites/PGBRetrievalLab/Shared Documents";
const ROOT_GRAPH_PAD = "/drives/drive-1/root:";

function client(afhandel: (url: string) => Response | Promise<Response>, callBudget = 40) {
  const gezien: string[] = [];
  const impl = (async (invoer: any) => {
    gezien.push(String(invoer));
    return afhandel(String(invoer));
  }) as unknown as typeof fetch;
  return {
    gezien,
    client: maakLeesClient({
      accessToken: "test-token",
      callBudget,
      signal: new AbortController().signal,
      fetchImpl: impl,
    }),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("elke Graph-call gaat met redirect: manual en een bearer-header de deur uit", async () => {
  let gezienInit: any = null;
  const c = maakLeesClient({
    accessToken: "test-token",
    callBudget: 5,
    signal: new AbortController().signal,
    fetchImpl: (async (_invoer: any, init: any) => {
      gezienInit = init;
      return json({ id: "x", userPrincipalName: "y" });
    }) as unknown as typeof fetch,
  });
  await c.json("/me?$select=id,userPrincipalName");
  assert.equal(gezienInit.redirect, "manual");
  assert.equal(gezienInit.method, "GET");
  assert.equal(gezienInit.headers.Authorization, "Bearer test-token");
});

test("negatief — een omleiding wordt niet gevolgd maar als fout gestopt", async () => {
  const { client: c, gezien } = client(() => new Response(null, { status: 302, headers: { location: "https://elders.example.com/" } }));
  await assert.rejects(
    () => c.json("/me"),
    (fout: GraphFout) => fout.code === "graph_omleiding" && fout.httpStatus === 302,
  );
  assert.equal(gezien.length, 1, "een omleiding mag geen tweede call opleveren");
});

test("negatief — een te grote respons wordt afgekapt, in bytes geteld", async () => {
  const blok = new TextEncoder().encode("€".repeat(64 * 1024));
  let verzonden = 0;
  const stroom = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (verzonden >= 32) {
        controller.close();
        return;
      }
      verzonden++;
      controller.enqueue(blok);
    },
  });
  const { client: c } = client(() => new Response(stroom, { status: 200 }));
  await assert.rejects(() => c.json("/me"), (fout: GraphFout) => fout.code === "graph_respons_te_groot");
  assert.ok(verzonden * blok.byteLength > MAX_GRAPH_RESPONSE_BYTES);
  assert.ok(verzonden < 32, "het lezen had moeten stoppen vóór de laatste chunk");
});

test("negatief — een gemelde content-length boven de grens stopt vóór het lezen", async () => {
  // De body is hier piepklein en volkomen geldig. Slaagt deze call, dan heeft
  // de lezer de header genegeerd en tóch gelezen; faalt hij, dan kan dat alleen
  // door de content-length-controle komen die ervóór staat.
  const { client: c } = client(
    () =>
      new Response('{"value":[]}', {
        status: 200,
        headers: { "content-length": String(MAX_GRAPH_RESPONSE_BYTES + 1) },
      }),
  );
  await assert.rejects(() => c.json("/me"), (fout: GraphFout) => fout.code === "graph_respons_te_groot");
});

test("het callbudget is een harde grens op feitelijke GET's", async () => {
  const { client: c, gezien } = client(() => json({ value: [] }), 2);
  await c.json("/me");
  await c.json("/me");
  await assert.rejects(() => c.json("/me"), (fout: GraphFout) => fout.code === "graph_callbudget");
  assert.equal(gezien.length, 2);
});

test("een pad buiten de v1.0-basis wordt geweigerd vóór het netwerk", async () => {
  const { client: c, gezien } = client(() => json({}));
  await assert.rejects(
    () => c.json("https://graph.microsoft.com/beta/me"),
    (fout: GraphFout) => fout.code === "graph_url_buiten_basis",
  );
  assert.equal(gezien.length, 0);
});

test("de site wordt via het geregistreerde pad opgezocht, niet via een naamzoekopdracht", async () => {
  const { client: c, gezien } = client((url) => {
    if (url.includes("/drive?")) return json({ id: "drive-1", webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}` });
    return json({ id: "site-1", webUrl: `https://${HOST}/sites/PGBRetrievalLab` });
  });
  const bron = await leesBron(c, HOST, "/sites/PGBRetrievalLab");
  assert.equal(bron.siteId, "site-1");
  assert.equal(bron.driveId, "drive-1");
  assert.ok(gezien[0].includes(`/sites/${HOST}:/sites/PGBRetrievalLab`));
  assert.ok(!gezien.some((url) => url.includes("search")), "de site mag niet via zoeken worden gevonden");
});

test("een sitepad met onverwachte tekens stopt vóór het netwerk", async () => {
  const { client: c, gezien } = client(() => json({}));
  await assert.rejects(
    () => leesBron(c, HOST, "/sites/PGB'Lab"),
    (fout: GraphFout) => fout.code === "site_pad_onveilig",
  );
  assert.equal(gezien.length, 0);
});

test("leesActor levert het gezaghebbende antwoord uit /me", async () => {
  const { client: c } = client(() => json({ id: "OID-1", userPrincipalName: "pgb-test@lab.onmicrosoft.com" }));
  assert.deepEqual(await leesActor(c), { id: "oid-1", userPrincipalName: "pgb-test@lab.onmicrosoft.com" });
});

test("de inhoudscan gaat door de zoekindex en telt apart wat binnen de root valt", async () => {
  const { client: c, gezien } = client(() =>
    json({
      value: [
        { id: "1", name: "PGB407-DOC-101-a.docx", webUrl: `https://${HOST}/:w:/r${encodeURI(ROOT_PAD)}/02/PGB407-DOC-101-a.docx`, parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02` } },
        { id: "2", name: "elders.docx", webUrl: `https://${HOST}/sites/AndereSite/Shared%20Documents/elders.docx`, parentReference: { driveId: "drive-2", path: "/drives/drive-2/root:" } },
      ],
    }));
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.treffers, 2);
  assert.equal(uitkomst.binnenRoot, 1);
  // Server-side gescoped op het root-item, niet drive-breed.
  assert.ok(gezien[0].includes("/items/root-item/search(q='Zandloperbaken%2012')"));
  assert.ok(!gezien[0].includes("/root/search"), "de inhoudscan zocht drive-breed");
});

test("een scanterm met een quote of wildcard komt de OData-functie niet in", async () => {
  const { client: c, gezien } = client(() => json({ value: [] }));
  for (const term of ["Zandloper'baken", "Zandloperbaken*", "Zandloperbaken\"12", "a OR b\n"]) {
    await assert.rejects(
      () => inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, term),
      (fout: GraphFout) => fout.code === "scanterm_onveilig",
      `term ${JSON.stringify(term)} werd geaccepteerd`,
    );
  }
  assert.equal(gezien.length, 0);
});

test("de bestandsnaamscan loopt de bibliotheek af en raakt de zoekindex niet", async () => {
  const { client: c, gezien } = client((url) => {
    if (url.includes("/items/root-item/children")) {
      return json({
        value: [
          { id: "map-1", name: "02 Beleid en reglementen", folder: { childCount: 2 }, webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/02%20Beleid`, parentReference: { driveId: "drive-1", path: ROOT_GRAPH_PAD } },
          { id: "f-0", name: "leeswijzer.docx", file: {}, webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/leeswijzer.docx`, parentReference: { driveId: "drive-1", path: ROOT_GRAPH_PAD } },
        ],
      });
    }
    return json({
      value: [
        {
          id: "f-1",
          name: "PGB407-DOC-101-Zandloperbaken-hersteldossier.docx",
          file: {},
          webUrl: `https://${HOST}/:w:/r${encodeURI(ROOT_PAD)}/02%20Beleid/PGB407-DOC-101-Zandloperbaken-hersteldossier.docx`,
          parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` },
        },
        {
          id: "f-2",
          name: "PGB407-DOC-102-Nevelanker.docx",
          file: {},
          webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/02%20Beleid/PGB407-DOC-102-Nevelanker.docx`,
          parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` },
        },
      ],
    });
  });
  const uitkomst = await bestandsnaamscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "PGB407-DOC-101");
  assert.equal(uitkomst.treffers, 1, "alleen DOC-101 hoort op de prefix te matchen");
  assert.equal(uitkomst.bekeken, 4);
  assert.equal(uitkomst.afgekapt, false);
  assert.ok(!gezien.some((url) => url.includes("search")), "de naamscan mag niet via de zoekindex lopen");
});

test("een naamtreffer buiten de bronroot telt niet mee", async () => {
  const { client: c } = client(() =>
    json({
      value: [
        {
          id: "f-1",
          name: "PGB407-DOC-101-elders.docx",
          file: {},
          webUrl: `https://${HOST}/sites/AndereSite/Shared%20Documents/PGB407-DOC-101-elders.docx`,
          parentReference: { driveId: "drive-2", path: "/drives/drive-2/root:" },
        },
      ],
    }));
  assert.equal((await bestandsnaamscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "PGB407-DOC-101")).treffers, 0);
});

test("een shortcut naar een bestand elders telt niet mee, ook niet met een passend parent-pad", async () => {
  const { client: c } = client(() =>
    json({
      value: [
        {
          id: "shortcut-1",
          name: "PGB407-DOC-101-elders.docx",
          file: {},
          remoteItem: { id: "extern-1" },
          webUrl: `https://${HOST}/:w:/r${encodeURI(ROOT_PAD)}/PGB407-DOC-101-elders.docx`,
          parentReference: { driveId: "drive-1", path: ROOT_GRAPH_PAD },
        },
      ],
    }));
  assert.equal((await bestandsnaamscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "PGB407-DOC-101")).treffers, 0);
});

test("de naamscan volgt alleen een nextLink binnen de v1.0-basis", async () => {
  let ronde = 0;
  const { client: c, gezien } = client(() => {
    ronde++;
    if (ronde === 1) {
      return json({ value: [], "@odata.nextLink": "https://elders.example.com/volgende" });
    }
    return json({ value: [] });
  });
  const uitkomst = await bestandsnaamscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "PGB407-DOC-101");
  assert.equal(uitkomst.treffers, 0);
  assert.equal(gezien.length, 1, "een nextLink naar een andere host mag niet gevolgd worden");
});

// ---------------------------------------------------------------------------
//  Het root-item — de scans mogen nooit bij de drive-root beginnen
// ---------------------------------------------------------------------------

const DRIVE_URL = `https://${HOST}${encodeURI(ROOT_PAD)}`;

test("een bronroot die de hele bibliotheek is, levert het drive-root-item", async () => {
  const { client: c, gezien } = client(() => json({ id: "root-0", webUrl: DRIVE_URL, folder: { childCount: 3 } }));
  const root = await leesRootItem(c, "drive-1", DRIVE_URL, `https://${HOST}${ROOT_PAD}`);
  assert.equal(root.rootItemId, "root-0");
  assert.ok(gezien[0].includes("/drives/drive-1/root?"));
});

test("een bronroot die een SUBMAP is, wordt via pad-adressering opgezocht", async () => {
  // Dit is het geval waarin een scan vanaf de drive-root metadata zou lezen van
  // stukken die buiten de geregistreerde bron vallen.
  const submap = `${ROOT_PAD}/Digital Twin Uitvoering`;
  const { client: c, gezien } = client(() =>
    json({ id: "root-sub", webUrl: `https://${HOST}${encodeURI(submap)}`, folder: { childCount: 6 } }));
  const root = await leesRootItem(c, "drive-1", DRIVE_URL, `https://${HOST}${submap}`);
  assert.equal(root.rootItemId, "root-sub");
  assert.ok(
    gezien[0].includes("/drives/drive-1/root:/Digital%20Twin%20Uitvoering?"),
    `onverwachte adressering: ${gezien[0]}`,
  );
});

test("beide scans beginnen bij het root-item van de submap, niet bij de drive-root", async () => {
  const bezocht: string[] = [];
  const { client: c } = client((url) => {
    bezocht.push(url);
    return json({ value: [] });
  });
  await inhoudscan(c, "drive-1", "root-sub", `${ROOT_GRAPH_PAD}/Digital Twin Uitvoering`, "Zandloperbaken 12");
  await bestandsnaamscan(c, "drive-1", "root-sub", `${ROOT_GRAPH_PAD}/Digital Twin Uitvoering`, "PGB407-DOC-101");
  assert.equal(bezocht.length, 2);
  for (const url of bezocht) {
    assert.ok(url.includes("/items/root-sub/"), `scan begon niet bij het root-item: ${url}`);
    assert.ok(!url.includes("/root/"), `scan raakte de drive-root: ${url}`);
    assert.ok(!url.includes("/root:"), `scan raakte de drive-root: ${url}`);
  }
});

test("een root buiten de bibliotheek wordt geweigerd vóór het netwerk", async () => {
  const { client: c, gezien } = client(() => json({}));
  await assert.rejects(
    () => leesRootItem(c, "drive-1", DRIVE_URL, `https://${HOST}/sites/PGBRetrievalLab/Andere%20Bibliotheek`),
    (fout: GraphFout) => fout.code === "root_buiten_bibliotheek",
  );
  assert.equal(gezien.length, 0);
});

test("een opgezocht root-item dat ergens anders heen wijst, wordt geweigerd", async () => {
  // Een hernoemde map of een snelkoppeling kan een pad naar een BREDERE scope
  // laten wijzen; dan is de webUrl die terugkomt niet de geregistreerde root.
  const { client: c } = client(() =>
    json({ id: "root-x", webUrl: `https://${HOST}/sites/PGBRetrievalLab/Shared%20Documents`, folder: {} }));
  await assert.rejects(
    () => leesRootItem(c, "drive-1", DRIVE_URL, `https://${HOST}${ROOT_PAD}/Digital Twin Uitvoering`),
    (fout: GraphFout) => fout.code === "root_wijst_elders",
  );
});

test("een root-item dat geen map is, wordt geweigerd", async () => {
  const { client: c } = client(() => json({ id: "root-f", webUrl: DRIVE_URL }));
  await assert.rejects(
    () => leesRootItem(c, "drive-1", DRIVE_URL, `https://${HOST}${ROOT_PAD}`),
    (fout: GraphFout) => fout.code === "root_geen_map",
  );
});

test("een rootpad met onverwachte tekens komt de pad-adressering niet in", async () => {
  const { client: c, gezien } = client(() => json({}));
  await assert.rejects(
    () => leesRootItem(c, "drive-1", DRIVE_URL, `https://${HOST}${ROOT_PAD}/map%3Aiets`),
    (fout: GraphFout) => fout.code === "root_pad_onveilig",
  );
  assert.equal(gezien.length, 0);
});

// ---------------------------------------------------------------------------
//  Verifieerbaarheid van een zoekresultaat (#419-vervolg)
// ---------------------------------------------------------------------------
//  Graph laat `parentReference.path` bij ZOEKRESULTATEN regelmatig weg. Sinds de
//  containment op parentReference leunt, viel zo'n treffer stilzwijgend af en
//  was "één treffer, nul geaccepteerd" niet te onderscheiden van een koude
//  index. Deze tests leggen het onderscheid vast.

const OFFICE_URL = `https://${HOST}/:w:/r/sites/PGBRetrievalLab/_layouts/15/Doc.aspx?sourcedoc=%7Babc%7D`;

/** Een zoekresultaat zoals Graph het levert: drive-id, geen pad. */
function zoekhitZonderPad(id = "hit-1") {
  return { id, name: "PGB407-DOC-101-Zandloperbaken-hersteldossier.docx", webUrl: OFFICE_URL, parentReference: { driveId: "drive-1" } };
}

function scanClient(afhandel: (url: string) => Response | Promise<Response>, budget = 40) {
  return client(afhandel, budget);
}

test("een zoekresultaat met bruikbaar ouderpad wordt geaccepteerd zonder extra lezing", async () => {
  const { client: c, gezien } = scanClient(() =>
    json({
      value: [
        {
          id: "hit-1",
          name: "x.docx",
          webUrl: OFFICE_URL,
          parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` },
        },
      ],
    }));
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.binnenRoot, 1);
  assert.equal(uitkomst.verseHerlezingen, 0, "er is onnodig herlezen");
  assert.equal(gezien.length, 1);
});

test("ontbrekende parentReference leidt tot één verse lezing die de treffer bevestigt", async () => {
  // Dit is de live stand van 21-09.
  const { client: c, gezien } = scanClient((url) => {
    if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
    return json({
      id: "hit-1",
      webUrl: OFFICE_URL,
      parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` },
    });
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.treffers, 1);
  assert.equal(uitkomst.binnenRoot, 1);
  assert.equal(uitkomst.nietVerifieerbaar, 0);
  assert.equal(uitkomst.verseHerlezingen, 1);
  // Herlezen op drive-id + item-id, niet op iets uit het zoekresultaat zelf.
  assert.ok(gezien[1].includes("/drives/drive-1/items/hit-1?"), `onverwachte herlezing: ${gezien[1]}`);
});

test("een verse lezing uit een ANDERE drive wordt geweigerd", async () => {
  const { client: c } = scanClient((url) => {
    if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
    return json({ id: "hit-1", parentReference: { driveId: "drive-2", path: "/drives/drive-2/root:/Shared Documents" } });
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.binnenRoot, 0);
  assert.equal(uitkomst.buitenRoot, 1);
  assert.deepEqual(uitkomst.redenen, { andere_drive: 1 });
});

test("een verse lezing buiten de geregistreerde root wordt geweigerd", async () => {
  const { client: c } = scanClient((url) => {
    if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
    return json({ id: "hit-1", parentReference: { driveId: "drive-1", path: "/drives/drive-1/root:/Andere Map" } });
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", `${ROOT_GRAPH_PAD}/02 Beleid`, "Zandloperbaken 12");
  assert.equal(uitkomst.buitenRoot, 1);
  assert.deepEqual(uitkomst.redenen, { pad_buiten_root: 1 });
});

test("een shortcut wordt geweigerd en kost geen enkele verse lezing", async () => {
  // De inhoud van een snelkoppeling woont ergens anders; het item dat wij
  // vasthebben is de verwijzing. Daar valt niets aan te herlezen.
  const { client: c, gezien } = scanClient(() =>
    json({ value: [{ ...zoekhitZonderPad(), remoteItem: { id: "elders" } }] }));
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.buitenRoot, 1);
  assert.deepEqual(uitkomst.redenen, { shortcut: 1 });
  assert.equal(uitkomst.verseHerlezingen, 0);
  assert.equal(gezien.length, 1);
});

test("een shortcut die pas bij de verse lezing blijkt, wordt alsnog geweigerd", async () => {
  const { client: c } = scanClient((url) => {
    if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
    return json({ id: "hit-1", remoteItem: { id: "elders" }, parentReference: { driveId: "drive-1" } });
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.buitenRoot, 1);
  assert.deepEqual(uitkomst.redenen, { shortcut: 1 });
});

test("403 en 404 op de verse lezing zijn NIET verifieerbaar, niet buiten-root", async () => {
  // Het verschil telt: "ik mag het niet zien" is iets anders dan "het ligt
  // buiten de bron". Het eerste vraagt om uitzoeken, het tweede om opruimen.
  for (const status of [403, 404]) {
    const { client: c } = scanClient((url) => {
      if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
      return new Response("{}", { status });
    });
    const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
    assert.equal(uitkomst.nietVerifieerbaar, 1, `status ${status}`);
    assert.equal(uitkomst.buitenRoot, 0, `status ${status}`);
    assert.deepEqual(uitkomst.redenen, { herlezing_geweigerd: 1 }, `status ${status}`);
  }
});

test("429 en 5xx op de verse lezing zijn niet verifieerbaar en leveren geen tweede poging", async () => {
  for (const status of [429, 503]) {
    let herlezingen = 0;
    const { client: c } = scanClient((url) => {
      if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
      herlezingen++;
      return new Response("{}", { status });
    });
    const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
    assert.equal(uitkomst.nietVerifieerbaar, 1, `status ${status}`);
    assert.deepEqual(uitkomst.redenen, { herlezing_mislukt: 1 }, `status ${status}`);
    assert.equal(herlezingen, 1, `status ${status}: er is opnieuw geprobeerd`);
  }
});

test("een timeout op de verse lezing telt als niet verifieerbaar, niet als afwijzing", async () => {
  const { client: c } = scanClient((url) => {
    if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
    const fout = new Error("te traag");
    fout.name = "TimeoutError";
    throw fout;
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(uitkomst.nietVerifieerbaar, 1);
  assert.equal(uitkomst.buitenRoot, 0);
});

test("een AFBREKING stopt de scan en wordt nooit als meetuitkomst geteld", async () => {
  // Een geannuleerde run mag niet als "niet verifieerbaar" in een telling
  // eindigen; dan zou Ctrl-C er als een meetresultaat uitzien.
  const afbreker = new AbortController();
  const c = maakLeesClient({
    accessToken: "test-token",
    callBudget: 40,
    signal: afbreker.signal,
    fetchImpl: (async (invoer: any) => {
      if (String(invoer).includes("/search(")) return json({ value: [zoekhitZonderPad()] });
      afbreker.abort();
      const fout = new Error("afgebroken");
      fout.name = "AbortError";
      throw fout;
    }) as unknown as typeof fetch,
  });
  await assert.rejects(
    () => inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12"),
    (fout: GraphFout) => fout.code === "graph_afgebroken",
  );
});

test("een zoekresultaat zonder item-id is niet verifieerbaar en kost geen lezing", async () => {
  const { client: c, gezien } = scanClient(() =>
    json({ value: [{ name: "x.docx", webUrl: OFFICE_URL, parentReference: { driveId: "drive-1" } }] }));
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.deepEqual(uitkomst.redenen, { geen_item_id: 1 });
  assert.equal(uitkomst.verseHerlezingen, 0);
  assert.equal(gezien.length, 1);
});

test("het herleesbudget is een harde grens; daarboven wordt niet meer gelezen", async () => {
  let herlezingen = 0;
  const { client: c } = scanClient((url) => {
    if (url.includes("/search(")) {
      return json({ value: Array.from({ length: MAX_VERSE_HERLEZINGEN + 3 }, (_, i) => zoekhitZonderPad(`hit-${i}`)) });
    }
    herlezingen++;
    return json({ id: "x", parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` } });
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.equal(herlezingen, MAX_VERSE_HERLEZINGEN, "er is buiten het budget gelezen");
  assert.equal(uitkomst.verseHerlezingen, MAX_VERSE_HERLEZINGEN);
  assert.equal(uitkomst.binnenRoot, MAX_VERSE_HERLEZINGEN);
  assert.equal(uitkomst.nietVerifieerbaar, 3);
  assert.deepEqual(uitkomst.redenen, { herleesbudget_op: 3 });
});

test("een verse lezing die nog steeds geen ouderpad draagt, blijft niet verifieerbaar", async () => {
  const { client: c } = scanClient((url) => {
    if (url.includes("/search(")) return json({ value: [zoekhitZonderPad()] });
    return json({ id: "hit-1", webUrl: OFFICE_URL, parentReference: { driveId: "drive-1" } });
  });
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.deepEqual(uitkomst.redenen, { geen_parentref_na_herlezing: 1 });
  assert.equal(uitkomst.nietVerifieerbaar, 1);
});

test("een expliciet andere drive in het zoekresultaat kost geen verse lezing", async () => {
  const { client: c, gezien } = scanClient(() =>
    json({ value: [{ ...zoekhitZonderPad(), parentReference: { driveId: "drive-2" } }] }));
  const uitkomst = await inhoudscan(c, "drive-1", "root-item", ROOT_GRAPH_PAD, "Zandloperbaken 12");
  assert.deepEqual(uitkomst.redenen, { andere_drive: 1 });
  assert.equal(gezien.length, 1);
});
