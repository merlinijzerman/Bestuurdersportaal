// ============================================================================
//  Sanity-tests voor platform/lib/machine-route-wrapper.ts (withMachineRoute v1).
//
//  Geen testframework; standalone met assert + injecteerbare stubs via
//  maakWithMachineRoute. Uitvoeren: npx tsx platform/lib/machine-route-wrapper.sanity.ts
//  (`npm run sanity` pakt dit bestand automatisch op — het draait mee in de
//  verplichte check "Security baseline (Sprint 1)".)
//
//  Waarom deze suite bestaat: de wrapper is de naad waar zeven machineroutes
//  doorheen gaan, en die routes draaien met de SERVICE-ROLE. Een fout hier is
//  geen tenantfout maar een platformfout. Vier invarianten moeten vaststaan
//  vóór de migratie:
//
//    1. De VOLGORDE. De DEPLOY_TARGET-skip staat vóór de bearer-check. Omdraaien
//       is geen cosmetica: dan krijgt een onbevoegde aanroep op de app-surface
//       een 401 in plaats van een 200-skip, en dat is een gedragswijziging in
//       PR 1 die er niet hoort te zijn. Getest door te bewijzen dat de
//       bearer-check bij een skip NIET WORDT AANGEROEPEN — een assertie op de
//       respons alleen zou dit niet vangen.
//    2. De twee responses zijn BYTE-IDENTIEK aan wat de routes vandaag
//       produceren. Daarom vergelijkt de suite de ruwe body-tekst, niet een
//       geparseerd object: {"ok":true,"skipped":"…"} en {"ok": true, …} zijn als
//       object gelijk en als snapshot verschillend.
//    3. `bewaking: "publiek"` roept GEEN van beide controles aan. Niet "hij laat
//       door", maar "hij kijkt niet eens" — anders zou een latere wijziging in
//       cron-auth stilletjes de publieke liveness-probe kunnen raken.
//    4. Er is GEEN vangnet. v1 voegt bewust geen try/catch toe; een fout uit de
//       handler moet er ongewijzigd uitkomen. Deze test legt die afwezigheid
//       vast, zodat "we hebben het vergeten" en "we hebben het bewust gelaten"
//       niet meer op elkaar lijken. Verdwijnt hij in PR 2, dan hoort deze test
//       mee te veranderen — met motivering.
// ============================================================================
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import {
  maakWithMachineRoute,
  type MachineDeps,
  type MachineContext,
} from "./machine-route-wrapper";

let n = 0;
async function test(naam: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const nepRequest = {} as NextRequest;

/** Deps met tellers, zodat we kunnen bewijzen wat er NIET is aangeroepen. */
function deps(opties: { opAppSurface: boolean; geautoriseerd: boolean }) {
  const geteld = { skipCheck: 0, authCheck: 0 };
  const d: MachineDeps = {
    draaitOpAppSurface: () => {
      geteld.skipCheck++;
      return opties.opAppSurface;
    },
    geautoriseerdeCron: () => {
      geteld.authCheck++;
      return opties.geautoriseerd;
    },
    // W9: default UIT. Alle specs hier zijn "geen-body", dus de schema-poort wordt
    // sowieso overgeslagen; de dep is er om MachineDeps compleet te maken.
    schemaEnforceAan: () => false,
  };
  return { d, geteld };
}

async function main() {
  console.log("withMachineRoute v1 — sanity");

  // ── 1. Skip vóór auth ─────────────────────────────────────────────────────
  await test(
    "app-surface: 200 skipped, en de bearer-check wordt NIET aangeroepen",
    async () => {
      const { d, geteld } = deps({ opAppSurface: true, geautoriseerd: false });
      let handlerAangeroepen = 0;
      const route = maakWithMachineRoute(d)({ bewaking: "cron-secret", label: "t", directeMutaties: [], schema: "geen-body", rateLimit: "geen", audit: "geen" }, async () => {
        handlerAangeroepen++;
        return new Response("nooit");
      });

      const res = await route(nepRequest);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '{"ok":true,"skipped":"deploy_target=app"}');
      assert.equal(handlerAangeroepen, 0, "handler mag niet draaien bij een skip");
      assert.equal(geteld.skipCheck, 1);
      assert.equal(
        geteld.authCheck,
        0,
        "VOLGORDE GEBROKEN: de bearer-check draaide vóór of tijdens de skip"
      );
    }
  );

  // ── 2. Byte-identieke 401 ─────────────────────────────────────────────────
  await test("niet geautoriseerd: exact 401 {\"error\":\"Niet geautoriseerd\"}", async () => {
    const { d, geteld } = deps({ opAppSurface: false, geautoriseerd: false });
    let handlerAangeroepen = 0;
    const route = maakWithMachineRoute(d)({ bewaking: "cron-secret", label: "t", directeMutaties: [], schema: "geen-body", rateLimit: "geen", audit: "geen" }, async () => {
      handlerAangeroepen++;
      return new Response("nooit");
    });

    const res = await route(nepRequest);
    assert.equal(res.status, 401);
    assert.equal(await res.text(), '{"error":"Niet geautoriseerd"}');
    assert.equal(handlerAangeroepen, 0);
    assert.equal(geteld.authCheck, 1);
  });

  // ── 3. Geautoriseerd: respons ONGEWIJZIGD door ────────────────────────────
  await test("geautoriseerd: de handler draait en zijn Response gaat ongewijzigd door", async () => {
    const { d } = deps({ opAppSurface: false, geautoriseerd: true });
    const eigen = new Response('{"werk":"gedaan"}', {
      status: 207,
      headers: { "content-type": "application/json", "x-eigen": "blijft" },
    });
    // Array i.p.v. een losse variabele: TypeScript versmalt een `let` die alleen
    // binnen een closure wordt gezet tot `never`, en dan verdwijnt juist de
    // assertie die er hier toe doet.
    const gezien: MachineContext[] = [];
    const route = maakWithMachineRoute(d)({ bewaking: "cron-secret", label: "worker", directeMutaties: [], schema: "geen-body", rateLimit: "geen", audit: "geen" }, async (ctx) => {
      gezien.push(ctx);
      return eigen;
    });

    const res = await route(nepRequest);
    assert.equal(res, eigen, "de wrapper mag de Response niet vervangen of kopiëren");
    assert.equal(res.status, 207);
    assert.equal(res.headers.get("x-eigen"), "blijft");
    assert.equal(gezien.length, 1, "handler kreeg geen context");
    assert.equal(gezien[0].label, "worker");
    assert.match(
      gezien[0].requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "requestId is geen uuid"
    );
  });

  // ── 4. "publiek" kijkt niet eens ──────────────────────────────────────────
  await test('bewaking "publiek": geen van beide controles wordt aangeroepen', async () => {
    const { d, geteld } = deps({ opAppSurface: true, geautoriseerd: false });
    const route = maakWithMachineRoute(d)({ bewaking: "publiek", label: "ping", directeMutaties: [], schema: "geen-body", rateLimit: "geen", audit: "geen" }, async () =>
      Response.json({ ok: true })
    );

    const res = await route(nepRequest);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"ok":true}');
    assert.equal(geteld.skipCheck, 0, '"publiek" mag de DEPLOY_TARGET-guard niet raadplegen');
    assert.equal(geteld.authCheck, 0, '"publiek" mag de bearer-check niet raadplegen');
  });

  // ── 5. Geen vangnet — bewust, en daarom vastgelegd ────────────────────────
  await test("v1 heeft GEEN vangnet: een fout uit de handler komt ongewijzigd naar buiten", async () => {
    const { d } = deps({ opAppSurface: false, geautoriseerd: true });
    const stuk = new Error("kapot in de handler");
    const route = maakWithMachineRoute(d)({ bewaking: "cron-secret", label: "t", directeMutaties: [], schema: "geen-body", rateLimit: "geen", audit: "geen" }, async () => {
      throw stuk;
    });

    await assert.rejects(
      () => route(nepRequest),
      (e: unknown) => e === stuk,
      "de wrapper ving de fout af — v1 hoort dat NIET te doen (zie de kop)"
    );
  });

  console.log(`\n${n} sanity-tests groen.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
