// ============================================================================
//  Sanity-tests voor de tenant-host-resolutie-cache (T1.2 / D1, data-access).
//  De pure host→fonds-resolutie is al in tenant-host.sanity.ts gedekt; hier
//  testen we alleen het (gesleutelde) cache-/fetch-gedrag via de injecteerbare kern.
//
//  Uitvoeren: npx tsx core/lib/tenant-domains.sanity.ts
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

const rij: TenantDomain = { host: "horizon.nl", fondsId: "fonds-a", actief: true };
const KEY = "horizon.nl";

async function main() {
  console.log("tenant-domains sanity-tests:");

  // Bestuurbare klok: `nu` wordt per test opgehoogd.
  let nu = 0;
  const now = () => nu;

  await test("eerste aanroep fetcht; tweede binnen TTL fetcht NIET (cache-hit)", async () => {
    let calls = 0;
    const haal = maakTenantDomainsCache<TenantDomain | null>({
      fetcher: async () => { calls++; return rij; },
      now,
      ttlMs: 1000,
      leeg: null,
    });
    nu = 0;
    assert.deepEqual(await haal(KEY), rij);
    nu = 999; // net binnen TTL
    assert.deepEqual(await haal(KEY), rij);
    assert.equal(calls, 1, "binnen TTL mag de DB niet opnieuw geraakt worden");
  });

  await test("cache is gesleuteld: een andere host fetcht apart", async () => {
    const gezien: string[] = [];
    const haal = maakTenantDomainsCache<TenantDomain | null>({
      fetcher: async (sleutel) => { gezien.push(sleutel); return rij; },
      now,
      ttlMs: 1000,
      leeg: null,
    });
    nu = 0;
    await haal("horizon.nl");
    await haal("horizon.nl"); // hit
    await haal("pgb.nl");     // andere sleutel → miss
    assert.deepEqual(gezien, ["horizon.nl", "pgb.nl"]);
  });

  await test("na TTL-verloop wordt opnieuw gefetcht", async () => {
    let calls = 0;
    const haal = maakTenantDomainsCache<TenantDomain | null>({
      fetcher: async () => { calls++; return rij; },
      now,
      ttlMs: 1000,
      leeg: null,
    });
    nu = 0;
    await haal(KEY);
    nu = 1000; // TTL verlopen (nu < verlooptOp is false)
    await haal(KEY);
    assert.equal(calls, 2, "na TTL moet de mapping opnieuw worden opgehaald");
  });

  await test("fetch-fout zonder cache → leeg (null; fail-safe → resolver 'onbekend')", async () => {
    const haal = maakTenantDomainsCache<TenantDomain | null>({
      fetcher: async () => { throw new Error("db down"); },
      now,
      ttlMs: 1000,
      leeg: null,
    });
    nu = 0;
    assert.equal(await haal(KEY), null);
  });

  await test("fetch-fout na eerdere succesvolle fetch → stale cache hergebruikt", async () => {
    let calls = 0;
    const haal = maakTenantDomainsCache<TenantDomain | null>({
      fetcher: async () => {
        calls++;
        if (calls === 1) return rij;
        throw new Error("db down");
      },
      now,
      ttlMs: 1000,
      leeg: null,
    });
    nu = 0;
    assert.deepEqual(await haal(KEY), rij); // vult de cache
    nu = 2000; // TTL verlopen → refetch, die nu faalt
    assert.deepEqual(await haal(KEY), rij, "stale cache moet blijven staan bij een fetch-fout");
    assert.equal(calls, 2);
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
