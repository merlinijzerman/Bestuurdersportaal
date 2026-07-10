import { createServerSupabase } from "@/lib/supabase-server";
import { vereisModuleToegang } from "@/lib/module-gate-page";
import { haalStuurinfo, type BalansRij, type Kpi } from "@/lib/stuurinfo-bron";
import { SUPPRESSIE_MASKER } from "@/lib/suppressie";

// ============================================================
//  Stuurinformatie — CONFIG-GEDREVEN, tenant-veilig (T11)
//  Data uit fonds_stuurinfo_kpi/-reeks onder fonds-RLS; presentatie/content uit
//  de per-fonds module-config. Alle cijfers zijn realistische dummy-data.
//  Server-side gate: beschikbaarheid (manifest) + capability (stuurinformatie.view)
//  + fonds-RLS. Kleine-populatie-suppressie (n<10) in de leeslaag.
// ============================================================

const fmt = (n: number) => n.toLocaleString("nl-NL");
const fmtMln = (mln: number) =>
  mln >= 1000 ? `${(mln / 1000).toFixed(1).replace(".", ",")} mld` : `${fmt(mln)} mln`;

function formatKpi(k: Kpi): string {
  if (k.onderdrukt || k.waarde === null) return SUPPRESSIE_MASKER;
  switch (k.eenheid) {
    case "pct":
      return `${k.waarde.toFixed(1).replace(".", ",")}%`;
    case "pct_signed": {
      const teken = k.waarde >= 0 ? "+" : "−";
      return `${teken}${Math.abs(k.waarde).toFixed(1).replace(".", ",")}%`;
    }
    case "mln":
      return `€ ${fmtMln(k.waarde)}`;
    case "aantal":
      return fmt(k.waarde);
    default:
      return String(k.waarde);
  }
}

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

export default async function DashboardPage() {
  // Server-side gate: beschikbaarheid (manifest) + capability + (queries) RLS.
  const { fondsId, userId } = await vereisModuleToegang("stuurinformatie", "stuurinformatie.view");

  const supabase = await createServerSupabase();
  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam")
    .eq("id", userId)
    .single();
  const naam = profiel?.naam?.split(" ")[0] || "Bestuurder";

  const data = await haalStuurinfo(fondsId);

  const [{ count: aantalDocs }, { count: aantalLogs }] = await Promise.all([
    supabase.from("documenten").select("*", { count: "exact", head: true }),
    supabase.from("governance_log").select("*", { count: "exact", head: true }),
  ]);

  const sumBalans = (rijen: BalansRij[]) => rijen.reduce((s, r) => s + r.waarde, 0);
  const totaalActiva =
    sumBalans(data.balans.activa.bescherming) +
    sumBalans(data.balans.activa.overrend) +
    sumBalans(data.balans.activa.liquide);
  const totaalPersoonlijk = sumBalans(data.balans.passiva.ppv);
  const totaalPassiva =
    totaalPersoonlijk +
    sumBalans(data.balans.passiva.reserve) +
    sumBalans(data.balans.passiva.overig);
  const reserve = data.balans.passiva.reserve[0] ?? null;

  const totaalDeelnemers = data.deelnemerStatus.reduce((s, r) => s + (r.aantal ?? 0), 0);
  const nettoDelta = data.deelnemerStatus.reduce((s, r) => s + (r.delta ?? 0), 0);

  // Trendgrafiek
  const trendW = 700;
  const trendH = 180;
  const yMin = 96;
  const yMax = 110;
  const heeftTrend = data.toonTrend && data.trend.waarden.length > 1;
  const fgPath = heeftTrend ? buildPath(data.trend.waarden, trendW, trendH, yMin, yMax) : "";
  const targetPath = heeftTrend
    ? buildPath(Array(data.trend.waarden.length).fill(100), trendW, trendH, yMin, yMax)
    : "";

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="font-serif text-ink text-xl font-bold">Welkom terug, {naam}</div>
          <div className="text-muted text-sm mt-0.5">
            Stuurinformatie{data.peildatum ? ` · per ${data.peildatum}` : ""}
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-muted bg-app-bg px-2 py-1 rounded-md">
          Demo-data
        </span>
      </div>

      {/* KPI-tegels (config-gedreven volgorde + aantal) */}
      {data.kpis.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
        >
          {data.kpis.map((k) => (
            <div key={k.key} className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">{k.label}</div>
              <div className="text-2xl font-bold text-ink mt-1">{formatKpi(k)}</div>
              {k.toelichting && <div className="text-xs text-muted mt-1">{k.toelichting}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Trend financieringsgraad */}
      {heeftTrend && (
        <div className="bg-white rounded-xl border border-line p-5">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div className="font-semibold text-ink text-sm">Financieringsgraad — 24 maanden</div>
            <div className="flex gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#185FA5" }}></span>
                Financieringsgraad
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5" style={{ background: "var(--warn)" }}></span>
                Doel 100%
              </span>
            </div>
          </div>
          <svg viewBox={`0 0 ${trendW} ${trendH + 24}`} className="w-full h-auto">
            {[98, 100, 102, 104, 106, 108].map((y) => {
              const yPos = trendH - ((y - yMin) / (yMax - yMin)) * trendH;
              return (
                <g key={y}>
                  <line x1={0} x2={trendW} y1={yPos} y2={yPos} stroke="var(--line)" strokeWidth={0.5} />
                  <text x={4} y={yPos - 2} fontSize={10} fill="var(--muted)">
                    {y}%
                  </text>
                </g>
              );
            })}
            <path d={targetPath} stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4,4" fill="none" />
            <path d={fgPath} stroke="#185FA5" strokeWidth={2} fill="none" />
            {data.trend.labels.map((label, i) => {
              if (i % 4 !== 0) return null;
              const x = (trendW / (data.trend.labels.length - 1)) * i;
              return (
                <text key={i} x={x} y={trendH + 16} fontSize={10} fill="var(--muted)" textAnchor="middle">
                  {label}
                </text>
              );
            })}
          </svg>
        </div>
      )}

      {/* Balans */}
      {data.toonBalans && totaalActiva > 0 && (
        <div className="bg-white rounded-xl border border-line p-5">
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
            <div>
              <div className="font-semibold text-ink text-sm">Balans · Wtp-regeling</div>
              <div className="text-xs text-muted mt-0.5">Solidaire premieregeling · bedragen in € mln</div>
            </div>
            <div className="text-xs text-muted">vs Q4 2025</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Activa */}
            <div>
              <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-line">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">Activa</span>
                <span className="text-lg font-semibold text-ink">{fmt(totaalActiva)}</span>
              </div>
              <BalansGroep titel="Beschermingsportefeuille" rijen={data.balans.activa.bescherming} />
              <BalansGroep titel="Overrendementsportefeuille" rijen={data.balans.activa.overrend} />
              <BalansGroep titel="Liquide" rijen={data.balans.activa.liquide} />
            </div>

            {/* Passiva */}
            <div>
              <div className="flex items-baseline justify-between pb-2 mb-3 border-b border-line">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">Passiva</span>
                <span className="text-lg font-semibold text-ink">{fmt(totaalPassiva)}</span>
              </div>

              <div className="text-xs font-medium text-muted mb-2 mt-1">Persoonlijke pensioenvermogens</div>
              <div className="space-y-1.5 text-sm">
                {data.balans.passiva.ppv.map((r) => (
                  <div key={r.key} className="flex justify-between">
                    <span className="text-ink">{r.naam}</span>
                    <span className="inline-flex gap-2 items-baseline">
                      <span className="tabular-nums">{fmt(r.waarde)}</span>
                      {r.delta !== null && (
                        <span className="text-[11px] text-ok-ink min-w-[40px] text-right">
                          +{r.delta.toFixed(1).replace(".", ",")}%
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {reserve && (
                <>
                  <div className="text-xs font-medium text-muted mb-2 mt-4">Solidariteitsreserve</div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-ink">{reserve.naam}</span>
                      <span className="inline-flex gap-2 items-baseline">
                        <span className="tabular-nums">{fmt(reserve.waarde)}</span>
                        {reserve.delta !== null && (
                          <span className="text-[11px] text-ok-ink min-w-[40px] text-right">
                            +{reserve.delta}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {data.balans.passiva.overig.length > 0 && (
                <>
                  <div className="text-xs font-medium text-muted mb-2 mt-4">Overige verplichtingen</div>
                  <div className="space-y-1.5 text-sm">
                    {data.balans.passiva.overig.map((r) => (
                      <div key={r.key} className="flex justify-between">
                        <span className="text-ink">{r.naam}</span>
                        <span className="inline-flex gap-2 items-baseline">
                          <span className="tabular-nums">{fmt(r.waarde)}</span>
                          <span
                            className={`text-[11px] min-w-[40px] text-right ${
                              (r.delta ?? 0) < 0
                                ? "text-err-ink"
                                : (r.delta ?? 0) > 0
                                ? "text-ok-ink"
                                : "text-muted"
                            }`}
                          >
                            {!r.delta ? "—" : r.delta > 0 ? `+${r.delta}` : r.delta}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Cohortverdeling onderaan */}
          {totaalPersoonlijk > 0 && (
            <div className="mt-6 pt-4 border-t border-line">
              <div className="text-xs font-medium text-muted mb-2">
                Verdeling persoonlijke pensioenvermogens per cohort
              </div>
              <div className="flex gap-1 h-5 rounded-md overflow-hidden">
                {data.balans.passiva.ppv.map((c) => {
                  const pct = (c.waarde / totaalPersoonlijk) * 100;
                  return (
                    <div
                      key={c.key}
                      className="flex items-center justify-center text-white text-[11px]"
                      style={{ width: `${pct}%`, background: c.kleur ?? "var(--muted)" }}
                    >
                      {Math.round(pct)}%
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deelnemers + Signaleringen */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Deelnemers */}
        <div className="bg-white rounded-xl border border-line p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-semibold text-ink text-sm">Deelnemers naar status</div>
            <span className="text-xs text-muted">vs Q4 2025</span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-xl font-bold text-ink">{fmt(totaalDeelnemers)}</span>
            <span className="text-xs text-muted">totaal</span>
            <span className="text-xs text-ok-ink ml-2">
              {nettoDelta >= 0 ? "+" : ""}
              {fmt(nettoDelta)} netto
            </span>
          </div>
          <div className="flex gap-0.5 h-3 rounded-md overflow-hidden mb-3">
            {data.deelnemerStatus.map((d) => {
              const pct = totaalDeelnemers > 0 ? ((d.aantal ?? 0) / totaalDeelnemers) * 100 : 0;
              return (
                <div
                  key={d.key}
                  style={{ width: `${pct}%`, background: d.kleur ?? "var(--muted)" }}
                  title={`${d.label} ${pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div className="space-y-1 text-sm">
            {data.deelnemerStatus.map((d) => (
              <div key={d.key} className="flex justify-between items-center">
                <span className="inline-flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.kleur ?? "var(--muted)" }} />
                  <span className="text-ink">{d.label}</span>
                </span>
                <span className="inline-flex gap-2 items-baseline">
                  <span className="tabular-nums">
                    {d.onderdrukt ? SUPPRESSIE_MASKER : fmt(d.aantal ?? 0)}
                  </span>
                  {d.onderdrukt ? (
                    <span className="text-[11px] min-w-[40px] text-right text-muted" title="n<10 — onderdrukt">
                      n&lt;10
                    </span>
                  ) : (
                    <span
                      className={`text-[11px] min-w-[40px] text-right ${
                        (d.delta ?? 0) > 0 ? "text-ok-ink" : (d.delta ?? 0) < 0 ? "text-err-ink" : "text-muted"
                      }`}
                    >
                      {(d.delta ?? 0) > 0 ? `+${d.delta}` : d.delta ?? 0}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-line">
            <div>
              <div className="text-[11px] text-muted">Instroom Q1</div>
              <div className="text-sm font-semibold text-ink mt-0.5">+{fmt(data.deelnemerMutatie.instroom)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Uitstroom Q1</div>
              <div className="text-sm font-semibold text-ink mt-0.5">−{fmt(data.deelnemerMutatie.uitstroom)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Pensioneringen Q1</div>
              <div className="text-sm font-semibold text-ink mt-0.5">{fmt(data.deelnemerMutatie.pensioneringen)}</div>
            </div>
          </div>
          {data.deelnemerStatus.some((d) => d.onderdrukt) && (
            <div className="text-[11px] text-muted mt-3">
              {SUPPRESSIE_MASKER} = onderdrukt wegens kleine populatie (n&lt;10, privacy-by-design).
            </div>
          )}
        </div>

        {/* Signaleringen */}
        <div className="bg-white rounded-xl border border-line p-5">
          <div className="font-semibold text-ink text-sm mb-3">Signaleringen</div>
          {data.signaleringen.length > 0 ? (
            <ul className="space-y-3">
              {data.signaleringen.map((s, i) => (
                <li key={i} className="flex gap-2.5 items-start">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                      s.kleur === "amber" ? "bg-warn" : s.kleur === "green" ? "bg-ok" : "bg-accent"
                    }`}
                  />
                  <div>
                    <div className="text-sm font-semibold text-ink">{s.titel}</div>
                    <div className="text-xs text-muted mt-0.5">{s.sub}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-muted">Geen actieve signaleringen.</div>
          )}
        </div>
      </div>

      {/* Vergaderingen / acties */}
      {data.vergaderingen.length > 0 && (
        <div className="bg-white rounded-xl border border-line p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-semibold text-ink text-sm">Openstaande acties &amp; vergaderingen</div>
            <span className="text-xs text-muted">{data.vergaderingen.length} lopend</span>
          </div>
          <div className="space-y-2.5">
            {data.vergaderingen.map((v, i) => (
              <div key={i} className="flex justify-between items-center gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-md whitespace-nowrap ${
                      v.kleur === "amber" ? "bg-warn-tint text-warn-ink" : "bg-accent-tint text-accent-ink"
                    }`}
                  >
                    {v.categorie}
                  </span>
                  <span className="text-sm text-ink truncate">{v.titel}</span>
                </div>
                <span className="text-xs text-muted whitespace-nowrap">{v.datum}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Governance traceability */}
      <div className="bg-accent-tint border border-accent/30 rounded-xl p-4 flex items-center gap-3 text-xs text-accent-ink">
        <span className="text-base">ℹ️</span>
        <div className="flex-1">
          <strong>{aantalDocs ?? 0}</strong> bron-documenten beschikbaar ·{" "}
          <strong>{aantalLogs ?? 0}</strong> AI-vragen gelogd · alle interacties traceerbaar via de
          Governance Log.
        </div>
      </div>
    </div>
  );
}

function BalansGroep({ titel, rijen }: { titel: string; rijen: BalansRij[] }) {
  if (rijen.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-muted mb-2 mt-3">{titel}</div>
      <div className="space-y-1.5 text-sm">
        {rijen.map((r) => (
          <div key={r.key} className="flex justify-between">
            <span className="text-ink">{r.naam}</span>
            <span className="inline-flex gap-2 items-baseline">
              <span className="tabular-nums">{fmt(r.waarde)}</span>
              <span
                className={`text-[11px] min-w-[40px] text-right ${
                  (r.delta ?? 0) < 0 ? "text-err-ink" : (r.delta ?? 0) > 0 ? "text-ok-ink" : "text-muted"
                }`}
              >
                {!r.delta ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1).replace(".", ",")}%`}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
