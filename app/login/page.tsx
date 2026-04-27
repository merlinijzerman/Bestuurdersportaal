"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase";
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
    <div className="min-h-screen flex items-center justify-center bg-[#F0F3F8]">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#C9A84C] rounded-2xl mb-4">
            <span className="text-[#0F2744] font-black text-2xl">P</span>
          </div>
          <h1 className="text-2xl font-bold text-[#0F2744]">Bestuurdersportaal</h1>
          <p className="text-sm text-gray-500 mt-1">
            {process.env.NEXT_PUBLIC_FONDS_NAAM || "Pensioenfonds"}
          </p>
        </div>

        {/* Login kaart */}
        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          <h2 className="text-lg font-bold text-[#0F2744] mb-6">Inloggen</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                E-mailadres
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C] focus:ring-1 focus:ring-[#C9A84C]"
                placeholder="naam@pensioenfonds.nl"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Wachtwoord
              </label>
              <input
                type="password"
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C] focus:ring-1 focus:ring-[#C9A84C]"
                placeholder="••••••••"
                required
              />
            </div>
            {fout && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                {fout}
              </div>
            )}
            <button
              type="submit"
              disabled={laden}
              className="w-full bg-[#0F2744] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#1A3A5C] disabled:opacity-50 transition-colors"
            >
              {laden ? "Inloggen..." : "Inloggen"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 bg-green-400 rounded-full pulse-dot"></span>
            Beveiligde, beheerde AI-omgeving
          </div>
        </div>
      </div>
    </div>
  );
}
