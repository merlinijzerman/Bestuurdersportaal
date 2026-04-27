import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bestuurdersportaal",
  description: "AI-ondersteund bestuurdersportaal voor pensioenfondsen",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
