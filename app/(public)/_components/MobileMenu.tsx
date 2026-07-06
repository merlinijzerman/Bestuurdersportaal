"use client";

import type { NavKey } from "./Header";

// Uitklapnavigatie voor mobiel (FO REQ-PV-004/062). Toetsenbordbedienbaar: het
// is een lijst gewone links naar echte routes; sluiten gebeurt bij klik
// (onNavigate) en het menu is verborgen voor screenreaders zolang het dicht is
// (aria-hidden). Primaire CTA = "Neem contact op".
const ITEMS: { href: string; label: string; extern?: boolean }[] = [
  { href: "/product", label: "Product" },
  { href: "/voor-wie", label: "Voor wie" },
  { href: "/sectoren", label: "Sectoren" },
  { href: "/governance-ai", label: "Governance & AI" },
  { href: "/over-ons", label: "Over ons" },
  { href: "https://the-paradox.com", label: "The Paradox", extern: true },
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
      {ITEMS.map((item) =>
        item.extern ? (
          <a
            key={item.href}
            className="navitem"
            href={item.href}
            target="_blank"
            rel="noopener"
            onClick={onNavigate}
          >
            {item.label}
          </a>
        ) : (
          <a
            key={item.href}
            className="navitem"
            href={item.href}
            aria-current={actief === item.href ? "page" : undefined}
            onClick={onNavigate}
          >
            {item.label}
          </a>
        )
      )}
      <div className="m-cta">
        <a href="/contact" className="btn btn-primary" onClick={onNavigate}>
          Neem contact op
        </a>
        <a href="/login" className="btn btn-outline" onClick={onNavigate}>
          Inloggen
        </a>
      </div>
    </div>
  );
}
