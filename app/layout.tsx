import type { Metadata } from "next";
import { Newsreader, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { isPreviewOmgeving } from "@/core/lib/deploy-omgeving";
import "./globals.css";

// App-brede typografie. Dezelfde fonts als de marketingsite, nu via de
// root-layout zodat --font-serif/--font-sans overal (app, platform, login)
// beschikbaar zijn en de Tailwind-classes font-serif/font-sans werken.
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bestuurdersportaal",
  description:
    "Besluitvorming die standhoudt - AI-ondersteunde besluitvorming voor besturen, commissies en toezichthoudende organen.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isPreview = isPreviewOmgeving({
    vercelEnv: process.env.VERCEL_ENV,
    vercelTargetEnv: process.env.VERCEL_TARGET_ENV,
  });

  return (
    <html lang="nl" className={`${newsreader.variable} ${inter.variable}`}>
      <body>
        {children}
        {isPreview && (
          <div
            role="status"
            aria-label="U werkt in de Preview-omgeving"
            className="pointer-events-none fixed bottom-3 right-3 z-[100] rounded-lg border border-warn bg-warn-tint px-3 py-2 text-xs font-bold tracking-wide text-warn-ink shadow-lg"
          >
            PREVIEW · GEEN PRODUCTIEOMGEVING
          </div>
        )}
        <Analytics />
      </body>
    </html>
  );
}
