// ============================================================================
//  Hostname-routing — pure beslislogica (Increment P0 — TO §3.3, variant B).
// ----------------------------------------------------------------------------
//  De platform back-office leeft op een eigen subdomein (PLATFORM_HOST, bv.
//  beheer.fonds.nl) maar binnen hetzelfde Next.js-project. Route-groups voegen
//  geen URL-segment toe, dus de platformpagina's krijgen een ECHT pad-segment
//  /platform; de subdomein-host verbergt dat via een interne rewrite, zodat de
//  EXTERNE URL schoon blijft (beheer.fonds.nl/login → intern /platform/login).
//  Bij de latere variant-C-splitsing (apart Vercel-project) vervalt de rewrite
//  en blijven de externe URL's/bookmarks gelijk (FO §5.5).
//
//  Regels:
//   - platform-host: een schoon extern pad (/login) wordt naar /platform/login
//     gerewrite. Een tenant-pad bestaat onder /platform niet → 404 (test 18a).
//     Het interne /platform/*-pad is hier OOK direct toegestaan (door), zodat de
//     auth-gate een stabiel redirect-doel (/platform/login) heeft dat zowel in
//     productie (platform-host) als lokaal (dev-fallback) werkt.
//   - tenant-host: /platform/* → 404 (platform onbereikbaar, test 18b/12).
//
//  Dit is DEFENSE-IN-DEPTH, geen autorisatie. De echte poort blijft de
//  capability+audit-wrapper server-side (§4).
// ============================================================================

export const PLATFORM_PREFIX = "/platform";

/** Hoort deze host bij de platform-surface? Lege/ontbrekende config → nooit. */
export function isPlatformHost(
  host: string | null | undefined,
  platformHost: string | null | undefined
): boolean {
  if (!host || !platformHost) return false;
  // Strip poort (localhost:3000) en normaliseer.
  const h = host.split(":")[0].trim().toLowerCase();
  const p = platformHost.split(":")[0].trim().toLowerCase();
  return h === p;
}

export type RouteBeslissing =
  | { type: "rewrite"; naar: string }
  | { type: "notFound" }
  | { type: "door" };

/** Bepaalt wat met een request moet gebeuren op basis van host + pad. Pure,
 *  zodat de host-/padmatrix zonder server testbaar is (tests 12/18a/18b). */
export function bepaalRoute(args: {
  platformHost: boolean;
  pathname: string;
}): RouteBeslissing {
  const { platformHost, pathname } = args;
  const isPlatformPad =
    pathname === PLATFORM_PREFIX || pathname.startsWith(PLATFORM_PREFIX + "/");

  if (platformHost) {
    // Interne /platform-paden direct toestaan (stabiel redirect-doel voor de gate).
    if (isPlatformPad) return { type: "door" };
    // Rewrite elk schoon extern pad naar de platform-routegroep. Tenant-paden
    // bestaan onder /platform niet → 404 (test 18a). Wortel → /platform.
    const naar = pathname === "/" ? PLATFORM_PREFIX : PLATFORM_PREFIX + pathname;
    return { type: "rewrite", naar };
  }

  // Tenant-host: platform onbereikbaar (test 18b/12).
  if (isPlatformPad) return { type: "notFound" };
  return { type: "door" };
}
