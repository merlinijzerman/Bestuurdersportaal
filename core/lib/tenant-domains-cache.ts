// ============================================================================
//  Pure, server-only-vrije cache-kern voor de tenant-host-resolutie (T1.2 / D1).
// ----------------------------------------------------------------------------
//  De beslislogica (TTL, stale-fallback) is losgetrokken van de I/O-schil
//  (lib/tenant-domains.ts, `server-only` + anon-RPC) zodat ze zonder DB/tijd
//  testbaar is — zelfde patroon als platform-grant-regels.ts ↔ platform-wrapper.ts.
//
//  D1 (werkopdracht C1): sinds de host→fonds-resolutie per host via de RPC
//  resolve_tenant_host loopt (i.p.v. één full-list-read met de service-role), is
//  deze cache GESLEUTELD op de genormaliseerde host. Per sleutel: TTL-hit, en bij
//  een fetch-fout de stale waarde (of `leeg` als er nog niets gecachet is) —
//  fail-safe, zodat een DB-hik de resolver niet laat omvallen.
// ============================================================================

type Entry<T> = { data: T; verlooptOp: number };

/** Bouwt een per-sleutel gecachete lezer met injecteerbare `fetcher` + klok.
 *  Retourneert altijd een waarde: TTL-hit → cache; miss → fetch; fetch-fout →
 *  stale waarde indien aanwezig, anders `leeg` (fail-safe → resolver `onbekend`;
 *  observeert, blokkeert niet in T1.2). */
export function maakTenantDomainsCache<T>(deps: {
  fetcher: (sleutel: string) => Promise<T>;
  now: () => number;
  ttlMs: number;
  leeg: T;
}) {
  const { fetcher, now, ttlMs, leeg } = deps;
  const state = new Map<string, Entry<T>>();

  return async function haal(sleutel: string): Promise<T> {
    const nu = now();
    const bestaand = state.get(sleutel);
    if (bestaand && nu < bestaand.verlooptOp) return bestaand.data;
    try {
      const data = await fetcher(sleutel);
      state.set(sleutel, { data, verlooptOp: nu + ttlMs });
      return data;
    } catch (e) {
      console.warn(
        `[TENANT-RESOLVE] host-resolutie faalde voor "${sleutel}"; ${
          bestaand ? "stale cache hergebruikt" : "lege waarde"
        }`,
        e instanceof Error ? e.message : e
      );
      return bestaand?.data ?? leeg;
    }
  };
}
