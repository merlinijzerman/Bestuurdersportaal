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

  console.log(`\nAlle ${n} route-wrapper sanity-tests groen.`);
}

main().catch((e) => {
  console.error("route-wrapper sanity ROOD:", e);
  process.exit(1);
});
