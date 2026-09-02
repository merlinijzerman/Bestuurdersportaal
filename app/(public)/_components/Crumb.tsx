import Link from "next/link";

// Breadcrumb (server component). Start altijd op Home; het laatste item is de
// huidige pagina (aria-current, geen link). Puur navigatie/oriëntatie.
export default function Crumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="crumb" aria-label="Kruimelpad">
      <Link href="/">Home</Link>
      {items.map((it) => (
        <span key={it.label} style={{ display: "contents" }}>
          <span className="sep" aria-hidden="true">
            ›
          </span>
          {it.href ? (
            <a href={it.href}>{it.label}</a>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
