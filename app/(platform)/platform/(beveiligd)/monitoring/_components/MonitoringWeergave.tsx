"use client";
// ============================================================================
//  MonitoringWeergave — subtabs binnen de monitoringtab (P5)
// ----------------------------------------------------------------------------
//  Twee weergaven achter één server-lezing (page.tsx doet één withPlatformRead
//  voor beide): "Ketenstatus & signalen" (bestaand) en "Verbruik & bundel"
//  (nieuw, besluit 0178). Het wisselen van subtab draait in de client en
//  veroorzaakt GEEN extra auditpaar — net als het fonds-/periodefilter.
// ============================================================================

import { useState } from "react";
import { SUPPRESSIE_DREMPEL } from "@/core/lib/suppressie";
import type { MonitoringOverzicht } from "@/platform/lib/monitoring-lees";
import type { VerbruikBundelOverzicht } from "@/platform/lib/verbruik-bundel-lees";
import { StoplichtLegenda } from "./Stoplicht";
import SignaalTabel from "./SignaalTabel";
import VerbruikBundel from "./VerbruikBundel";

type Tab = "signalen" | "verbruik";

export default function MonitoringWeergave({
  overzicht,
  verbruik,
}: {
  overzicht: MonitoringOverzicht;
  verbruik: VerbruikBundelOverzicht;
}) {
  const [tab, setTab] = useState<Tab>("signalen");
  const verouderd = overzicht.signalen.filter((s) => s.verouderd).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Monitoringweergaven">
        <TabKnop actief={tab === "signalen"} onClick={() => setTab("signalen")}>
          Ketenstatus &amp; signalen
        </TabKnop>
        <TabKnop actief={tab === "verbruik"} onClick={() => setTab("verbruik")}>
          Verbruik &amp; bundel
        </TabKnop>
      </div>

      {tab === "signalen" ? (
        <div className="space-y-6">
          <MonitorStatus
            laatste={overzicht.laatsteSnapshot}
            verouderd={verouderd}
            leesfout={overzicht.leesfout}
            trendAfgekapt={overzicht.trendAfgekapt}
            gedekteDagen={overzicht.gedekteDagen}
          />
          <StoplichtLegenda />
          <SignaalTabel
            signalen={overzicht.signalen}
            trendAfgekapt={overzicht.trendAfgekapt}
            gedekteDagen={overzicht.gedekteDagen}
            leesfout={overzicht.leesfout}
          />
          <p className="text-xs text-ink/50">
            Alle waarden zijn aggregaten. Signalen die op gebruik leunen worden
            onderdrukt bij minder dan {SUPPRESSIE_DREMPEL} waarnemingen
            (besluit 0055). Er is in deze fase géén alerting: rode drempels sturen
            geen bericht — kijk hier, of stel alerting als aparte tranche in.
          </p>
        </div>
      ) : (
        <VerbruikBundel overzicht={verbruik} />
      )}
    </div>
  );
}

function TabKnop({
  actief,
  onClick,
  children,
}: {
  actief: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={actief}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        actief
          ? "border-accent bg-accent text-white"
          : "border-line bg-white text-ink/70 hover:bg-app-bg"
      }`}
    >
      {children}
    </button>
  );
}

/** De monitor over de monitor: leeft de snapshot-job nog? Alleen relevant voor
 *  de signalentab — de verbruikweergave leest live uit governance_log. */
function MonitorStatus({
  laatste,
  verouderd,
  leesfout,
  trendAfgekapt,
  gedekteDagen,
}: {
  laatste: string | null;
  verouderd: number;
  leesfout: boolean;
  trendAfgekapt: boolean;
  gedekteDagen: number;
}) {
  if (leesfout) {
    return (
      <div className="rounded-lg border border-err/30 bg-err-tint px-4 py-3 text-sm text-err-ink">
        <strong>De monitoringgegevens konden niet worden gelezen.</strong> De
        metingen hieronder zijn daarom niet actueel — dit zegt niets over de
        gezondheid van de keten, alleen dat het dashboard er niet bij kan.
        Controleer de databaseverbinding van het beheer-project.
      </div>
    );
  }
  if (!laatste) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn-ink">
        <strong>Er is nog nooit gemeten.</strong> De snapshot-job heeft geen enkele
        meting geschreven. Controleer of de cron draait in het beheer-project
        (<code className="font-mono">/api/platform/monitoring/snapshot</code>) en of{" "}
        <code className="font-mono">CRON_SECRET</code> is gezet. Zolang dit zo is,
        zegt geen enkel signaal hieronder iets.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-ink/70">Laatste meting</span>
        <span className="font-medium text-ink">{formatteerTijd(laatste)}</span>
      </div>
      {trendAfgekapt && (
        <p className="mt-2 text-xs text-ink/60">
          De trendlijnen zijn afgekapt op de leeslimiet en dekken{" "}
          {gedekteDagen} {gedekteDagen === 1 ? "dag" : "dagen"} in plaats van de
          gevraagde periode. De laatste stand per signaal klopt wel.
        </p>
      )}
      {verouderd > 0 && (
        <p className="mt-2 text-xs text-warn-ink">
          {verouderd === 1
            ? "Eén signaal is niet recent gemeten en staat daarom op Onbekend"
            : `${verouderd} signalen zijn niet recent gemeten en staan daarom op Onbekend`}{" "}
          &mdash; niet op groen. Een stilgevallen meting is geen bewijs dat het goed gaat.
        </p>
      )}
    </div>
  );
}

function formatteerTijd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "onbekend";
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}
