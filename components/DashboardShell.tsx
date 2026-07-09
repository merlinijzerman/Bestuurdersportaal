"use client";
import { useState } from "react";
import Sidebar from "./Sidebar";

interface DashboardShellProps {
  gebruikerNaam?: string;
  gebruikerRol?: string;
  fondsNaam?: string;
  /** Manifest-beschikbare modules (T8) — doorgegeven aan de Sidebar-filter. */
  beschikbareModules?: string[];
  /** Optionele branding uit de fonds-theming. */
  logoLetter?: string;
  logoUrl?: string;
}

// Mobiele chrome rond de bestaande (desktop) sidebar. Op md+ verandert er niets:
// de sidebar staat vast links en deze topbar/backdrop zijn verborgen (md:hidden).
// Op < md wordt de sidebar een off-canvas drawer die opent via de hamburger.
export default function DashboardShell({
  gebruikerNaam,
  gebruikerRol,
  fondsNaam,
  beschikbareModules,
  logoLetter,
  logoUrl,
}: DashboardShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobiele topbar met hamburger — alleen < md */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-nav border-b border-nav-line flex items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Menu openen"
          aria-expanded={open}
          className="text-nav-text-active -ml-1 p-2 rounded-lg hover:bg-nav-line/40 transition-colors"
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
      />
    </>
  );
}
