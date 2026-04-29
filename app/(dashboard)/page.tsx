import { createServerSupabase } from "@/lib/supabase-server";
import Link from "next/link";

// ============================================================
//  Demo-KPI's — zelfde cijfers als de Stuurinformatiepagina,
//  hier compact getoond als "snelle blik" op de homepage.
// ============================================================
const KPI = {
  financieringsgraad: { huidig: 102.4, deltaPP: 0.3 },
  solidariteitsreserve: { percentage: 2.4, target: 5.0 },
  vermogen: { mln: 98400, deltaYTDmln: 1700 },
  rendementYTD: { fonds: 6.8, benchmark: 6.4 },
};

const ROL_LABEL: Record<string, string> = {
  bestuurder: "bestuurslid",
  voorzitter: "voorzitter van het bestuur",
  beheerder: "beheerder",
};

function dagdeelGroet() {
  const u = new Date().getHours();
  if (u < 6) return "Goedenacht";
  if (u < 12) return "Goedemorgen";
  if (u < 18) return "Goedemiddag";
  return "Goedenavond";
}

function dagenTot(datum: string) {
  const d = new Date(datum).getTime();
  const nu = new Date().getTime();
  return Math.ceil((d - nu) / 86400000);
}

function formatDatum(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelatief(d: string) {
  const dt = new Date(d);
  const verschil = Date.now() - dt.getTime();
  const min = Math.floor(verschil / 60000);
  const uur = Math.floor(verschil / 3600000);
  const dag = Math.floor(verschil / 86400000);
  if (min < 1) return "zojuist";
  if (min < 60) return `${min} min geleden`;
  if (uur < 24) return `${uur} uur geleden`;
  if (dag === 1) return "gisteren";
  if (dag < 7) return `${dag} dagen geleden`;
  return dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function fmtMln(mln: number) {
  return mln >= 1000 ? `${(mln / 1000).toFixed(1).replace(".", ",")} mld` : `${mln.toLocaleString("nl-NL")} mln`;
}

interface Vergadering {
  id: string;
  titel: string;
  datum: string;
  locatie: string | null;
}

interface AgendapuntCount {
  id: string;
  titel: string;
}

interface LogItem {
  id: string;
  vraag: string;
  aangemaakt: string;
}

interface DocItem {
  id: string;
  titel: string;
  aangemaakt: string;
}

interface InbrengItem {
  id: string;
  tekst: string;
  aangemaakt: string;
  agendapunt_id: string;
}

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam, rol, fonds_id, fondsen(naam)")
    .eq("id", user.id)
    .single();

  const fondsenRel = profiel?.fondsen as
    | { naam: string }
    | { naam: string }[]
    | null
    | undefined;
  const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
  const fondsnaam = fondsenObj?.naam || process.env.NEXT_PUBLIC_FONDS_NAAM || "uw fonds";

  const voornaam = profiel?.naam?.split(" ")[0] || "";
  const rolLabel = ROL_LABEL[profiel?.rol || "bestuurder"] || "bestuurslid";

  const nu = new Date().toISOString();

  // Volgende vergadering
  const { data: volgendeVergaderingenRaw } = await supabase
    .from("vergaderingen")
    .select("id, titel, datum, locatie")
    .eq("fonds_id", profiel?.fonds_id || "")
    .gte("datum", nu)
    .order("datum", { ascending: true })
    .limit(1);

  const volgendeVergadering = (volgendeVergaderingenRaw?.[0] as Vergadering | undefined) || null;

  // Agendapunten in komende vergadering + mijn inbreng-status
  let agendapuntenZonderInbreng = 0;
  let totaalAgendapunten = 0;
  if (volgendeVergadering) {
    const { data: ap } = await supabase
      .from("agendapunten")
      .select("id, titel")
      .eq("vergadering_id", volgendeVergadering.id);
    const apList = (ap || []) as AgendapuntCount[];
    totaalAgendapunten = apList.length;

    if (apList.length > 0) {
      const { data: mijnInbreng } = await supabase
        .from("agendapunt_inbreng")
        .select("agendapunt_id")
        .eq("gebruiker_id", user.id)
        .in(
          "agendapunt_id",
          apList.map((a) => a.id)
        );
      const inbrengSet = new Set(
        (mijnInbreng || []).map((i: { agendapunt_id: string }) => i.agendapunt_id)
      );
      agendapuntenZonderInbreng = apList.filter((a) => !inbrengSet.has(a.id)).length;
    }
  }

  // Mijn recente activiteit
  const [{ data: recenteVragen }, { data: recenteInbreng }, { data: recenteDocs }] =
    await Promise.all([
      supabase
        .from("governance_log")
        .select("id, vraag, aangemaakt")
        .eq("gebruiker_id", user.id)
        .order("aangemaakt", { ascending: false })
        .limit(3),
      supabase
        .from("agendapunt_inbreng")
        .select("id, tekst, aangemaakt, agendapunt_id")
        .eq("gebruiker_id", user.id)
        .order("aangemaakt", { ascending: false })
        .limit(3),
      supabase
        .from("documenten")
        .select("id, titel, aangemaakt")
        .eq("opgeslagen_door", user.id)
        .order("aangemaakt", { ascending: false })
        .limit(3),
    ]);

  const vragen = (recenteVragen || []) as LogItem[];
  const inbreng = (recenteInbreng || []) as InbrengItem[];
  const docs = (recenteDocs || []) as DocItem[];

  const heeftActiviteit = vragen.length > 0 || inbreng.length > 0 || docs.length > 0;

  return (
    <div className="p-7 space-y-5">
      {/* Persoonlijke welkomst */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="text-[#0F2744] text-xl font-bold">
              {dagdeelGroet()}
              {voornaam ? ` ${voornaam}` : ""}, fijn u terug te zien.
            </div>
            <div className="text-sm text-gray-500 mt-1">
              U bent {rolLabel} van {fondsnaam}.
              {volgendeVergadering ? (
                <>
                  {" "}De volgende vergadering is{" "}
                  <Link
                    href={`/vergaderingen/${volgendeVergadering.id}`}
                    className="text-[#0F2744] font-medium hover:text-[#C9A84C]"
                  >
                    {volgendeVergadering.titel}
                  </Link>
                  , over {dagenTot(volgendeVergadering.datum)} dagen.
                </>
              ) : (
                <> Er staat geen volgende vergadering ingepland.</>
              )}
            </div>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-[#0F2744] border border-gray-200 px-3 py-1.5 rounded-lg hover:border-[#C9A84C] transition-colors"
          >
            Open volledige stuurinformatie →
          </Link>
        </div>
      </div>

      {/* Compacte KPI-strook */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Financieringsgraad"
          waarde={`${KPI.financieringsgraad.huidig.toFixed(1).replace(".", ",")}%`}
          extra={`+${KPI.financieringsgraad.deltaPP} pp t.o.v. Q4`}
          extraKleur="text-green-600"
        />
        <KpiCard
          label="Solidariteitsreserve"
          waarde={`${KPI.solidariteitsreserve.percentage.toFixed(1).replace(".", ",")}%`}
          extra={`target ${KPI.solidariteitsreserve.target.toFixed(0)}%`}
          extraKleur="text-gray-500"
        />
        <KpiCard
          label="Vermogen"
          waarde={`€ ${fmtMln(KPI.vermogen.mln)}`}
          extra={`+${(KPI.vermogen.deltaYTDmln / 1000).toFixed(1).replace(".", ",")} mld YTD`}
          extraKleur="text-green-600"
        />
        <KpiCard
          label="Rendement YTD"
          waarde={`+${KPI.rendementYTD.fonds.toFixed(1).replace(".", ",")}%`}
          extra={`benchmark +${KPI.rendementYTD.benchmark.toFixed(1).replace(".", ",")}%`}
          extraKleur="text-gray-500"
        />
      </div>

      {/* Voor u open + Mijn activiteit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Voor u open */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="font-semibold text-[#0F2744] text-sm mb-3">Voor u open</div>
          {volgendeVergadering ? (
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Komende vergadering</div>
                <Link
                  href={`/vergaderingen/${volgendeVergadering.id}`}
                  className="text-sm font-medium text-[#0F2744] hover:text-[#C9A84C]"
                >
                  {volgendeVergadering.titel}
                </Link>
                <div className="text-xs text-gray-500 mt-1">
                  {formatDatum(volgendeVergadering.datum)}
                  {volgendeVergadering.locatie ? ` · ${volgendeVergadering.locatie}` : ""}
                </div>
              </div>

              {totaalAgendapunten > 0 ? (
                <div className="flex items-start gap-2.5">
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      agendapuntenZonderInbreng > 0 ? "bg-amber-400" : "bg-green-500"
                    }`}
                  />
                  <div className="text-sm text-gray-700">
                    {agendapuntenZonderInbreng > 0 ? (
                      <>
                        Op{" "}
                        <span className="font-medium text-[#0F2744]">
                          {agendapuntenZonderInbreng}
                        </span>{" "}
                        van de {totaalAgendapunten} agendapunten heeft u nog geen
                        inbreng geplaatst.{" "}
                        <Link
                          href={`/vergaderingen/${volgendeVergadering.id}`}
                          className="text-[#0F2744] hover:text-[#C9A84C] font-medium"
                        >
                          Bekijken →
                        </Link>
                      </>
                    ) : (
                      <>U heeft op alle agendapunten al inbreng geplaatst — fijn voorbereid.</>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  <div className="text-sm text-gray-700">
                    Er zijn nog geen agendapunten toegevoegd.{" "}
                    <Link
                      href={`/vergaderingen/${volgendeVergadering.id}`}
                      className="text-[#0F2744] hover:text-[#C9A84C] font-medium"
                    >
                      Toevoegen →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              Geen openstaande vergaderingen.{" "}
              <Link
                href="/vergaderingen"
                className="text-[#0F2744] hover:text-[#C9A84C] font-medium"
              >
                Vergadering inplannen →
              </Link>
            </div>
          )}
        </div>

        {/* Mijn recente activiteit */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="font-semibold text-[#0F2744] text-sm mb-3">
            Uw recente activiteit
          </div>
          {!heeftActiviteit ? (
            <div className="text-sm text-gray-500">
              Hier verschijnen uw laatste vragen, inbreng en uploads zodra u ze gebruikt.
            </div>
          ) : (
            <div className="space-y-4">
              {vragen.length > 0 && (
                <RecentBlok titel="AI-vragen">
                  {vragen.map((v) => (
                    <RecentRij
                      key={v.id}
                      tekst={v.vraag}
                      tijd={formatRelatief(v.aangemaakt)}
                      href="/ai"
                    />
                  ))}
                </RecentBlok>
              )}
              {inbreng.length > 0 && (
                <RecentBlok titel="Geplaatste inbreng">
                  {inbreng.map((i) => (
                    <RecentRij
                      key={i.id}
                      tekst={i.tekst}
                      tijd={formatRelatief(i.aangemaakt)}
                    />
                  ))}
                </RecentBlok>
              )}
              {docs.length > 0 && (
                <RecentBlok titel="Geüploade documenten">
                  {docs.map((d) => (
                    <RecentRij
                      key={d.id}
                      tekst={d.titel}
                      tijd={formatRelatief(d.aangemaakt)}
                      href="/bibliotheek"
                    />
                  ))}
                </RecentBlok>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Governance traceability — slim onderaan */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 text-xs text-blue-800">
        <span className="text-base">ℹ️</span>
        <div className="flex-1">
          Alle AI-interacties worden gelogd in de{" "}
          <Link href="/governance" className="font-semibold hover:underline">
            Governance Log
          </Link>{" "}
          en zijn traceerbaar inclusief de gebruikte modus en bronvermeldingen.
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  waarde,
  extra,
  extraKleur,
}: {
  label: string;
  waarde: string;
  extra: string;
  extraKleur: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-[#0F2744] mt-1">{waarde}</div>
      <div className={`text-xs mt-1 ${extraKleur}`}>{extra}</div>
    </div>
  );
}

function RecentBlok({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
        {titel}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RecentRij({
  tekst,
  tijd,
  href,
}: {
  tekst: string;
  tijd: string;
  href?: string;
}) {
  const inhoud = (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-sm text-gray-700 truncate">
        {tekst.length > 70 ? `${tekst.substring(0, 70)}…` : tekst}
      </span>
      <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{tijd}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:text-[#C9A84C] transition-colors">
      {inhoud}
    </Link>
  ) : (
    <div>{inhoud}</div>
  );
}
