import { createServerSupabase } from "@/lib/supabase-server";

// ============================================================
//  DEMO-DATA — Wtp-stuurinformatie
//  Later vervangen door echte data uit Supabase of de uitvoerder.
// ============================================================
const FONDS_DATUM = "31 maart 2026";

const KPI = {
  financieringsgraad: { huidig: 102.4, deltaPP: 0.3 },
  solidariteitsreserve: { percentage: 2.4, target: 5.0, deltaMln: 260 },
  vermogen: { mln: 98400, deltaYTDmln: 1700 },
  rendementYTD: { fonds: 6.8, benchmark: 6.4 },
};

// 24 maanden financieringsgraad (oudste -> nieuwste)
const TREND_FG = [
  99.1, 99.4, 99.7, 100.0, 100.3, 100.5, 100.7, 100.9, 101.0, 101.2,
  101.4, 101.5, 101.6, 101.8, 102.0, 102.1, 102.2, 102.0, 102.1, 102.2,
  102.3, 102.4, 102.3, 102.4,
];
const TREND_LABELS = [
  "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec", "jan", "feb",
  "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec",
  "jan", "feb", "mrt", "apr",
];

const ACTIVA = {
  bescherming: [
    { naam: "Staatsobligaties", mln: 27620, deltaPct: 0.8 },
    { naam: "Bedrijfsobligaties", mln: 12840, deltaPct: 1.2 },
    { naam: "Hypotheken", mln: 4510, deltaPct: 0.1 },
    { naam: "Rentederivaten", mln: 4230, deltaPct: -2.3 },
  ],
  overrendement: [
    { naam: "Aandelen ontwikkeld", mln: 19420, deltaPct: 5.4 },
    { naam: "Aandelen opkomend", mln: 9180, deltaPct: 3.1 },
    { naam: "Vastgoed", mln: 8870, deltaPct: -0.7 },
    { naam: "Alternatieven", mln: 8560, deltaPct: 2.8 },
  ],
  liquide: [
    { naam: "Liquide middelen", mln: 2490, deltaPct: 0 },
    { naam: "Vorderingen", mln: 680, deltaPct: 0 },
  ],
};

const PASSIVA = {
  persoonlijkePensioenvermogens: [
    { naam: "Cohort < 35 jaar", mln: 18700, rendementPct: 8.2 },
    { naam: "Cohort 35–55", mln: 37400, rendementPct: 5.9 },
    { naam: "Cohort 55–67", mln: 20500, rendementPct: 3.4 },
    { naam: "Uitkeringsfase 67+", mln: 17100, rendementPct: 1.8 },
  ],
  solidariteitsreserve: { mln: 2400, deltaMln: 260 },
  overigeVerplichtingen: [
    { naam: "Compensatiedepot", mln: 1620, deltaMln: -220 },
    { naam: "Operationele reserve", mln: 680, deltaMln: 0 },
  ],
};

const DEELNEMERS = {
  totaal: 1210300,
  nettoDelta: 1840,
  verdeling: [
    { status: "Actief", aantal: 462180, delta: 820, kleur: "#185FA5" },
    { status: "Slaper", aantal: 389640, delta: 120, kleur: "#85B7EB" },
    { status: "Arbeidsongeschikt", aantal: 19350, delta: -30, kleur: "#BA7517" },
    { status: "Pensioengerechtigd", aantal: 331860, delta: 960, kleur: "#1D9E75" },
    { status: "Nabestaande / wees", aantal: 7270, delta: -30, kleur: "#888780" },
  ],
  mutaties: { instroom: 4130, uitstroom: 2290, pensioneringen: 1120 },
};

const SIGNALERINGEN = [
  {
    kleur: "amber",
    titel: "Solidariteitsreserve onder bandbreedte",
    sub: "2,4% — afspraak 5%; aanvullingstempo conform plan",
  },
  {
    kleur: "blue",
    titel: "DNB-rapportage Q1 deadline 30 april",
    sub: "Voortgang ABTN-update: 70%",
  },
  {
    kleur: "green",
    titel: "Toedelingsregels-toetsing waarmerkend actuaris",
    sub: "Afgerond — geen bevindingen",
  },
];

const VERGADERINGEN = [
  { categorie: "Bestuur", titel: "Bestuursvergadering Q2 — agendaconcept", datum: "15 mei", kleur: "blue" },
  { categorie: "Beleg.com.", titel: "Herijking beschermingsrendement-toedeling", datum: "8 mei", kleur: "amber" },
  { categorie: "Risico", titel: "Update IRM-overzicht voor mei-vergadering", datum: "12 mei", kleur: "blue" },
];

// ============================================================
//  Helpers
// ============================================================
const fmt = (n: number) => n.toLocaleString("nl-NL");
const fmtMln = (mln: number) =>
  mln >= 1000 ? `${(mln / 1000).toFixed(1).replace(".", ",")} mld` : `${fmt(mln)} mln`;

const totaalActiva =
  ACTIVA.bescherming.reduce((s, r) => s + r.mln, 0) +
  ACTIVA.overrendement.reduce((s, r) => s + r.mln, 0) +
  ACTIVA.liquide.reduce((s, r) => s + r.mln, 0);

const totaalPersoonlijk = PASSIVA.persoonlijkePensioenvermogens.reduce((s, r) => s + r.mln, 0);
const totaalOverig = PASSIVA.overigeVerplichtingen.reduce((s, r) => s + r.mln, 0);
const totaalPassiva = totaalPersoonlijk + PASSIVA.solidariteitsreserve.mln + totaalOverig;

// SVG-pad voor de trendgrafiek
function buildPath(values: number[], w: number, h: number, yMin: number, yMax: number) {
  const stepX = w / (values.length - 1);
  const range = yMax - yMin;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - yMin) / range) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

// ============================================================
//  Pagina
// ============================================================
export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam")
    .eq("id", user!.id)
    .single();

  const naam = profiel?.naam?.split(" ")[0] || "Bestuurder";

  // Kleine governance-stats voor onderaan
  const [{ count: aantalDocs }, { count: aantalLogs }] = await Promise.all([
    supabase.from("documenten").select("*", { count: "exact", head: true }),
    supabase.from("governance_log").select("*", { count: "exact", head: true }),
  ]);

  const trendW = 700;
  const trendH = 180;
  const yMin = 96;
  const yMax = 105;
  const fgPath = buildPath(TREND_FG, trendW, trendH, yMin, yMax);
  const targetPath = buildPath(Array(TREND_FG.length).fill(100), trendW, trendH, yMin, yMax);

  return (
    <div className="p-7 space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="text-[#0F2744] text-xl font-bold">
            Welkom terug, {naam}
          </div>
          <div className="text-gray-500 text-sm mt-0.5">
            Stuurinformatie · per {FONDS_DATUM}
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-gray-400 bg-gray-100 px-2 py-1 rounded-md">
          Demo-data
        </span>
      </div>

      {/* KPI tegels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Financieringsgraad</div>
          <div className="text-2xl font-bold text-[#0F2744] mt-1">
            {KPI.financieringsgraad.huidig.toFixed(1).replace(".", ",")}%
          </div>
          <div className="text-xs text-green-600 mt-1">
            +{KPI.financieringsgraad.deltaPP} pp t.o.v. Q4
          </div>
        </div>
        {(() => {
          const aanpassingPct = (KPI.financieringsgraad.huidig - 100) / 5;
          const teken = aanpassingPct >= 0 ? "+" : "−";
          const absStr = Math.abs(aanpassingPct).toFixed(1).replace(".", ",");
          const kleur = aanpassingPct >= 0 ? "text-green-600" : "text-red-600";
          return (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs text-gray-500">
                Jaarlijkse aanpassing uitkeringen
              </div>
              <div className={`text-2xl font-bold mt-1 ${kleur}`}>
                {teken}
                {absStr}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                indicatie volgend jaar · 1/5 × (FG − 100%)
              </div>
            </div>
          );
        })()}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Solidariteitsreserve</div>
          <div className="text-2xl font-bold text-[#0F2744] mt-1">
            {KPI.solidariteitsreserve.percentage.toFixed(1).replace(".", ",")}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            target {KPI.solidariteitsreserve.target.toFixed(0)}% · opbouw
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Vermogen</div>
          <div className="text-2xl font-bold text-[#0F2744] mt-1">
            € {fmtMln(KPI.vermogen.mln)}
          </div>
          <div className="text-xs text-green-600 mt-1">
            +{(KPI.vermogen.deltaYTDmln / 1000).toFixed(1).replace(".", ",")} mld YTD
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500">Rendement YTD</div>
          <div className="text-2xl font-bold text-[#0F2744] mt-1">
            +{KPI.rendementYTD.fonds.toFixed(1).replace(".", ",")}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            benchmark +{KPI.rendementYTD.benchmark.toFixed(1).replace(".", ",")}%
          </div>
        </div>
      </div>

      {/* Trend financieringsgraad */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div className="font-semibold text-[#0F2744] text-sm">
            Financieringsgraad — 24 maanden
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#185FA5" }}></span>
              Financieringsgraad
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5" style={{ background: "#BA7517" }}></span>
              Doel 100%
            </span>
          </div>
        </div>
        <svg viewBox={`0 0 ${trendW} ${trendH + 24}`} className="w-full h-auto">
          {[97, 99, 101, 103, 105].map((y) => {
            const yPos = trendH - ((y - yMin) / (yMax - yMin)) * trendH;
            return (
              <g key={y}>
                <line
                  x1={0}
                  x2={trendW}
                  y1={yPos}
                  y2={yPos}
                  stroke="#E5E7EB"
                  strokeWidth={0.5}
                />
                <text x={4} y={yPos - 2} fontSize={10} fill="#9CA3AF">
                  {y}%
                </text>
              </g>
            );
          })}
          <path d={targetPath} stroke="#BA7517" strokeWidth={1.5} strokeDasharray="4,4" fill="none" />
          <path d={fgPath} stroke="#185FA5" strokeWidth={2} fill="none" />
          {TREND_LABELS.map((label, i) => {
            if (i % 4 !== 0) return null;
            const x = (trendW / (TREND_LABELS.length - 1)) * i;
            return (
              <text key={i} x={x} y={trendH + 16} fontSize={10} fill="#9CA3AF" textAnchor="middle">
                {label}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Balans */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-semibold text-[#0F2744] text-sm">Balans · Wtp-regeling</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Solidaire premieregeling · bedragen in € mln
            </div>
          </div>
          <div className="text-xs text-gray-400">vs Q4 2025</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activa */}
          <div>
            <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-gray-200">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Activa
              </span>
              <span className="text-lg font-semibold text-[#0F2744]">
                {fmt(totaalActiva)}
              </span>
            </div>

            <BalansGroep titel="Beschermingsportefeuille" rijen={ACTIVA.bescherming} />
            <BalansGroep titel="Overrendementsportefeuille" rijen={ACTIVA.overrendement} />
            <BalansGroep titel="Liquide" rijen={ACTIVA.liquide} />
          </div>

          {/* Passiva */}
          <div>
            <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-gray-200">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Passiva
              </span>
              <span className="text-lg font-semibold text-[#0F2744]">
                {fmt(totaalPassiva)}
              </span>
            </div>

            <div className="text-xs font-medium text-gray-500 mb-2 mt-1">
              Persoonlijke pensioenvermogens
            </div>
            <div className="space-y-1.5 text-sm">
              {PASSIVA.persoonlijkePensioenvermogens.map((r) => (
                <div key={r.naam} className="flex justify-between">
                  <span className="text-gray-700">{r.naam}</span>
                  <span className="inline-flex gap-2 items-baseline">
                    <span className="tabular-nums">{fmt(r.mln)}</span>
                    <span className="text-[11px] text-green-600 min-w-[40px] text-right">
                      +{r.rendementPct.toFixed(1).replace(".", ",")}%
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <div className="text-xs font-medium text-gray-500 mb-2 mt-4">
              Solidariteitsreserve
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-700">Beschikbaar saldo</span>
                <span className="inline-flex gap-2 items-baseline">
                  <span className="tabular-nums">{fmt(PASSIVA.solidariteitsreserve.mln)}</span>
                  <span className="text-[11px] text-green-600 min-w-[40px] text-right">
                    +{PASSIVA.solidariteitsreserve.deltaMln}
                  </span>
                </span>
              </div>
            </div>

            <div className="text-xs font-medium text-gray-500 mb-2 mt-4">
              Overige verplichtingen
            </div>
            <div className="space-y-1.5 text-sm">
              {PASSIVA.overigeVerplichtingen.map((r) => (
                <div key={r.naam} className="flex justify-between">
                  <span className="text-gray-700">{r.naam}</span>
                  <span className="inline-flex gap-2 items-baseline">
                    <span className="tabular-nums">{fmt(r.mln)}</span>
                    <span
                      className={`text-[11px] min-w-[40px] text-right ${
                        r.deltaMln < 0
                          ? "text-red-600"
                          : r.deltaMln > 0
                          ? "text-green-600"
                          : "text-gray-400"
                      }`}
                    >
                      {r.deltaMln === 0 ? "—" : r.deltaMln > 0 ? `+${r.deltaMln}` : r.deltaMln}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-gray-50 rounded-md px-3 py-2.5 mt-5">
              <div className="text-[11px] text-gray-500">
                Financieringsgraad (vermogen ÷ verplichtingen)
              </div>
              <div className="text-base font-semibold text-[#0F2744] mt-0.5">
                {KPI.financieringsgraad.huidig.toFixed(1).replace(".", ",")}%
                <span className="text-xs text-green-600 font-normal ml-2">
                  surplus → solidariteitsreserve
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Cohortverdeling onderaan */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="text-xs font-medium text-gray-500 mb-2">
            Verdeling persoonlijke pensioenvermogens per cohort
          </div>
          <div className="flex gap-1 h-5 rounded-md overflow-hidden">
            {PASSIVA.persoonlijkePensioenvermogens.map((c, idx) => {
              const pct = (c.mln / totaalPersoonlijk) * 100;
              const kleuren = ["#534AB7", "#185FA5", "#1D9E75", "#888780"];
              return (
                <div
                  key={c.naam}
                  className="flex items-center justify-center text-white text-[11px]"
                  style={{ width: `${pct}%`, background: kleuren[idx] }}
                >
                  {Math.round(pct)}%
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-gray-400 mt-1.5">
            Toedelingsregels per cohort sturen verdeling van bescherming- en overrendement.
          </div>
        </div>
      </div>

      {/* Deelnemers + Signaleringen */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Deelnemers */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-semibold text-[#0F2744] text-sm">Deelnemers naar status</div>
            <span className="text-xs text-gray-400">vs Q4 2025</span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-xl font-bold text-[#0F2744]">
              {fmt(DEELNEMERS.totaal)}
            </span>
            <span className="text-xs text-gray-500">totaal</span>
            <span className="text-xs text-green-600 ml-2">
              +{fmt(DEELNEMERS.nettoDelta)} netto
            </span>
          </div>
          <div className="flex gap-0.5 h-3 rounded-md overflow-hidden mb-3">
            {DEELNEMERS.verdeling.map((d) => {
              const pct = (d.aantal / DEELNEMERS.totaal) * 100;
              return (
                <div
                  key={d.status}
                  style={{ width: `${pct}%`, background: d.kleur }}
                  title={`${d.status} ${pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div className="space-y-1 text-sm">
            {DEELNEMERS.verdeling.map((d) => (
              <div key={d.status} className="flex justify-between items-center">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: d.kleur }}
                  />
                  <span className="text-gray-700">{d.status}</span>
                </span>
                <span className="inline-flex gap-2 items-baseline">
                  <span className="tabular-nums">{fmt(d.aantal)}</span>
                  <span
                    className={`text-[11px] min-w-[40px] text-right ${
                      d.delta > 0
                        ? "text-green-600"
                        : d.delta < 0
                        ? "text-red-600"
                        : "text-gray-400"
                    }`}
                  >
                    {d.delta > 0 ? `+${d.delta}` : d.delta}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-gray-200">
            <div>
              <div className="text-[11px] text-gray-500">Instroom Q1</div>
              <div className="text-sm font-semibold text-[#0F2744] mt-0.5">
                +{fmt(DEELNEMERS.mutaties.instroom)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Uitstroom Q1</div>
              <div className="text-sm font-semibold text-[#0F2744] mt-0.5">
                −{fmt(DEELNEMERS.mutaties.uitstroom)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Pensioneringen Q1</div>
              <div className="text-sm font-semibold text-[#0F2744] mt-0.5">
                {fmt(DEELNEMERS.mutaties.pensioneringen)}
              </div>
            </div>
          </div>
        </div>

        {/* Signaleringen */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="font-semibold text-[#0F2744] text-sm mb-3">Signaleringen</div>
          <ul className="space-y-3">
            {SIGNALERINGEN.map((s, i) => (
              <li key={i} className="flex gap-2.5 items-start">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                    s.kleur === "amber"
                      ? "bg-amber-400"
                      : s.kleur === "green"
                      ? "bg-green-500"
                      : "bg-blue-500"
                  }`}
                />
                <div>
                  <div className="text-sm font-semibold text-[#0F2744]">{s.titel}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.sub}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Vergaderingen / acties */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="font-semibold text-[#0F2744] text-sm">
            Openstaande acties &amp; vergaderingen
          </div>
          <span className="text-xs text-gray-400">{VERGADERINGEN.length} lopend</span>
        </div>
        <div className="space-y-2.5">
          {VERGADERINGEN.map((v, i) => (
            <div key={i} className="flex justify-between items-center gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-md whitespace-nowrap ${
                    v.kleur === "amber"
                      ? "bg-amber-50 text-amber-800"
                      : "bg-blue-50 text-blue-800"
                  }`}
                >
                  {v.categorie}
                </span>
                <span className="text-sm text-gray-700 truncate">{v.titel}</span>
              </div>
              <span className="text-xs text-gray-500 whitespace-nowrap">{v.datum}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Governance traceability — kleinere voet */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 text-xs text-blue-800">
        <span className="text-base">ℹ️</span>
        <div className="flex-1">
          <strong>{aantalDocs ?? 0}</strong> bron-documenten beschikbaar ·{" "}
          <strong>{aantalLogs ?? 0}</strong> AI-vragen gelogd · alle interacties traceerbaar via
          de Governance Log.
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Sub-component: balansgroep (links, activa-zijde)
// ============================================================
function BalansGroep({
  titel,
  rijen,
}: {
  titel: string;
  rijen: { naam: string; mln: number; deltaPct: number }[];
}) {
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-gray-500 mb-2 mt-3">{titel}</div>
      <div className="space-y-1.5 text-sm">
        {rijen.map((r) => (
          <div key={r.naam} className="flex justify-between">
            <span className="text-gray-700">{r.naam}</span>
            <span className="inline-flex gap-2 items-baseline">
              <span className="tabular-nums">{fmt(r.mln)}</span>
              <span
                className={`text-[11px] min-w-[40px] text-right ${
                  r.deltaPct < 0
                    ? "text-red-600"
                    : r.deltaPct > 0
                    ? "text-green-600"
                    : "text-gray-400"
                }`}
              >
                {r.deltaPct === 0
                  ? "—"
                  : `${r.deltaPct > 0 ? "+" : ""}${r.deltaPct.toFixed(1).replace(".", ",")}%`}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
