"use client";

import { useState } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";

// Marketing-header. variant "full" = volledige navigatie + hamburger/mobiel menu
// (homepage + subpagina's). variant "simple" = compacte balk voor tekstpagina's
// (privacy, contact). "Inloggen"/"/login" is een gewone link: op de marketing-
// host redirect de middleware naar de app-login (TO §2.5). Primaire CTA is
// overal "Neem contact op" (Bouwoverdracht §1 punt 3), nooit "Plan een demo".
//
// De `actief`-prop markeert het huidige menu-item (aria-current) voor a11y +
// visuele nadruk. Waarden = route-paden ("/product", "/voor-wie", …).
export type NavKey =
  | "/product"
  | "/voor-wie"
  | "/sectoren"
  | "/governance-ai"
  | "/over-ons"
  | null;

// De nav bevat sinds besluit 0103 geen externe links meer: The Paradox is uit
// de hoofdnavigatie gehaald ten gunste van "Over". De herkomst blijft zichtbaar
// via de hero-regel op de homepage, de Over-pagina en de footer — daar staat de
// externe link nog wél.
const NAV: { href: string; label: string }[] = [
  { href: "/product", label: "Product" },
  { href: "/voor-wie", label: "Voor wie" },
  { href: "/sectoren", label: "Sectoren" },
  { href: "/governance-ai", label: "Governance & AI" },
  { href: "/over-ons", label: "Over" },
];

export default function Header({
  variant = "full",
  actief = null,
}: {
  variant?: "full" | "simple";
  actief?: NavKey;
}) {
  const [open, setOpen] = useState(false);

  if (variant === "simple") {
    return (
      <header>
        <div className="wrap wide nav">
          <Link href="/" className="brand">
            <span className="mark">B</span>Bestuurdersportaal
          </Link>
          <span style={{ marginLeft: "auto" }} />
          <a href="/contact" className="btn">
            Neem contact op
          </a>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  return (
    <>
      <header>
        <div className="wrap nav">
          <Link href="/" className="brand">
            <span className="mark">B</span>Bestuurdersportaal
          </Link>
          <nav className="links">
            {NAV.map((item) => (
              <a
                key={item.href}
                className="navitem"
                href={item.href}
                aria-current={actief === item.href ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
            <a href="/contact" className="btn btn-primary">
              Neem contact op
            </a>
            <a href="/login" className="btn btn-outline">
              Inloggen
            </a>
            <ThemeToggle />
            <button
              type="button"
              className="hamburger"
              aria-label="Menu"
              aria-expanded={open}
              aria-controls="mobileMenu"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "✕" : "☰"}
            </button>
          </nav>
        </div>
      </header>
      <MobileMenu open={open} actief={actief} onNavigate={() => setOpen(false)} />
    </>
  );
}
