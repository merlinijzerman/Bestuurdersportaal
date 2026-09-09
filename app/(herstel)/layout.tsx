import type { Metadata } from "next";

// ============================================================================
//  Geneste layout voor de herstelflow (/koppelen) — fase 1C, #344 PR-B.
// ----------------------------------------------------------------------------
//  Dit is GEEN eigen root-layout: zolang app/layout.tsx bestaat erft /koppelen
//  die root-layout (fonts, globals.css, previewbanner). Daarom staan hier geen
//  <html>/<body>. Wat deze laag wél doet: `noindex` en `referrer: no-referrer`
//  in de metadata. Het weglaten van analytics gebeurt in de root-layout zelf,
//  routebewust (core/components/RouteBewusteAnalytics.tsx), omdat een geneste
//  layout een bovenliggend <Analytics/> niet kan tegenhouden.
// ============================================================================
export const metadata: Metadata = {
  title: "Koppeling herstellen",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function HerstelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
