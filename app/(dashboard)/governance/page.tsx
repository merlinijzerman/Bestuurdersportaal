import { createServerSupabase } from "@/lib/supabase-server";

interface LogRegel {
  id: string;
  gebruiker_naam: string;
  vraag: string;
  antwoord: string;
  bronnen: Array<{ titel: string; bron: string; pagina?: number; paragraaf?: string }>;
  aangemaakt: string;
}

const BRONKLEUR: Record<string, string> = {
  DNB: "bg-red-100 text-red-700",
  AFM: "bg-blue-100 text-blue-700",
  Pensioenfederatie: "bg-green-100 text-green-700",
  Intern: "bg-amber-100 text-amber-700",
  Extern: "bg-amber-100 text-amber-700",
};

export default async function GovernancePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id")
    .eq("id", user!.id)
    .single();

  const { data: logRegels } = await supabase
    .from("governance_log")
    .select("*")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("aangemaakt", { ascending: false })
    .limit(50);

  return (
    <div className="p-7">
      <div className="mb-6">
        <h1 className="text-xl font-black text-[#0F2744]">Governance Log</h1>
        <p className="text-sm text-gray-500 mt-1">
          Alle AI-interacties worden automatisch gelogd voor compliance en traceerbaarheid
        </p>
      </div>

      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-sm text-blue-800">
        <span>🛡️</span>
        <div>
          Dit log registreert <strong>elke vraag</strong> gesteld aan de AI-assistent: wie,
          wanneer, welke bronnen geraadpleegd en welk antwoord gegeven. Het log is onveranderbaar
          en kan worden geëxporteerd voor toezichthouders.
        </div>
      </div>

      {!logRegels || logRegels.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="font-semibold text-gray-700 mb-1">Nog geen AI-interacties</h3>
          <p className="text-sm text-gray-400">
            Zodra bestuurders vragen stellen aan de AI, verschijnen die hier.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(logRegels as LogRegel[]).map((log) => {
            const initials = log.gebruiker_naam
              ?.split(" ")
              .map((n: string) => n[0])
              .join("")
              .substring(0, 2)
              .toUpperCase() || "??";

            return (
              <div key={log.id} className="bg-white border border-gray-200 rounded-xl p-4">
                {/* Header */}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-7 h-7 bg-[#C9A84C] rounded-full flex items-center justify-center text-xs font-bold text-[#0F2744] flex-shrink-0">
                    {initials}
                  </div>
                  <span className="font-semibold text-sm text-[#0F2744]">
                    {log.gebruiker_naam}
                  </span>
                  <span className="ml-auto text-xs text-gray-400">
                    {new Date(log.aangemaakt).toLocaleString("nl-NL", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {/* Vraag */}
                <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700 mb-3">
                  ❓ „{log.vraag}"
                </div>

                {/* Bronnen */}
                {log.bronnen && log.bronnen.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {log.bronnen.map((b, j) => (
                      <span
                        key={j}
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          BRONKLEUR[b.bron] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {b.bron} — {b.titel.substring(0, 40)}{b.titel.length > 40 ? "…" : ""}
                        {b.paragraaf ? ` ${b.paragraaf}` : ""}
                        {b.pagina ? ` pag. ${b.pagina}` : ""}
                      </span>
                    ))}
                  </div>
                )}

                {log.bronnen?.length === 0 && (
                  <span className="text-xs text-gray-400 italic">
                    Geen documentbronnen gevonden voor deze vraag
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {logRegels && logRegels.length > 0 && (
        <div className="mt-5 flex gap-3">
          <button className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            📥 Exporteren als CSV
          </button>
          <div className="ml-auto text-xs text-gray-400 self-center">
            {logRegels.length} interacties weergegeven
          </div>
        </div>
      )}
    </div>
  );
}
