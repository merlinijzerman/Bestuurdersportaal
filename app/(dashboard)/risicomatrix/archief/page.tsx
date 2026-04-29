import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  CategorieSlug,
  NiveauSlug,
  TypeRisicoSlug,
  NIVEAU_KLEUREN,
  NIVEAU_LABEL,
  categorieLabel,
} from "@/lib/risico-config";

interface GeslotenRisico {
  id: string;
  categorie: CategorieSlug;
  titel: string;
  toelichting: string | null;
  niveau: NiveauSlug;
  type_risico: TypeRisicoSlug;
  gesloten_op: string | null;
}

function formatDatum(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function ArchiefPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id")
    .eq("id", user.id)
    .single();

  const { data: risicos } = await supabase
    .from("risicos")
    .select("id, categorie, titel, toelichting, niveau, type_risico, gesloten_op")
    .eq("fonds_id", profiel?.fonds_id || "")
    .eq("status", "gesloten")
    .order("gesloten_op", { ascending: false });

  const lijst = (risicos || []) as GeslotenRisico[];

  return (
    <div className="p-7 space-y-5">
      <Link
        href="/risicomatrix"
        className="text-sm text-gray-500 hover:text-[#0F2744] inline-flex items-center gap-1"
      >
        ← Terug naar matrix
      </Link>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[#0F2744] text-xl font-bold">
            Archief gesloten risico&apos;s
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Volledig reproduceerbaar: elk gesloten risico bewaart toelichting,
            maatregelen en logboek zoals op moment van sluiting.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          {lijst.length} gesloten {lijst.length === 1 ? "risico" : "risico's"}
        </div>
      </div>

      {lijst.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-400">
          Nog geen gesloten risico&apos;s.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs uppercase tracking-wide text-gray-500 font-semibold border-b border-gray-100 bg-gray-50">
            <div className="col-span-5">Titel</div>
            <div className="col-span-3">Categorie</div>
            <div className="col-span-2">Niveau bij sluiting</div>
            <div className="col-span-2">Gesloten op</div>
          </div>
          <div className="divide-y divide-gray-100">
            {lijst.map((r) => (
              <Link
                key={r.id}
                href={`/risicomatrix/${r.id}`}
                className="grid grid-cols-12 gap-4 px-4 py-4 items-center hover:bg-gray-50 text-sm"
              >
                <div className="col-span-5 min-w-0">
                  <div className="font-medium text-[#0F2744]">{r.titel}</div>
                  {r.toelichting && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {r.toelichting}
                    </div>
                  )}
                </div>
                <div className="col-span-3 text-xs text-gray-700">
                  {categorieLabel(r.categorie)}
                </div>
                <div className="col-span-2">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded ${NIVEAU_KLEUREN[r.niveau].pillBg} ${NIVEAU_KLEUREN[r.niveau].pillText}`}
                  >
                    {NIVEAU_LABEL[r.niveau]}
                  </span>
                </div>
                <div className="col-span-2 text-xs text-gray-700">
                  {r.gesloten_op ? formatDatum(r.gesloten_op) : "—"}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
