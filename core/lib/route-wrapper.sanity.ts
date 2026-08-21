// ============================================================================
//  Sanity-tests voor core/lib/route-wrapper.ts (withFondsRoute v1, W2).
//
//  Geen testframework; standalone met assert + injecteerbare stubs via
//  maakWithFondsRoute. Uitvoeren: npx tsx core/lib/route-wrapper.sanity.ts
//
//  Waarom: de wrapper is de naad waar élke tenant-route straks doorheen loopt.
//  Drie invarianten moeten hard vaststaan vóór de codemod (W3/W4):
//    1. geen sessie → EXACT {"error":"Niet ingelogd"} / 401 (byte-identiek);
//    2. geen profiel → ctx.fondsId === null (route beslist zelf);
//    3. host-guard uit → de host-resolutie wordt niet eens aangeroepen.
//
//  W5 (#101) voegt de vierde toe, voor de twee SSE-routes:
//    4. de wrapper raakt een STREAM niet aan — hij geeft de Response ongewijzigd
//       door en zijn vangnet kan daarna niet meer afgaan.
//
//  Waarom die vierde apart moet: het vangnet van de wrapper produceert
//  500 {"error":"Serverfout"}. Bij een JSON-route is dat onschadelijk. Bij een
//  SSE-route niet: zodra de handler een Response met een ReadableStream heeft
//  teruggegeven zijn de headers verzonden, en een 500 daarná is onmogelijk — een
//  poging levert in het gunstigste geval een genegeerde write en in het
//  ongunstigste een afgebroken verbinding zonder spoor. Dit faalt dus pas in
//  productie, onder een fout die je in de test niet uitlokt. Vandaar de
//  expliciete injectieproef hieronder in plaats van een redenering.
// ============================================================================
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { maakWithFondsRoute, type WrapperDeps, type FondsContext } from "./route-wrapper";

let n = 0;
async function test(naam: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Minimale nep-Supabase; alleen auth.getUser wordt door de wrapper gebruikt.
function nepSupabase(user: { id: string } | null) {
  return { auth: { getUser: async () => ({ data: { user } }) } } as unknown as Awaited<
    ReturnType<WrapperDeps["createServerSupabase"]>
  >;
}

function deps(overrides: Partial<WrapperDeps>): WrapperDeps {
  return {
    createServerSupabase: async () => nepSupabase({ id: "u-1" }),
    haalProfiel: async () => ({ id: "u-1", naam: "N", rol: "voorzitter", fondsId: "f-1" }),
    beoordeelRouteHostToegang: async () => ({ toegestaan: true }),
    ...overrides,
  };
}

const req = () => new Request("http://localhost/api/test") as unknown as NextRequest;

async function main() {
  console.log("route-wrapper sanity-tests:");

  await test("geen sessie → exact {\"error\":\"Niet ingelogd\"} met status 401", async () => {
    const wrap = maakWithFondsRoute(deps({ createServerSupabase: async () => nepSupabase(null) }));
    const handler = wrap({}, async () => new Response("mag niet"));
    const res = await handler(req());
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Niet ingelogd" });
  });

  await test("geen profiel → ctx.fondsId/rol/naam === null", async () => {
    const cap: { ctx?: FondsContext } = {};
    const wrap = maakWithFondsRoute(deps({ haalProfiel: async () => null }));
    const handler = wrap({}, async (ctx) => {
      cap.ctx = ctx;
      return Response.json({ ok: true });
    });
    await handler(req());
    assert.ok(cap.ctx);
    assert.equal(cap.ctx.fondsId, null);
    assert.equal(cap.ctx.rol, null);
    assert.equal(cap.ctx.naam, null);
    assert.equal(cap.ctx.gebruikerId, "u-1");
  });

  await test("host-guard UIT → beoordeelRouteHostToegang wordt niet aangeroepen", async () => {
    let aangeroepen = 0;
    const wrap = maakWithFondsRoute(
      deps({
        beoordeelRouteHostToegang: async () => {
          aangeroepen++;
          return { toegestaan: true };
        },
      })
    );
    const handler = wrap({}, async () => Response.json({ ok: true }));
    await handler(req());
    assert.equal(aangeroepen, 0);
  });

  await test("host-guard AAN + !toegestaan → 403 met vaste body", async () => {
    const wrap = maakWithFondsRoute(
      deps({ beoordeelRouteHostToegang: async () => ({ toegestaan: false }) })
    );
    const handler = wrap({ hostGuard: true }, async () => Response.json({ ok: true }));
    const res = await handler(req());
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Dit webadres hoort niet bij uw fonds." });
  });

  await test("onafgevangen fout in handler → 500 {\"error\":\"Serverfout\"}", async () => {
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({}, async () => {
      throw new Error("boem");
    });
    const res = await handler(req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Serverfout" });
  });

  await test("ctx draagt rol/naam/fondsId door uit haalProfiel", async () => {
    const cap: { ctx?: FondsContext } = {};
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({}, async (ctx) => {
      cap.ctx = ctx;
      return Response.json({ ok: true });
    });
    await handler(req());
    assert.ok(cap.ctx);
    assert.equal(cap.ctx.rol, "voorzitter");
    assert.equal(cap.ctx.fondsId, "f-1");
    assert.ok(typeof cap.ctx.requestId === "string" && cap.ctx.requestId.length > 0);
  });

  // ── W5 (#101) — streamdoorgifte ───────────────────────────────────────────

  /** SSE-achtige respons: enqueue't één regel en roept dan `daarna` aan.
   *  `daarna` mag gooien — dat is de injectie. De throw staat BUITEN een
   *  try/catch in de start-callback, precies zoals een fout die aan de eigen
   *  catch van de route ontsnapt.
   *
   *  `async start` is hier ESSENTIEEL en niet cosmetisch. Bij een SYNCHRONE
   *  start-callback draait de hele body al binnen `new ReadableStream(...)`, dus
   *  vóór `new Response(...)` en dus vóór de handler returnt — de throw komt dan
   *  gewoon in de handleraanroep uit en het vangnet van de wrapper hoort hem
   *  juist wél af te vangen. De test hieronder maakt dat onderscheid expliciet.
   *
   *  Beide W5-SSE-routes gebruiken `async start(controller)` op de tak die de
   *  modelstream draagt (chat/route.ts en agendapunten/[id]/voorbereiding). De
   *  twee synchrone streams in chat enqueue'n een kant-en-klare payload en
   *  sluiten meteen; die kunnen niet ná de headers falen. */
  function sseRespons(daarna: () => void) {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode('data: {"type":"progress","n":0}\n\n'));
        daarna();
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  await test("stream → de wrapper geeft DEZELFDE Response door (identiteit)", async () => {
    const respons = sseRespons(() => {});
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({}, async () => respons);
    const uit = await handler(req());
    // Identiteit, niet gelijkwaardigheid: de wrapper mag hem niet herverpakken.
    assert.equal(uit, respons);
    assert.equal(uit.status, 200);
    assert.equal(uit.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(uit.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(await uit.text(), 'data: {"type":"progress","n":0}\n\n');
  });

  await test("throw NÁ het eerste enqueue → stream breekt af; GEEN Serverfout", async () => {
    const respons = sseRespons(() => {
      throw new Error("W5-injectie: fout ná het eerste enqueue");
    });
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({}, async () => respons);

    // 1. De wrapper heeft de respons al teruggegeven vóór de stream wordt
    //    geconsumeerd. Zijn catch omhult ALLEEN de aanroep van de handler.
    const uit = await handler(req());
    assert.equal(uit, respons);
    assert.equal(uit.status, 200);
    assert.equal(uit.headers.get("content-type"), "text/event-stream; charset=utf-8");

    // 2. Het consumeren gooit — de stream breekt af, zoals vóór de migratie.
    let gebroken = false;
    let tekst: string | null = null;
    try {
      tekst = await uit.text();
    } catch (e) {
      gebroken = true;
      assert.match(String((e as Error).message), /W5-injectie/);
    }
    assert.equal(gebroken, true, "de stream hoorde af te breken op de injectie");

    // 3. En het belangrijkste: er is NERGENS een 500 {"error":"Serverfout"}
    //    ontstaan. Dat is de fout die de wrapper zou introduceren als zijn
    //    vangnet de consumptie van de stream zou omhullen.
    assert.equal(tekst, null);
    assert.equal(uit.status, 200);
  });

  await test("SYNCHRONE start + throw → nog vóór de return; wrapper vangt hem wél", async () => {
    // De keerzijde van de vorige test, en de reden dat `async start` daar geen
    // detail is. Bij een synchrone start-callback loopt de hele body al binnen
    // `new ReadableStream(...)`: de throw gebeurt vóór `new Response(...)` en dus
    // vóór de handler returnt. Er is dan nog geen byte verzonden, en 500
    // {"error":"Serverfout"} is precies goed.
    //
    // Dit staat hier zodat het onderscheid gemeten is en niet aangenomen: wie
    // later een `async start` naar synchroon herschrijft, verandert daarmee stil
    // welke laag de fout afhandelt.
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({}, async () => {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode("data: {}\n\n"));
          throw new Error("W5-injectie: synchrone start");
        },
      });
      return new Response(stream, { status: 200 });
    });
    const res = await handler(req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Serverfout" });
  });

  await test("vangnet blijft gelden vóór de stream: throw VÓÓR de return → 500", async () => {
    // Tegenproef bij de vorige test. Zonder deze zou "geen Serverfout" ook waar
    // zijn als het vangnet helemaal stuk was.
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({}, async () => {
      throw new Error("fout vóór de eerste byte");
    });
    const res = await handler(req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Serverfout" });
  });

  console.log(`\nAlle ${n} route-wrapper sanity-tests groen.`);
}

main().catch((e) => {
  console.error("route-wrapper sanity ROOD:", e);
  process.exit(1);
});
