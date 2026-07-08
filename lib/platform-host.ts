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

/** Publieke marketing-routes die op de marketing-host op hun eigen pad gerenderd
 *  mogen worden (de (public)-routegroep). Een expliciete allowlist — alles wat
 *  hier niet in staat (app-/platform-paden zoals /dashboard, /procedures,
 *  /platform/…) blijft 404, zodat de besluitomgeving nooit op de marketing-host
 *  lekt (REQ-PV-050/051). De homepage staat hier NIET in: die woont intern op
 *  MARKETING_HOME_PAD en wordt via een rewrite vanaf "/" geserveerd (zie onder).
 *  /login is geen pagina maar een redirect (zie bepaalRoute).
 *
 *  Fase 1 meerpagina (besluit 0035 + 0037): naast /contact en /privacy komen de
 *  nieuwe publieke routes hierbij. Dezelfde set 404't óók op de app-surface, zodat
 *  marketingpagina's niet op de app-host lekken (tegenhanger van REQ-PV-050/051).
 *
 *  /sectoren/pensioenfondsen stond hier lange tijd BEWUST NIET in: de pagina was
 *  gebouwd maar mocht pas live ná feitelijke pensioen-SME-validatie (besluit 0035).
 *  Die validatie is akkoord (6 juli 2026) → het pad is vrijgegeven, hier én in
 *  app/sitemap.ts. */
export const MARKETING_PUBLIEKE_PADEN = new Set<string>([
  "/contact",
  "/privacy",
  "/product",
  "/voor-wie",
  "/sectoren",
  "/sectoren/pensioenfondsen",
  "/governance-ai",
  "/over-ons",
]);

/** Interne route van de marketing-homepage. De (public)-routegroep kan geen
 *  page op "/" hebben — dat pad is al van de app-homepage ((dashboard)/page).
 *  Next.js verbiedt twee pages op hetzelfde pad. Daarom woont de marketing-
 *  homepage op /home en rewrit de marketing-host "/" hiernaartoe (de URL blijft
 *  "/"). Dit pad is intern: direct bezoek (marketing of app) → 404, zodat de
 *  canonieke marketing-URL "/" blijft en de marketingpagina niet op de app-host
 *  lekt. Spiegelt het platform-patroon (extern pad → interne /platform-rewrite). */
export const MARKETING_HOME_PAD = "/home";

export type Surface = "marketing" | "app" | "platform";

/** Normaliseer een host: poort strippen, lowercase, leidende `www.` weg, zodat
 *  apex en `www.apex` dezelfde marketing-surface zijn. Geëxporteerd zodat de
 *  tenant-resolver (lib/tenant-host.ts) exact hetzelfde contract hergebruikt. */
export function normaliseerHost(host: string | null | undefined): string | null {
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
    // Homepage: "/" wordt naar de interne /home-route gerewrit (de URL blijft
    // "/"). Het interne pad zelf → 404, zodat "/" canoniek blijft.
    if (pathname === "/")
      return { type: "rewrite", naar: MARKETING_HOME_PAD };
    if (pathname === MARKETING_HOME_PAD) return { type: "notFound" };
    // W1: de (public)-routegroep bestaat. Serveer alleen de expliciet
    // toegestane publieke paden; al het overige (app-/platform-paden) → 404,
    // zodat de besluitomgeving niet op de marketing-host lekt (REQ-PV-050/051).
    if (MARKETING_PUBLIEKE_PADEN.has(pathname)) return { type: "door" };
    return { type: "notFound" };
  }

  // surface === "app": bestaand tenant-gedrag, ongewijzigd — op de marketing-
  // paden na: de (public)-routegroep (home + /contact, /product, …) bestaat in de
  // route-tree en zou anders óók op de app-host de marketingpagina's tonen.
  // Expliciet 404 → geen marketing-lek op de app-host (tegenhanger van
  // REQ-PV-050/051). /home is het interne homepad, de rest de allowlist.
  if (isPlatformPad) return { type: "notFound" };
  if (pathname === MARKETING_HOME_PAD) return { type: "notFound" };
  if (MARKETING_PUBLIEKE_PADEN.has(pathname)) return { type: "notFound" };
  return { type: "door" };
}
