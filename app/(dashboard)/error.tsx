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
    <div className="p-4 sm:p-6 lg:p-7">
      <div className="max-w-xl mx-auto bg-white border border-line rounded-xl p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-warn-tint rounded-2xl mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h1 className="font-serif text-ink text-lg font-bold">
          Er ging iets mis bij het laden van deze pagina
        </h1>
        <p className="text-sm text-muted mt-2">
          De pagina kon niet volledig worden geladen. Probeer het opnieuw; blijft
          het misgaan, ververs dan de pagina of ga terug naar het overzicht.
        </p>

        <div className="flex items-center justify-center gap-3 mt-5">
          <button
            onClick={() => reset()}
            className="text-sm text-white bg-accent px-4 py-2 rounded-lg hover:bg-accent-ink transition-colors"
          >
            Opnieuw proberen
          </button>
          <Link
            href="/"
            className="text-sm text-ink border border-line px-4 py-2 rounded-lg hover:border-accent transition-colors"
          >
            Naar overzicht
          </Link>
        </div>

        {error?.digest ? (
          <p className="text-[11px] text-muted mt-4">
            Referentie: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
