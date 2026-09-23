// ============================================================================
//  #413 T4-B — De client: één endpoint, hard budget, strikte parsing.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database, geen echt token. `fetch` wordt
//  geïnjecteerd; een test die per ongeluk naar buiten belt, faalt hier zichtbaar.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { roepCopilotRetrievalAan } from "../../core/lib/microsoft-retrieval/client";
import { CopilotFout } from "../../core/lib/microsoft-retrieval/fouten";
import { COPILOT_RETRIEVAL_ENDPOINT } from "../../core/lib/microsoft-retrieval/endpoint";
import { COPILOT_MAX_RESPONSE_BYTES } from "../../core/lib/microsoft-retrieval/client";
import { RetrievalAfgebroken } from "../../core/lib/retrieval/afbreken";

const HOST = "contoso.sharepoint.com";
const ROOT = `https://${HOST}/sites/pgb/Gedeelde documenten`;

type Aanroep = { url: string; init: RequestInit };

function stubFetch(antwoorden: (Response | (() => Response | Promise<Response>))[]) {
  const aanroepen: Aanroep[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    aanroepen.push({ url: String(url), init: init ?? {} });
    const volgende = antwoorden[Math.min(i, antwoorden.length - 1)];
    i++;
    return typeof volgende === "function" ? volgende() : volgende;
  }) as unknown as typeof fetch;
  return { impl, aanroepen };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function basis(extra: Partial<Parameters<typeof roepCopilotRetrievalAan>[0]> = {}) {
  return {
    vraag: "Welke hersteltermijn geldt er?",
    rootWebUrl: ROOT,
    siteHostnaam: HOST,
    maxKandidaten: 60,
    tokenbron: async () => ({ accessToken: "stub-token" }),
    signal: new AbortController().signal,
    ...extra,
  } as Parameters<typeof roepCopilotRetrievalAan>[0];
}

test("de call gaat naar het vastgepinde endpoint met een server-side body", async () => {
  const hits = { retrievalHits: [{ webUrl: `https://${HOST}/sites/pgb/a.docx`, extracts: [{ text: "een passage" }] }] };
  const { impl, aanroepen } = stubFetch([json(hits)]);
  const uitkomst = await roepCopilotRetrievalAan(basis({ fetchImpl: impl }));

  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].url, COPILOT_RETRIEVAL_ENDPOINT);
  assert.equal(aanroepen[0].init.method, "POST");
  assert.equal(aanroepen[0].init.redirect, "manual");

  const body = JSON.parse(String(aanroepen[0].init.body));
  assert.equal(body.dataSource, "sharePoint");
  assert.equal(body.filterExpression, 'path:"https://contoso.sharepoint.com/sites/pgb/Gedeelde%20documenten"');
  assert.equal(body.queryString, "Welke hersteltermijn geldt er?");
  // 60 gevraagd, geklemd op de Microsoft-grens.
  assert.equal(body.maximumNumberOfResults, 25);

  assert.deepEqual(uitkomst.kandidaten, [
    { webUrl: `https://${HOST}/sites/pgb/a.docx`, extracts: ["een passage"] },
  ]);
  assert.equal(uitkomst.netwerkpogingen, 1);
  assert.deepEqual(uitkomst.responsTelling, { retrievalHitsVeld: "array", ruweHits: 1, hitsZonderLocator: 0 });
});

test("een ongeldige root of lege vraag laat GEEN call vertrekken", async () => {
  for (const opdracht of [
    basis({ rootWebUrl: `https://andere.sharepoint.com/sites/pgb` }),
    basis({ rootWebUrl: `https://${HOST}/sites/pgb/a" OR path:"x` }),
    basis({ vraag: "   " }),
  ]) {
    const { impl, aanroepen } = stubFetch([json({ retrievalHits: [] })]);
    await assert.rejects(
      () => roepCopilotRetrievalAan({ ...opdracht, fetchImpl: impl }),
      (e: unknown) => e instanceof CopilotFout && e.code === "copilot_configuratie",
    );
    assert.equal(aanroepen.length, 0, "er is toch een call vertrokken");
  }
});

test("het budget telt feitelijke pogingen: bij budget 1 is een 429 een eindresultaat", async () => {
  const { impl, aanroepen } = stubFetch([json({}, 429)]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, requestBudget: 1 })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_rate_limit",
  );
  assert.equal(aanroepen.length, 1);
});

test("429 mag binnen het budget herhalen; 403 nooit", async () => {
  const herhaald = stubFetch([json({}, 429), json({ retrievalHits: [] })]);
  const uitkomst = await roepCopilotRetrievalAan(basis({ fetchImpl: herhaald.impl, requestBudget: 2 }));
  assert.equal(herhaald.aanroepen.length, 2);
  assert.equal(uitkomst.netwerkpogingen, 2);
  assert.deepEqual(uitkomst.kandidaten, []);

  const geweigerd = stubFetch([json({}, 403), json({ retrievalHits: [] })]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: geweigerd.impl, requestBudget: 3 })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_toegang_geweigerd",
  );
  assert.equal(geweigerd.aanroepen.length, 1, "een 403 is herhaald");
});

test("402 stopt onmiddellijk en blijft een configuratiefout", async () => {
  const { impl, aanroepen } = stubFetch([json({}, 402)]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, requestBudget: 3 })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_billing" && e.categorie === "configuratiefout",
  );
  assert.equal(aanroepen.length, 1);
});

test("een budget buiten de grenzen laat geen call vertrekken", async () => {
  for (const budget of [0, -1, 4, 2.5]) {
    const { impl, aanroepen } = stubFetch([json({ retrievalHits: [] })]);
    await assert.rejects(
      () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, requestBudget: budget })),
      (e: unknown) => e instanceof CopilotFout && e.code === "copilot_budget",
    );
    assert.equal(aanroepen.length, 0, `budget ${budget}`);
  }
});

test("een afgebroken beurt kost geen enkele poging", async () => {
  const controller = new AbortController();
  controller.abort(new RetrievalAfgebroken("annulering"));
  const { impl, aanroepen } = stubFetch([json({ retrievalHits: [] })]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, signal: controller.signal, requestBudget: 3 })),
    (e: unknown) => e instanceof RetrievalAfgebroken,
  );
  assert.equal(aanroepen.length, 0);
});

test("een onbekende responsvorm faalt gesloten en wordt niet herhaald", async () => {
  for (const body of [
    { retrievalHits: "geen-array" },
    { retrievalHits: [42] },
    { retrievalHits: [{ webUrl: "https://x/a", extracts: "geen-array" }] },
    "een string in plaats van een object",
  ]) {
    const { impl, aanroepen } = stubFetch([json(body)]);
    await assert.rejects(
      () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, requestBudget: 3 })),
      (e: unknown) => e instanceof CopilotFout && e.code === "copilot_responsvorm",
      JSON.stringify(body),
    );
    assert.equal(aanroepen.length, 1, "een vormfout is herhaald");
  }

  const kapot = stubFetch([new Response("{ geen json", { status: 200 })]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: kapot.impl, requestBudget: 3 })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_responsvorm",
  );
  assert.equal(kapot.aanroepen.length, 1);
});

test("een ontbrekend retrievalHits is een lege uitslag, geen fout", async () => {
  for (const [body, veld] of [
    [{}, "ontbreekt"],
    [{ retrievalHits: null }, "null"],
    [{ retrievalHits: [] }, "array"],
  ] as const) {
    const { impl } = stubFetch([json(body)]);
    const uitkomst = await roepCopilotRetrievalAan(basis({ fetchImpl: impl }));
    assert.deepEqual(uitkomst.kandidaten, []);
    assert.deepEqual(uitkomst.responsTelling, { retrievalHitsVeld: veld, ruweHits: 0, hitsZonderLocator: 0 });
  }
});

test("hits zonder bruikbare locator vallen stil af; lege extracts blijven leeg", async () => {
  const { impl } = stubFetch([
    json({
      retrievalHits: [
        { webUrl: "", extracts: [{ text: "x" }] },
        { extracts: [{ text: "y" }] },
        { webUrl: `https://${HOST}/sites/pgb/b.docx`, extracts: [{ text: "  " }, { tekst: "fout veld" }, { text: "goed" }] },
        { webUrl: `https://${HOST}/sites/pgb/c.docx` },
      ],
    }),
  ]);
  const uitkomst = await roepCopilotRetrievalAan(basis({ fetchImpl: impl }));
  assert.deepEqual(uitkomst.kandidaten, [
    { webUrl: `https://${HOST}/sites/pgb/b.docx`, extracts: ["goed"] },
    { webUrl: `https://${HOST}/sites/pgb/c.docx`, extracts: [] },
  ]);
  assert.deepEqual(uitkomst.responsTelling, { retrievalHitsVeld: "array", ruweHits: 4, hitsZonderLocator: 2 });
});

test("het aantal kandidaten blijft binnen het gevraagde plafond", async () => {
  const hits = Array.from({ length: 40 }, (_, i) => ({ webUrl: `https://${HOST}/sites/pgb/${i}.docx` }));
  const { impl } = stubFetch([json({ retrievalHits: hits })]);
  const uitkomst = await roepCopilotRetrievalAan(basis({ fetchImpl: impl, maxKandidaten: 5 }));
  assert.equal(uitkomst.kandidaten.length, 5);
  assert.deepEqual(uitkomst.responsTelling, { retrievalHitsVeld: "array", ruweHits: 40, hitsZonderLocator: 0 });
});

test("een te groot antwoord wordt geweigerd op content-length, zonder te lezen", async () => {
  const { impl } = stubFetch([
    json({ retrievalHits: [] }, 200, { "content-length": String(3 * 1024 * 1024) }),
  ]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: impl })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_responsvorm",
  );
});

test("de grens telt ONTVANGEN BYTES, niet tekens, en stopt het lezen", async () => {
  // Het geval dat de oude implementatie doorliet: chunked (dus geen
  // content-length), drie bytes per teken. 900.105 tekens halen elke
  // tekengrens, maar zijn 2.700.315 bytes.
  const chunk = new TextEncoder().encode("€".repeat(15_000)); // 45.000 bytes
  const nodig = 60; // 2.700.000 bytes — ruim boven 2 MiB
  let gepulld = 0;
  let geannuleerd = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (gepulld >= nodig) {
        controller.close();
        return;
      }
      gepulld++;
      controller.enqueue(chunk);
    },
    cancel() {
      geannuleerd = true;
    },
  });
  const { impl } = stubFetch([new Response(stream, { status: 200, headers: { "content-type": "application/json" } })]);

  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, requestBudget: 3 })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_responsvorm",
  );

  // De stream mag vooruitlezen (de queuing strategy vraagt een chunk zodra er
  // ruimte is), dus de marge is twee chunks. Wat telt: het lezen stopt vlak na
  // de grens in plaats van de hele body binnen te halen.
  const gelezenBytes = gepulld * chunk.byteLength;
  assert.ok(
    gelezenBytes <= COPILOT_MAX_RESPONSE_BYTES + 2 * chunk.byteLength,
    `er is doorgelezen tot ${gelezenBytes} bytes; de grens is ${COPILOT_MAX_RESPONSE_BYTES}`,
  );
  assert.ok(gepulld < nodig, "de hele body is alsnog binnengehaald");
  assert.ok(geannuleerd, "de reader is niet geannuleerd");
});

test("een multibyte antwoord binnen de grens wordt correct gedecodeerd over chunkgrenzen", async () => {
  // De splitsing valt midden in een driebyteteken; zonder `stream: true` op de
  // decoder levert dat een vervangingsteken op in plaats van de tekst.
  const payload = JSON.stringify({
    retrievalHits: [{ webUrl: `https://${HOST}/sites/pgb/€éü.docx`, extracts: [{ text: "één passage — met streepje" }] }],
  });
  const bytes = new TextEncoder().encode(payload);
  const knip = 40;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, knip));
      controller.enqueue(bytes.slice(knip));
      controller.close();
    },
  });
  const { impl } = stubFetch([new Response(stream, { status: 200, headers: { "content-type": "application/json" } })]);
  const uitkomst = await roepCopilotRetrievalAan(basis({ fetchImpl: impl }));
  assert.deepEqual(uitkomst.kandidaten, [
    { webUrl: `https://${HOST}/sites/pgb/€éü.docx`, extracts: ["één passage — met streepje"] },
  ]);
});

test("een omleiding wordt niet gevolgd maar als fout behandeld", async () => {
  // `redirect: "manual"` levert de 3xx zelf terug; hij is niet ok, en 3xx valt
  // onder configuratiefout — wij volgen niets van dit endpoint af.
  const { impl, aanroepen } = stubFetch([
    new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
  ]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({ fetchImpl: impl, requestBudget: 3 })),
    (e: unknown) => e instanceof CopilotFout && e.code === "copilot_configuratie",
  );
  assert.equal(aanroepen.length, 1);
});

test("het token wordt per poging opgehaald en reist alleen in de header mee", async () => {
  let opgehaald = 0;
  const { impl, aanroepen } = stubFetch([json({}, 503), json({ retrievalHits: [] })]);
  await roepCopilotRetrievalAan(
    basis({
      fetchImpl: impl,
      requestBudget: 2,
      tokenbron: async () => {
        opgehaald++;
        return { accessToken: `token-${opgehaald}` };
      },
    }),
  );
  assert.equal(opgehaald, 2, "het token is niet per poging opgehaald");
  const headers = aanroepen.map((a) => (a.init.headers as Record<string, string>).Authorization);
  assert.deepEqual(headers, ["Bearer token-1", "Bearer token-2"]);
  for (const aanroep of aanroepen) {
    assert.equal(String(aanroep.init.body).includes("token-"), false, "het token staat in de body");
  }
});

test("een falende tokenbron levert geen netwerkpoging op", async () => {
  const { impl, aanroepen } = stubFetch([json({ retrievalHits: [] })]);
  await assert.rejects(
    () => roepCopilotRetrievalAan(basis({
      fetchImpl: impl,
      tokenbron: async () => { throw new Error("geen token"); },
    })),
    (e: unknown) => e instanceof CopilotFout && e.categorie === "providerfout",
  );
  assert.equal(aanroepen.length, 0);
});
