"use client";

// Compacte dropdown-knop voor het exporteren van het auditdossier.
// Gebruikt de bestaande GET /api/decisions/[id]/auditdossier-route met
// query-params voor versie (actueel | besluitmoment) en formaat
// (html | json).
//
// Plaatsing: in de DossierStatusStrip naast de statusovergang-knop,
// zodat globale acties op het dossier op één plek staan.

import { useEffect, useRef, useState } from "react";

interface Props {
  decisionId: string;
  /** Toon de besluitmoment-snapshot-optie alleen als er minstens
      één snapshot bestaat. Default true (de UI laat 'm zien; bij
      ontbreken geeft de API een nette 404 terug). */
  heeftSnapshot?: boolean;
  /** T6: anker van het Afschriften-paneel. Gezet ⇒ toon onderin de dropdown
      de actie "Volledig dossier vastleggen (afschrift)" die daarnaartoe springt.
      De snelle HTML/JSON-export (per besluit, geen vastlegging) blijft bestaan. */
  afschriftAnker?: string;
}

interface Optie {
  label: string;
  versie: "actueel" | "besluitmoment";
  formaat: "html" | "json";
  /** Voor json triggeren we een download via download-attribuut;
      voor html openen we een nieuw tabblad zodat de gebruiker direct
      kan printen of als PDF opslaan. */
  doel: "_blank" | "download";
  hint?: string;
}

// JSON-inzage bewust verwijderd (verzoek 2026-08-09): een bestuurder heeft geen
// machine-JSON nodig, en het volledige, machine-leesbare dossier zit in het
// afschrift (MANIFEST.json + 03_Auditlog.json). Hier alleen de snelle HTML-inzage.
const BASIS_OPTIES: Optie[] = [
  {
    label: "HTML — actuele toestand",
    versie: "actueel",
    formaat: "html",
    doel: "_blank",
    hint: "Print-vriendelijk, opent in nieuw tabblad",
  },
];

const SNAPSHOT_OPTIES: Optie[] = [
  {
    label: "HTML — besluitmoment-snapshot",
    versie: "besluitmoment",
    formaat: "html",
    doel: "_blank",
    hint: "Bevroren toestand bij besluitvorming",
  },
];

export default function AuditExportKnop({
  decisionId,
  heeftSnapshot = true,
  afschriftAnker,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Klik buiten de dropdown sluit hem.
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handle);
      return () => document.removeEventListener("mousedown", handle);
    }
  }, [open]);

  const opties: Optie[] = heeftSnapshot
    ? [...BASIS_OPTIES, ...SNAPSHOT_OPTIES]
    : BASIS_OPTIES;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-ink bg-white border border-app-line-strong hover:bg-app-bg px-3 py-1.5 rounded-md whitespace-nowrap"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Exporteer auditdossier ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-72 bg-white border border-line rounded-lg shadow-lg z-30 overflow-hidden"
        >
          <ul className="divide-y divide-line">
            {opties.map((o) => {
              const href = `/api/decisions/${decisionId}/auditdossier?versie=${o.versie}&formaat=${o.formaat}`;
              return (
                <li key={`${o.versie}-${o.formaat}`}>
                  <a
                    href={href}
                    target={o.doel === "_blank" ? "_blank" : undefined}
                    rel={o.doel === "_blank" ? "noopener noreferrer" : undefined}
                    download={o.doel === "download" ? "" : undefined}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 hover:bg-app-bg text-left"
                  >
                    <div className="text-sm font-medium text-ink">
                      {o.label}
                    </div>
                    {o.hint && (
                      <div className="text-[11px] text-muted mt-0.5">
                        {o.hint}
                      </div>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
          {/* T6: het volledige, procesbrede dossier als permanent vastgelegde
              bundel — een aparte, zwaardere actie dan de snelle export hierboven. */}
          {afschriftAnker && (
            <a
              href={`#${afschriftAnker}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 border-t border-line bg-app-bg hover:bg-app-line/40 text-left"
            >
              <div className="text-sm font-medium text-accent-ink">
                Volledig dossier vastleggen (afschrift) →
              </div>
              <div className="text-[11px] text-muted mt-0.5">
                Hele proces als permanente, gezipte bundel met leeswijzer
              </div>
            </a>
          )}
          {!heeftSnapshot && (
            <div className="px-3 py-2 text-[11px] text-muted italic border-t border-line bg-app-bg">
              Snapshot-versies verschijnen zodra er een audit-snapshot is
              vastgelegd (bij overgang naar besloten of afgesloten).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
