// ============================================================================
//  Data-access voor de host→fonds-mapping (tenant_domains) — SERVER-ONLY.
// ----------------------------------------------------------------------------
//  I/O-schil rond de pure resolver (T1.1, lib/tenant-host.ts): haalt de ACTIEVE
//  rijen uit public.tenant_domains op via de service-role en levert ze in exact
//  de vorm die bepaalFondsContext consumeert. Geen normalisatie/beslislogica
//  hier — die blijft puur in tenant-host.ts; de cache-/TTL-logica leeft in de
//  server-only-vrije kern lib/tenant-domains-cache.ts (los testbaar).
//
//  tenant_domains heeft BEWUST geen gewone-gebruiker-SELECT-policy (RLS
//  deny-by-default, migratie 2026_07_08). Lezen kan daarom alleen met de
//  service-role, buiten RLS om — vandaar de generieke server-only service-client
//  (lib/supabase-service.ts). Dit verzwakt geen tenant-RLS: de mapping is
//  globaal en niet-tenant-gebonden.
// ============================================================================

import "server-only";
import { createServiceSupabase } from "@/lib/supabase-service";
import { maakTenantDomainsCache } from "@/lib/tenant-domains-cache";
import type { TenantDomain } from "@/lib/tenant-host";

const TTL_MS = 60_000; // 60 s — vers genoeg, ontlast de DB per request.

/** Rauwe fetch van de actieve mapping. Genormaliseerde `host` staat al in de
 *  tabel (kolomcontract migratie 2026_07_08); we mappen alleen naam→camelCase. */
async function fetchActieveTenantDomains(): Promise<TenantDomain[]> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from("tenant_domains")
    .select("host, fonds_id, actief")
    .eq("actief", true);
  if (error) {
    throw new Error(`tenant_domains niet leesbaar: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    host: r.host as string,
    fondsId: r.fonds_id as string,
    actief: r.actief as boolean,
  }));
}

// Default productie-instantie: echte service-role-fetch + wandklok.
const haalUitCache = maakTenantDomainsCache({
  fetcher: fetchActieveTenantDomains,
  now: () => Date.now(),
  ttlMs: TTL_MS,
});

/** Actieve host→fonds-mapping, gecachet (~60 s). Vorm = input voor
 *  bepaalFondsContext (T1.1). */
export function haalActieveTenantDomains(): Promise<ReadonlyArray<TenantDomain>> {
  return haalUitCache();
}
