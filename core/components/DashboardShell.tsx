"use client";
import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import { AssistentContextProvider } from "./assistent/AssistentContextProvider";
import {
  AssistentPaneelProvider,
  useAssistentPaneelStaat,
} from "./assistent/AssistentPaneelProvider";
import AssistentPaneel from "./assistent/AssistentPaneel";
import AssistentKnopRechtsonder from "./assistent/AssistentKnopRechtsonder";

interface DashboardShellProps {
  gebruikerNaam?: string;
  gebruikerRol?: string;
  fondsNaam?: string;
  /** Manifest-beschikbare modules (T8) — doorgegeven aan de Sidebar-filter. */
  beschikbareModules?: string[];
  /** Optionele branding uit de fonds-theming. */
  logoLetter?: string;
  logoUrl?: string;
  /** De (server-gerenderde) paginacontent. Wordt hier omhuld zodat de contentmarge
   *  met de inklapstand van de sidebar meebeweegt (client-state, één bron). */
  children: React.ReactNode;
  /**
   * De assistent als PANEEL (T1, besluit 0204) — een slot, geen import.
   *
   * De presentatielaag van de assistent staat in `app/(dashboard)/ai/_components/`
   * en `core/` mag daar niet uit importeren (boundary T9). De layout geeft het
   * oppervlak daarom als node door; de schil bepaalt alleen wannéér het wordt
   * gerenderd. Dat "wanneer" is de tweede winst: een JSX-node mount pas bij
   * renderen, dus wie de assistent nooit opent betaalt geen enkele query en
   * krijgt geen tweede Supabase-client. Na de eerste opening blijft het
   * oppervlak staan (alleen verborgen), zodat het gesprek een modulewissel én
   * sluiten/heropenen overleeft.
   */
  assistentOppervlak?: React.ReactNode;
}

// localStorage-sleutel voor de desktop-inklapvoorkeur. Puur client-side UI-state:
// geen serverstate, geen tabel, geen governance-event (huisstijl T1, besluit 0084).
const INKLAP_SLEUTEL = "nav-ingeklapt";

// Mobiele chrome rond de bestaande (desktop) sidebar + de contentwrapper. Op md+
// staat de sidebar vast links; deze topbar/backdrop zijn verborgen (max-md/md:hidden).
// Op < md wordt de sidebar een off-canvas drawer die opent via de hamburger — die
// mobiele drawer staat LOS van de desktop-inklapstand (`ingeklapt` is md-only).
export default function DashboardShell({
  gebruikerNaam,
  gebruikerRol,
  fondsNaam,
  beschikbareModules,
  logoLetter,
  logoUrl,
  children,
  assistentOppervlak,
}: DashboardShellProps) {
  const [open, setOpen] = useState(false); // mobiele drawer
  const [ingeklapt, setIngeklapt] = useState(false); // desktop inklap (md+)

  // Manifest (T8): staat module `ai` uit voor dit fonds, dan bestaat er geen
  // paneel, geen knop rechtsonder en geen enkele module-ingang. Ontbreekt de
  // lijst (config onbereikbaar), dan volgen we de Sidebar: niets wegfilteren.
  const aiBeschikbaar = !beschikbareModules || beschikbareModules.includes("ai");
  const paneel = useAssistentPaneelStaat({ aiBeschikbaar });
  const navBreedte = ingeklapt ? "3.5rem" : "16rem";
  const paneelMarge =
    paneel.stand === "paneel"
      ? "assistent-marge-paneel"
      : paneel.stand === "vergroot"
        ? "assistent-marge-vergroot"
        : "";

  // Voorkeur na hydration inlezen. Bewuste afweging (besluit 0084): de eerste
  // client-render blijft uitgeklapt (= SSR-HTML), daarna past dit de voorkeur toe.
  // Voor "ingeklapt"-gebruikers geeft dat één frame reflow bij herladen; de
  // transition op breedte/marge maakt dat vloeiend. Geen flits-vrije pre-paint
  // hack nodig voor deze UI-state.
  useEffect(() => {
    try {
      setIngeklapt(localStorage.getItem(INKLAP_SLEUTEL) === "1");
    } catch {
      /* localStorage niet beschikbaar → default uitgeklapt */
    }
  }, []);

  function toggleInklap() {
    setIngeklapt((v) => {
      const volgende = !v;
      try {
        localStorage.setItem(INKLAP_SLEUTEL, volgende ? "1" : "0");
      } catch {
        /* stil: voorkeur bewaren is best-effort */
      }
      return volgende;
    });
  }

  return (
    <AssistentContextProvider>
      <AssistentPaneelProvider waarde={paneel}>
        {/* Mobiele topbar met hamburger — alleen < md. `hidden` als basis + `max-md:flex`
            i.p.v. `flex md:hidden`: anders zetten `flex` én `md:hidden` allebei `display`
            op hetzelfde element en wint `flex` óók op desktop (de balk bleef zichtbaar). */}
        <div className="hidden max-md:flex fixed top-0 left-0 right-0 z-40 h-14 bg-nav border-b border-nav-line items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Menu openen"
            aria-expanded={open}
            className="text-nav-text-active -ml-1 p-2 rounded-lg hover:bg-nav-line transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 6h18M3 12h18M3 18h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="text-nav-text-active font-serif text-sm font-semibold truncate">
            {fondsNaam || process.env.NEXT_PUBLIC_FONDS_NAAM || "Bestuurdersportaal"}
          </span>
        </div>

        {/* Backdrop achter de drawer — alleen < md en alleen bij open */}
        {open && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          gebruikerNaam={gebruikerNaam}
          gebruikerRol={gebruikerRol}
          fondsNaam={fondsNaam}
          beschikbareModules={beschikbareModules}
          logoLetter={logoLetter}
          logoUrl={logoUrl}
          open={open}
          onNavigate={() => setOpen(false)}
          ingeklapt={ingeklapt}
          onToggleInklap={toggleInklap}
        />

        {/* Contentmarge beweegt mee met de inklapstand (md+); op < md geen marge
            (drawer overlapt). De transition houdt marge en sidebarrand synchroon. */}
        <main
          className={`${
            ingeklapt ? "md:ml-14" : "md:ml-64"
          } ${paneelMarge} flex flex-col min-h-screen pt-14 md:pt-0 transition-[margin] duration-200 ease-out`}
        >
          {children}
        </main>

        {/* Het paneel staat NA <main> in de DOM-volgorde: het is een aanvulling
            op de module, niet de hoofdinhoud. Voor toetsenbord en schermlezer is
            dat de juiste leesvolgorde; visueel staat het rechts. */}
        {aiBeschikbaar && paneel.ooitGeopend && assistentOppervlak && (
          <AssistentPaneel navBreedte={navBreedte}>{assistentOppervlak}</AssistentPaneel>
        )}
        {aiBeschikbaar && <AssistentKnopRechtsonder />}
      </AssistentPaneelProvider>
    </AssistentContextProvider>
  );
}
