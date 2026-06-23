// ============================================================================
//  Hostname-middleware (Increment P0 — TO §3.3, variant B). DEFENSE-IN-DEPTH.
// ----------------------------------------------------------------------------
//  Scheidt de platform-host (PLATFORM_HOST) van de tenant-host op URL-niveau:
//   - platform-host → alles wordt naar de interne /platform-routegroep gerewrite;
//     tenant-paden bestaan daar niet → 404.
//   - tenant-host → /platform/* is onbereikbaar (404).
//
//  Dit is GEEN autorisatie. De echte poort is de capability+audit-wrapper
//  (lib/platform-wrapper.ts); de platform-auth/MFA-gate zit in de (beveiligd)-
//  layout. Middleware doet hier bewust GEEN DB-/sessiecheck (Edge, geen
//  service-role): "geen platform-sessie → naar login" wordt in die layout
//  afgedwongen.
//
//  Dev-fallback: lokaal (geen subdomein) simuleert ?platform=1 de platform-host,
//  zodat de routing te smoken is. Alleen buiten productie.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { isPlatformHost, bepaalRoute } from "@/lib/platform-host";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  const platformHostEnv = process.env.PLATFORM_HOST;

  const isDev = process.env.NODE_ENV !== "production";

  // Dev-ergonomie: lokaal (geen subdomein) is /platform/* direct bereikbaar,
  // zodat de platform-surface zonder host-config te smoken is.
  if (isDev && request.nextUrl.pathname.startsWith("/platform")) {
    return NextResponse.next();
  }

  let platformHost = isPlatformHost(host, platformHostEnv);

  // Dev-fallback: buiten productie mag ?platform=1 de platform-host simuleren
  // (zodat de rewrite van schone externe paden /login → /platform/login werkt).
  if (!platformHost && isDev && request.nextUrl.searchParams.get("platform") === "1") {
    platformHost = true;
  }

  const beslissing = bepaalRoute({
    platformHost,
    pathname: request.nextUrl.pathname,
  });

  switch (beslissing.type) {
    case "notFound":
      return new NextResponse("Not found", { status: 404 });
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
// is gedeeld door tenant- en platform-login (zelfde Supabase-project, 3b).
export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
