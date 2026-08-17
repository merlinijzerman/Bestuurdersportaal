import Link from "next/link";
import { requireCapability } from "@/core/lib/capabilities";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import BeheerClient from "./_components/BeheerClient";
import ConfigBeheer from "./_components/ConfigBeheer";

// Beheer-sectie: procescatalogus + organen + import. De hub zelf is
// server-side gegate op catalog.manage; de API-routes blijven daarnaast
// afzonderlijk capability- en RLS-gated.
export default async function BeheerPage() {
  const sessie = await vereisModuleToegang("beheer", "catalog.manage");
  // Fonds-configuratie volgt de capability (beheerder ÉN voorzitter dragen
  // fonds.config.manage) en blijft ook op de hub server-side getoetst.
  const magConfigBeheren = await requireCapability(sessie.userId, "fonds.config.manage");
  // Stuurinformatie-invoer (T14): eigen sub-scherm, capability-gated
  // (stuurinformatie.manage; API + RLS blijven de echte schrijfrand).
  const magStuurinfoInvoeren = await requireCapability(sessie.userId, "stuurinformatie.manage");

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-ink">Catalogus &amp; organen</h1>
        <p className="text-muted text-sm mt-1">
          Beheer fonds-specifieke procesmodellen, gremia, expertises en kritische
          focusgebieden. Importeer de standaardset als startpunt.
        </p>
      </div>

      {/* Stuurinformatie-invoerlaag (T14): periodes, balans/reserves, Excel-upload. */}
      {magStuurinfoInvoeren && (
        <Link
          href="/beheer/stuurinformatie"
          className="mb-8 flex items-center justify-between rounded-xl border border-line bg-white px-5 py-4 hover:bg-app-bg"
        >
          <div>
            <div className="font-semibold text-ink">Stuurinformatie — bedragen invoeren</div>
            <div className="text-sm text-muted mt-0.5">
              Rapportageperiodes aanmaken, balans en reserves invoeren of via Excel-sjabloon
              uploaden. Elke wijziging wordt append-only gelogd.
            </div>
          </div>
          <span className="text-muted">›</span>
        </Link>
      )}

      <BeheerClient />

      {/* Fonds-configuratie (T8): huisstijl, modules, feature flags + historie.
          Gegate op de capability fonds.config.manage (beheerder + voorzitter);
          de API blijft de echte grens (zelf-gating op mag_beheren). */}
      {magConfigBeheren && (
        <div className="mt-12 border-t border-line pt-8">
          <div className="mb-6">
            <h1 className="font-serif text-2xl font-bold text-ink">
              Fonds-configuratie
            </h1>
            <p className="text-muted text-sm mt-1">
              Onderscheid dit fonds via huisstijl, beschikbare modules en feature
              flags — zonder codewijziging, versiebeheerd en herstelbaar. Elke
              wijziging wordt append-only vastgelegd.
            </p>
          </div>
          <ConfigBeheer />
        </div>
      )}
    </div>
  );
}
