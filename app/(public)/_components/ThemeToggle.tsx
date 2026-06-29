"use client";

// Licht/donker-thema voor de marketingsite. data-theme staat op de .bp-public
// wrapper (zie layout); de voorkeur wordt client-side onthouden (bp-theme).
// Dark mode is nice-to-have (FO REQ-PV-005); geen externe library.
export default function ThemeToggle() {
  function toggle() {
    const root = document.querySelector<HTMLElement>(".bp-public");
    if (!root) return;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("bp-theme", next);
    } catch {
      /* localStorage niet beschikbaar — thema werkt dan alleen deze sessie */
    }
  }

  return (
    <button
      type="button"
      className="toggle"
      onClick={toggle}
      title="Licht / donker"
      aria-label="Wissel thema"
    >
      ◐
    </button>
  );
}
