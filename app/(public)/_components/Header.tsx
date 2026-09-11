"use client";

import { useState } from "react";
import Link from "next/link";
import MobileMenu from "./MobileMenu";

// Marketing-header v0.8. Navigatie teruggebracht tot vier items; /sectoren is
// samengevoegd in /voor-wie. Primaire CTA is overal "Plan een live demo"
// (voorheen "Neem contact op"). De themaknop is vervallen: de site kent nog één
// lichte huisstijl.
export type NavKey =
  | "/product"
  | "/voor-wie"
  | "/governance-ai"
  | null;

const NAV: { href: string; label: string }[] = [
  { href: "/#werkwijze", label: "Werkwijze" },
  { href: "/product", label: "Product" },
  { href: "/voor-wie", label: "Voor wie" },
  { href: "/governance-ai", label: "AI & governance" },
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
          <a href="/contact" className="btn btn-primary btn-sm">
            Plan een live demo
          </a>
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
            <a href="/contact" className="btn btn-primary btn-sm">
              Plan een live demo
            </a>
            <a href="/login" className="btn btn-outline btn-sm">
              Inloggen
            </a>
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
