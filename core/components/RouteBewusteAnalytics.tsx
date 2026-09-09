"use client";
// ============================================================================
//  RouteBewusteAnalytics — de <Analytics/> van de algemene root-layout, maar
//  routebewust: op /koppelen (herstelflow, #344 PR-B) rendert dit NIETS.
// ----------------------------------------------------------------------------
//  app/(herstel)/layout.tsx is geen eigen root-layout zolang app/layout.tsx
//  bestaat; de herstelpagina erft dus deze root-layout. Het herkoppeltoken staat
//  daar tijdelijk in het URL-fragment, en een analytics-script mag dat pad niet
//  eens bezoeken. De padregel leeft in één browserveilige functie
//  (analyticsUitgesloten) en wordt door contract-, sanity- en E2E-tests gepind.
// ============================================================================
import { Analytics } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";
import { analyticsUitgesloten } from "@/core/lib/microsoft-login-meldingen-core";

export default function RouteBewusteAnalytics() {
  const pathname = usePathname();
  if (analyticsUitgesloten(pathname)) return null;
  return <Analytics />;
}
