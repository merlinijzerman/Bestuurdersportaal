// ============================================================================
//  #407 labsmoke — hermetische tests op het inwisselen van de autorisatiecode.
// ----------------------------------------------------------------------------
//  Dit is het enige stuk van de aanmeldflow dat zonder browser en zonder
//  loopback-socket te testen is, en het is precies het stuk waar de runner
//  eerder onbeperkt kon blijven hangen: ná de browserstap, in een `fetch`
//  zonder signaal en zonder deadline.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { AuthFout, wisselCodeIn } from "./auth";

const BASIS = {
  autoriteit: "https://login.microsoftonline.com/tenant/oauth2/v2.0",
  clientId: "client-id",
  code: "auth-code",
  redirectUri: "http://localhost:1234/",
  verifier: "verifier",
};

test("de tokenrequest draagt PKCE-verifier, geen clientsecret, en volgt geen omleiding", async () => {
  let gezienUrl = "";
  let gezienInit: any = null;
  await wisselCodeIn({
    ...BASIS,
    fetchImpl: (async (invoer: any, init: any) => {
      gezienUrl = String(invoer);
      gezienInit = init;
      return new Response(JSON.stringify({ access_token: "a", id_token: "b" }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.equal(gezienUrl, `${BASIS.autoriteit}/token`);
  assert.equal(gezienInit.redirect, "error");
  const body = new URLSearchParams(String(gezienInit.body));
  assert.equal(body.get("code_verifier"), "verifier");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_secret"), null, "een public client stuurt geen secret mee");
  // Het signaal is de kern van deze correctie: zonder is de call niet te stoppen.
  assert.ok(gezienInit.signal instanceof AbortSignal, "de tokenrequest ging zonder AbortSignal de deur uit");
  assert.equal(gezienInit.signal.aborted, false);
});

test("een afgebroken run stopt de tokenuitgifte met een eigen code", async () => {
  const afbreker = new AbortController();
  await assert.rejects(
    () =>
      wisselCodeIn({
        ...BASIS,
        signal: afbreker.signal,
        fetchImpl: ((_invoer: any, init: any) =>
          new Promise<Response>((_, mislukt) => {
            // Doet wat een echte fetch doet: luisteren naar het signaal.
            init.signal.addEventListener("abort", () => {
              const fout = new Error("afgebroken");
              fout.name = "AbortError";
              mislukt(fout);
            });
            afbreker.abort();
          })) as unknown as typeof fetch,
      }),
    (fout: AuthFout) => fout.code === "aanmelding_afgebroken",
  );
});

test("een tokenendpoint dat niet antwoordt, loopt op de eigen deadline en niet oneindig", async () => {
  const begin = Date.now();
  await assert.rejects(
    () =>
      wisselCodeIn({
        ...BASIS,
        timeoutMs: 60,
        // Antwoordt NOOIT uit zichzelf. Zonder deadline zou deze test hangen —
        // en dat is exact wat de runner eerder deed.
        fetchImpl: ((_invoer: any, init: any) =>
          new Promise<Response>((_, mislukt) => {
            init.signal.addEventListener("abort", () => mislukt(init.signal.reason));
          })) as unknown as typeof fetch,
      }),
    (fout: AuthFout) => fout.code === "tokenuitgifte_timeout",
  );
  assert.ok(Date.now() - begin < 5_000, "de deadline greep niet in");
});

test("een mislukte tokenrespons geeft alleen de status door, geen providertekst", async () => {
  await assert.rejects(
    () =>
      wisselCodeIn({
        ...BASIS,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "AADSTS70008 pgb-test@lab correlatie 1234" }),
            { status: 400 },
          )) as unknown as typeof fetch,
      }),
    (fout: AuthFout) =>
      fout.code === "tokenuitgifte_mislukt"
      && fout.message.includes("400")
      && !fout.message.includes("pgb-test")
      && !fout.message.includes("AADSTS"),
  );
});
