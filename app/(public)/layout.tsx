import type { Metadata } from "next";
import { Newsreader, Inter } from "next/font/google";
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
    default:
      "Bestuurdersportaal — eigen online besluitomgeving met AI voor besturen",
    template: "%s — Bestuurdersportaal",
  },
  description:
    "Het Bestuurdersportaal geeft besturen en commissies een eigen online besluitomgeving waarin AI werkt met de eigen documentatie, besluitdossiers en historische context — voor zorgvuldig voorbereiden, besluiten, verantwoorden en evalueren.",
  openGraph: {
    type: "website",
    locale: "nl_NL",
    siteName: "Bestuurdersportaal",
  },
};

// Thema-bootstrap: zet data-theme op de wrapper vóór paint (geen flash). Klein,
// geen externe library; de ThemeToggle beheert daarna de wissel. Default = licht.
const themeInit = `(function(){try{var t=localStorage.getItem('bp-theme');var el=document.currentScript&&document.currentScript.parentElement;if(el&&(t==='dark'||t==='light')){el.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bp-public ${newsreader.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      {children}
    </div>
  );
}
