"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  section: string;
  iconSrc?: string;
  badge?: string;
  rolVereist?: string;
};

const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: "🏠", section: "Overzicht" },
  { href: "/dashboard", label: "Stuurinformatie", icon: "📊", section: "Overzicht" },
  { href: "/klantbeeld", label: "Klantbeeld", icon: "👥", section: "Overzicht" },
  { href: "/ai", label: "AI Assistent", icon: "🤖", iconSrc: "/ai-assistent.png", section: "Kennisbase", badge: "AI" },
  { href: "/bibliotheek", label: "Documentbibliotheek", icon: "📚", section: "Kennisbase" },
  { href: "/vergaderingen", label: "Vergaderingen", icon: "📅", section: "Bestuur" },
  { href: "/notulen", label: "Besluiten & Notulen", icon: "📋", section: "Bestuur" },
  { href: "/procedures", label: "Procedures", icon: "📂", section: "Bestuur" },
  { href: "/risicomatrix", label: "Risicomatrix", icon: "🛡️", section: "Bestuur" },
  { href: "/beheer", label: "Catalogus & organen", icon: "⚙️", section: "Beheer", rolVereist: "beheerder" },
  { href: "/governance", label: "Governance Log", icon: "🔍", section: "Beheer", rolVereist: "beheerder" },
];

interface SidebarProps {
  gebruikerNaam?: string;
  gebruikerRol?: string;
  fondsNaam?: string;
}

export default function Sidebar({ gebruikerNaam, gebruikerRol, fondsNaam }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function uitloggen() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = gebruikerNaam
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "??";

  const rolLabel: Record<string, string> = {
    voorzitter: "Voorzitter bestuur",
    bestuurder: "Bestuurslid",
    beheerder: "Beheerder",
  };

  let huidigSection = "";

  return (
    <nav className="w-64 h-screen bg-nav border-r border-nav-line flex flex-col fixed top-0 left-0 z-50">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-nav-line">
        <div className="w-10 h-10 bg-nav-accent rounded-xl flex items-center justify-center font-black text-lg text-white mb-3">
          P
        </div>
        <div className="text-nav-text-active font-bold text-sm leading-snug">
          {fondsNaam || process.env.NEXT_PUBLIC_FONDS_NAAM || "Bestuurdersportaal"}
        </div>
        <div className="text-nav-text text-xs mt-0.5">Bestuurdersportaal MVP</div>
      </div>

      {/* Gebruiker — klik opent het eigen profiel (geen los nav-item meer) */}
      <Link
        href="/profiel"
        title="Mijn profiel openen"
        className={`px-5 py-3 border-b border-nav-line flex items-center gap-2.5 transition-colors ${
          pathname === "/profiel" ? "bg-nav-active" : "hover:bg-nav-line/40"
        }`}
      >
        <div className="w-8 h-8 bg-nav-accent rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`text-xs font-semibold truncate ${
              pathname === "/profiel" ? "text-nav-text-active" : "text-nav-text-active"
            }`}
          >
            {gebruikerNaam || "Bestuurslid"}
          </div>
          <div className="text-nav-text text-xs">
            {rolLabel[gebruikerRol || "bestuurder"] || "Bestuurslid"}
          </div>
        </div>
        <span aria-hidden className="text-nav-text/60 text-xs flex-shrink-0">
          ›
        </span>
      </Link>

      {/* Navigatie */}
      <div className="flex-1 py-3 overflow-y-auto">
        {navItems
          .filter((item) => !item.rolVereist || item.rolVereist === gebruikerRol)
          .map((item) => {
          const showSection = item.section !== huidigSection;
          if (showSection) huidigSection = item.section;
          // Klantbeeld heeft sub-routes (/deelnemers, /werkgevers, …), dus matchen we de prefix
          const actief =
            item.href === "/klantbeeld"
              ? pathname.startsWith("/klantbeeld")
              : pathname === item.href;

          return (
            <div key={item.href}>
              {showSection && (
                <div className="px-5 pt-3 pb-1 text-nav-text/70 text-xs font-bold uppercase tracking-widest">
                  {item.section}
                </div>
              )}
              <Link
                href={item.href}
                className={`flex items-center gap-2.5 px-5 py-2.5 text-sm border-l-[3px] transition-all ${
                  actief
                    ? "bg-nav-active text-nav-text-active border-nav-accent font-medium"
                    : "text-nav-text border-transparent hover:bg-nav-line/40 hover:text-nav-text-active"
                }`}
              >
                {item.iconSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.iconSrc}
                    alt=""
                    aria-hidden="true"
                    className="w-5 h-5 object-contain"
                  />
                ) : (
                  <span className="text-base w-5 text-center">{item.icon}</span>
                )}
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="bg-nav-accent text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-nav-line space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-ok rounded-full pulse-dot"></span>
          <span className="text-nav-text text-xs">Beheerde AI-omgeving actief</span>
        </div>
        <button
          onClick={uitloggen}
          className="text-nav-text text-xs hover:text-nav-text-active transition-colors"
        >
          Uitloggen →
        </button>
      </div>
    </nav>
  );
}
