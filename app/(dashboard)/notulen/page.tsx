import { createServerSupabase } from "@/lib/supabase-server";
import Link from "next/link";

export default async function NotulenPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id")
    .eq("id", user!.id)
    .single();

  // Haal fondsspecifieke documenten op die notulen of besluiten zijn
  const { data: documenten } = await supabase
    .from("documenten")
    .select("*")
    .eq("bibliotheek", "fonds")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("aangemaakt", { ascending: false });

  return (
    <div className="p-7">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-[#0F2744]">Besluiten &amp; Notulen</h1>
          <p className="text-sm text-gray-500 mt-1">
            Historisch archief van bestuursvergaderingen en officiële besluiten
          </p>
        </div>
        <Link
          href="/bibliotheek"
          className="bg-[#0F2744] text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-[#1A3A5C] transition-colors"
        >
          + Document toevoegen
        </Link>
      </div>

      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-800">
        <span>💡</span>
        <div>
          Upload notulen en besluiten via de <strong>Documentbibliotheek</strong> (bibliotheek:{" "}
          <em>Fonds</em>). De AI-assistent kan ze dan direct doorzoeken en citeren.
        </div>
      </div>

      {!documenten || documenten.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="font-semibold text-gray-700 mb-2">Nog geen fondsspecifieke documenten</h3>
          <p className="text-sm text-gray-400 mb-4">
            Upload notulen en besluiten als PDF via de Documentbibliotheek.
          </p>
          <Link
            href="/bibliotheek"
            className="inline-block bg-[#0F2744] text-white font-semibold px-5 py-2.5 rounded-lg text-sm hover:bg-[#1A3A5C]"
          >
            Naar Documentbibliotheek →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {documenten.map((doc) => {
            const datum = new Date(doc.aangemaakt);
            return (
              <div
                key={doc.id}
                className="bg-white border border-gray-200 rounded-xl p-4 flex gap-4 items-start hover:border-[#C9A84C] transition-colors cursor-pointer"
              >
                <div className="bg-[#0F2744] text-white rounded-xl p-3 text-center min-w-[52px] flex-shrink-0">
                  <div className="text-xs font-bold uppercase opacity-70">
                    {datum.toLocaleString("nl-NL", { month: "short" })}
                  </div>
                  <div className="text-xl font-black leading-none">{datum.getDate()}</div>
                  <div className="text-xs opacity-60">{datum.getFullYear()}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[#0F2744] text-sm">{doc.titel}</div>
                  <div className="text-xs text-gray-400 mt-1 flex gap-3">
                    <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                      {doc.bron}
                    </span>
                    {doc.paginas && <span>{doc.paginas} pagina's</span>}
                    {doc.geindexeerd && (
                      <span className="text-green-600 font-semibold">✓ Doorzoekbaar via AI</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
