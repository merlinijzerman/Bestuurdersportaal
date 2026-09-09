import type { Metadata } from "next";
import { Newsreader, Inter } from "next/font/google";
import "../globals.css";

// ============================================================================
//  Eigen ROOT-layout voor de herstelflow (/koppelen) — fase 1C, #344 PR-B.
// ----------------------------------------------------------------------------
//  Bewust een aparte root-layout naast app/layout.tsx: op deze pagina staat het
//  herkoppeltoken tijdelijk in het URL-fragment. Daarom géén <Analytics/>, géén
//  scripts van derden, `referrer: no-referrer` en `noindex`. De fonts zijn
//  dezelfde als in de hoofdlayout (zelfde CSS-variabelen), meer niet.
// ============================================================================
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Koppeling herstellen",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function HerstelLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${newsreader.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
