"use client";

// Uitklapnavigatie voor mobiel (FO REQ-PV-004/062). Toetsenbordbedienbaar:
// het is een lijst gewone links; sluiten gebeurt bij klik (onNavigate) en het
// is verborgen voor screenreaders zolang het dicht is (aria-hidden).
export default function MobileMenu({
  open,
  onNavigate,
}: {
  open: boolean;
  onNavigate: () => void;
}) {
  return (
    <div
      id="mobileMenu"
      className={`mobile-menu${open ? " open" : ""}`}
      aria-hidden={!open}
    >
      <a className="navitem" href="#product" onClick={onNavigate}>
        Product
      </a>
      <a className="navitem" href="#voor-besturen" onClick={onNavigate}>
        Voor besturen
      </a>
      <a className="navitem" href="#eigen-omgeving" onClick={onNavigate}>
        Eigen omgeving
      </a>
      <a className="navitem" href="#gebruikssituaties" onClick={onNavigate}>
        Gebruikssituaties
      </a>
      <a className="navitem" href="#voorwie" onClick={onNavigate}>
        Voor wie
      </a>
      <a className="navitem" href="#governance-ai" onClick={onNavigate}>
        Governance &amp; AI
      </a>
      <a
        className="navitem"
        href="https://the-paradox.com"
        target="_blank"
        rel="noopener"
        onClick={onNavigate}
      >
        The Paradox
      </a>
      <a className="navitem" href="/contact" onClick={onNavigate}>
        Contact
      </a>
      <div className="m-cta">
        <a href="/contact" className="btn btn-primary" onClick={onNavigate}>
          Plan een demo
        </a>
        <a href="/login" className="btn btn-outline" onClick={onNavigate}>
          Inloggen
        </a>
      </div>
    </div>
  );
}
