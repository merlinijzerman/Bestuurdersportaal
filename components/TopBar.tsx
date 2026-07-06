"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

interface TopBarProps {
  gebruikerNaam?: string;
  gebruikerRol?: string;
  fondsNaam?: string;
}

const rolLabel: Record<string, string> = {
  voorzitter: "Voorzitter bestuur",
  bestuurder: "Bestuurslid",
  beheerder: "Beheerder",
};

// Gedeelde navy topbar: geeft het scherm samen met de sidebar een donker
// ink-navy chrome-frame rond de lichte content. Draagt de fondsnaam (brand)
// links en identiteit + uitloggen rechts, zodat de sidebar puur navigatie blijft.
export default function TopBar({ gebruikerNaam, gebruikerRol, fondsNaam }: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  async function uitloggen() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials =
    gebruikerNaam
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "??";

  return (
    <header className="sticky top-0 z-40 h-14 flex items-center justify-between gap-4 px-6 bg-nav border-b border-nav-line">
      <div className="min-w-0 flex items-center gap-3">
        <span className="text-nav-text-active font-serif text-sm font-semibold truncate">
          {fondsNaam || process.env.NEXT_PUBLIC_FONDS_NAAM || "Bestuurdersportaal"}
        </span>
        <span className="hidden md:inline-flex items-center gap-1.5 text-nav-text text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-ok pulse-dot" />
          Beheerde AI-omgeving actief
        </span>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <Link
          href="/profiel"
          title="Mijn profiel openen"
          className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors ${
            pathname === "/profiel" ? "bg-nav-active" : "hover:bg-nav-line/40"
          }`}
        >
          <span className="w-7 h-7 rounded-full bg-nav-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            {initials}
          </span>
          <span className="hidden sm:flex flex-col leading-tight min-w-0">
            <span className="text-nav-text-active text-xs font-semibold truncate">
              {gebruikerNaam || "Bestuurslid"}
            </span>
            <span className="text-nav-text text-[11px] truncate">
              {rolLabel[gebruikerRol || "bestuurder"] || "Bestuurslid"}
            </span>
          </span>
        </Link>
        <button
          onClick={uitloggen}
          className="text-nav-text hover:text-nav-text-active text-xs transition-colors"
        >
          Uitloggen →
        </button>
      </div>
    </header>
  );
}
