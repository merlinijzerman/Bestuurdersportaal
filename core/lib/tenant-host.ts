// ============================================================================
//  Tenant-resolver — pure host→fonds-beslislogica (besluit 0040, B4).
// ----------------------------------------------------------------------------
//  De fondscontext wordt server-side afgeleid uit de request-host, niet uit de
//  UI of de request-body. Deze module bevat ALLEEN de pure beslisfunctie; de
//  data-fetch (service-role query op public.tenant_domains) en de middleware-
//  wiring zijn een vervolgticket (T1.2). Spiegelt het patroon van
//  lib/platform-host.ts: pure functie + aparte wiring-laag, server-loos testbaar.
//
//  FAIL-CLOSED: een lege, onbekende of niet-actieve host levert `onbekend` op.
//  Nooit een "eerste fonds"-fallback, nooit een default-fonds (besluit 0040, B4).
//
//  Dit is DEFENSE-IN-DEPTH naast de RLS-fonds-isolatie, geen autorisatie
//  (huispatroon 0039: RLS = fonds-isolatie, code = rolgate).
// ============================================================================

import { normaliseerHost } from "./platform-host";

/** Eén host→fonds-mappingrij, aangeleverd door de caller (T1.2 haalt deze via de
 *  service-role uit public.tenant_domains). `host` is reeds genormaliseerd. */
export type TenantDomain = {
  host: string;
  fondsId: string;
  actief: boolean;
};

export type FondsResolutie =
  | { type: "gevonden"; fondsId: string }
  | { type: "onbekend" }; // fail-closed: geen fonds, geen fallback

/** Vertaalt een request-host naar een fonds-context. Puur (geen I/O): de caller
 *  levert de mapping aan, net zoals bepaalSurface het env-contract krijgt.
 *
 *  Normaliseert de host (lowercase, poort weg, leidende `www.` weg — identiek
 *  aan platform-host) en zoekt een exacte match op een ACTIEVE rij. Geen match,
 *  lege host of alleen inactieve rijen → `onbekend` (fail-closed). */
export function bepaalFondsContext(args: {
  host: string | null | undefined;
  domains: ReadonlyArray<TenantDomain>;
}): FondsResolutie {
  const h = normaliseerHost(args.host);
  if (!h) return { type: "onbekend" };

  const match = args.domains.find((d) => d.actief && d.host === h);
  return match ? { type: "gevonden", fondsId: match.fondsId } : { type: "onbekend" };
}
