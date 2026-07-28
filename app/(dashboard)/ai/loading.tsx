// ============================================================================
//  /ai — laadskelet (AI-startpunt P1, besluit 0085).
// ----------------------------------------------------------------------------
//  Getoond terwijl de server-wrapper de gedeelde portaalcontext ophaalt
//  (acceptatiecriterium 7: binnen ~100 ms een skelet/laadindicator). Zuiver
//  presentatie; geen data. Alleen bestaande tokens (lint:colors groen).
// ============================================================================

export default function Laden() {
  return (
    <div className="flex flex-col h-screen animate-pulse" aria-hidden>
      {/* Kopbalk */}
      <div className="bg-white border-b border-line p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-app-line" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-40 bg-app-line rounded" />
          <div className="h-2.5 w-64 bg-app-line rounded" />
        </div>
      </div>

      {/* Berichtenzone */}
      <div className="flex-1 overflow-hidden p-6 space-y-4">
        <div className="max-w-2xl space-y-2">
          <div className="h-3 w-3/4 bg-app-line rounded" />
          <div className="h-3 w-2/3 bg-app-line rounded" />
          <div className="h-3 w-1/2 bg-app-line rounded" />
        </div>

        {/* Startpunt-skelet: context + taakknoppen */}
        <div className="px-0 pt-2 space-y-4 max-w-3xl">
          <div className="h-2.5 w-28 bg-app-line rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="h-20 bg-app-line rounded-lg" />
            <div className="h-20 bg-app-line rounded-lg" />
            <div className="h-20 bg-app-line rounded-lg" />
          </div>
          <div className="h-2.5 w-28 bg-app-line rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="h-16 bg-app-line rounded-xl" />
            <div className="h-16 bg-app-line rounded-xl" />
            <div className="h-16 bg-app-line rounded-xl" />
          </div>
        </div>
      </div>

      {/* Invoerbalk */}
      <div className="bg-white border-t border-line p-4">
        <div className="h-16 bg-app-line rounded-xl" />
      </div>
    </div>
  );
}
