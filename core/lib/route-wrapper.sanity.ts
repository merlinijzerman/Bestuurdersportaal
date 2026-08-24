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
import { z } from "zod";
import type { NextRequest } from "next/server";
import { maakWithFondsRoute, type WrapperDeps, type FondsContext } from "./route-wrapper";
import type { RouteCapability } from "./capability-enforce";

/** De v1-tests (W2/W5) gaan NIET over de capability-poort. Ze draaien daarom op
 *  de declaratie die aantoonbaar niets afsluit, zodat ze precies dezelfde
 *  invarianten blijven toetsen als vóór W6. De poort zelf heeft eigen tests
 *  onderaan dit bestand. */
const IEDEREEN: RouteCapability = "iedere-ingelogde";

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
    // W6: default UIT. De vlag-aan-stand is de enige tak die gedrag verandert en
    // wordt per test expliciet aangezet — nooit via process.env.
    capabilityEnforceAan: () => false,
    // W9: default UIT, zelfde reden als capabilityEnforceAan. De schema-poort-tests
    // onderaan zetten hem per test expliciet aan.
    schemaEnforceAan: () => false,
    ...overrides,
  };
}

const req = () => new Request("http://localhost/api/test") as unknown as NextRequest;

async function main() {
  console.log("route-wrapper sanity-tests:");

  await test("geen sessie → exact {\"error\":\"Niet ingelogd\"} met status 401", async () => {
    const wrap = maakWithFondsRoute(deps({ createServerSupabase: async () => nepSupabase(null) }));
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => new Response("mag niet"));
    const res = await handler(req());
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Niet ingelogd" });
  });

  await test("geen profiel → ctx.fondsId/rol/naam === null", async () => {
    const cap: { ctx?: FondsContext } = {};
    const wrap = maakWithFondsRoute(deps({ haalProfiel: async () => null }));
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async (ctx) => {
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
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => Response.json({ ok: true }));
    await handler(req());
    assert.equal(aangeroepen, 0);
  });

  await test("host-guard AAN + !toegestaan → 403 met vaste body", async () => {
    const wrap = maakWithFondsRoute(
      deps({ beoordeelRouteHostToegang: async () => ({ toegestaan: false }) })
    );
    const handler = wrap({ capability: IEDEREEN, hostGuard: true, schema: "geen-body" }, async () => Response.json({ ok: true }));
    const res = await handler(req());
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Dit webadres hoort niet bij uw fonds." });
  });

  await test("onafgevangen fout in handler → 500 {\"error\":\"Serverfout\"}", async () => {
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => {
      throw new Error("boem");
    });
    const res = await handler(req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Serverfout" });
  });

  await test("ctx draagt rol/naam/fondsId door uit haalProfiel", async () => {
    const cap: { ctx?: FondsContext } = {};
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async (ctx) => {
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
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => respons);
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
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => respons);

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
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => {
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
    const handler = wrap({ capability: IEDEREEN, schema: "geen-body" }, async () => {
      throw new Error("fout vóór de eerste byte");
    });
    const res = await handler(req());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Serverfout" });
  });

  // ── W6 (#___) — de capability-poort ───────────────────────────────────────
  //
  //  Twee dingen moeten hier hard vaststaan, en ze zijn elkaars tegenproef:
  //    • met de vlag UIT verandert er NIETS aan de respons — dat is de hele
  //      belofte waarop de byte-identieke snapshots rusten;
  //    • met de vlag AAN geeft `TE_BEPALEN` wél 403 — anders zou "niets
  //      veranderd" ook waar zijn als de poort helemaal niet bedraad was.
  //  De vlag komt uit de DEPS, nooit uit process.env: een test die op een
  //  omgevingsvariabele leunt bewijst niets over de andere stand.

  /** Vangt console.warn af en geeft de opgevangen regels terug. */
  async function metOpgevangenWarn<T>(fn: () => Promise<T>): Promise<[T, unknown[][]]> {
    const opgevangen: unknown[][] = [];
    const origineel = console.warn;
    console.warn = (...args: unknown[]) => {
      opgevangen.push(args);
    };
    try {
      return [await fn(), opgevangen];
    } finally {
      console.warn = origineel;
    }
  }

  await test("vlag UIT + TE_BEPALEN → handler draait, respons ONGEWIJZIGD", async () => {
    let aangeroepen = 0;
    const wrap = maakWithFondsRoute(deps({ capabilityEnforceAan: () => false }));
    const handler = wrap({ capability: "TE_BEPALEN", schema: "geen-body" }, async () => {
      aangeroepen++;
      return Response.json({ ok: true });
    });
    const [res] = await metOpgevangenWarn(() => handler(req()));
    assert.equal(aangeroepen, 1);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  await test("vlag UIT + TE_BEPALEN → observe-logregel met route, rol en zou-beslissing", async () => {
    const wrap = maakWithFondsRoute(deps({ capabilityEnforceAan: () => false }));
    const handler = wrap({ capability: "TE_BEPALEN", schema: "geen-body" }, async () => Response.json({ ok: true }));
    const [, warns] = await metOpgevangenWarn(() => handler(req()));
    const regel = warns.find((w) => w[0] === "[CAPABILITY-OBSERVE]");
    assert.ok(regel, "geen [CAPABILITY-OBSERVE]-regel — W7 begint dan zonder dataset");
    const veld = regel[1] as Record<string, unknown>;
    assert.equal(veld.capability, "TE_BEPALEN");
    assert.equal(veld.rol, "voorzitter");
    assert.equal(veld.zouBeslissing, "weigeren");
    assert.equal(veld.reden, "te-bepalen");
    assert.equal(veld.handhaven, false);
    assert.equal(veld.route, "/api/test");
  });

  await test("observe-logregel draagt GEEN e-mail en GEEN gebruikers-id", async () => {
    // De ctx draagt sinds W4 een e-mailadres. Deze regel gaat naar de
    // platformlogs; W7 heeft route + rol + uitkomst nodig en verder niets.
    const wrap = maakWithFondsRoute(deps({ capabilityEnforceAan: () => false }));
    const handler = wrap({ capability: "TE_BEPALEN", schema: "geen-body" }, async () => Response.json({ ok: true }));
    const [, warns] = await metOpgevangenWarn(() => handler(req()));
    const regel = warns.find((w) => w[0] === "[CAPABILITY-OBSERVE]");
    assert.ok(regel);
    const tekst = JSON.stringify(regel[1]);
    assert.ok(!/@/.test(tekst), `observe-log lekt een e-mailadres: ${tekst}`);
    assert.ok(!/\bu-1\b/.test(tekst), `observe-log lekt het gebruikers-id: ${tekst}`);
  });

  await test("vlag AAN + TE_BEPALEN → 403 en de handler draait NIET", async () => {
    let aangeroepen = 0;
    const wrap = maakWithFondsRoute(deps({ capabilityEnforceAan: () => true }));
    const handler = wrap({ capability: "TE_BEPALEN", schema: "geen-body" }, async () => {
      aangeroepen++;
      return Response.json({ ok: true });
    });
    const [res] = await metOpgevangenWarn(() => handler(req()));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "U heeft geen rechten voor deze actie." });
    assert.equal(aangeroepen, 0, "de handler draaide alsnog — de poort staat ná de route");
  });

  await test("vlag AAN + iedere-ingelogde → doorgelaten", async () => {
    const wrap = maakWithFondsRoute(deps({ capabilityEnforceAan: () => true }));
    const handler = wrap({ capability: "iedere-ingelogde", schema: "geen-body" }, async () => Response.json({ ok: true }));
    const res = await handler(req());
    assert.equal(res.status, 200);
  });

  await test("vlag AAN + echte capability: rol heeft hem → door, rol mist hem → 403", async () => {
    // `dossiers.manage` hangt aan beheerder+voorzitter, niet aan bestuurder.
    const doorlaat = maakWithFondsRoute(deps({ capabilityEnforceAan: () => true }));
    const res1 = await doorlaat({ capability: "dossiers.manage", schema: "geen-body" }, async () =>
      Response.json({ ok: true })
    )(req());
    assert.equal(res1.status, 200);

    const weiger = maakWithFondsRoute(
      deps({
        capabilityEnforceAan: () => true,
        haalProfiel: async () => ({ id: "u-1", naam: "N", rol: "bestuurder", fondsId: "f-1" }),
      })
    );
    const [res2] = await metOpgevangenWarn(() =>
      weiger({ capability: "dossiers.manage", schema: "geen-body" }, async () => Response.json({ ok: true }))(req())
    );
    assert.equal(res2.status, 403);
  });

  await test("vlag AAN + geen profiel → 403 bij een echte capability (geen rol = geen recht)", async () => {
    const wrap = maakWithFondsRoute(
      deps({ capabilityEnforceAan: () => true, haalProfiel: async () => null })
    );
    const [res] = await metOpgevangenWarn(() =>
      wrap({ capability: "dossiers.manage", schema: "geen-body" }, async () => Response.json({ ok: true }))(req())
    );
    assert.equal(res.status, 403);
  });

  await test("ORDENING: host-guard gaat vóór de capability-poort", async () => {
    // Het BESLUIT uit de wrapper, gemeten in plaats van beredeneerd. Zou de
    // capability-poort ervóór staan, dan zou het flippen van ENFORCE_CAPABILITY
    // veranderen WELKE 403 een host-mismatch oplevert — een gedragswijziging die
    // niets met autorisatie te maken heeft.
    const wrap = maakWithFondsRoute(
      deps({
        capabilityEnforceAan: () => true,
        beoordeelRouteHostToegang: async () => ({ toegestaan: false }),
      })
    );
    const handler = wrap(
      { capability: "TE_BEPALEN", hostGuard: true, schema: "geen-body" },
      async () => Response.json({ ok: true })
    );
    const [res] = await metOpgevangenWarn(() => handler(req()));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Dit webadres hoort niet bij uw fonds." });
  });

  await test("vlag UIT + rol mist de capability → doorlaten (observe), niet weigeren", async () => {
    let aangeroepen = 0;
    const wrap = maakWithFondsRoute(
      deps({
        capabilityEnforceAan: () => false,
        haalProfiel: async () => ({ id: "u-1", naam: "N", rol: "bestuurder", fondsId: "f-1" }),
      })
    );
    const handler = wrap({ capability: "dossiers.manage", schema: "geen-body" }, async () => {
      aangeroepen++;
      return Response.json({ ok: true });
    });
    const [res, warns] = await metOpgevangenWarn(() => handler(req()));
    assert.equal(res.status, 200);
    assert.equal(aangeroepen, 1);
    const regel = warns.find((w) => w[0] === "[CAPABILITY-OBSERVE]");
    assert.ok(regel, "een mismatch onder de vlag-uit hoort wél geobserveerd te worden");
    assert.equal((regel[1] as Record<string, unknown>).reden, "rol-mist-capability");
  });

  await test("vlag UIT + rol HEEFT de capability → geen logregel (happy path blijft stil)", async () => {
    const wrap = maakWithFondsRoute(deps({ capabilityEnforceAan: () => false }));
    const handler = wrap({ capability: "dossiers.manage", schema: "geen-body" }, async () => Response.json({ ok: true }));
    const [, warns] = await metOpgevangenWarn(() => handler(req()));
    assert.equal(
      warns.filter((w) => w[0] === "[CAPABILITY-OBSERVE]").length,
      0,
      "proportioneel loggen: alleen zou-weigeringen, zoals [TENANT-RESOLVE]"
    );
  });

  await test("geen sessie → 401 vóór de capability-poort, ook met de vlag AAN", async () => {
    // De 401 is de byte-identieke vorm uit W2. Hij mag door W6 niet in een 403
    // veranderen: dat zou wél een responsebyte wijzigen.
    const wrap = maakWithFondsRoute(
      deps({ createServerSupabase: async () => nepSupabase(null), capabilityEnforceAan: () => true })
    );
    const handler = wrap({ capability: "TE_BEPALEN", schema: "geen-body" }, async () => new Response("mag niet"));
    const res = await handler(req());
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Niet ingelogd" });
  });

  // ── Schema-poort (W9) ─────────────────────────────────────────────────────
  // Een POST-request MET body; de wrapper leest een clone, de handler het origineel.
  const reqMetBody = (body: unknown) =>
    new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

  await test("SCHEMA: de wrapper leest een clone — de handler leest het origineel ONGEMOEID", async () => {
    // De kern van het W9-ontwerp: request.clone() consumeert het origineel niet,
    // dus ziet de handler onder de vlag UIT exact wat hij vandaag ziet (byte-identiek).
    const gezien: unknown[] = [];
    const wrap = maakWithFondsRoute(deps({}));
    const handler = wrap(
      { capability: "iedere-ingelogde", schema: z.object({}).passthrough() },
      async (_ctx, request) => {
        gezien.push(await request.json());
        return Response.json({ ok: true });
      }
    );
    const res = await handler(reqMetBody({ a: 1, titel: "x" }));
    assert.equal(res.status, 200);
    assert.deepEqual(gezien[0], { a: 1, titel: "x" }, "de handler moet de volledige body kunnen lezen");
  });

  await test("SCHEMA vlag UIT + mismatch → observe (5 velden) én doorlaten", async () => {
    let aangeroepen = 0;
    const wrap = maakWithFondsRoute(deps({ schemaEnforceAan: () => false }));
    const handler = wrap(
      { capability: "iedere-ingelogde", schema: z.object({ titel: z.string() }).passthrough() },
      async () => {
        aangeroepen++;
        return Response.json({ ok: true });
      }
    );
    const [res, warns] = await metOpgevangenWarn(() => handler(reqMetBody({ titel: 123 })));
    assert.equal(res.status, 200, "vlag uit mag geen byte wijzigen");
    assert.equal(aangeroepen, 1, "de handler moet gewoon draaien onder de vlag uit");
    const regel = warns.find((w) => w[0] === "[SCHEMA-OBSERVE]");
    assert.ok(regel, "een mismatch onder de vlag-uit hoort geobserveerd te worden");
    const r = regel[1] as Record<string, unknown>;
    assert.equal(r.veld, "titel");
    assert.equal(r.verwacht, "string");
    assert.equal(r.gekregen, "number");
    assert.equal(r.handhaven, false);
  });

  await test("SCHEMA vlag AAN + mismatch → 400, de handler draait NIET", async () => {
    let aangeroepen = 0;
    const wrap = maakWithFondsRoute(deps({ schemaEnforceAan: () => true }));
    const handler = wrap(
      { capability: "iedere-ingelogde", schema: z.object({ titel: z.string() }).passthrough() },
      async () => {
        aangeroepen++;
        return Response.json({ ok: true });
      }
    );
    const [res] = await metOpgevangenWarn(() => handler(reqMetBody({ titel: 123 })));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Ongeldige invoer." });
    assert.equal(aangeroepen, 0, "bij afdwinging mag de handler niet draaien");
  });

  await test("SCHEMA vlag AAN + geldige body → doorgelaten", async () => {
    const wrap = maakWithFondsRoute(deps({ schemaEnforceAan: () => true }));
    const handler = wrap(
      { capability: "iedere-ingelogde", schema: z.object({ titel: z.string() }).passthrough() },
      async () => Response.json({ ok: true })
    );
    const res = await handler(reqMetBody({ titel: "geldig", extra: 1 }));
    assert.equal(res.status, 200, "een geldige body (met onbekend extra veld) moet door");
  });

  await test("ORDENING: capability gaat vóór schema — een 403 wordt geen 400", async () => {
    // Beide vlaggen AAN, capability weigert ÉN de body zou een schemafout geven.
    // De uitkomst moet 403 zijn (capability eerst), niet 400 (schema). Gemeten,
    // niet beredeneerd — zodat het flippen van ENFORCE_SCHEMA niet verandert WELKE
    // afwijzing een onbevoegd verzoek krijgt.
    const wrap = maakWithFondsRoute(
      deps({
        capabilityEnforceAan: () => true,
        schemaEnforceAan: () => true,
        haalProfiel: async () => ({ id: "u-1", naam: "N", rol: "bestuurder", fondsId: "f-1" }),
      })
    );
    const handler = wrap(
      { capability: "dossiers.manage", schema: z.object({ titel: z.string() }).passthrough() },
      async () => Response.json({ ok: true })
    );
    const [res] = await metOpgevangenWarn(() => handler(reqMetBody({ titel: 123 })));
    assert.equal(res.status, 403, "capability weigert eerst; schema komt er niet aan toe");
    assert.deepEqual(await res.json(), { error: "U heeft geen rechten voor deze actie." });
  });

  console.log(`\nAlle ${n} route-wrapper sanity-tests groen.`);
}

main().catch((e) => {
  console.error("route-wrapper sanity ROOD:", e);
  process.exit(1);
});
