// ============================================================================
//  #413 T4-C — De begrensde download: geen tokenlek, geen onbegrensde body.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk. `fetch` wordt geïnjecteerd.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DOWNLOAD_BYTES,
  contentUrl,
  downloadItem,
  veiligeDownloadUrl,
} from "../../core/lib/microsoft-retrieval/download";
import { SharePointGraphError } from "../../core/lib/microsoft-sharepoint-graph-core";
import { RetrievalAfgebroken } from "../../core/lib/retrieval/afbreken";

const HOST = "check.sharepoint.com";
const DRIVE = "drive-1";
const ITEM = "item-1";
const DOWNLOAD = `https://${HOST}/_layouts/download.aspx?token=geheim`;

type Aanroep = { url: string; init: RequestInit };

function stub(antwoorden: Response[]) {
  const aanroepen: Aanroep[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    aanroepen.push({ url, init });
    return antwoorden[Math.min(i++, antwoorden.length - 1)];
  }) as (input: string, init: RequestInit) => Promise<Response>;
  return { impl, aanroepen };
}

const omleiding = (locatie: string | null, status = 302) =>
  new Response(null, { status, headers: locatie ? { location: locatie } : {} });

const bestand = (inhoud: Uint8Array | string, headers: Record<string, string> = {}) =>
  new Response(typeof inhoud === "string" ? inhoud : (inhoud.buffer as ArrayBuffer).slice(inhoud.byteOffset, inhoud.byteOffset + inhoud.byteLength), { status: 200, headers });

function opdracht(extra: Partial<Parameters<typeof downloadItem>[0]> = {}) {
  return { accessToken: "stub-token", driveId: DRIVE, itemId: ITEM, siteHostnaam: HOST, ...extra };
}

test("de omleiding wordt NIET automatisch gevolgd en het token gaat alleen naar Graph", async () => {
  const { impl, aanroepen } = stub([omleiding(DOWNLOAD), bestand("hallo")]);
  const uitkomst = await downloadItem(opdracht({ fetchImpl: impl }));
  assert.ok(uitkomst.ok);
  assert.equal(uitkomst.bytes.toString("utf8"), "hallo");

  assert.equal(aanroepen.length, 2);
  // Stap 1: naar Graph, mét token, redirect handmatig.
  assert.equal(aanroepen[0].url, contentUrl(DRIVE, ITEM));
  assert.equal(aanroepen[0].init.redirect, "manual");
  assert.equal((aanroepen[0].init.headers as Record<string, string>).Authorization, "Bearer stub-token");

  // Stap 2: naar de downloadhost, ZONDER token. Dit is de kern: zou de fetch de
  // omleiding zelf volgen, dan reisde het delegated token mee naar een host
  // waarvoor het niet bedoeld is.
  assert.equal(aanroepen[1].url, DOWNLOAD);
  const headers2 = aanroepen[1].init.headers as Record<string, string>;
  assert.equal(headers2.Authorization, undefined, "het token lekt naar de downloadhost");
  assert.equal(JSON.stringify(aanroepen[1].init).includes("stub-token"), false);
  assert.equal(aanroepen[1].init.redirect, "error");
});

test("alleen de eigen SharePointhost en de Microsoft-CDN zijn toegestaan", () => {
  assert.ok(veiligeDownloadUrl(DOWNLOAD, HOST));
  assert.ok(veiligeDownloadUrl("https://abc-my.files.1drv.com/x?token=1", HOST));
  assert.ok(veiligeDownloadUrl(`https://${HOST.toUpperCase()}/x`, HOST));

  for (const locatie of [
    null,
    "",
    "http://check.sharepoint.com/x",
    "https://evil.test/x",
    "https://andere.sharepoint.com/x",
    `https://${HOST}.evil.test/x`,
    `https://user:pw@${HOST}/x`,
    `https://${HOST}:8443/x`,
    `https://${HOST}/x#fragment`,
    "https://abc.files.1drv.com.evil.test/x",
    "geen-url",
  ]) {
    assert.equal(veiligeDownloadUrl(locatie, HOST), null, String(locatie));
  }
});

test("een omleiding naar een vreemde host levert geen download op", async () => {
  const { impl, aanroepen } = stub([omleiding("https://evil.test/x"), bestand("nooit")]);
  const uitkomst = await downloadItem(opdracht({ fetchImpl: impl }));
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "download");
  assert.equal(aanroepen.length, 1, "er is toch naar de vreemde host gegaan");
});

test("404/403/401 op een van beide stappen is een kandidaatweigering", async () => {
  for (const status of [404, 403, 401]) {
    const eerste = stub([new Response(null, { status })]);
    const a = await downloadItem(opdracht({ fetchImpl: eerste.impl }));
    assert.equal(a.ok, false, `stap 1 status ${status}`);
    assert.equal(a.ok === false && a.afwijzing, "rechten_configuratie");

    const tweede = stub([omleiding(DOWNLOAD), new Response(null, { status })]);
    const b = await downloadItem(opdracht({ fetchImpl: tweede.impl }));
    assert.equal(b.ok, false, `stap 2 status ${status}`);
    assert.equal(b.ok === false && b.afwijzing, "rechten_configuratie");
  }
});

test("een storing stopt de beurt in plaats van de kandidaat te laten vallen", async () => {
  for (const status of [429, 500, 503]) {
    const eerste = stub([new Response(null, { status })]);
    await assert.rejects(
      () => downloadItem(opdracht({ fetchImpl: eerste.impl })),
      (e: unknown) => e instanceof SharePointGraphError,
      `stap 1 status ${status}`,
    );

    const tweede = stub([omleiding(DOWNLOAD), new Response(null, { status })]);
    await assert.rejects(
      () => downloadItem(opdracht({ fetchImpl: tweede.impl })),
      (e: unknown) => e instanceof SharePointGraphError,
      `stap 2 status ${status}`,
    );
  }

  // Een netwerkfout is ook een storing, geen uitspraak over dit document.
  const kapot = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: kapot as never })),
    (e: unknown) => e instanceof SharePointGraphError,
  );
});

test("een afbreking wordt doorgegooid en kost geen tweede aanroep", async () => {
  const afbreking = new RetrievalAfgebroken("annulering");
  const controller = new AbortController();
  controller.abort(afbreking);
  const { impl, aanroepen } = stub([omleiding(DOWNLOAD), bestand("x")]);
  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: impl, signal: controller.signal })),
    (e: unknown) => e === afbreking,
  );
  assert.equal(aanroepen.length, 0);

  // En een afbreking die valt terwijl stap 1 onderweg is, telt niet alsnog mee.
  const laat = new AbortController();
  const afbreking2 = new RetrievalAfgebroken("timeout");
  const traag = (async () => { laat.abort(afbreking2); return omleiding(DOWNLOAD); }) as unknown as typeof fetch;
  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: traag as never, signal: laat.signal })),
    (e: unknown) => e === afbreking2,
  );
});

test("de grens telt ONTVANGEN BYTES en stopt het lezen", async () => {
  // Chunked, geen content-length, drie bytes per teken: een tekengrens zou dit
  // doorlaten.
  const chunk = new TextEncoder().encode("€".repeat(200_000)); // 600.000 bytes
  const nodig = 50; // 30 MB
  let gepulld = 0;
  let geannuleerd = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (gepulld >= nodig) return controller.close();
      gepulld++;
      controller.enqueue(chunk);
    },
    cancel() { geannuleerd = true; },
  });
  const { impl } = stub([omleiding(DOWNLOAD), new Response(stream, { status: 200 })]);
  const uitkomst = await downloadItem(opdracht({ fetchImpl: impl }));

  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "download");
  assert.ok(gepulld * chunk.byteLength <= MAX_DOWNLOAD_BYTES + 2 * chunk.byteLength, "er is doorgelezen");
  assert.ok(gepulld < nodig, "de hele body is alsnog binnengehaald");
  assert.ok(geannuleerd, "de reader is niet geannuleerd");
});

test("content-length boven de grens wordt geweigerd zonder te lezen", async () => {
  const { impl } = stub([
    omleiding(DOWNLOAD),
    bestand("x", { "content-length": String(MAX_DOWNLOAD_BYTES + 1) }),
  ]);
  const uitkomst = await downloadItem(opdracht({ fetchImpl: impl }));
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "download");
});

test("een leeg bestand is geen bruikbare kandidaat", async () => {
  const { impl } = stub([omleiding(DOWNLOAD), bestand(new Uint8Array(0))]);
  const uitkomst = await downloadItem(opdracht({ fetchImpl: impl }));
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "download");
});

test("binaire inhoud komt byte-voor-byte terug", async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x7f, 0x80]);
  const { impl } = stub([omleiding(DOWNLOAD), bestand(bytes)]);
  const uitkomst = await downloadItem(opdracht({ fetchImpl: impl }));
  assert.ok(uitkomst.ok);
  assert.deepEqual(new Uint8Array(uitkomst.bytes), bytes);
});
