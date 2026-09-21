// ============================================================================
//  #413 T4-C — De begrensde download: geen tokenlek, geen onbegrensde body.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk. `fetch` wordt geïnjecteerd.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOAD_TIMEOUT_MS,
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

/**
 * Een fetch die blijft hangen tot het meegegeven signaal afgaat. Let op de
 * eerste regel: een signaal dat AL is afgebroken vuurt geen event meer, en
 * zonder die controle wacht de test eeuwig op iets dat allang gebeurd is.
 */
function hangendeFetch(voorafAan?: () => void) {
  return (async (_url: string, init: RequestInit) => {
    voorafAan?.();
    const signaal = init.signal;
    if (signaal?.aborted) throw signaal.reason;
    await new Promise((_, reject) => {
      signaal?.addEventListener("abort", () => reject(signaal.reason), { once: true });
    });
    throw new Error("onbereikbaar");
  }) as (input: string, init: RequestInit) => Promise<Response>;
}

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

test("403/404 op een van beide stappen is een kandidaatweigering", async () => {
  for (const status of [404, 403, 410]) {
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

test("401 is BRONBREED en stopt de beurt, ook al lijkt het op een rechtenkwestie", async () => {
  // Een ongeldig token geldt voor élke kandidaat van deze bron. Zou 401 hier
  // als weigering eindigen, dan valt document na document stil af en levert de
  // beurt een volledig ogend antwoord op een kleinere bronverzameling.
  const eerste = stub([new Response(null, { status: 401 })]);
  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: eerste.impl })),
    (e: unknown) => e instanceof SharePointGraphError && e.categorie === "toestemming_of_token",
  );

  const tweede = stub([omleiding(DOWNLOAD), new Response(null, { status: 401 })]);
  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: tweede.impl })),
    (e: unknown) => e instanceof SharePointGraphError && e.categorie === "toestemming_of_token",
  );
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

test("na het verstrijken van de ketendeadline vertrekt er GEEN tweede call", async () => {
  // De reproductie uit de review: een fetch die het abortsignaal negeert en ná
  // de deadline alsnog een 302 teruggeeft. Zonder een ketencontrole op het
  // SUCCESPAD vertrok de download daarna gewoon — gemeten 2 calls in plaats
  // van 1. De deadline was dan niet meer dan een belofte in een commentaarregel.
  let calls = 0;
  const negeertSignaal = (async (_url: string, _init: RequestInit) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 60));
    return omleiding(DOWNLOAD);
  }) as (input: string, init: RequestInit) => Promise<Response>;

  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: negeertSignaal, timeoutMs: 20 })),
    (e: unknown) => e instanceof SharePointGraphError && e.categorie === "graph_timeout",
  );
  assert.equal(calls, 1, `na de deadline vertrok er alsnog een call (${calls})`);
});

test("ÉÉN DEADLINE over de keten: stap 1 verbruikt de klok van stap 2", async () => {
  // Eerst startte de deadline pas ná stap 1. Een trage omleiding plus een trage
  // download kon zo ruim het dubbele van de grens duren — ten koste van de
  // beurtdeadline die alle kandidaten samen delen.
  //
  // Beide stappen dragen nu hetzelfde signaal. Dat is hier direct zichtbaar:
  // stap 1 en stap 2 krijgen exact dezelfde AbortSignal mee.
  const { impl, aanroepen } = stub([omleiding(DOWNLOAD), bestand("hallo")]);
  await downloadItem(opdracht({ fetchImpl: impl }));
  assert.equal(aanroepen.length, 2);
  assert.ok(aanroepen[0].init.signal, "stap 1 loopt zonder deadline");
  assert.ok(aanroepen[1].init.signal, "stap 2 loopt zonder deadline");
  assert.equal(aanroepen[0].init.signal, aanroepen[1].init.signal, "stap 1 en 2 hebben elk hun eigen klok");
});

test("een verlopen ketendeadline is een STORING, geen beurtafbreking", async () => {
  // AbortSignal.timeout() zou een TimeoutError geven, en isAfbreking() leest
  // die als "de beurt is afgebroken" — dan zou één traag document de hele
  // beurt laten eindigen. Onze eigen klok houdt dat onderscheid vast.
  const traag = hangendeFetch();

  // De productieklok staat op 30 s; de test zet hem op 40 ms, anders wacht deze
  // suite een halve minuut per geval.
  assert.equal(DOWNLOAD_TIMEOUT_MS, 30_000, "de productiedeadline is gewijzigd");
  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: traag, timeoutMs: 40 })),
    (e: unknown) => e instanceof SharePointGraphError && !(e instanceof RetrievalAfgebroken),
  );
});

test("de beurtafbreking wint van de eigen klok", async () => {
  const afbreking = new RetrievalAfgebroken("timeout");
  const controller = new AbortController();
  const traag = hangendeFetch(() => controller.abort(afbreking));

  await assert.rejects(
    () => downloadItem(opdracht({ fetchImpl: traag, signal: controller.signal, timeoutMs: 5_000 })),
    (e: unknown) => e === afbreking,
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
