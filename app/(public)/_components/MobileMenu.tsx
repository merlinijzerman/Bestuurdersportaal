"use client";

import type { NavKey } from "./Header";

// Uitklapnavigatie voor mobiel. Zelfde items en volgorde als de desktopnav,
// met Over ons en Contact erachter. Primaire CTA = "Plan een live demo".
const ITEMS: { href: string; label: string }[] = [
  { href: "/#werkwijze", label: "Werkwijze" },
  { href: "/product", label: "Product" },
  { href: "/voor-wie", label: "Voor wie" },
  { href: "/governance-ai", label: "AI & governance" },
  { href: "/over-ons", label: "Over ons" },
  { href: "/contact", label: "Contact" },
];

export default function MobileMenu({
  open,
  actief = null,
  onNavigate,
}: {
  open: boolean;
  actief?: NavKey;
  onNavigate: () => void;
}) {
  return (
    <div
      id="mobileMenu"
      className={`mobile-menu${open ? " open" : ""}`}
      aria-hidden={!open}
    >
      {ITEMS.map((item) => (
        <a
          key={item.href}
          className="navitem"
          href={item.href}
          aria-current={actief === item.href ? "page" : undefined}
          onClick={onNavigate}
        >
          {item.label}
        </a>
      ))}
      <div className="m-cta">
        <a href="/contact" className="btn btn-primary" onClick={onNavigate}>
          Plan een live demo
        </a>
        <a href="/login" className="btn btn-outline" onClick={onNavigate}>
          Inloggen
        </a>
      </div>
    </div>
  );
}
