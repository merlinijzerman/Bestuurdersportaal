import type { Metadata } from "next";
import { Newsreader, Inter } from "next/font/google";
import { OPEN_GRAPH_IMAGE } from "./open-graph";
import "./public.css";

// Marketingtokens worden door deze fonts gevoed (--serif/--sans in public.css).
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

const MARKETING_ORIGIN = `https://${
  process.env.MARKETING_HOST?.split(",")[0]?.trim() || "bestuurdersportaal.com"
}`;

export const metadata: Metadata = {
  metadataBase: new URL(MARKETING_ORIGIN),
  title: {
    default: "Bestuurdersportaal — online besluitomgeving voor besturen",
    template: "%s — Bestuurdersportaal",
  },
  description:
    "Eén digitale plek om bestuursbesluiten voor te bereiden, te onderbouwen en vast te leggen. Met beheerste AI die laat zien welke bronnen zijn gebruikt.",
  openGraph: {
    type: "website",
    locale: "nl_NL",
    siteName: "Bestuurdersportaal",
    images: [OPEN_GRAPH_IMAGE],
  },
  twitter: { card: "summary_large_image" },
};

// v0.8: de themawissel is vervallen. De publieke site kent één lichte huisstijl,
// gelijk aan het palet achter de login; de themabootstrap en ThemeToggle zijn
// daarmee overbodig geworden.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`bp-public ${newsreader.variable} ${inter.variable}`}>
      {children}
    </div>
  );
}
