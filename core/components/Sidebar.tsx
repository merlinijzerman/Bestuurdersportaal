"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/core/lib/supabase";
import { alleModules, isModuleKey, type ModuleKey } from "@/core/lib/module-registry";
import { ACTIEF_GESPREK_SLEUTEL } from "@/core/lib/ai-sessie";

interface SidebarProps {
  gebruikerNaam?: string;
  gebruikerRol?: string;
  fondsNaam?: string;
  /** Manifest-beschikbare modules (server-side afgeleid, T8). Ontbreekt de prop,
   *  dan tonen we alles (backward-compat). Dit is UI-cosmetica: de echte gate zit
   *  server-side in requireCapability()/RLS + de module-guard per route. */
  beschikbareModules?: string[];
  /** Optionele branding uit de fonds-theming (logo-letter/-url). */
  logoLetter?: string;
  logoUrl?: string;
  /** Drawer open (mobiel). Op desktop (md+) altijd zichtbaar, ongeacht deze waarde. */
  open?: boolean;
  /** Aangeroepen bij navigatie/uitloggen zodat de mobiele drawer sluit. */
  onNavigate?: () => void;
  /** Ingeklapte (smalle) stand op desktop (md+). Client-side UI-voorkeur; op < md
   *  altijd genegeerd — daar is de sidebar een volledige off-canvas drawer. */
  ingeklapt?: boolean;
  /** Toggle voor de inklapstand (hamburger in het logoblok, md-only). */
  onToggleInklap?: () => void;
}

export default function Sidebar({
  gebruikerNaam,
  gebruikerRol,
  fondsNaam,
  beschikbareModules,
  logoLetter,
  logoUrl,
  open = false,
  onNavigate,
  ingeklapt = false,
  onToggleInklap,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function uitloggen() {
    onNavigate?.();
    // Wis de AI-sessiemarkering (besluit 0086): na uitloggen + opnieuw inloggen
    // in dezelfde tab landt de gebruiker op het startpunt, niet in een oud gesprek.
    try {
      window.sessionStorage.removeItem(ACTIEF_GESPREK_SLEUTEL);
    } catch {
      /* best-effort */
    }
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
    // T1 bureau-rol: zonder deze regel zou de fallback op regel ~161
    // "Bestuurslid" tonen, en dat is voor het bureau feitelijk onjuist.
    bestuursbureau: "Bestuursbureau",
  };

  // Manifest-filter (T8): toon alleen modules die voor dit fonds beschikbaar zijn.
  // Ontbreekt de prop → toon alles (backward-compat). Kern-infrastructuur (home/
  // beheer/governance) zit sowieso in de set (registry: manifestBeheerbaar=false).
  const beschikbaarSet: Set<ModuleKey> | null = beschikbareModules
    ? new Set(beschikbareModules.filter(isModuleKey))
    : null;
  // VEN-2: sub-functies (navigeerbaar=false) krijgen nooit een eigen menu-item —
  // ze delen de href van hun dragende module. Dit filter staat los van de
  // beschikbaarheid: ook als zo'n module ooit AAN gaat, hoort er geen tweede
  // "Vergaderingen"-regel in de nav te verschijnen.
  const navItems = alleModules().filter(
    (m) => m.navigeerbaar !== false && (!beschikbaarSet || beschikbaarSet.has(m.key))
  );

  let huidigSection = "";

  // Helper: klasse die een element bij inklap op md+ verbergt (mobiel altijd tonen).
  const bijInklapVerborgen = ingeklapt ? "md:hidden" : "";

  return (
    <nav
      className={`w-64 ${
        ingeklapt ? "md:w-14" : "md:w-64"
      } h-screen bg-nav border-r border-nav-line flex flex-col fixed top-0 left-0 z-50 transition-[transform,width] duration-200 ease-out md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Logo — brandbaar via fonds-theming (T8): logo-url wint, dan logo-letter,
          anders de default "P". Cosmetisch; geen autorisatiebetekenis. De
          inklap-hamburger (md-only) klapt de sidebar smal/breed.

          06-08-2026: fondslogo's zijn in de praktijk WOORDMERKEN met een brede
          verhouding (gemeten 1,8:1 tot 3,8:1) en overwegend donkere kleuren.
          In de vierkante tegel van 40x40 px met achtergrond --nav-accent werden
          ze onleesbaar; één fonds had bovendien vrijwel dezelfde navy als de
          tegel, waardoor het logo volledig wegviel. Daarom rendert een logo
          uitgeklapt nu in een BREDE, TRANSPARANTE STROOK: het logo staat
          direct op het nav-vlak en lijnt uit met de fondsnaam eronder.

          De vierkante tegel blijft bestaan voor twee gevallen: geen logo (dan
          de letter — Horizon ongewijzigd) en de INGEKLAPTE zijbalk, waar een
          brede strook simpelweg niet past. */}
      <div
        className={`border-b border-nav-line ${
          ingeklapt ? "px-5 py-6 md:px-0 md:py-4" : "px-5 py-6"
        }`}
      >
        {/* Logo + inklap-hamburger op één regel. Uitgeklapt: logo links, hamburger
            rechts (justify-between). Ingeklapt (md): kolom-omgekeerd → hamburger
            bóven het logo, gecentreerd. DOM-volgorde = logo vóór hamburger, zodat
            de tabvolgorde niet verspringt tussen de standen. */}
        <div
          className={`flex items-center mb-3 ${
            ingeklapt ? "md:flex-col-reverse md:gap-2 md:mb-0" : "justify-between"
          }`}
        >
          {logoUrl ? (
            <>
              {/* Uitgeklapt: brede strook, TRANSPARANT — het logo staat direct
                  op het nav-vlak. Een eigen witte achtergrond met randje leverde
                  op de lichte nav van het basispalet een zichtbaar kader in een
                  kader op; zonder achtergrond lijnt het logo bovendien uit met
                  de fondsnaam eronder.

                  LET OP bij een donker nav-thema: fondslogo's zijn overwegend
                  donker, dus zonder lichte ondergrond vallen ze dan weg. Wie
                  `nav-rgb` overschrijft naar een donkere waarde, levert een
                  lichte logovariant aan of zet hier een ondergrond terug.

                  `alt=""` + aria-hidden: de fondsnaam staat er als tekst onder,
                  dus het logo is decoratief en zou anders dubbel worden
                  voorgelezen. */}
              <div
                className={`h-11 flex-1 min-w-0 mr-2 flex items-center ${
                  ingeklapt ? "md:hidden" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt=""
                  aria-hidden="true"
                  className="max-h-7 max-w-full object-contain"
                />
              </div>
              {/* Ingeklapt (md): terug naar de vierkante tegel met de letter —
                  een woordmerk van 14 px breed is zinloos. Op mobiel is de
                  zijbalk een lade op volle breedte, dus daar blijft de strook
                  staan; vandaar `hidden md:flex` (zelfde regel als
                  bijInklapVerborgen elders in dit bestand). */}
              {ingeklapt && (
                <div className="hidden md:flex w-10 h-10 bg-nav-accent rounded-xl items-center justify-center font-black text-lg text-white overflow-hidden flex-shrink-0">
                  {logoLetter || "P"}
                </div>
              )}
            </>
          ) : (
            <div className="w-10 h-10 bg-nav-accent rounded-xl flex items-center justify-center font-black text-lg text-white overflow-hidden flex-shrink-0">
              {logoLetter || "P"}
            </div>
          )}
          <button
            type="button"
            onClick={onToggleInklap}
            aria-label={ingeklapt ? "Menu uitklappen" : "Menu inklappen"}
            aria-expanded={!ingeklapt}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-nav-text hover:bg-nav-line hover:text-nav-text-active transition-colors flex-shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 6h18M3 12h18M3 18h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className={`text-nav-text-active font-bold text-sm leading-snug ${bijInklapVerborgen}`}>
          {fondsNaam || process.env.NEXT_PUBLIC_FONDS_NAAM || "Bestuurdersportaal"}
        </div>
        <div className={`text-nav-text text-xs mt-0.5 ${bijInklapVerborgen}`}>Demo omgeving</div>
      </div>

      {/* Gebruiker — klik opent het eigen profiel (geen los nav-item meer) */}
      <Link
        href="/profiel"
        title={ingeklapt ? "Mijn profiel" : "Mijn profiel openen"}
        onClick={onNavigate}
        className={`border-b border-nav-line flex items-center gap-2.5 transition-colors ${
          ingeklapt ? "px-5 py-3 md:px-0 md:py-3 md:justify-center" : "px-5 py-3"
        } ${pathname === "/profiel" ? "bg-nav-active" : "hover:bg-nav-line"}`}
      >
        <div className="w-8 h-8 bg-nav-accent rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0">
          {initials}
        </div>
        <div className={`flex-1 min-w-0 ${bijInklapVerborgen}`}>
          <div className="text-xs font-semibold truncate text-nav-text-active">
            {gebruikerNaam || "Bestuurslid"}
          </div>
          <div className="text-nav-text text-xs">
            {rolLabel[gebruikerRol || "bestuurder"] || "Bestuurslid"}
          </div>
        </div>
        <span aria-hidden className={`text-nav-text/60 text-xs flex-shrink-0 ${bijInklapVerborgen}`}>
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
                <div
                  className={`px-5 pt-3 pb-1 text-nav-text/70 text-xs font-bold uppercase tracking-widest ${bijInklapVerborgen}`}
                >
                  {item.section}
                </div>
              )}
              <Link
                href={item.href}
                onClick={onNavigate}
                // Tooltip toont de moduletitel in ingeklapte stand (label is dan verborgen).
                title={ingeklapt ? item.label : undefined}
                className={`flex items-center gap-2.5 text-sm border-l-[3px] transition-all ${
                  ingeklapt ? "px-5 py-2.5 md:px-0 md:justify-center md:gap-0" : "px-5 py-2.5"
                } ${
                  actief
                    ? "bg-nav-active text-nav-text-active border-nav-accent font-medium"
                    : "text-nav-text border-transparent hover:bg-nav-line hover:text-nav-text-active"
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
                  <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                )}
                <span className={`flex-1 ${bijInklapVerborgen}`}>{item.label}</span>
                {item.badge && (
                  <span
                    className={`bg-nav-accent text-white text-xs font-bold px-2 py-0.5 rounded-full ${bijInklapVerborgen}`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className={`border-t border-nav-line space-y-2 ${ingeklapt ? "px-5 py-4 md:px-0" : "px-5 py-4"}`}>
        <div className={`flex items-center gap-2 ${ingeklapt ? "md:justify-center" : ""}`}>
          <span className="w-2 h-2 bg-ok rounded-full pulse-dot flex-shrink-0"></span>
          <span className={`text-nav-text text-xs ${bijInklapVerborgen}`}>Beheerde AI-omgeving actief</span>
        </div>
        <button
          onClick={uitloggen}
          title={ingeklapt ? "Uitloggen" : undefined}
          className={`text-nav-text text-xs hover:text-nav-text-active transition-colors ${
            ingeklapt ? "md:w-full md:text-center" : ""
          }`}
        >
          <span className={bijInklapVerborgen}>Uitloggen </span>
          <span aria-hidden>→</span>
        </button>
      </div>
    </nav>
  );
}
