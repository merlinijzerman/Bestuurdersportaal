// ============================================================================
//  Data-access voor de host→fonds-mapping (tenant_domains) — SERVER-ONLY.
// ----------------------------------------------------------------------------
//  I/O-schil rond de pure resolver (T1.1, lib/tenant-host.ts): resolveert één
//  request-host naar zijn actieve tenant_domains-rij en levert die in de vorm die
//  bepaalFondsContext consumeert. De normalisatie/beslislogica blijft puur in
//  tenant-host.ts; de cache-/TTL-logica in de server-only-vrije kern
//  tenant-domains-cache.ts (los testbaar).
//
//  D1 (werkopdracht C1): tenant_domains heeft BEWUST geen SELECT-policy (RLS
//  deny-by-default, migratie 2026_07_08). Voorheen las de resolver de volledige
//  mapping met de SERVICE-ROLE. Nu loopt de resolutie via de anon-key + de
//  SECURITY DEFINER-RPC `resolve_tenant_host(p_host)`, die exact 0/1 ACTIEVE rij
//  voor de meegegeven (genormaliseerde) host teruggeeft — strikt minder
//  blootstelling dan een full-table-read, geen service-role, en de tabel blijft
//  deny-by-default. Zo heeft de gedeelde surface de service-role hier niet meer
//  nodig (Fase B, criterium 2). Geen tenant-RLS geraakt: de mapping is globaal.
// ============================================================================

import "server-only";
import { createAnonSupabase } from "@/core/lib/supabase-anon";
import { normaliseerHost } from "@/core/lib/platform-host";
import { maakTenantDomainsCache } from "@/core/lib/tenant-domains-cache";
import type { TenantDomain } from "@/core/lib/tenant-host";

const TTL_MS = 60_000; // 60 s — vers genoeg, ontlast de DB per request.

/** Rauwe resolutie van één genormaliseerde host via de anon-RPC. Geeft de
 *  actieve rij of null (onbekende/inactieve host). */
async function fetchTenantDomainVoorHost(
  normHost: string
): Promise<TenantDomain | null> {
  const anon = createAnonSupabase();
  const { data, error } = await anon.rpc("resolve_tenant_host", {
    p_host: normHost,
  });
  if (error) {
    throw new Error(`resolve_tenant_host niet leesbaar: ${error.message}`);
  }
  const rij = (Array.isArray(data) ? data[0] : data) as
    | { host: string; fonds_id: string; actief: boolean }
    | undefined;
  if (!rij) return null;
  return { host: rij.host, fondsId: rij.fonds_id, actief: rij.actief };
}

// Default productie-instantie: anon-RPC-resolutie + wandklok, per host gecachet.
const haalUitCache = maakTenantDomainsCache<TenantDomain | null>({
  fetcher: fetchTenantDomainVoorHost,
  now: () => Date.now(),
  ttlMs: TTL_MS,
  leeg: null,
});

/** Resolveert een request-host naar zijn actieve tenant_domains-rij (of null),
 *  gecachet per genormaliseerde host (~60 s). Vorm = input voor
 *  bepaalFondsContext (T1.1). Lege/ontbrekende host → null. */
export async function haalTenantDomainVoorHost(
  host: string | null | undefined
): Promise<TenantDomain | null> {
  const norm = normaliseerHost(host);
  if (!norm) return null;
  return haalUitCache(norm);
}
