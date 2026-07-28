import { createServerSupabase } from "@/core/lib/supabase-server";
import { getPortaalContext } from "@/core/lib/portaalcontext";
import { redirect } from "next/navigation";
import Link from "next/link";
import NotificatiesBlok from "./_components/NotificatiesBlok";
import type { NotificatieType } from "@/core/lib/notifications";

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

interface NotifRow {
  id: string;
  type: NotificatieType;
  payload: Record<string, unknown>;
  gerelateerd_aan_type: string | null;
  gerelateerd_aan_id: string | null;
  aangemaakt: string;
  gelezen_op: string | null;
}

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Consistent met de layout-guard: geen geldige sessie -> naar login
  // (in plaats van een blanco render). Voorkomt verdere null-toegang.
  if (!user) redirect("/login");

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

  // Gedeelde portaalcontext (besluit 0085): dezelfde bron als het AI-startpunt.
  // We geven de reeds-opgehaalde sessie door zodat er geen extra profiel-query
  // ontstaat; React.cache() dedupliceert de afleiding binnen deze render.
  const ctx = await getPortaalContext({
    userId: user.id,
    fondsId: profiel?.fonds_id || "",
    gebruikerNaam: profiel?.naam ?? null,
  });
  const volgendeVergadering = ctx.volgendeVergadering;
  const totaalAgendapunten = ctx.agendapunten.totaal;
  const agendapuntenZonderInbreng = ctx.agendapunten.zonderEigenInbreng;

  // Mijn recente activiteit + meldingen (iteratie 3-A)
  // We laden alle 4 streams parallel zodat de homepage zo snel mogelijk
  // rendert. Notificaties worden gecombineerd: ongelezen eerst, daarna
  // recent gelezen — top 5 totaal om het blok compact te houden.
  const [
    { data: recenteVragen },
    { data: recenteInbreng },
    { data: recenteDocs },
    { data: recenteNotificaties },
  ] = await Promise.all([
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
    // Notificaties: ongelezen + recent gelezen, totaal max 5 in homepage-blok.
    // De volledige paginatie loopt via /api/notificaties.
    supabase
      .from("notificaties")
      .select(
        "id, type, payload, gerelateerd_aan_type, gerelateerd_aan_id, aangemaakt, gelezen_op"
      )
      .order("gelezen_op", { ascending: true, nullsFirst: true }) // ongelezen eerst
      .order("aangemaakt", { ascending: false })
      .limit(5),
  ]);

  const vragen = (recenteVragen || []) as LogItem[];
  const inbreng = (recenteInbreng || []) as InbrengItem[];
  const docs = (recenteDocs || []) as DocItem[];
  const notificaties = (recenteNotificaties || []) as NotifRow[];

  const heeftActiviteit =
    vragen.length > 0 ||
    inbreng.length > 0 ||
    docs.length > 0 ||
    notificaties.length > 0;

  // Mijn open procedure-stappen (waar ik co-eigenaar ben) — uit de gedeelde
  // portaalcontext (besluit 0085); zelfde query, volgorde en limiet als voorheen.
  const openStappen = ctx.openStappen;

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-5">
      {/* Persoonlijke welkomst */}
      <div className="bg-white border border-line rounded-xl p-5">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="font-serif text-ink text-xl font-bold">
              {dagdeelGroet()}
              {voornaam ? ` ${voornaam}` : ""}, fijn u terug te zien.
            </div>
            <div className="text-sm text-muted mt-1">
              U bent {rolLabel} van {fondsnaam}.
              {volgendeVergadering ? (
                <>
                  {" "}De volgende vergadering is{" "}
                  <Link
                    href={`/vergaderingen/${volgendeVergadering.id}`}
                    className="text-ink font-medium hover:text-accent"
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
            className="text-xs text-ink border border-line px-3 py-1.5 rounded-lg hover:border-accent transition-colors"
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
          extraKleur="text-ok-ink"
        />
        <KpiCard
          label="Solidariteitsreserve"
          waarde={`${KPI.solidariteitsreserve.percentage.toFixed(1).replace(".", ",")}%`}
          extra={`target ${KPI.solidariteitsreserve.target.toFixed(0)}%`}
          extraKleur="text-muted"
        />
        <KpiCard
          label="Vermogen"
          waarde={`€ ${fmtMln(KPI.vermogen.mln)}`}
          extra={`+${(KPI.vermogen.deltaYTDmln / 1000).toFixed(1).replace(".", ",")} mld YTD`}
          extraKleur="text-ok-ink"
        />
        <KpiCard
          label="Rendement YTD"
          waarde={`+${KPI.rendementYTD.fonds.toFixed(1).replace(".", ",")}%`}
          extra={`benchmark +${KPI.rendementYTD.benchmark.toFixed(1).replace(".", ",")}%`}
          extraKleur="text-muted"
        />
      </div>

      {/* Mijn open procedure-stappen */}
      {openStappen.length > 0 && (
        <div className="bg-white border border-line rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="font-semibold text-ink text-sm">
              Uw open procedure-stappen
            </div>
            <Link
              href="/procedures"
              className="text-xs text-ink hover:text-accent"
            >
              Alle procedures →
            </Link>
          </div>
          <div className="space-y-2">
            {openStappen.map((s) => {
              const dagen = s.deadline
                ? Math.ceil(
                    (new Date(s.deadline).getTime() - Date.now()) / 86400000
                  )
                : null;
              const dringend = dagen !== null && dagen <= 7;
              return (
                <Link
                  key={s.id}
                  href={`/procedures/${s.procedure_id}`}
                  className="flex items-center gap-3 p-3 border border-line rounded-lg hover:border-accent"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      dringend ? "bg-warn" : "bg-accent"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {s.naam}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {s.procedure_titel}
                    </div>
                  </div>
                  {s.deadline && (
                    <div
                      className={`text-xs flex-shrink-0 ${
                        dringend ? "text-warn-ink font-medium" : "text-muted"
                      }`}
                    >
                      {dagen !== null && dagen < 0
                        ? `${Math.abs(dagen)} dgn over`
                        : dagen !== null && dagen === 0
                          ? "Vandaag"
                          : dagen !== null
                            ? `Nog ${dagen} dgn`
                            : ""}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Voor u open + Mijn activiteit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Voor u open */}
        <div className="bg-white border border-line rounded-xl p-5">
          <div className="font-semibold text-ink text-sm mb-3">Voor u open</div>
          {volgendeVergadering ? (
            <div className="space-y-3">
              <div className="bg-app-bg rounded-lg p-3">
                <div className="text-xs text-muted mb-1">Komende vergadering</div>
                <Link
                  href={`/vergaderingen/${volgendeVergadering.id}`}
                  className="text-sm font-medium text-ink hover:text-accent"
                >
                  {volgendeVergadering.titel}
                </Link>
                <div className="text-xs text-muted mt-1">
                  {formatDatum(volgendeVergadering.datum)}
                  {volgendeVergadering.locatie ? ` · ${volgendeVergadering.locatie}` : ""}
                </div>
              </div>

              {totaalAgendapunten > 0 ? (
                <div className="flex items-start gap-2.5">
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      agendapuntenZonderInbreng > 0 ? "bg-warn" : "bg-ok"
                    }`}
                  />
                  <div className="text-sm text-ink">
                    {agendapuntenZonderInbreng > 0 ? (
                      <>
                        Op{" "}
                        <span className="font-medium text-ink">
                          {agendapuntenZonderInbreng}
                        </span>{" "}
                        van de {totaalAgendapunten} agendapunten heeft u nog geen
                        inbreng geplaatst.{" "}
                        <Link
                          href={`/vergaderingen/${volgendeVergadering.id}`}
                          className="text-ink hover:text-accent font-medium"
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
                  <span className="w-2 h-2 rounded-full bg-app-line mt-1.5 flex-shrink-0" />
                  <div className="text-sm text-ink">
                    Er zijn nog geen agendapunten toegevoegd.{" "}
                    <Link
                      href={`/vergaderingen/${volgendeVergadering.id}`}
                      className="text-ink hover:text-accent font-medium"
                    >
                      Toevoegen →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted">
              Geen openstaande vergaderingen.{" "}
              <Link
                href="/vergaderingen"
                className="text-ink hover:text-accent font-medium"
              >
                Vergadering inplannen →
              </Link>
            </div>
          )}
        </div>

        {/* Mijn recente activiteit */}
        <div className="bg-white border border-line rounded-xl p-5">
          <div className="font-semibold text-ink text-sm mb-3">
            Uw recente activiteit
          </div>
          {!heeftActiviteit ? (
            <div className="text-sm text-muted">
              Hier verschijnen uw meldingen, laatste vragen, inbreng en uploads zodra u ze ontvangt of gebruikt.
            </div>
          ) : (
            <div className="space-y-4">
              {notificaties.length > 0 && (
                <NotificatiesBlok initieelNotificaties={notificaties} />
              )}
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
      <div className="bg-accent-tint border border-accent/30 rounded-xl p-4 flex items-center gap-3 text-xs text-accent-ink">
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
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-bold text-ink mt-1">{waarde}</div>
      <div className={`text-xs mt-1 ${extraKleur}`}>{extra}</div>
    </div>
  );
}

function RecentBlok({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
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
      <span className="text-sm text-ink truncate">
        {tekst.length > 70 ? `${tekst.substring(0, 70)}…` : tekst}
      </span>
      <span className="text-[11px] text-muted whitespace-nowrap flex-shrink-0">{tijd}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:text-accent transition-colors">
      {inhoud}
    </Link>
  ) : (
    <div>{inhoud}</div>
  );
}
