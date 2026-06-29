// ============================================================================
//  Hostname-middleware (variant B). DEFENSE-IN-DEPTH.
// ----------------------------------------------------------------------------
//  Scheidt drie surfaces op URL-niveau (TO publieke voorkant §2.1/§2.5):
//   - marketing-host (MARKETING_HOST) → publieke voorkant; /login → redirect
//     naar de app-login (backward-compat reeds gedeelde links), overige paden
//     → 404 (in W0 bestaan de (public)-pagina's nog niet).
//   - app-host (APP_HOST, óók de fail-safe default) → besluitomgeving; /platform/*
//     onbereikbaar (404), rest door.
//   - platform-host (PLATFORM_HOST) → rewrite naar de interne /platform-routegroep.
//
//  Dit is GEEN autorisatie. De echte poort is de auth-gate in de layouts +
//  de capability+audit-wrapper (lib/platform-wrapper.ts). Middleware doet hier
//  bewust GEEN DB-/sessiecheck (Edge, geen service-role).
//
//  A1 (cutover env-gedreven): zolang MARKETING_HOST niet gezet is, blijft de
//  apex 'app' (huidig gedrag). De flip naar marketing is dus het zetten/weghalen
//  van één env-var — meteen ook de rollback.
//
//  Dev-fallbacks (alleen buiten productie): ?surface=marketing|app|platform en
//  het bestaande ?platform=1 simuleren een host, zodat de routing zonder echte
//  subdomeinen te smoken is.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { bepaalSurface, bepaalRoute, type Surface } from "@/lib/platform-host";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  const isDev = process.env.NODE_ENV !== "production";

  // Dev-ergonomie: lokaal is /platform/* direct bereikbaar, zodat de
  // platform-surface zonder host-config te smoken is.
  if (isDev && request.nextUrl.pathname.startsWith("/platform")) {
    return NextResponse.next();
  }

  let surface = bepaalSurface({
    host,
    marketingHost: process.env.MARKETING_HOST,
    appHost: process.env.APP_HOST,
    platformHost: process.env.PLATFORM_HOST,
  });

  // Dev-fallback: buiten productie mag een querystring de surface simuleren
  // (o.a. om de marketing /login → app-login-redirect lokaal te testen).
  if (isDev) {
    const sim = request.nextUrl.searchParams.get("surface");
    if (sim === "marketing" || sim === "app" || sim === "platform") {
      surface = sim as Surface;
    } else if (request.nextUrl.searchParams.get("platform") === "1") {
      surface = "platform";
    }
  }

  const beslissing = bepaalRoute({
    surface,
    pathname: request.nextUrl.pathname,
  });

  switch (beslissing.type) {
    case "notFound":
      return new NextResponse("Not found", { status: 404 });

    case "redirectLogin": {
      // Backward-compat: marketing-host /login → app-login. 307 (tijdelijk,
      // methode-behoudend; → later 301 als apart besluit). Query-params blijven
      // behouden (clone neemt de search mee). Zonder APP_HOST geen veilig
      // redirect-doel → fail-safe doorlaten (geen lus, geen verkeerde host).
      const appHost = process.env.APP_HOST;
      if (!appHost) return NextResponse.next();
      const url = request.nextUrl.clone();
      if (!isDev) url.protocol = "https:";
      url.host = appHost;
      url.pathname = "/login";
      return NextResponse.redirect(url, 307);
    }

    case "rewrite": {
      const url = request.nextUrl.clone();
      url.pathname = beslissing.naar;
      return NextResponse.rewrite(url);
    }

    case "door":
    default:
      return NextResponse.next();
  }
}

// Laat statische assets, API- en auth-callbackroutes ongemoeid. De auth-callback
// hoort op de app-host (TO §2.6) en blijft hier uitgezonderd. /login wordt NIET
// uitgezonderd, zodat de marketing-redirect (§2.5) in de middleware kan draaien.
export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
