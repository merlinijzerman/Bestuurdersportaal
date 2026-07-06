"use client";

// ============================================================================
//  Platform-login (Increment P0 — eigen, losstaande login + harde MFA).
// ----------------------------------------------------------------------------
//  Stappen: wachtwoord → (MFA enroll als er nog geen factor is, anders MFA
//  challenge) → AAL2 → /platform. De gate-layout laat niemand zonder AAL2 door;
//  deze pagina helpt de gebruiker AAL2 te bereiken. TOTP-secret wordt als tekst
//  getoond (handmatige invoer in de authenticator) — bewust geen QR-library
//  toegevoegd (geen nieuwe afhankelijkheid). Tenant-accounts worden door de
//  gate geweigerd (?fout=geen_toegang) en hier uitgelogd.
// ============================================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Stap = "wachtwoord" | "enroll" | "challenge";

export default function PlatformLoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [stap, setStap] = useState<Stap>("wachtwoord");
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [code, setCode] = useState("");
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState("");

  // Enroll-/challenge-state.
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQr, setTotpQr] = useState("");

  async function naarPlatform() {
    router.push("/platform");
    router.refresh();
  }

  // Reageer op gate-redirects: ?mfa=1 (sessie zonder AAL2) of ?fout=geen_toegang.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fout") === "geen_toegang") {
      setFout("Dit account heeft geen platformtoegang. U bent uitgelogd.");
      supabase.auth.signOut();
      return;
    }
    if (params.get("mfa") === "1") {
      void naarMfaStap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Bepaalt op basis van bestaande factoren of we moeten enrollen of challengen. */
  async function naarMfaStap() {
    setFout("");
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setFout("Kon MFA-status niet ophalen.");
      return;
    }
    const totp = (data?.totp ?? []).find((f) => f.status === "verified");
    if (totp) {
      await startChallenge(totp.id);
    } else {
      await startEnroll();
    }
  }

  async function handleWachtwoord(e: React.FormEvent) {
    e.preventDefault();
    setLaden(true);
    setFout("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: wachtwoord,
    });
    if (error) {
      setFout("Inloggen mislukt. Controleer e-mailadres en wachtwoord.");
      setLaden(false);
      return;
    }
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") {
      await naarPlatform();
      return;
    }
    await naarMfaStap();
    setLaden(false);
  }

  async function startEnroll() {
    setFout("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `platform-${Date.now()}`,
    });
    if (error || !data) {
      setFout("Kon MFA-inschrijving niet starten.");
      return;
    }
    setFactorId(data.id);
    setTotpSecret(data.totp.secret);
    setTotpQr(data.totp.qr_code);
    setStap("enroll");
  }

  async function startChallenge(fId: string) {
    setFout("");
    const { data, error } = await supabase.auth.mfa.challenge({ factorId: fId });
    if (error || !data) {
      setFout("Kon MFA-challenge niet starten.");
      return;
    }
    setFactorId(fId);
    setChallengeId(data.id);
    setStap("challenge");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLaden(true);
    setFout("");

    let chId = challengeId;
    if (stap === "enroll") {
      // Voor een net-ingeschreven factor eerst een challenge aanmaken.
      const { data, error } = await supabase.auth.mfa.challenge({ factorId });
      if (error || !data) {
        setFout("Kon MFA-challenge niet starten.");
        setLaden(false);
        return;
      }
      chId = data.id;
    }

    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: chId,
      code,
    });
    if (error) {
      setFout("Verificatiecode onjuist of verlopen.");
      setLaden(false);
      return;
    }
    await naarPlatform();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
            <span className="text-2xl font-black text-[#0F2744]">P</span>
          </div>
          <h1 className="text-xl font-bold text-[#0F2744]">
            Platform back-office
          </h1>
          <p className="mt-1 text-sm text-[#0F2744]/60">
            Afgeschermde toegang — MFA verplicht.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {fout && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {fout}
            </div>
          )}

          {stap === "wachtwoord" && (
            <form onSubmit={handleWachtwoord} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#0F2744]">
                  E-mailadres
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#0F2744]/15 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[#0F2744]">
                  Wachtwoord
                </label>
                <input
                  type="password"
                  required
                  value={wachtwoord}
                  onChange={(e) => setWachtwoord(e.target.value)}
                  className="w-full rounded-lg border border-[#0F2744]/15 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={laden}
                className="w-full rounded-lg bg-[#0F2744] py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {laden ? "Bezig…" : "Inloggen"}
              </button>
            </form>
          )}

          {stap === "enroll" && (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-[#0F2744]/80">
                Scan deze QR-code met uw authenticator-app en voer de
                6-cijferige code in.
              </p>
              {totpQr && (
                <div className="flex justify-center rounded-lg bg-white p-3">
                  {/* Supabase levert de QR als gerenderde SVG-data-URI — geen
                      QR-library nodig. eslint-disable: bewust een <img>, geen
                      next/image (data-URI, geen remote-optimalisatie nodig). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={totpQr}
                    alt="QR-code voor MFA-inschrijving"
                    className="h-44 w-44"
                  />
                </div>
              )}
              <details className="rounded-lg bg-app-bg p-3">
                <summary className="cursor-pointer text-xs font-medium text-[#0F2744]/60">
                  Scannen lukt niet? Voer de sleutel handmatig in
                </summary>
                <div className="mt-2 break-all font-mono text-sm">
                  {totpSecret}
                </div>
              </details>
              <CodeInvoer code={code} setCode={setCode} />
              <button
                type="submit"
                disabled={laden}
                className="w-full rounded-lg bg-[#0F2744] py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {laden ? "Verifiëren…" : "Inschrijven en inloggen"}
              </button>
            </form>
          )}

          {stap === "challenge" && (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-[#0F2744]/80">
                Voer de 6-cijferige code uit uw authenticator-app in.
              </p>
              <CodeInvoer code={code} setCode={setCode} />
              <button
                type="submit"
                disabled={laden}
                className="w-full rounded-lg bg-[#0F2744] py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {laden ? "Verifiëren…" : "Verifiëren"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeInvoer({
  code,
  setCode,
}: {
  code: string;
  setCode: (v: string) => void;
}) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      required
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      placeholder="123456"
      className="w-full rounded-lg border border-[#0F2744]/15 px-3 py-2 text-center font-mono text-lg tracking-widest"
    />
  );
}
