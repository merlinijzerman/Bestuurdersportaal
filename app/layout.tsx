import type { Metadata } from "next";
import { Newsreader, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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
  return (
    <html lang="nl" className={`${newsreader.variable} ${inter.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
