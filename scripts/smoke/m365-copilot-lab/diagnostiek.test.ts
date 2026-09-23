import assert from "node:assert/strict";
import test from "node:test";
import { diagnostischeRetrievalFetch, type VeiligeProviderDiagnostiek } from "./diagnostiek";

const REQUEST_ID = "a1b2c3d4-1111-4111-8111-a1b2c3d4e5f6";

test("403 bewaart alleen een gesloten licentielabel en UUID's, nooit de providerboodschap", async () => {
  const gemeten: { diagnostiek?: VeiligeProviderDiagnostiek; headers?: Headers } = {};
  const stub = (async (_: unknown, init?: RequestInit) => {
    gemeten.headers = new Headers(init?.headers);
    return new Response(JSON.stringify({
      error: {
        code: "Forbidden",
        message: "Authorization Failed - User does not have valid license",
        innerError: { "request-id": "afwijkend" },
      },
    }), { status: 403, headers: { "request-id": REQUEST_ID } });
  }) as typeof fetch;

  const response = await diagnostischeRetrievalFetch(stub, new AbortController().signal, (d) => {
    gemeten.diagnostiek = d;
  })("https://graph.microsoft.com/v1.0/copilot/retrieval", {
    method: "POST",
    headers: { Authorization: "Bearer geheime-testwaarde" },
  });

  assert.equal(response.status, 403);
  assert.equal(gemeten.diagnostiek?.foutcode, "licentie_melding");
  assert.equal(gemeten.diagnostiek?.requestId, REQUEST_ID);
  assert.match(gemeten.diagnostiek?.clientRequestId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(gemeten.headers?.get("Authorization"), "Bearer geheime-testwaarde");
  assert.equal(gemeten.headers?.get("client-request-id"), gemeten.diagnostiek?.clientRequestId);
  assert.equal(gemeten.headers?.get("return-client-request-id"), "true");
  assert.ok(!JSON.stringify(gemeten.diagnostiek).includes("geheime-testwaarde"));
  assert.ok(!JSON.stringify(gemeten.diagnostiek).includes("User does not have valid license"));
});

test("vijandige providertekst, URL en foutcode kunnen niet in diagnostiek komen", async () => {
  const gemeten: { diagnostiek?: VeiligeProviderDiagnostiek } = {};
  const vijandig = "https://gevoelig.example/pad?token=SECRET";
  const stub = (async () => new Response(JSON.stringify({
    error: { code: vijandig, message: `document ${vijandig}`, innerError: { "request-id": vijandig } },
  }), { status: 403, headers: { "request-id": vijandig } })) as typeof fetch;
  await diagnostischeRetrievalFetch(stub, new AbortController().signal, (d) => { gemeten.diagnostiek = d; })("https://graph.microsoft.com");
  assert.equal(gemeten.diagnostiek?.foutcode, "onbekend");
  assert.equal(gemeten.diagnostiek?.requestId, null);
  assert.ok(!JSON.stringify(gemeten.diagnostiek).includes(vijandig));
});

test("Conditional Access-claim wordt herkend zonder WWW-Authenticate te bewaren", async () => {
  const gemeten: { diagnostiek?: VeiligeProviderDiagnostiek } = {};
  const challenge = 'Bearer realm="x", error="insufficient_claims", claims="geheim"';
  const stub = (async () => new Response("{}", { status: 403, headers: { "www-authenticate": challenge } })) as typeof fetch;
  await diagnostischeRetrievalFetch(stub, new AbortController().signal, (d) => { gemeten.diagnostiek = d; })("https://graph.microsoft.com");
  assert.equal(gemeten.diagnostiek?.foutcode, "insufficient_claims");
  assert.ok(!JSON.stringify(gemeten.diagnostiek).includes("geheim"));
});

test("een te grote chunked foutbody wordt gestopt, zonder de HTTP-uitkomst te veranderen", async () => {
  let annuleringen = 0;
  const gemeten: { diagnostiek?: VeiligeProviderDiagnostiek } = {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(9_000)); },
    cancel() { annuleringen++; },
  });
  const stub = (async () => new Response(body, { status: 403, headers: { "request-id": REQUEST_ID } })) as typeof fetch;
  const response = await diagnostischeRetrievalFetch(stub, new AbortController().signal, (d) => { gemeten.diagnostiek = d; })("https://graph.microsoft.com");
  assert.equal(response.status, 403);
  assert.equal(gemeten.diagnostiek?.foutcode, "onbekend");
  assert.equal(gemeten.diagnostiek?.requestId, REQUEST_ID);
  assert.equal(annuleringen, 1);
});

test("een ontbrekende header valt alleen terug op een geldige innerError request-id", async () => {
  const gemeten: { diagnostiek?: VeiligeProviderDiagnostiek } = {};
  const stub = (async () => new Response(JSON.stringify({
    error: { code: "accessDenied", innerError: { "request-id": REQUEST_ID } },
  }), { status: 403 })) as typeof fetch;
  await diagnostischeRetrievalFetch(stub, new AbortController().signal, (d) => { gemeten.diagnostiek = d; })("https://graph.microsoft.com");
  assert.equal(gemeten.diagnostiek?.foutcode, "access_denied");
  assert.equal(gemeten.diagnostiek?.requestId, REQUEST_ID);
});

test("een hangende foutbody blokkeert de 403-afhandeling hoogstens één seconde", async () => {
  const gemeten: { diagnostiek?: VeiligeProviderDiagnostiek } = {};
  let annuleringen = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { annuleringen++; } });
  const stub = (async () => new Response(body, { status: 403 })) as typeof fetch;
  const start = performance.now();
  const response = await diagnostischeRetrievalFetch(stub, new AbortController().signal, (d) => { gemeten.diagnostiek = d; })("https://graph.microsoft.com");
  const duur = performance.now() - start;
  assert.equal(response.status, 403);
  assert.ok(duur >= 900 && duur < 2_000, `diagnostiek duurde ${duur} ms`);
  assert.equal(gemeten.diagnostiek?.foutcode, "onbekend");
  assert.equal(annuleringen, 1);
});

test("afbreking tijdens het lezen blijft een beurtafbreking, geen 403-rapport", async () => {
  const afbreker = new AbortController();
  const body = new ReadableStream<Uint8Array>({});
  const stub = (async () => new Response(body, { status: 403 })) as typeof fetch;
  let diagnoses = 0;
  const lopend = diagnostischeRetrievalFetch(stub, afbreker.signal, () => { diagnoses++; })("https://graph.microsoft.com");
  afbreker.abort(new DOMException("afgebroken", "AbortError"));
  await assert.rejects(lopend, { name: "AbortError" });
  assert.equal(diagnoses, 0);
});

test("een geslaagde respons blijft geheel ongelezen door de diagnosewrapper", async () => {
  let diagnoses = 0;
  const stub = (async () => new Response('{"retrievalHits":[]}', { status: 200 })) as typeof fetch;
  const response = await diagnostischeRetrievalFetch(stub, new AbortController().signal, () => { diagnoses++; })("https://graph.microsoft.com");
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), '{"retrievalHits":[]}');
  assert.equal(diagnoses, 0);
});
