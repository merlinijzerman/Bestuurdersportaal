"use client";

import { useEffect } from "react";
import Link from "next/link";

// Segment-error-boundary voor alle dashboard-pagina's.
// Vangt elke render-fout op (server of client) zodat een onverwachte
// null/undefined of mislukte query nooit meer de hele pagina laat crashen,
// maar degradeert naar een nette fallback met herstel-actie.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log naar de server/Vercel-logs voor diagnose (incl. digest).
    console.error("Dashboard render error:", error);
  }, [error]);

  return (
    <div className="p-7">
      <div className="max-w-xl mx-auto bg-white border border-gray-200 rounded-xl p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-50 rounded-2xl mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h1 className="text-[#0F2744] text-lg font-bold">
          Er ging iets mis bij het laden van deze pagina
        </h1>
        <p className="text-sm text-gray-500 mt-2">
          De pagina kon niet volledig worden geladen. Probeer het opnieuw; blijft
          het misgaan, ververs dan de pagina of ga terug naar het overzicht.
        </p>

        <div className="flex items-center justify-center gap-3 mt-5">
          <button
            onClick={() => reset()}
            className="text-sm text-white bg-[#0F2744] px-4 py-2 rounded-lg hover:bg-[#163457] transition-colors"
          >
            Opnieuw proberen
          </button>
          <Link
            href="/"
            className="text-sm text-[#0F2744] border border-gray-200 px-4 py-2 rounded-lg hover:border-[#C9A84C] transition-colors"
          >
            Naar overzicht
          </Link>
        </div>

        {error?.digest ? (
          <p className="text-[11px] text-gray-400 mt-4">
            Referentie: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
