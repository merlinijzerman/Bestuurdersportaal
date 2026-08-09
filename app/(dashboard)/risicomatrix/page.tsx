import Link from "next/link";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  CATEGORIEEN,
  CategorieSlug,
  NiveauSlug,
  TypeRisicoSlug,
  NIVEAU_KLEUREN,
  NIVEAU_LABEL,
  NIVEAU_OMSCHRIJVING,
  TYPE_LABEL,
} from "@/core/lib/risico-config";
// Besluit 0145 — de heatmap is klikbaar (schaling) en de zijpanelen zijn
// uitklapbaar; beide vragen state en leven daarom als client-component.
import Heatmap from "./_components/Heatmap";
import ZijpaneelBlok from "./_components/ZijpaneelBlok";

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
    <div className="p-4 sm:p-6 lg:p-7 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-ink text-xl font-bold">Risicomatrix</h1>
          <p className="text-muted text-sm mt-0.5">
            Actueel inzicht in de risico&apos;s van het fonds, gerangschikt op
            Kans &times; Impact en onderverdeeld in vier categorie&euml;n.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Besluit 0151 — instap naar de AI in de context van de hele risicomatrix
              (de enige risico-ingang). In de chat kan op één risico worden ingezoomd. */}
          <Link
            href="/ai?risicomatrix=1"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-accent bg-accent/5 rounded-lg hover:bg-accent/10 text-accent font-semibold"
          >
            <span aria-hidden>✨</span>
            Bespreek met de AI
          </Link>
          <Link
            href="/risicomatrix/archief"
            className="px-3 py-2 text-sm border border-line rounded-lg hover:border-accent text-ink"
          >
            Archief gesloten risico&apos;s
          </Link>
          <Link
            href="/risicomatrix/nieuw"
            className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent-ink"
          >
            + Nieuw risico
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-8 bg-white border border-line rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Kans &times; Impact heatmap
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Klik een cel aan om de risico&apos;s erin te tonen.
              </p>
            </div>
            <div className="text-xs text-muted">
              {lijst.length} actieve risico&apos;s
            </div>
          </div>
          <Heatmap risicos={lijst} />
        </div>

        <aside className="col-span-12 lg:col-span-4 space-y-3">
          {/* Legenda staat standaard DICHT: het is naslag die je één keer leest,
              maar die permanent ruimte innam naast de visual die je elke keer
              bekijkt. De verdeling staat open — dat zijn cijfers die je wél elke
              keer wilt zien. */}
          <ZijpaneelBlok titel="Legenda risiconiveau" samenvatting="Hoog · Middel · Laag">
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
                    <div className="text-xs text-muted leading-relaxed">
                      {NIVEAU_OMSCHRIJVING[n]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ZijpaneelBlok>

          <ZijpaneelBlok
            titel="Verdeling"
            standaardOpen
            samenvatting={`${tellers.hoog} hoog · ${tellers.middel} middel · ${tellers.laag} laag`}
          >
            <div className="space-y-2">
              {(["hoog", "middel", "laag"] as NiveauSlug[]).map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${NIVEAU_KLEUREN[n].dot}`}
                  />
                  <div className="flex-1 text-sm text-ink">
                    {NIVEAU_LABEL[n]}
                  </div>
                  <div className="text-sm font-semibold text-ink">
                    {tellers[n]}
                  </div>
                </div>
              ))}
              <hr className="my-2 border-line" />
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex-1">Structureel</span>
                <span>{tellers.structureel} van {lijst.length}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex-1">Tijdelijk</span>
                <span>{tellers.tijdelijk} van {lijst.length}</span>
              </div>
            </div>
          </ZijpaneelBlok>
        </aside>
      </div>

      <div className="space-y-5">
        {CATEGORIEEN.map((cat) => {
          const inCat = lijst.filter((r) => r.categorie === cat.slug);
          return (
            <section key={cat.slug}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
                  {cat.label}
                </h2>
                <span className="text-xs text-muted">
                  {inCat.length} {inCat.length === 1 ? "risico" : "risico's"}
                </span>
              </div>
              {inCat.length === 0 ? (
                <div className="bg-white border border-dashed border-line rounded-xl px-5 py-4 text-sm text-muted">
                  Nog geen risico&apos;s in deze categorie.
                </div>
              ) : (
                <div className="bg-white border border-line rounded-xl divide-y divide-line">
                  {inCat.map((r) => (
                    <Link
                      key={r.id}
                      href={`/risicomatrix/${r.id}`}
                      className="flex items-center gap-4 p-4 hover:bg-app-bg"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${NIVEAU_KLEUREN[r.niveau].dot}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-ink">
                            {r.titel}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-ink bg-accent-tint px-1.5 py-0.5 rounded">
                            {TYPE_LABEL[r.type_risico]}
                          </span>
                        </div>
                        {r.toelichting && (
                          <p className="text-xs text-muted mt-0.5 line-clamp-1">
                            {r.toelichting}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-muted flex-shrink-0">
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
