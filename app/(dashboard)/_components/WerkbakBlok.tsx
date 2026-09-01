"use client";

// §9.2 — één homepage-werkbak. Bestuurlijke signalen blijven hierin een
// voorrangsmelding, geen tweede takenlijst; de regels daaronder zijn het werk
// waarvoor de ingelogde gebruiker zelf als houder bekend is.

import { useState } from "react";
import Link from "next/link";
import {
  eersteWerkbakItems,
  isAchterstallig,
  type WerkbakItem,
  type WerkbakSoort,
} from "@/core/lib/werkbak-afleiding";
import type { BestuurlijkSignaal } from "@/core/lib/bestuurlijke-signalen";

const SOORT_LABEL: Record<WerkbakSoort, string> = {
  actie: "ACTIE",
  stap: "STAP",
  vergadering: "VERG",
};

const SOORT_KLASSE: Record<WerkbakSoort, string> = {
  actie: "bg-accent-tint text-accent-ink",
  stap: "bg-phase-tint text-phase-ink",
  vergadering: "bg-app-bg text-muted",
};

function formaatDatum(datum: string) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" }).format(
    new Date(`${datum.slice(0, 10)}T12:00:00`)
  );
}

function deadlineLabel(deadline: string | null, vandaag: string) {
  if (!deadline) return null;
  const verschil = Math.round(
    (Date.parse(`${deadline.slice(0, 10)}T00:00:00.000Z`) -
      Date.parse(`${vandaag}T00:00:00.000Z`)) /
      86400000
  );
  if (verschil < 0) return `${Math.abs(verschil)} dgn te laat`;
  if (verschil === 0) return "Vandaag";
  return `Over ${verschil} dgn`;
}

export default function WerkbakBlok({
  items,
  signalen,
  vandaag,
}: {
  items: WerkbakItem[];
  signalen: BestuurlijkSignaal[];
  vandaag: string;
}) {
  const [toonAlles, setToonAlles] = useState(false);
  const getoond = toonAlles ? eersteWerkbakItems(items, vandaag, Number.MAX_SAFE_INTEGER) : eersteWerkbakItems(items, vandaag);
  const verborgen = items.length - getoond.length;
  const teLaat = items.filter((item) => isAchterstallig(item, vandaag)).length;

  if (signalen.length === 0 && items.length === 0) return null;

  return (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="font-semibold text-ink text-sm">
          Voor u
          {items.length > 0 && (
            <span className="font-normal text-muted"> · {items.length} open{teLaat > 0 ? ` · ${teLaat} te laat` : ""}</span>
          )}
        </div>
        <Link href="/procedures" className="text-xs text-ink hover:text-accent">
          Alle procedures →
        </Link>
      </div>

      <div className="space-y-2">
        {signalen.length > 0 && (
          <div className="pb-1">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
              Bestuurlijke signalen
            </div>
            <div className="space-y-2">
              {signalen.map((signaal) => (
                <Link
                  key={signaal.soort}
                  href={signaal.href}
                  className="flex items-start gap-3 p-3 border border-line rounded-lg hover:border-accent transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-warn mt-1.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{signaal.titel}</div>
                    <div className="text-xs text-muted mt-0.5 truncate">{signaal.toelichting}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className={signalen.length > 0 ? "pt-2" : ""}>
            {signalen.length > 0 && (
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
                Mijn werk
              </div>
            )}
            <div className="space-y-2">
              {getoond.map((item) => {
                const achterstallig = isAchterstallig(item, vandaag);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-3 p-3 border border-line rounded-lg hover:border-accent hover:bg-app-zebra transition-colors"
                  >
                    <span className={`w-8 h-8 rounded-lg text-[10px] font-bold tracking-wide grid place-items-center flex-shrink-0 ${SOORT_KLASSE[item.soort]}`}>
                      {SOORT_LABEL[item.soort]}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">{item.titel}</span>
                      <span className="block text-xs text-muted mt-0.5 truncate">
                        {item.herkomst}
                        {achterstallig && <span className="ml-2 text-err-ink font-medium">Te laat</span>}
                      </span>
                    </span>
                    {item.deadline && (
                      <span className={`text-right flex-shrink-0 text-xs ${achterstallig ? "text-err-ink font-medium" : "text-muted"}`}>
                        <span className="block">{formaatDatum(item.deadline)}</span>
                        <span className="text-[11px]">{deadlineLabel(item.deadline, vandaag)}</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            {verborgen > 0 && !toonAlles && (
              <button
                type="button"
                onClick={() => setToonAlles(true)}
                className="w-full mt-2 px-3 py-2.5 text-xs text-muted border border-dashed border-app-line-strong rounded-lg hover:border-accent hover:text-accent"
              >
                Toon alles — nog {verborgen} {verborgen === 1 ? "regel" : "regels"}
              </button>
            )}
            {toonAlles && items.length > 7 && (
              <button
                type="button"
                onClick={() => setToonAlles(false)}
                className="w-full mt-2 px-3 py-2.5 text-xs text-muted border border-dashed border-app-line-strong rounded-lg hover:border-accent hover:text-accent"
              >
                Toon minder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
