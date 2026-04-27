"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

const navItems = [
  { href: "/", label: "Dashboard", icon: "🏠", section: "Overzicht" },
  { href: "/ai", label: "AI Assistent", icon: "🤖", section: "Kennisbase", badge: "AI" },
  { href: "/bibliotheek", label: "Documentbibliotheek", icon: "📚", section: "Kennisbase" },
  { href: "/notulen", label: "Besluiten & Notulen", icon: "📋", section: "Bestuur" },
  { href: "/governance", label: "Governance Log", icon: "🔍", section: "Bestuur" },
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
    <nav className="w-64 min-h-screen bg-[#0F2744] flex flex-col fixed top-0 left-0 z-50">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/10">
        <div className="w-10 h-10 bg-[#C9A84C] rounded-xl flex items-center justify-center font-black text-lg text-[#0F2744] mb-3">
          P
        </div>
        <div className="text-white font-bold text-sm leading-snug">
          {fondsNaam || process.env.NEXT_PUBLIC_FONDS_NAAM || "Bestuurdersportaal"}
        </div>
        <div className="text-white/40 text-xs mt-0.5">Bestuurdersportaal MVP</div>
      </div>

      {/* Gebruiker */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-[#C9A84C] rounded-full flex items-center justify-center font-bold text-xs text-[#0F2744] flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-xs font-semibold truncate">
            {gebruikerNaam || "Bestuurslid"}
          </div>
          <div className="text-white/40 text-xs">
            {rolLabel[gebruikerRol || "bestuurder"] || "Bestuurslid"}
          </div>
        </div>
      </div>

      {/* Navigatie */}
      <div className="flex-1 py-3 overflow-y-auto">
        {navItems.map((item) => {
          const showSection = item.section !== huidigSection;
          if (showSection) huidigSection = item.section;
          const actief = pathname === item.href;

          return (
            <div key={item.href}>
              {showSection && (
                <div className="px-5 pt-3 pb-1 text-white/30 text-xs font-bold uppercase tracking-widest">
                  {item.section}
                </div>
              )}
              <Link
                href={item.href}
                className={`flex items-center gap-2.5 px-5 py-2.5 text-sm border-l-[3px] transition-all ${
                  actief
                    ? "bg-[#C9A84C]/15 text-[#C9A84C] border-[#C9A84C]"
                    : "text-white/65 border-transparent hover:bg-white/7 hover:text-white"
                }`}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="bg-[#C9A84C] text-[#0F2744] text-xs font-bold px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full pulse-dot"></span>
          <span className="text-white/40 text-xs">Beheerde AI-omgeving actief</span>
        </div>
        <button
          onClick={uitloggen}
          className="text-white/40 text-xs hover:text-white/70 transition-colors"
        >
          Uitloggen →
        </button>
      </div>
    </nav>
  );
}
