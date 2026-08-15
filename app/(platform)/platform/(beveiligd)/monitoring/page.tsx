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
import {
  haalVerbruikBundelOverzicht,
  type VerbruikBundelOverzicht,
} from "@/platform/lib/verbruik-bundel-lees";
import MonitoringWeergave from "./_components/MonitoringWeergave";

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
  let verbruik: VerbruikBundelOverzicht;
  try {
    const uit = await withPlatformRead(
      { capability: CAPABILITY, handeling: "monitoring.dashboard.inzien" },
      async (svc) => {
        // ÉÉN server-lezing voor beide subtabs (signalen + verbruik & bundel):
        // zo blijft er precies één attempt/result-paar met TELLINGEN als effect.
        const signalen = await haalMonitoringOverzicht(svc);
        const verbruikBundel = await haalVerbruikBundelOverzicht(svc);
        // Effect = tellingen, nooit meetwaarden of fondsnamen. Ongewijzigd t.o.v.
        // de kaartweergave: het fonds-/periodefilter gaat het auditspoor NIET in.
        return {
          resultaat: { signalen, verbruikBundel },
          effect: {
            signalen: signalen.signalen.length,
            snapshotrijen: signalen.gelezenRijen,
            verbruikrijen: verbruikBundel.gelezenRijen,
          },
        };
      }
    );
    overzicht = uit.signalen;
    verbruik = uit.verbruikBundel;
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

  return (
    <Omhulsel>
      <MonitoringWeergave overzicht={overzicht} verbruik={verbruik} />
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
