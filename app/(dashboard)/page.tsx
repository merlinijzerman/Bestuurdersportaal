import { createServerSupabase } from "@/lib/supabase-server";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam, fonds_id")
    .eq("id", user!.id)
    .single();

  // Statistieken ophalen
  const [{ count: aantalDocs }, { count: aantalLogs }] = await Promise.all([
    supabase
      .from("documenten")
      .select("*", { count: "exact", head: true })
      .or(`fonds_id.eq.${profiel?.fonds_id},bibliotheek.eq.generiek`),
    supabase
      .from("governance_log")
      .select("*", { count: "exact", head: true })
      .eq("fonds_id", profiel?.fonds_id || ""),
  ]);

  const { data: recentLog } = await supabase
    .from("governance_log")
    .select("gebruiker_naam, vraag, aangemaakt")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("aangemaakt", { ascending: false })
    .limit(5);

  const naam = profiel?.naam?.split(" ")[0] || "Bestuurder";

  return (
    <div className="p-7">
      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-sm text-blue-800">
        <span className="text-lg">ℹ️</span>
        <div>
          <strong>Welkom in uw beheerde AI-omgeving, {naam}.</strong> Alle AI-interacties worden gelogd
          en zijn traceerbaar via de Governance Log. Antwoorden zijn altijd voorzien van
          bronverwijzingen naar gevalideerde documenten.
        </div>
      </div>

      {/* Statistieken */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl mb-1">📄</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">Documenten</div>
          <div className="text-3xl font-black text-[#0F2744] my-1">{aantalDocs || 0}</div>
          <div className="text-xs text-gray-400">In beide bibliotheken</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl mb-1">🤖</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">AI-vragen</div>
          <div className="text-3xl font-black text-[#0F2744] my-1">{aantalLogs || 0}</div>
          <div className="text-xs text-gray-400">100% traceerbaar gelogd</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl mb-1">✅</div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">AI-omgeving</div>
          <div className="text-3xl font-black text-green-600 my-1">Actief</div>
          <div className="text-xs text-gray-400">Governance logging aan</div>
        </div>
      </div>

      {/* Recente AI-activiteit */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="font-bold text-[#0F2744] text-sm mb-4">Recente AI-vragen</div>
        {recentLog && recentLog.length > 0 ? (
          <div className="space-y-3">
            {recentLog.map((log, i) => (
              <div key={i} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                <div className="w-2 h-2 bg-green-400 rounded-full mt-1.5 flex-shrink-0"></div>
                <div>
                  <div className="text-sm text-gray-800">
                    <strong>{log.gebruiker_naam}</strong> vroeg: „{log.vraag.substring(0, 80)}{log.vraag.length > 80 ? "…" : ""}"
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(log.aangemaakt).toLocaleString("nl-NL", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-6">
            Nog geen AI-vragen gesteld. Probeer de AI Assistent!
          </div>
        )}
      </div>
    </div>
  );
}
