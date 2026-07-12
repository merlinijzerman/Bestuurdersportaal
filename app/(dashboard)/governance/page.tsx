import { createServerSupabase } from "@/core/lib/supabase-server";

interface LogRegel {
  id: string;
  gebruiker_naam: string;
  vraag: string;
  antwoord: string;
  bronnen: Array<{ titel: string; bron: string; pagina?: number; paragraaf?: string }>;
  aangemaakt: string;
}

const BRONKLEUR: Record<string, string> = {
  DNB: "bg-err-tint text-err-ink",
  AFM: "bg-accent-tint text-accent-ink",
  Pensioenfederatie: "bg-ok-tint text-ok-ink",
  Intern: "bg-warn-tint text-warn-ink",
  Extern: "bg-warn-tint text-warn-ink",
};

export default async function GovernancePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id, rol")
    .eq("id", user!.id)
    .single();

  // Het governance-log toont wie welke AI-vraag stelde (persoonsgegevens van
  // bestuurders) en is voorbehouden aan de rol beheerder. Dit is de leidende,
  // server-side autorisatie; de sidebar-gating is slechts cosmetisch. RLS borgt
  // daarnaast de fonds-isolatie. NB: alleen-tonen-blokkade, geen mutatie.
  if (profiel?.rol !== "beheerder") {
    return (
      <div className="p-4 sm:p-6 lg:p-7 max-w-3xl">
        <div className="mb-6">
          <h1 className="font-serif text-xl font-black text-ink">Governance Log</h1>
        </div>
        <div className="rounded-xl border border-warn/30 bg-warn-tint p-4 text-sm text-warn-ink">
          U heeft geen rechten om het governance-log in te zien. Inzage in het
          AI-auditspoor is voorbehouden aan de rol <strong>beheerder</strong>.
        </div>
      </div>
    );
  }

  const { data: logRegels } = await supabase
    .from("governance_log")
    .select("*")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("aangemaakt", { ascending: false })
    .limit(50);

  return (
    <div className="p-4 sm:p-6 lg:p-7">
      <div className="mb-6">
        <h1 className="font-serif text-xl font-black text-ink">Governance Log</h1>
        <p className="text-sm text-muted mt-1">
          Alle AI-interacties worden automatisch gelogd voor compliance en traceerbaarheid
        </p>
      </div>

      <div className="flex items-start gap-3 bg-accent-tint border border-accent/30 rounded-xl px-4 py-3 mb-6 text-sm text-accent-ink">
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
          <h3 className="font-semibold text-ink mb-1">Nog geen AI-interacties</h3>
          <p className="text-sm text-muted">
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
              <div key={log.id} className="bg-white border border-line rounded-xl p-4">
                {/* Header */}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-7 h-7 bg-accent rounded-full flex items-center justify-center text-xs font-bold text-ink flex-shrink-0">
                    {initials}
                  </div>
                  <span className="font-semibold text-sm text-ink">
                    {log.gebruiker_naam}
                  </span>
                  <span className="ml-auto text-xs text-muted">
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
                <div className="bg-app-bg rounded-lg px-3 py-2 text-sm text-ink mb-3">
                  ❓ „{log.vraag}"
                </div>

                {/* Bronnen */}
                {log.bronnen && log.bronnen.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {log.bronnen.map((b, j) => (
                      <span
                        key={j}
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          BRONKLEUR[b.bron] || "bg-app-bg text-muted"
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
                  <span className="text-xs text-muted italic">
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
          <button className="border border-line rounded-lg px-4 py-2 text-sm font-semibold text-muted hover:bg-app-bg transition-colors">
            📥 Exporteren als CSV
          </button>
          <div className="ml-auto text-xs text-muted self-center">
            {logRegels.length} interacties weergegeven
          </div>
        </div>
      )}
    </div>
  );
}
