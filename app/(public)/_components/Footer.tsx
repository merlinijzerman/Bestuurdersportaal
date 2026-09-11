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
          <Link href="/product">Product</Link>
          <Link href="/voor-wie">Voor wie</Link>
          <Link href="/over-ons">Over ons</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/login">Inloggen</Link>
          <Link href="/privacy">Privacy</Link>
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
          <Link href="/#werkwijze">Werkwijze</Link>
          <Link href="/product">Product</Link>
          <Link href="/voor-wie">Voor wie</Link>
          <Link href="/governance-ai">AI &amp; governance</Link>
          <Link href="/over-ons">Over ons</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/login">Inloggen</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
        <div className="foot-bottom">
          <span>© 2026 Bestuurdersportaal</span>
          <span>Eerste specialisatie: pensioenfondsen</span>
        </div>
      </div>
    </footer>
  );
}
