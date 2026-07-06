import { createServerSupabase } from "@/lib/supabase-server";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Increment D — notulenmodule: notulendocumenten per fonds, met segmentstatus.
// Bevestigde segmenten zijn de agendapuntbron voor de AI; concept-notulen tonen
// expliciet dat ze nog niet vastgesteld zijn (UX-principe "blokkers vooraf").
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

  // Notulendocumenten van het fonds + hun vergadering.
  const { data: documenten } = await supabase
    .from("documenten")
    .select("id, titel, status, documentdatum, aangemaakt, vergadering_id, vergaderingen(titel, datum)")
    .eq("documenttype", "notulen")
    .eq("fonds_id", profiel?.fonds_id || "")
    .order("documentdatum", { ascending: false, nullsFirst: false });

  const docIds = (documenten ?? []).map((d) => d.id);

  // Segmentstatus per document (één query, in JS geaggregeerd).
  const segPerDoc = new Map<string, { totaal: number; bevestigd: number }>();
  if (docIds.length > 0) {
    const { data: segmenten } = await supabase
      .from("notulen_segmenten")
      .select("document_id, bevestigd")
      .in("document_id", docIds);
    for (const s of segmenten ?? []) {
      const e = segPerDoc.get(s.document_id) ?? { totaal: 0, bevestigd: 0 };
      e.totaal += 1;
      if (s.bevestigd) e.bevestigd += 1;
      segPerDoc.set(s.document_id, e);
    }
  }

  return (
    <div className="p-7">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-ink">Notulen</h1>
          <p className="text-sm text-gray-500 mt-1">
            Geüploade notulen worden per agendapunt benutbaar zodra de secretaris de
            voorgestelde segmenten bevestigt. Alleen bevestigde segmenten van
            vastgestelde notulen gebruikt de AI als agendapuntbron.
          </p>
        </div>
        <Link
          href="/bibliotheek"
          className="bg-accent text-white font-semibold px-4 py-2 rounded-lg text-sm hover:bg-accent-ink transition-colors"
        >
          + Notulen uploaden
        </Link>
      </div>

      {!documenten || documenten.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="font-semibold text-gray-700 mb-2">Nog geen notulen</h3>
          <p className="text-sm text-gray-400 mb-4">
            Upload notulen als PDF via de Documentbibliotheek (documenttype:{" "}
            <em>notulen</em>) en koppel ze aan een vergadering.
          </p>
          <Link
            href="/bibliotheek"
            className="inline-block bg-accent text-white font-semibold px-5 py-2.5 rounded-lg text-sm hover:bg-accent-ink"
          >
            Naar Documentbibliotheek →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {documenten.map((doc) => {
            const verg = (doc as unknown as {
              vergaderingen: { titel: string; datum: string } | null;
            }).vergaderingen;
            const seg = segPerDoc.get(doc.id) ?? { totaal: 0, bevestigd: 0 };
            const vastgesteld = doc.status === "vastgesteld";
            const datum = doc.documentdatum
              ? new Date(doc.documentdatum)
              : new Date(doc.aangemaakt);
            return (
              <Link
                key={doc.id}
                href={`/notulen/${doc.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-accent transition-colors"
              >
                <div className="flex gap-4 items-start">
                  <div className="bg-accent text-white rounded-xl p-3 text-center min-w-[52px] flex-shrink-0">
                    <div className="text-xs font-bold uppercase opacity-70">
                      {datum.toLocaleString("nl-NL", { month: "short" })}
                    </div>
                    <div className="text-xl font-black leading-none">{datum.getDate()}</div>
                    <div className="text-xs opacity-60">{datum.getFullYear()}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink text-sm">{doc.titel}</div>
                    {verg && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Vergadering: {verg.titel}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-2 flex flex-wrap gap-2 items-center">
                      <span
                        className={`px-2 py-0.5 rounded-full font-semibold ${
                          vastgesteld
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {vastgesteld ? "Vastgesteld" : `Concept (${doc.status ?? "—"})`}
                      </span>
                      {seg.totaal === 0 ? (
                        <span className="text-gray-400">Nog niet gesegmenteerd</span>
                      ) : (
                        <span className="text-gray-500">
                          {seg.bevestigd} van {seg.totaal} segment(en) bevestigd
                        </span>
                      )}
                      {seg.bevestigd > 0 && (
                        <span className="text-green-600 font-semibold">
                          ✓ {seg.bevestigd} agendapuntbron(nen) actief
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
