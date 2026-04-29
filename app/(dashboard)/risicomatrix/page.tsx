import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  CATEGORIEEN,
  CategorieSlug,
  NiveauSlug,
  TypeRisicoSlug,
  NIVEAU_KLEUREN,
  NIVEAU_LABEL,
  NIVEAU_OMSCHRIJVING,
  TYPE_LABEL,
} from "@/lib/risico-config";

interface RisicoRij {
  id: string;
  categorie: CategorieSlug;
  titel: string;
  toelichting: string | null;
  kans: number;
  impact: number;
  niveau: NiveauSlug;
  type_risico: TypeRisicoSlug;
  status: "actief" | "gesloten";
  eigenaar_naam: string | null;
}

export default async function RisicomatrixPage() {
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
    .select(
      "id, categorie, titel, toelichting, kans, impact, niveau, type_risico, status, eigenaar_naam"
    )
    .eq("fonds_id", profiel?.fonds_id || "")
    .eq("status", "actief")
    .order("aangemaakt", { ascending: false });

  const lijst = (risicos || []) as RisicoRij[];

  const tellers = {
    hoog: lijst.filter((r) => r.niveau === "hoog").length,
    middel: lijst.filter((r) => r.niveau === "middel").length,
    laag: lijst.filter((r) => r.niveau === "laag").length,
    structureel: lijst.filter((r) => r.type_risico === "structureel").length,
    tijdelijk: lijst.filter((r) => r.type_risico === "tijdelijk").length,
  };

  return (
    <div className="p-7 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[#0F2744] text-xl font-bold">Risicomatrix</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Actueel inzicht in de risico&apos;s van het fonds, gerangschikt op
            Kans &times; Impact en onderverdeeld in vier categorie&euml;n.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/risicomatrix/archief"
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-[#0F2744] text-gray-700"
          >
            Archief gesloten risico&apos;s
          </Link>
          <Link
            href="/risicomatrix/nieuw"
            className="bg-[#0F2744] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#1a3858]"
          >
            + Nieuw risico
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-8 bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-[#0F2744]">
                Kans &times; Impact heatmap
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Klik een risico-pil aan voor details.
              </p>
            </div>
            <div className="text-xs text-gray-500">
              {lijst.length} actieve risico&apos;s
            </div>
          </div>
          <Heatmap risicos={lijst} />
        </div>

        <aside className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
              Legenda risiconiveau
            </h3>
            <div className="space-y-3">
              {(["hoog", "middel", "laag"] as NiveauSlug[]).map((n) => (
                <div key={n} className="flex items-start gap-3">
                  <div
                    className={`w-4 h-4 rounded mt-0.5 flex-shrink-0 ${NIVEAU_KLEUREN[n].dot}`}
                  />
                  <div>
                    <div
                      className={`text-sm font-semibold ${NIVEAU_KLEUREN[n].pillText}`}
                    >
                      {NIVEAU_LABEL[n]}
                    </div>
                    <div className="text-xs text-gray-600 leading-relaxed">
                      {NIVEAU_OMSCHRIJVING[n]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
              Verdeling
            </h3>
            <div className="space-y-2">
              {(["hoog", "middel", "laag"] as NiveauSlug[]).map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${NIVEAU_KLEUREN[n].dot}`}
                  />
                  <div className="flex-1 text-sm text-gray-700">
                    {NIVEAU_LABEL[n]}
                  </div>
                  <div className="text-sm font-semibold text-[#0F2744]">
                    {tellers[n]}
                  </div>
                </div>
              ))}
              <hr className="my-2 border-gray-100" />
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex-1">Structureel</span>
                <span>{tellers.structureel} van {lijst.length}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex-1">Tijdelijk</span>
                <span>{tellers.tijdelijk} van {lijst.length}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="space-y-5">
        {CATEGORIEEN.map((cat) => {
          const inCat = lijst.filter((r) => r.categorie === cat.slug);
          return (
            <section key={cat.slug}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-[#0F2744] uppercase tracking-wide">
                  {cat.label}
                </h2>
                <span className="text-xs text-gray-500">
                  {inCat.length} {inCat.length === 1 ? "risico" : "risico's"}
                </span>
              </div>
              {inCat.length === 0 ? (
                <div className="bg-white border border-dashed border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-400">
                  Nog geen risico&apos;s in deze categorie.
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                  {inCat.map((r) => (
                    <Link
                      key={r.id}
                      href={`/risicomatrix/${r.id}`}
                      className="flex items-center gap-4 p-4 hover:bg-gray-50"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${NIVEAU_KLEUREN[r.niveau].dot}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-[#0F2744]">
                            {r.titel}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-[#0F2744] bg-blue-50 px-1.5 py-0.5 rounded">
                            {TYPE_LABEL[r.type_risico]}
                          </span>
                        </div>
                        {r.toelichting && (
                          <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">
                            {r.toelichting}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 flex-shrink-0">
                        K{r.kans} &middot; I{r.impact}
                      </div>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded ${NIVEAU_KLEUREN[r.niveau].pillBg} ${NIVEAU_KLEUREN[r.niveau].pillText}`}
                      >
                        {NIVEAU_LABEL[r.niveau]}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// Heatmap component — Server Component, geen state nodig
function Heatmap({ risicos }: { risicos: RisicoRij[] }) {
  // Bouw cellen-matrix [impact][kans] = risicos[]
  const cellen: RisicoRij[][][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => [])
  );
  for (const r of risicos) {
    const i = Math.min(Math.max(r.impact, 1), 5) - 1;
    const k = Math.min(Math.max(r.kans, 1), 5) - 1;
    cellen[i][k].push(r);
  }

  // Niveau per cel afgeleid op basis van som
  function celNiveau(k: number, i: number): NiveauSlug {
    const sum = k + i + 2; // k en i zijn 0-based hier
    if (sum <= 4) return "laag";
    if (sum <= 7) return "middel";
    return "hoog";
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-[60px_repeat(5,1fr)] gap-1.5">
        <div />
        {[1, 2, 3, 4, 5].map((k) => (
          <div
            key={`hdr-${k}`}
            className="text-[10px] uppercase tracking-wide text-gray-400 text-center pb-1 font-semibold"
          >
            K{k}
          </div>
        ))}
        {[5, 4, 3, 2, 1].map((iLabel) => {
          const iIdx = iLabel - 1; // index in cellen array
          return (
            <div className="contents" key={`row-${iLabel}`}>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 text-right pr-2 self-center font-semibold">
                I{iLabel}
              </div>
              {[0, 1, 2, 3, 4].map((kIdx) => {
                const niveau = celNiveau(kIdx, iIdx);
                const items = cellen[iIdx][kIdx];
                return (
                  <div
                    key={`cell-${iLabel}-${kIdx + 1}`}
                    className={`rounded h-20 p-1.5 border ${NIVEAU_KLEUREN[niveau].cellBg} ${NIVEAU_KLEUREN[niveau].cellBorder} space-y-1 overflow-hidden`}
                  >
                    {items.slice(0, 2).map((r) => (
                      <Link
                        key={r.id}
                        href={`/risicomatrix/${r.id}`}
                        className={`block text-[10px] font-medium px-1.5 py-1 rounded leading-tight truncate ${
                          niveau === "hoog"
                            ? "bg-red-200 text-red-900 hover:bg-red-300"
                            : niveau === "middel"
                              ? "bg-amber-200 text-amber-900 hover:bg-amber-300"
                              : "bg-emerald-200 text-emerald-900 hover:bg-emerald-300"
                        }`}
                        title={r.titel}
                      >
                        {r.titel}
                      </Link>
                    ))}
                    {items.length > 2 && (
                      <div className="text-[10px] text-gray-600 px-1.5">
                        + {items.length - 2} meer
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="text-center text-[10px] uppercase tracking-widest text-gray-400 font-semibold mt-3">
        Kans →
      </div>
    </div>
  );
}

