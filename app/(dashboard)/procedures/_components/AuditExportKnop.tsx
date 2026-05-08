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

const BASIS_OPTIES: Optie[] = [
  {
    label: "HTML — actuele toestand",
    versie: "actueel",
    formaat: "html",
    doel: "_blank",
    hint: "Print-vriendelijk, opent in nieuw tabblad",
  },
  {
    label: "JSON — actuele toestand",
    versie: "actueel",
    formaat: "json",
    doel: "download",
    hint: "Download voor archief of machine-consumption",
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
  {
    label: "JSON — besluitmoment-snapshot",
    versie: "besluitmoment",
    formaat: "json",
    doel: "download",
  },
];

export default function AuditExportKnop({
  decisionId,
  heeftSnapshot = true,
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
        className="text-xs font-medium text-[#0F2744] bg-white border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-md whitespace-nowrap"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Exporteer auditdossier ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-30 overflow-hidden"
        >
          <ul className="divide-y divide-gray-100">
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
                    className="block px-3 py-2 hover:bg-gray-50 text-left"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {o.label}
                    </div>
                    {o.hint && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {o.hint}
                      </div>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
          {!heeftSnapshot && (
            <div className="px-3 py-2 text-[11px] text-gray-500 italic border-t border-gray-100 bg-gray-50">
              Snapshot-versies verschijnen zodra er een audit-snapshot is
              vastgelegd (bij overgang naar besloten of afgesloten).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
