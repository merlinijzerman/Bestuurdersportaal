// ============================================================================
//  Hostname-routing — pure beslislogica (variant B).
// ----------------------------------------------------------------------------
//  Drie surfaces binnen hetzelfde Next.js-project, gescheiden op host-niveau
//  (Increment P0 + publieke voorkant W0 — TO publieke voorkant §2.1):
//
//   - 'marketing' (apex + www., MARKETING_HOST): publieke voorkant. App-/
//     platform-paden bestaan hier niet → 404. ENIGE uitzondering: /login →
//     redirect naar de app-login (backward-compat reeds gedeelde links, §2.5).
//     In W0 bestaan de (public)-pagina's nog niet, dus al het overige → 404;
//     in W1 wordt dit "serveer (public), 404 op app/platform-paden".
//   - 'app' (APP_HOST): de besluitomgeving (tenant-app + login + auth-callback).
//     /platform/* → 404; rest → door. Dit is óók de fail-safe default: een
//     onbekende/onconfigureerde host (preview, lokaal) valt achter de auth-gate.
//   - 'platform' (PLATFORM_HOST): platform back-office. Een schoon extern pad
//     (/login) wordt naar /platform/login gerewrite; tenant-paden bestaan onder
//     /platform niet → 404. Het interne /platform/*-pad is direct toegestaan
//     (door), zodat de auth-gate een stabiel redirect-doel heeft. Platform is
//     NOOIT de default → fail-closed (lege PLATFORM_HOST opent niets).
//
//  Bij de latere variant-C-splitsing (aparte Vercel-projecten) vervalt de
//  rewrite en blijven de externe URL's/bookmarks gelijk.
//
//  Dit is DEFENSE-IN-DEPTH, geen autorisatie. De echte poort blijft de
//  auth-gate in de layouts + de capability+audit-wrapper server-side (§4).
// ============================================================================

export const PLATFORM_PREFIX = "/platform";

export type Surface = "marketing" | "app" | "platform";

/** Normaliseer een host: poort strippen, lowercase, leidende `www.` weg, zodat
 *  apex en `www.apex` dezelfde marketing-surface zijn. */
function normaliseerHost(host: string | null | undefined): string | null {
  if (!host) return null;
  let h = host.split(":")[0].trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  return h || null;
}

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

/** Bepaalt de surface op basis van de request-host en het env-contract. Pure,
 *  zodat de host-matrix zonder server testbaar is. Matchvolgorde:
 *  platform → app → marketing → default 'app'. De app-precedentie boven
 *  marketing voorkomt bovendien een redirect-lus bij een (fout)configuratie
 *  waarin APP_HOST en MARKETING_HOST gelijk zijn. */
export function bepaalSurface(args: {
  host: string | null | undefined;
  marketingHost?: string | null;
  appHost?: string | null;
  platformHost?: string | null;
}): Surface {
  const h = normaliseerHost(args.host);
  const platform = normaliseerHost(args.platformHost);
  const app = normaliseerHost(args.appHost);
  const marketing = normaliseerHost(args.marketingHost);

  if (h && platform && h === platform) return "platform";
  if (h && app && h === app) return "app";
  if (h && marketing && h === marketing) return "marketing";
  // Fail-safe: onbekende/onconfigureerde host → 'app' (achter de auth-gate).
  // Platform is hierboven al afgehandeld en wordt nooit default → fail-closed.
  return "app";
}

export type RouteBeslissing =
  | { type: "rewrite"; naar: string }
  | { type: "redirectLogin" }
  | { type: "notFound" }
  | { type: "door" };

/** Bepaalt wat met een request moet gebeuren op basis van surface + pad. Pure,
 *  zodat de host-/padmatrix zonder server testbaar is. De absolute redirect-URL
 *  voor 'redirectLogin' (naar APP_HOST, query behouden) bouwt de middleware. */
export function bepaalRoute(args: {
  surface: Surface;
  pathname: string;
}): RouteBeslissing {
  const { surface, pathname } = args;
  const isPlatformPad =
    pathname === PLATFORM_PREFIX || pathname.startsWith(PLATFORM_PREFIX + "/");

  if (surface === "platform") {
    // Interne /platform-paden direct toestaan (stabiel redirect-doel voor de gate).
    if (isPlatformPad) return { type: "door" };
    // Rewrite elk schoon extern pad naar de platform-routegroep. Tenant-paden
    // bestaan onder /platform niet → 404. Wortel → /platform.
    const naar = pathname === "/" ? PLATFORM_PREFIX : PLATFORM_PREFIX + pathname;
    return { type: "rewrite", naar };
  }

  if (surface === "marketing") {
    // Backward-compat: reeds gedeelde loginlinks → app-login (§2.5). Nooit naar
    // / of homepage; geen lus (de app-host beslist daarna over de sessie).
    if (pathname === "/login") return { type: "redirectLogin" };
    // App- en platform-paden bestaan niet op de marketing-host. In W0 bestaan de
    // (public)-pagina's nog niet → al het overige eveneens 404 (geen lek).
    return { type: "notFound" };
  }

  // surface === "app": bestaand tenant-gedrag, ongewijzigd.
  if (isPlatformPad) return { type: "notFound" };
  return { type: "door" };
}
