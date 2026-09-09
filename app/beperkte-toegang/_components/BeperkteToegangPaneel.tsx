"use client";
// ============================================================================
//  BeperkteToegangPaneel — de twee handelingen die een afgeschaalde sessie heeft
//  (#344): de tweestapsverificatie afronden (noodtoegang) of opnieuw koppelen.
// ----------------------------------------------------------------------------
//  Geen fondsdata, geen navigatie naar het portaal: die zou toch leeg zijn, want
//  het token draagt de beperkte databaserol. Na een geslaagde verificatie geeft
//  de Auth-hook bij de volgende tokenuitgifte de normale rol; één volledige
//  navigatie is genoeg om daar te komen.
// ============================================================================
import { useEffect, useState } from "react";
import { createClient } from "@/core/lib/supabase";

/** Koppelstatus van dit account (GET /api/microsoft-login/koppeling; ook voor de beperkte rol). */
type KoppelStatus = { status?: "geen" | "pending" | "active" | "revoking" | "onbekend"; magKoppelen?: boolean; magOntkoppelen?: boolean };

export default function BeperkteToegangPaneel({ naam, factorId }: { naam: string | null; factorId: string | null }) {
  const [code, setCode] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState("");
  const [koppel, setKoppel] = useState<KoppelStatus | null>(null);
  const supabase = createClient();

  // Herstelsessie (#344 PR-B): eerst weten of er nog een oude koppeling in de weg
  // zit. Die moet de gebruiker binnen het venster zelf losmaken vóór hij opnieuw
  // koppelt (koppelen/start weigert met 409 zolang er een levende binding is).
  useEffect(() => {
    if (factorId) return;
    let actief = true;
    void fetch("/api/microsoft-login/koppeling", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as KoppelStatus) : { status: "onbekend" as const }))
      .catch(() => ({ status: "onbekend" as const }))
      .then((s) => {
        if (actief) setKoppel(s);
      });
    return () => {
      actief = false;
    };
  }, [factorId]);

  async function losmaken() {
    if (!confirm("Oude Microsoft-koppeling losmaken? Daarna koppelt u uw (nieuwe) Microsoft-account opnieuw.")) return;
    setBezig(true);
    setFout("");
    try {
      const r = await fetch("/api/microsoft-login/koppeling", { method: "DELETE" });
      if (!r.ok) {
        setFout("De oude koppeling kon niet worden losgemaakt. Neem contact op met uw beheerder.");
        return;
      }
      setKoppel({ status: "geen", magKoppelen: true });
    } catch {
      setFout("De oude koppeling kon niet worden losgemaakt. Probeer het opnieuw.");
    } finally {
      setBezig(false);
    }
  }

  async function verifieer(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBezig(true);
    setFout("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setFout("De code klopt niet of is verlopen. Probeer het opnieuw.");
      setBezig(false);
      return;
    }
    // De sessie is nu AAL2, maar nog stééds beperkt: de Auth-hook geeft de normale
    // rol pas als er een activeringsvenster IS. Dat openen is een expliciete,
    // geaudite serverhandeling — daarna vernieuwen we het token één keer.
    const verhoging = await fetch("/api/microsoft-login/verhoging", { method: "POST" });
    if (!verhoging.ok) {
      setFout("Noodtoegang kan nu niet worden geopend. Neem contact op met uw beheerder.");
      setBezig(false);
      return;
    }
    const { error: verversFout } = await supabase.auth.refreshSession();
    if (verversFout) {
      setFout("De sessie kon niet worden vernieuwd. Probeer het opnieuw.");
      setBezig(false);
      return;
    }
    window.location.replace("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-line p-8 shadow-sm">
          <h1 className="text-lg font-bold text-ink mb-2">Beperkte toegang</h1>
          <p className="text-sm text-muted mb-6">
            {naam ? `${naam}, uw` : "Uw"} organisatie gebruikt Microsoft-login. Deze sessie geeft nog geen toegang tot
            het portaal.
          </p>

          {factorId ? (
            <form onSubmit={verifieer} className="space-y-4">
              <p className="text-sm text-ink">
                Rond de tweestapsverificatie af om noodtoegang te krijgen.
              </p>
              <div>
                <label htmlFor="mfa-code" className="block text-sm font-semibold text-ink mb-1">
                  Verificatiecode
                </label>
                <input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  placeholder="000000"
                  required
                />
              </div>
              {fout && (
                <div role="alert" className="bg-err-tint border border-err/30 rounded-lg px-3 py-2 text-sm text-err-ink">
                  {fout}
                </div>
              )}
              <button
                type="submit"
                disabled={bezig || code.length < 6}
                className="w-full bg-accent text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-accent-ink disabled:opacity-50 transition-colors"
              >
                {bezig ? "Controleren..." : "Verifiëren"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink">
                Koppel uw Microsoft-account om verder te gaan. Lukt dat niet, neem dan contact op met uw beheerder.
              </p>
              {fout && (
                <div role="alert" className="bg-err-tint border border-err/30 rounded-lg px-3 py-2 text-sm text-err-ink">
                  {fout}
                </div>
              )}
              {koppel && koppel.status !== "geen" && koppel.status !== "onbekend" ? (
                <>
                  <p className="text-sm text-muted">
                    Er staat nog een oude Microsoft-koppeling op uw account. Maak die eerst los; daarna koppelt u opnieuw.
                  </p>
                  <button
                    type="button"
                    disabled={bezig}
                    onClick={() => void losmaken()}
                    className="w-full border border-app-line-strong text-ink font-semibold py-2.5 rounded-lg text-sm hover:bg-app-bg disabled:opacity-50 transition-colors"
                  >
                    Oude koppeling losmaken
                  </button>
                </>
              ) : (
                <a
                  href="/api/microsoft-login/koppelen/start"
                  className="block w-full text-center border border-app-line-strong text-ink font-semibold py-2.5 rounded-lg text-sm hover:bg-app-bg transition-colors"
                >
                  Microsoft-account koppelen
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
