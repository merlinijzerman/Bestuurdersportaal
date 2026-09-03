"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/core/lib/supabase";
import { alleModules, isModuleKey, type ModuleKey } from "@/core/lib/module-registry";
import { ACTIEF_GESPREK_SLEUTEL } from "@/core/lib/ai-sessie";
import Icoon from "@/core/components/icons/Icoon";

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
    // Eén navigatie na het wissen van de cookie. Een aansluitende refresh op de
    // huidige route kan de login-navigatie annuleren en het beschermde scherm
    // zichtbaar laten staan totdat de gebruiker zelf herlaadt.
    router.replace("/login");
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
      } h-screen bg-nav border-r border-nav-line chrome-focus flex flex-col fixed top-0 left-0 z-50 transition-[transform,width] duration-200 ease-out md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Logo — brandbaar via fonds-theming (T8): logo-url wint, dan logo-letter,
          anders de default "P". Cosmetisch; geen autorisatiebetekenis. De
          inklap-hamburger (md-only) klapt de sidebar smal/breed.

          06-08-2026: fondslogo's zijn in de praktijk WOORDMERKEN met een brede
          verhouding (gemeten 1,8:1 tot 3,8:1) en overwegend donkere kleuren.
          In de vierkante tegel van 40x40 px met achtergrond --nav-accent werden
          ze onleesbaar; daarom rendert een logo uitgeklapt in een BREDE strook
          die uitlijnt met de fondsnaam eronder.

          T3 (besluit 0202): die strook was TRANSPARANT, wat kon zolang de nav
          licht was. Op de donkere chrome valt een donker woordmerk weg — dat
          was geen risico maar een zekerheid. De strook heeft nu een lichte
          ondergrond terug, zodat een donker fondslogo leesbaar blijft zonder
          dat fondsen eerst een lichte logovariant hoeven aan te leveren.

          BEIDE GEVALLEN GETOETST, en de uitkomst is asymmetrisch: een donker
          woordmerk is op deze strook goed leesbaar, een WIT woordmerk is er
          onzichtbaar. Eén ondergrond kan die twee niet allebei bedienen. De
          keuze valt op de lichte strook omdat fondslogo's in de praktijk
          overwegend donker zijn, en omdat vandaag geen enkel fonds een
          `logo-url` zet (het blok in 2026_08_06_demo_fondsen_bootstrap.sql
          staat uitgecommentarieerd). Levert een fonds straks een licht logo,
          dan is de nette oplossing een themabaar `logo-variant`-token
          (licht|donker) dat deze strook uitzet — dat vraagt een extra prop via
          DashboardShell.tsx, en dat bestand is deze sprint van T1 (#281). Zie
          de openstaande-puntenlijst.

          De vierkante tegel blijft bestaan voor twee gevallen: geen logo (dan
          de letter — Horizon ongewijzigd) en de INGEKLAPTE zijbalk, waar een
          brede strook simpelweg niet past. */}
      <div
        className={`border-b border-nav-line ${
          ingeklapt ? "px-4 py-5 md:px-0 md:py-4" : "px-4 py-5"
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
              {/* Uitgeklapt: brede strook met lichte ondergrond (zie de noot
                  hierboven).

                  `alt=""` + aria-hidden: de fondsnaam staat er als tekst onder,
                  dus het logo is decoratief en zou anders dubbel worden
                  voorgelezen. */}
              <div
                className={`h-11 flex-1 min-w-0 mr-2 flex items-center rounded-lg bg-white/95 px-2.5 ${
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
                <div className="hidden md:flex w-9 h-9 bg-nav-accent rounded-lg items-center justify-center font-bold text-sm text-white overflow-hidden flex-shrink-0">
                  {logoLetter || "P"}
                </div>
              )}
            </>
          ) : (
            <div className="w-9 h-9 bg-nav-accent rounded-lg flex items-center justify-center font-bold text-sm text-white overflow-hidden flex-shrink-0">
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
            <Icoon sleutel="menu" grootte={18} streek={1.9} />
          </button>
        </div>
        <div
          className={`text-nav-text-active font-serif text-[15px] font-medium leading-snug ${bijInklapVerborgen}`}
        >
          {fondsNaam || process.env.NEXT_PUBLIC_FONDS_NAAM || "Bestuurdersportaal"}
        </div>
        {/* Rolneutrale ondertitel. Stond hier tot T3 als hardcoded "Demo
            omgeving" — een tekst die in een productieomgeving feitelijk onjuist
            is en die niets zegt over waar de gebruiker zich bevindt. */}
        <div className={`text-nav-text/80 text-[11px] mt-0.5 ${bijInklapVerborgen}`}>
          Bestuursomgeving
        </div>
      </div>

      {/* Navigatie */}
      <div className="flex-1 py-2 overflow-y-auto nav-scroll">
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
                  className={`overline px-4 pt-4 pb-1.5 text-nav-text/80 ${bijInklapVerborgen}`}
                >
                  {item.section}
                </div>
              )}
              <Link
                href={item.href}
                onClick={onNavigate}
                // Tooltip toont de moduletitel in ingeklapte stand (label is dan verborgen).
                title={ingeklapt ? item.label : undefined}
                // De actieve staat wordt door VIER dragers gemeld, niet door de
                // teal rail alleen (besluit 0097 — kleur is nooit de enige
                // drager): aria-current voor de schermlezer, witte tekst,
                // een zwaarder gewicht en het gradiëntvlak.
                aria-current={actief ? "page" : undefined}
                className={`flex items-center gap-2.5 mx-2 rounded-lg text-[13.5px] transition-colors ${
                  ingeklapt ? "px-3 py-2 md:px-0 md:mx-1 md:justify-center md:gap-0" : "px-3 py-2"
                } ${
                  actief
                    ? "bg-gradient-to-r from-nav-active to-transparent text-nav-text-active font-medium shadow-[inset_3px_0_0_var(--nav-rail)]"
                    : "text-nav-text hover:bg-nav-line hover:text-nav-text-active"
                }`}
              >
                {item.iconSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.iconSrc}
                    alt=""
                    aria-hidden="true"
                    className="w-[18px] h-[18px] object-contain flex-shrink-0"
                  />
                ) : (
                  <Icoon sleutel={item.icon} grootte={18} className="flex-shrink-0" />
                )}
                <span className={`flex-1 ${bijInklapVerborgen}`}>{item.label}</span>
                {/* Badge — draagt vandaag "AI", maar is ook geschikt voor een
                    telling. Wit op een wit-vlak (11,15:1); NIET het
                    assistent-accent: --ai haalt op de donkere chrome maar
                    3,04:1. Zie besluit 0202. */}
                {item.badge && (
                  <span
                    className={`bg-white/15 text-nav-text-active text-[10.5px] font-semibold leading-none min-w-[19px] h-[19px] px-1.5 rounded-full inline-flex items-center justify-center flex-shrink-0 ${bijInklapVerborgen}`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Voet — sinds T3 draagt deze het gebruikersblok. Dat stond direct onder
          het merkblok, waardoor de navigatie pas als derde blok begon; nu begint
          ze meteen onder het merk en staat "wie ben ik" waar je het zoekt.
          Volgorde: bronrecht → beheerde omgeving → profiel → uitloggen. */}
      <div
        className={`border-t border-nav-line space-y-2 ${
          ingeklapt ? "px-3 py-3 md:px-1" : "px-3 py-3"
        }`}
      >
        <div
          className={`flex items-center gap-2 px-1 text-nav-text/80 text-[11px] ${
            ingeklapt ? "md:justify-center" : ""
          }`}
        >
          <Icoon sleutel="schild" grootte={14} streek={1.8} className="flex-shrink-0" />
          <span className={bijInklapVerborgen}>Alleen bronnen waar u recht op heeft</span>
        </div>
        <div className={`flex items-center gap-2 px-1 ${ingeklapt ? "md:justify-center" : ""}`}>
          <span className="w-2 h-2 bg-ok rounded-full pulse-dot flex-shrink-0"></span>
          <span className={`text-nav-text/80 text-[11px] ${bijInklapVerborgen}`}>
            Beheerde AI-omgeving actief
          </span>
        </div>

        {/* Gebruiker — klik opent het eigen profiel (geen los nav-item meer) */}
        <Link
          href="/profiel"
          title={ingeklapt ? "Mijn profiel" : "Mijn profiel openen"}
          onClick={onNavigate}
          aria-current={pathname === "/profiel" ? "page" : undefined}
          className={`flex items-center gap-2.5 rounded-lg transition-colors ${
            ingeklapt ? "px-2 py-2 md:px-0 md:justify-center" : "px-2 py-2"
          } ${
            pathname === "/profiel"
              ? "bg-nav-line text-nav-text-active"
              : "bg-white/5 hover:bg-nav-line"
          }`}
        >
          <div className="w-8 h-8 bg-nav-accent rounded-lg flex items-center justify-center font-semibold text-[11.5px] text-white flex-shrink-0">
            {initials}
          </div>
          <div className={`flex-1 min-w-0 ${bijInklapVerborgen}`}>
            <div className="text-[12.5px] font-semibold truncate text-nav-text-active">
              {gebruikerNaam || "Bestuurslid"}
            </div>
            <div className="text-nav-text text-[11px]">
              {rolLabel[gebruikerRol || "bestuurder"] || "Bestuurslid"}
            </div>
          </div>
          <span className={`text-nav-text flex-shrink-0 ${bijInklapVerborgen}`}>
            <Icoon sleutel="chevron-rechts" grootte={15} streek={1.9} />
          </span>
        </Link>

        <button
          onClick={uitloggen}
          title={ingeklapt ? "Uitloggen" : undefined}
          // Expliciete naam: in de ingeklapte stand is het label visueel weg en
          // draagt het icoon niets (het is `aria-hidden`, guardrail 5).
          aria-label="Uitloggen"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-nav-text text-[11.5px] hover:bg-nav-line hover:text-nav-text-active transition-colors ${
            ingeklapt ? "md:w-full md:justify-center md:px-0" : ""
          }`}
        >
          <Icoon sleutel="uitloggen" grootte={15} streek={1.8} className="flex-shrink-0" />
          <span className={bijInklapVerborgen}>Uitloggen</span>
        </button>
      </div>
    </nav>
  );
}
