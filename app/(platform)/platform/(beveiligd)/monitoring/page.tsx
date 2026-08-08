// ============================================================================
//  Platform — Monitoring (driedelig dashboard, P4-light tranche B)
// ----------------------------------------------------------------------------
//  Drie lagen: ketenstatusbalk, filterbare signaaltabel (één rij per signaal,
//  ongeacht het aantal fondsen) en een uitklapbaar detail per rij. Vervangt de
//  kaartweergave die één kaart per signaal PER FONDS toonde.
//
//  ÉÉN SERVER-LEZING. Deze server component doet de enige withPlatformRead-lezing
//  en schrijft daarbij precies één attempt/result-paar met TELLINGEN als effect —
//  nooit meetwaarden of fondsnamen. Het fonds-, periode- en domeinfilter draaien
//  in de client component (SignaalTabel) en veroorzaken dus GEEN extra auditpaar
//  per klik (architectuurpunt 1 en 2). De leeslaag past de suppressie al toe
//  vóórdat de data de client bereikt (maskeerTrendwaarde + de laatste stand),
//  dus er staat geen individu-herleidbaar gegeven in de payload.
//
//  AUTORISATIE — achter `platform.observability.read`, met dezelfde dubbele check
//  als voorheen: een vriendelijke voorcheck plus de échte afdwinging binnen
//  withPlatformRead (live AAL2-hercheck, actief-check, capabilitycheck).
//
//  ZELFMONITORING — de meldingen boven de balk (leesfout / nog nooit gemeten /
//  aantal verouderd / trend afgekapt) blijven ongewijzigd en gaan VÓÓR de balk.
//  Een verouderde snapshot maakt een signaal grijs, nooit groen (FO §18.2).
// ============================================================================

import { withPlatformRead, PlatformError } from "@/platform/lib/platform-wrapper";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import {
  haalMonitoringOverzicht,
  type MonitoringOverzicht,
} from "@/platform/lib/monitoring-lees";
import { SUPPRESSIE_DREMPEL } from "@/core/lib/suppressie";
import { StoplichtLegenda } from "./_components/Stoplicht";
import SignaalTabel from "./_components/SignaalTabel";

export const dynamic = "force-dynamic";

const CAPABILITY = "platform.observability.read" as const;

export default async function MonitoringPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const caps = identiteit?.capabilities ?? [];

  if (!caps.includes(CAPABILITY)) {
    return (
      <Omhulsel>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen recht om de monitoring in te zien. Dit vereist{" "}
          <code className="font-mono">{CAPABILITY}</code>.
        </div>
      </Omhulsel>
    );
  }

  let overzicht: MonitoringOverzicht;
  try {
    overzicht = await withPlatformRead(
      { capability: CAPABILITY, handeling: "monitoring.dashboard.inzien" },
      async (svc) => {
        const uit = await haalMonitoringOverzicht(svc);
        // Effect = tellingen, nooit meetwaarden of fondsnamen. Ongewijzigd t.o.v.
        // de kaartweergave: het fondsfilter gaat het auditspoor NIET in.
        return {
          resultaat: uit,
          effect: { signalen: uit.signalen.length, snapshotrijen: uit.gelezenRijen },
        };
      }
    );
  } catch (e) {
    if (!(e instanceof PlatformError)) throw e;
    return (
      <Omhulsel>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          De monitoring kon niet worden geopend ({e.foutcode}). Log opnieuw in met
          tweefactorauthenticatie of neem contact op met een platformbeheerder.
        </div>
      </Omhulsel>
    );
  }

  const verouderd = overzicht.signalen.filter((s) => s.verouderd).length;

  return (
    <Omhulsel>
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
    </Omhulsel>
  );
}

function Omhulsel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Monitoring</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Operationele en technische signalen over de keten: verwerking, AI,
          beschikbaarheid en de volledigheid van het auditspoor. Metadata en
          telemetrie &mdash; geen fondsinhoud en geen gegevens over individuele
          gebruikers.
        </p>
      </div>
      {children}
    </div>
  );
}

/** De monitor over de monitor: leeft de snapshot-job nog? Blijft VÓÓR de balk staan. */
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
  // Een leesfout is iets ANDERS dan "nog nooit gemeten". Die twee door elkaar
  // halen levert een verkeerde diagnose, met stelligheid gebracht: de operator
  // gaat de cron controleren terwijl de meting gewoon niet gelezen kon worden.
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
