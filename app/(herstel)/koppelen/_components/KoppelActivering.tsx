"use client";
// ============================================================================
//  KoppelActivering — leest het herkoppeltoken uit het URL-fragment, wist het
//  direct uit de adresbalk en verstuurt het uitsluitend in de body van een POST
//  (fase 1C, #344 PR-B; reviewafspraak: nooit in pad, log, referrer of HTML).
// ----------------------------------------------------------------------------
//  Het token leeft alleen in React-state en wordt niet gerenderd. Activering is
//  een expliciete handeling (knop): een gewone GET, linkpreview of scanner
//  verbruikt de eenmalige uitnodiging niet. Na activering gaat de gebruiker naar
//  de login om met zijn WACHTWOORD in te loggen — het token authenticeert niet.
// ============================================================================
import { useEffect, useState } from "react";
import { tokenUitFragment, UITNODIGING_ONGELDIG_MELDING } from "@/core/lib/microsoft-login-meldingen-core";

type Stand = "lezen" | "geen-token" | "klaar" | "bezig" | "geactiveerd" | "geweigerd";

export default function KoppelActivering() {
  const [token, setToken] = useState<string | null>(null);
  const [stand, setStand] = useState<Stand>("lezen");
  const [melding, setMelding] = useState<string | null>(null);

  useEffect(() => {
    const t = tokenUitFragment(window.location.hash);
    // Fragment direct wissen: niet in browserhistorie of adresbalk laten staan.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setToken(t);
    setStand(t ? "klaar" : "geen-token");
  }, []);

  async function activeer() {
    if (!token) return;
    setStand("bezig");
    setMelding(null);
    try {
      const r = await fetch("/auth/microsoft-login/uitnodiging", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      // Token na één gebruik uit het geheugen; ongeacht de uitkomst.
      setToken(null);
      if (!r.ok) {
        setStand("geweigerd");
        setMelding(UITNODIGING_ONGELDIG_MELDING);
        return;
      }
      setStand("geactiveerd");
    } catch {
      setToken(null);
      setStand("geweigerd");
      setMelding(UITNODIGING_ONGELDIG_MELDING);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-line p-8 shadow-sm">
          <h1 className="text-lg font-bold text-ink mb-2">Microsoft-koppeling herstellen</h1>

          {stand === "lezen" && <p className="text-sm text-muted">Een ogenblik…</p>}

          {stand === "geen-token" && (
            <p className="text-sm text-muted" role="status">
              Deze pagina werkt alleen via een uitnodigingslink van uw beheerder. Vraag een nieuwe link aan als u er
              geen heeft.
            </p>
          )}

          {(stand === "klaar" || stand === "bezig") && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Uw beheerder heeft u uitgenodigd om uw Microsoft-koppeling te herstellen. Na het starten heeft u
                vijftien minuten om in te loggen met uw wachtwoord en uw Microsoft-account opnieuw te koppelen.
              </p>
              <button
                type="button"
                disabled={stand === "bezig"}
                onClick={() => void activeer()}
                className="w-full bg-accent text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-accent-ink disabled:opacity-50 transition-colors"
              >
                {stand === "bezig" ? "Starten..." : "Herstel starten"}
              </button>
            </div>
          )}

          {stand === "geactiveerd" && (
            <div className="space-y-4">
              <p className="text-sm text-ink" role="status">
                Het herstelvenster is geopend. Log binnen vijftien minuten in met uw e-mailadres en wachtwoord; daarna
                koppelt u uw Microsoft-account opnieuw.
              </p>
              <a
                href="/login"
                className="block w-full text-center bg-accent text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-accent-ink transition-colors"
              >
                Naar inloggen
              </a>
            </div>
          )}

          {stand === "geweigerd" && melding && (
            <div id="koppelen-melding" role="alert" className="bg-err-tint border border-err/30 rounded-lg px-3 py-2 text-sm text-err-ink">
              {melding}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
