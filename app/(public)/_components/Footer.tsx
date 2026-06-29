// Marketing-footer (server component). variant "home" = volledige footer;
// "simple" = compacte linkbalk voor tekstpagina's (privacy, contact).
export default function Footer({
  variant = "home",
}: {
  variant?: "home" | "simple";
}) {
  if (variant === "simple") {
    return (
      <footer>
        <div className="wrap wide foot-links">
          <a href="/">Home</a>
          <a href="/contact">Contact</a>
          <a href="/login">Inloggen</a>
          <a href="https://the-paradox.com" target="_blank" rel="noopener">
            The Paradox
          </a>
        </div>
      </footer>
    );
  }

  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          Bestuurdersportaal — bestuurlijke besluitvorming, door ontwerp.
        </div>
        <div className="foot-links">
          <a href="#product">Product</a>
          <a href="#voor-besturen">Voor besturen</a>
          <a href="#eigen-omgeving">Eigen omgeving</a>
          <a href="#governance-ai">Governance &amp; AI</a>
          <a href="https://the-paradox.com" target="_blank" rel="noopener">
            The Paradox
          </a>
          <a href="/contact">Contact</a>
          <a href="/login">Inloggen</a>
          <a href="/privacy">Privacy</a>
        </div>
        <div className="foot-bottom">
          <span>© 2026 Bestuurdersportaal</span>
          <span>Gebouwd op het besluitvormingsdenken van The Paradox.</span>
        </div>
      </div>
    </footer>
  );
}
