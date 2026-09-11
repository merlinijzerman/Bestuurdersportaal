import Link from "next/link";

// Marketing-footer v0.8. Over ons, Contact en Privacy staan hier; de
// hoofdnavigatie is teruggebracht tot vier items.
export default function Footer({
  variant = "full",
}: {
  variant?: "full" | "simple";
}) {
  if (variant === "simple") {
    return (
      <footer>
        <div className="wrap wide foot-links">
          <Link href="/">Home</Link>
          <a href="/product">Product</a>
          <a href="/voor-wie">Voor wie</a>
          <a href="/over-ons">Over ons</a>
          <a href="/contact">Contact</a>
          <a href="/login">Inloggen</a>
          <a href="/privacy">Privacy</a>
        </div>
      </footer>
    );
  }

  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          Bestuurdersportaal — waar het besluit zijn onderbouwing houdt.
        </div>
        <div className="foot-links">
          <a href="/#werkwijze">Werkwijze</a>
          <a href="/product">Product</a>
          <a href="/voor-wie">Voor wie</a>
          <a href="/governance-ai">AI &amp; governance</a>
          <a href="/over-ons">Over ons</a>
          <a href="/contact">Contact</a>
          <a href="/login">Inloggen</a>
          <a href="/privacy">Privacy</a>
        </div>
        <div className="foot-bottom">
          <span>© 2026 Bestuurdersportaal</span>
          <span>Eerste specialisatie: pensioenfondsen</span>
        </div>
      </div>
    </footer>
  );
}
