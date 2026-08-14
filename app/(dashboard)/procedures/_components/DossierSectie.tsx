"use client";

// Master-inklap rond het complete Dossier-blok onderaan de procedure-detail
// (Classificatie & onderbouwing, Onderbouwing, Statusovergang, Audit-trail,
// Afschriften). Standaard ingeklapt zodat het scherm rustig opent.
//
// Belangrijk: op #status-overgang en #afschriften wordt vanuit knoppen
// ("Statusovergang →", "Volledig dossier") naartoe genavigeerd. Zonder deze
// koppeling zou zo'n knop naar een blok scrollen dat dicht zit ("er gebeurt
// niets"). Daarom klapt deze sectie zichzelf open zodra zo'n anker in de URL
// verschijnt; het onderliggende UitklapbaarPaneel opent en scrolt daarna zelf.

import { useState, useEffect, type ReactNode } from "react";

const OPEN_ANKERS = ["status-overgang", "afschriften"];

export default function DossierSectie({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash && OPEN_ANKERS.includes(hash)) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 mb-3 text-left group"
      >
        <span className="flex items-center gap-2">
          <h2 className="text-xs uppercase tracking-wide text-muted font-semibold">
            Dossier
          </h2>
          {!open && (
            <span className="text-[11px] text-muted hidden sm:inline">
              — classificatie, onderbouwing, statusovergang, audit-trail, afschriften
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={`text-muted text-xs transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}
