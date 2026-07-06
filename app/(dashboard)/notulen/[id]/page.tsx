import { createServerSupabase } from "@/lib/supabase-server";
import { rolHeeftCapability } from "@/lib/capabilities";
import Link from "next/link";
import { notFound } from "next/navigation";
import SegmentBeheer, { type SegmentData, type AgendapuntOptie } from "../_components/SegmentBeheer";

export const dynamic = "force-dynamic";

// Increment D — notulendetail: segmentvoorstellen bevestigen/corrigeren per
// agendapunt. Capability-gated (server-side leidend); de UI toont vóór de actie
// of de notulen zijn vastgesteld.
export default async function NotulenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profiel } = await supabase
    .from("profielen")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();
  const magBeheren = rolHeeftCapability(profiel?.rol, "notulen.segment.confirm");

  const { data: doc } = await supabase
    .from("documenten")
    .select("id, titel, status, documenttype, vergadering_id, vergaderingen(titel, datum)")
    .eq("id", id)
    .maybeSingle();
  if (!doc || doc.documenttype !== "notulen") notFound();

  const verg = (doc as unknown as {
    vergaderingen: { titel: string; datum: string } | null;
  }).vergaderingen;
  const vastgesteld = doc.status === "vastgesteld";

  // Agendapunten van de vergadering (voor de koppel-dropdown).
  const { data: agendaRows } = doc.vergadering_id
    ? await supabase
        .from("agendapunten")
        .select("id, titel, volgorde")
        .eq("vergadering_id", doc.vergadering_id)
        .is("verwijderd_op", null)
        .order("volgorde", { ascending: true })
    : { data: [] };
  const agendapunten: AgendapuntOptie[] = (agendaRows ?? []).map((a) => ({
    id: a.id,
    titel: a.titel,
    volgorde: a.volgorde,
  }));

  const { data: segRows } = await supabase
    .from("notulen_segmenten")
    .select("id, segment_index, titel, tekst, agendapunt_id, bevestigd, bevestigd_op")
    .eq("document_id", id)
    .order("segment_index", { ascending: true });
  const segmenten: SegmentData[] = (segRows ?? []).map((s) => ({
    id: s.id,
    segment_index: s.segment_index,
    titel: s.titel,
    tekst: s.tekst,
    agendapunt_id: s.agendapunt_id,
    bevestigd: s.bevestigd,
    bevestigd_op: s.bevestigd_op,
  }));

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-4xl">
      <Link href="/notulen" className="text-sm text-gray-500 hover:text-ink">
        ← Terug naar notulen
      </Link>
      <div className="flex items-start justify-between flex-wrap gap-2 mt-2 mb-1">
        <h1 className="font-serif text-xl font-black text-ink">{doc.titel}</h1>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
            vastgesteld ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {vastgesteld ? "Vastgesteld" : `Concept (${doc.status ?? "—"})`}
        </span>
      </div>
      {verg && (
        <p className="text-sm text-gray-500 mb-5">
          Vergadering: <strong>{verg.titel}</strong>
          {verg.datum && ` — ${new Date(verg.datum).toLocaleDateString("nl-NL")}`}
        </p>
      )}

      {!vastgesteld && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800">
          <span>⚠️</span>
          <div>
            Deze notulen zijn nog niet <strong>vastgesteld</strong>. Je kunt segmenten
            wel voorstellen en corrigeren, maar pas ná vaststelling kan een segment
            worden bevestigd en als agendapuntbron worden geïndexeerd.
          </div>
        </div>
      )}

      <SegmentBeheer
        documentId={id}
        vastgesteld={vastgesteld}
        magBeheren={magBeheren}
        agendapunten={agendapunten}
        segmenten={segmenten}
      />
    </div>
  );
}
