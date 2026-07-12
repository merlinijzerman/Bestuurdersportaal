"use client";
import { useState } from "react";
import { createClient } from "@/core/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState("");
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLaden(true);
    setFout("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: wachtwoord,
    });

    if (error) {
      setFout("Inloggen mislukt. Controleer uw e-mailadres en wachtwoord.");
      setLaden(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg">
      <div className="w-full max-w-md">
        {/* Logo — neutraal, geen fondsbranding (publieke login, TO §2.5) */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4">
            <span className="text-white font-black text-2xl">B</span>
          </div>
          <h1 className="font-serif text-2xl font-bold text-ink">Bestuurdersportaal</h1>
          <p className="text-sm text-muted mt-1">
            Open de beveiligde omgeving van uw organisatie
          </p>
        </div>

        {/* Login kaart */}
        <div className="bg-white rounded-2xl border border-line p-8 shadow-sm">
          <h2 className="text-lg font-bold text-ink mb-6">
            Log in op uw bestuurdersomgeving
          </h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                E-mailadres
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                placeholder="naam@organisatie.nl"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Wachtwoord
              </label>
              <input
                type="password"
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                placeholder="••••••••"
                required
              />
            </div>
            {fout && (
              <div className="bg-err-tint border border-err/30 rounded-lg px-3 py-2 text-sm text-err-ink">
                {fout}
              </div>
            )}
            <button
              type="submit"
              disabled={laden}
              className="w-full bg-accent text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-accent-ink disabled:opacity-50 transition-colors"
            >
              {laden ? "Inloggen..." : "Inloggen"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-muted">
            <span className="w-2 h-2 bg-ok rounded-full pulse-dot"></span>
            Beveiligde, beheerde AI-omgeving
          </div>
        </div>
      </div>
    </div>
  );
}
