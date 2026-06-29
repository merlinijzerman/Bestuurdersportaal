"use client";

import { useState } from "react";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";

// Marketing-header. variant "home" = volledige navigatie + hamburger/mobiel
// menu (homepage). variant "simple" = compacte balk voor tekstpagina's
// (privacy, contact). "Inloggen"/"/login" is een gewone link: op de
// marketing-host redirect de middleware naar de app-login (TO §2.5).
export default function Header({
  variant = "home",
}: {
  variant?: "home" | "simple";
}) {
  const [open, setOpen] = useState(false);

  if (variant === "simple") {
    return (
      <header>
        <div className="wrap wide nav">
          <a href="/" className="brand">
            <span className="mark">B</span>Bestuurdersportaal
          </a>
          <span style={{ marginLeft: "auto" }} />
          <a href="/contact" className="btn">
            Contact
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
          <a href="/" className="brand">
            <span className="mark">B</span>Bestuurdersportaal
          </a>
          <nav className="links">
            <a className="navitem" href="#product">
              Product
            </a>
            <a className="navitem" href="#voor-besturen">
              Voor besturen
            </a>
            <a className="navitem" href="#eigen-omgeving">
              Eigen omgeving
            </a>
            <a className="navitem" href="#governance-ai">
              Governance &amp; AI
            </a>
            <a
              className="navitem"
              href="https://the-paradox.com"
              target="_blank"
              rel="noopener"
            >
              The Paradox
            </a>
            <a href="/contact" className="btn btn-primary">
              Plan een demo
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
      <MobileMenu open={open} onNavigate={() => setOpen(false)} />
    </>
  );
}
