// ============================================================================
//  Sanity-tests voor de tenant_domains-cache (T1.2, data-access).
//  De pure host→fonds-resolutie is al in tenant-host.sanity.ts gedekt; hier
//  testen we alleen het cache-/fetch-gedrag via de injecteerbare kern.
//
//  Uitvoeren: npx tsx lib/tenant-domains.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { maakTenantDomainsCache } from "./tenant-domains-cache";
import type { TenantDomain } from "./tenant-host";

let n = 0;
function test(naam: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn()).then(() => {
    n++;
    console.log(`  ✓ ${naam}`);
  });
}

const rijen: TenantDomain[] = [{ host: "horizon.nl", fondsId: "fonds-a", actief: true }];

async function main() {
  console.log("tenant-domains sanity-tests:");

  // Bestuurbare klok: `nu` wordt per test opgehoogd.
  let nu = 0;
  const now = () => nu;

  await test("eerste aanroep fetcht; tweede binnen TTL fetcht NIET (cache-hit)", async () => {
    let calls = 0;
    const haal = maakTenantDomainsCache({
      fetcher: async () => { calls++; return rijen; },
      now,
      ttlMs: 1000,
    });
    nu = 0;
    assert.deepEqual(await haal(), rijen);
    nu = 999; // net binnen TTL
    assert.deepEqual(await haal(), rijen);
    assert.equal(calls, 1, "binnen TTL mag de DB niet opnieuw geraakt worden");
  });

  await test("na TTL-verloop wordt opnieuw gefetcht", async () => {
    let calls = 0;
    const haal = maakTenantDomainsCache({
      fetcher: async () => { calls++; return rijen; },
      now,
      ttlMs: 1000,
    });
    nu = 0;
    await haal();
    nu = 1000; // TTL verlopen (nu < verlooptOp is false)
    await haal();
    assert.equal(calls, 2, "na TTL moet de mapping opnieuw worden opgehaald");
  });

  await test("fetch-fout zonder cache → lege lijst (fail-safe → resolver 'onbekend')", async () => {
    const haal = maakTenantDomainsCache({
      fetcher: async () => { throw new Error("db down"); },
      now,
      ttlMs: 1000,
    });
    nu = 0;
    assert.deepEqual(await haal(), []);
  });

  await test("fetch-fout na eerdere succesvolle fetch → stale cache hergebruikt", async () => {
    let calls = 0;
    const haal = maakTenantDomainsCache({
      fetcher: async () => {
        calls++;
        if (calls === 1) return rijen;
        throw new Error("db down");
      },
      now,
      ttlMs: 1000,
    });
    nu = 0;
    assert.deepEqual(await haal(), rijen); // vult de cache
    nu = 2000; // TTL verlopen → refetch, die nu faalt
    assert.deepEqual(await haal(), rijen, "stale cache moet blijven staan bij een fetch-fout");
    assert.equal(calls, 2);
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
