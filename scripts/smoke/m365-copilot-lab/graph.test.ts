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
  maakLeesClient,
} from "./graph";

const HOST = "bestuurdersportaaltest.sharepoint.com";
const ROOT_PAD = "/sites/PGBRetrievalLab/Shared Documents";

/** Laat alles binnen de root toe; de rootregel zelf wordt in smoke.test.ts getoetst. */
const binnenRoot = (webUrl: string | undefined): string | null => {
  if (!webUrl) return null;
  try {
    const parsed = new URL(webUrl);
    const pad = decodeURIComponent(parsed.pathname);
    return parsed.hostname === HOST && (pad === ROOT_PAD || pad.startsWith(`${ROOT_PAD}/`)) ? webUrl : null;
  } catch {
    return null;
  }
};

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
        { id: "1", name: "PGB407-DOC-101-a.docx", webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/02/PGB407-DOC-101-a.docx` },
        { id: "2", name: "elders.docx", webUrl: `https://${HOST}/sites/AndereSite/Shared%20Documents/elders.docx` },
      ],
    }));
  const uitkomst = await inhoudscan(c, "drive-1", "Zandloperbaken 12", binnenRoot);
  assert.equal(uitkomst.treffers, 2);
  assert.equal(uitkomst.binnenRoot, 1);
  assert.ok(gezien[0].includes("root/search(q='Zandloperbaken%2012')"));
});

test("een scanterm met een quote of wildcard komt de OData-functie niet in", async () => {
  const { client: c, gezien } = client(() => json({ value: [] }));
  for (const term of ["Zandloper'baken", "Zandloperbaken*", "Zandloperbaken\"12", "a OR b\n"]) {
    await assert.rejects(
      () => inhoudscan(c, "drive-1", term, binnenRoot),
      (fout: GraphFout) => fout.code === "scanterm_onveilig",
      `term ${JSON.stringify(term)} werd geaccepteerd`,
    );
  }
  assert.equal(gezien.length, 0);
});

test("de bestandsnaamscan loopt de bibliotheek af en raakt de zoekindex niet", async () => {
  const { client: c, gezien } = client((url) => {
    if (url.includes("/root/children")) {
      return json({
        value: [
          { id: "map-1", name: "02 Beleid en reglementen", folder: { childCount: 2 }, webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/02%20Beleid` },
          { id: "f-0", name: "leeswijzer.docx", file: {}, webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/leeswijzer.docx` },
        ],
      });
    }
    return json({
      value: [
        {
          id: "f-1",
          name: "PGB407-DOC-101-Zandloperbaken-hersteldossier.docx",
          file: {},
          webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/02%20Beleid/PGB407-DOC-101-Zandloperbaken-hersteldossier.docx`,
        },
        {
          id: "f-2",
          name: "PGB407-DOC-102-Nevelanker.docx",
          file: {},
          webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}/02%20Beleid/PGB407-DOC-102-Nevelanker.docx`,
        },
      ],
    });
  });
  const uitkomst = await bestandsnaamscan(c, "drive-1", "PGB407-DOC-101", binnenRoot);
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
        },
      ],
    }));
  assert.equal((await bestandsnaamscan(c, "drive-1", "PGB407-DOC-101", binnenRoot)).treffers, 0);
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
  const uitkomst = await bestandsnaamscan(c, "drive-1", "PGB407-DOC-101", binnenRoot);
  assert.equal(uitkomst.treffers, 0);
  assert.equal(gezien.length, 1, "een nextLink naar een andere host mag niet gevolgd worden");
});
