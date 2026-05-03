import { HoofdTabs } from "./SubTabs";

export function KlantbeeldHeader() {
  return (
    <div className="bg-white border-b border-gray-200 px-7 pt-6 pb-0 -mx-7 -mt-7 mb-6">
      <div className="max-w-7xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2744]">Klantbeeld</h1>
            <p className="text-sm text-gray-600 mt-1 max-w-3xl">
              Inzicht in hoe het fonds zijn klanten — deelnemers en werkgevers — bedient.
              Voor deelnemers ligt de focus op de ontwikkeling van het persoonlijk pensioenvermogen
              onder Wtp; voor werkgevers op aansluiting, premie-afdracht en service-niveau.
            </p>
          </div>
          <span className="text-[11px] uppercase tracking-wider text-gray-400 bg-gray-100 px-2 py-1 rounded-md flex-shrink-0">
            Demo-data
          </span>
        </div>
        <HoofdTabs />
      </div>
    </div>
  );
}
