// ============================================================================
//  Pure, server-only-vrije cache-kern voor de tenant_domains-mapping (T1.2).
// ----------------------------------------------------------------------------
//  De beslislogica (TTL, stale-fallback) is losgetrokken van de I/O-schil
//  (lib/tenant-domains.ts, `server-only` + service-role) zodat ze zonder DB/tijd
//  testbaar is — zelfde patroon als platform-grant-regels.ts ↔ platform-wrapper.ts.
// ============================================================================

import type { TenantDomain } from "@/lib/tenant-host";

type CacheState = { data: ReadonlyArray<TenantDomain>; verlooptOp: number } | null;

/** Bouwt een gecachete lezer met injecteerbare `fetcher` + klok. Retourneert
 *  altijd een lijst; bij een fetch-fout stale cache indien aanwezig, anders []
 *  (fail-safe → de resolver geeft `onbekend`; observeert, blokkeert niet in T1.2). */
export function maakTenantDomainsCache(deps: {
  fetcher: () => Promise<TenantDomain[]>;
  now: () => number;
  ttlMs: number;
}) {
  const { fetcher, now, ttlMs } = deps;
  let state: CacheState = null;

  return async function haal(): Promise<ReadonlyArray<TenantDomain>> {
    const nu = now();
    if (state && nu < state.verlooptOp) return state.data;
    try {
      const data = await fetcher();
      state = { data, verlooptOp: nu + ttlMs };
      return data;
    } catch (e) {
      console.warn(
        `[TENANT-RESOLVE] tenant_domains-fetch faalde; ${
          state ? "stale cache hergebruikt" : "lege mapping"
        }`,
        e instanceof Error ? e.message : e
      );
      return state?.data ?? [];
    }
  };
}
