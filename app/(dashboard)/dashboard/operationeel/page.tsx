import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalStuurinfoOperationeel } from "@/core/lib/stuurinfo-bron";
import { formatteerPeriode, richtingVan, type Richting } from "@/core/lib/stuurinfo-balans";
import type { OperOntwikkeling, OperKostenOverzicht } from "@/core/lib/stuurinfo-operationeel";
import { StuurinfoShell } from "../_components/StuurinfoShell";

// ============================================================
//  Bestuurdersdashboard — tab 6 Operationeel beleid (T16, decisions/0077).
//  Ontwikkeling van de operationele reserve als ontwikkelingstabel (primo →
//  mutaties naar bron, incl. de kosten als geaggregeerde post − → totaal
//  mutatie → ultimo), de reserve t.o.v. norm/band (gauge in € mln) en het
//  kostendetail (realisatie YTD vs. begroting, aangeleverd). Totaal mutatie,
//  primo en ultimo zijn AFGELEID (stuurinfo-ontwikkeling/-operationeel.ts);
//  de ultimo komt van de oper-reserve-rij — DEZELFDE bron als de operationele
//  reserve op de balans (tab 1, één bron per bedrag).
//  Data onder fonds-RLS; presentatie volgt het goedgekeurde prototype
//  (stuurinformatie-prototype.html, tab 6).
//  WERKHYPOTHESE (compliancegevoelig): de TWK-/verrekeningsposten zijn
//  fondsspecifiek/transitiegerelateerd — valideren met actuaris/uitvoerder
//  (zie decisions/0077).
// ============================================================

const fmt1 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${fmt1(n)}%`;
/** ±-notatie met echte minus (U+2212), 1 decimaal — prototype-conventie. */
const fmtSigned1 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))}`;

const STATUS_DUIDING: Record<OperOntwikkeling["status"], string> = {
  ok: "binnen de bandbreedte.",
  onder: "onder de ondergrens van de band — agenderen voor het bestuur.",
  boven: "boven de bovengrens van de band — beoordeel afroming of normbijstelling.",
  monitoring: "geen bandbreedte beschikbaar — positie niet toetsbaar.",
};

function Pijl({ richting }: { richting: Richting | null }) {
  if (richting === "op") return <span className="text-ok-ink text-[11px]">▲</span>;
  if (richting === "neer") return <span className="text-err-ink text-[11px]">▼</span>;
  return null;
}

/** ±-cel met kleur (groen = voedt de reserve, rood = drukt) — prototype. */
function SignedCel({ waarde, vet }: { waarde: number | null; vet?: boolean }) {
  if (waarde === null) return <span className="text-muted">—</span>;
  const kleur = waarde > 0 ? "text-ok-ink" : waarde < 0 ? "text-err-ink" : "text-ink";
  return <span className={`${kleur} ${vet ? "font-semibold" : ""}`}>{fmtSigned1(waarde)}</span>;
}

// ── Norm-gauge (pure SVG, 460×130 — prototype-patroon, band in € mln) ────────
function NormGauge({ o }: { o: OperOntwikkeling }) {
  if (o.gaugePositie === null || o.bandOnder === null || o.bandBoven === null) {
    return (
      <div className="text-sm text-muted">
        Geen bandbreedte of stand beschikbaar voor deze periode — de positie t.o.v. de norm kan
        niet worden getoond.
      </div>
    );
  }
  const vulBreedte = o.gaugePositie * 360;
  const normX = o.normPositie !== null ? 60 + o.normPositie * 360 : null;
  return (
    <svg viewBox="0 0 460 130" className="w-full h-auto" role="img" aria-label="Operationele reserve t.o.v. norm">
      <rect x={60} y={44} width={360} height={24} rx={6} fill="#eef0f4" stroke="#e6e8ec" />
      <rect x={60} y={44} width={vulBreedte} height={24} rx={6} fill="var(--accent)" />
      {o.stand !== null && vulBreedte > 40 && (
        <text x={60 + vulBreedte - 8} y={60} fontSize={11} fill="#fff" textAnchor="end" fontWeight={700}>
          {fmt1(o.stand)}
        </text>
      )}
      {normX !== null && (
        <>
          <line x1={normX} x2={normX} y1={32} y2={78} stroke="#6b7280" strokeWidth={2} strokeDasharray="3 3" />
          <text x={normX} y={24} fontSize={10.5} fill="#6b7280" textAnchor="middle">
            norm {o.norm === null ? "" : fmt1(o.norm)}
          </text>
        </>
      )}
      <text x={60} y={88} fontSize={10.5} fill="#6b7280" textAnchor="middle">
        {fmt1(o.bandOnder)} (onder)
      </text>
      <text x={420} y={88} fontSize={10.5} fill="#6b7280" textAnchor="middle">
        {fmt1(o.bandBoven)} (boven)
      </text>
    </svg>
  );
}

// ── Kosten-bars (realisatie t.o.v. begroting; begroting = 100% van de track) ─
function KostenBars({ kosten }: { kosten: OperKostenOverzicht }) {
  return (
    <div className="space-y-2">
      {kosten.regels.map((r) => {
        const overschrijding = r.realisatie !== null && r.begroot !== null && r.realisatie > r.begroot;
        const breedte =
          r.realisatie !== null && r.begroot !== null && r.begroot > 0
            ? Math.min(1, r.realisatie / r.begroot) * 100
            : null;
        return (
          <div key={r.key} className="grid grid-cols-[130px_1fr_86px] items-center gap-3 text-sm">
            <span className="text-ink">{r.label}</span>
            <span className="h-2.5 rounded-full bg-app-bg overflow-hidden">
              {breedte !== null && (
                <span
                  className={`block h-full rounded-full ${overschrijding ? "bg-err" : "bg-accent"}`}
                  style={{ width: `${breedte}%` }}
                />
              )}
            </span>
            <span className="text-right text-xs text-muted tabular-nums whitespace-nowrap">
              {r.realisatie === null ? "—" : fmt1(r.realisatie)} /{" "}
              {r.begroot === null ? "—" : fmt1(r.begroot)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default async function OperationeelPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  // Server-side gate: beschikbaarheid (manifest) + capability + (queries) RLS.
  const { fondsId } = await vereisModuleToegang("stuurinformatie", "stuurinformatie.view");

  const { periode } = await searchParams;
  const supabase = await createServerSupabase();
  const [fondsRes, data] = await Promise.all([
    supabase.from("fondsen").select("naam").eq("id", fondsId).single(),
    haalStuurinfoOperationeel(fondsId, typeof periode === "string" ? periode : undefined),
  ]);
  const fondsNaam = fondsRes.data?.naam ?? "";

  const huidigLabel = data.gekozenPeriode ? formatteerPeriode(data.gekozenPeriode.periode) : null;
  const vorigLabel = data.vorigePeriode ? formatteerPeriode(data.vorigePeriode.periode) : null;
  const o = data.huidig;
  const v = data.vorig;
  const heeftData = o.stand !== null || o.totaalMutatie !== null;
  const ultimoRichting =
    o.ultimo !== null && v?.ultimo != null ? richtingVan(o.ultimo, v.ultimo) : null;
  const normDuiding =
    o.stand !== null && o.norm !== null
      ? o.stand > o.norm
        ? "boven norm"
        : o.stand < o.norm
          ? "onder norm"
          : "op norm"
      : null;

  return (
    <StuurinfoShell
      actieveTab="operationeel"
      fondsNaam={fondsNaam}
      regelingLabel={data.regelingLabel}
      gekozenPeriode={data.gekozenPeriode}
      periodes={data.periodes}
      financieringsgraad={data.financieringsgraad}
    >
      {!data.gekozenPeriode ? (
        <div className="bg-white rounded-xl border border-line p-5 text-sm text-muted">
          Er zijn nog geen rapportageperiodes beschikbaar voor dit fonds.
        </div>
      ) : !heeftData ? (
        <div className="bg-white rounded-xl border border-line p-5 text-sm text-muted">
          Geen operationeel-beleidsdata beschikbaar voor {huidigLabel}. Een voorzitter of beheerder
          kan de mutaties invoeren via Beheer › Stuurinformatie (sectie Operationeel).
        </div>
      ) : (
        <>
          {/* Consistentie-signaal: afgeleide ultimo ≠ balans-stand */}
          {!o.consistent && (
            <div className="bg-err-tint border-l-2 border-err rounded-r-lg px-4 py-3 text-xs text-err-ink">
              <strong>Inconsistentie:</strong> primo + totaal mutatie (€{" "}
              {o.ultimo === null ? "—" : fmt1(o.ultimo)} mln) wijkt af van de operationele reserve
              uit de balans (€ {o.stand === null ? "—" : fmt1(o.stand)} mln). Controleer de invoer
              via Beheer › Stuurinformatie — de balans en de mutaties horen op elkaar te sluiten
              (één bron per bedrag).
            </div>
          )}

          {/* KPI-rij (prototypevolgorde) */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
          >
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Operationele reserve</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {o.stand === null ? "—" : `€ ${fmt1(o.stand)} mln`}
              </div>
              <div
                className={`text-xs mt-1 ${
                  o.pctVanNorm === null
                    ? "text-muted"
                    : o.pctVanNorm >= 100
                      ? "text-ok-ink"
                      : "text-warn-ink"
                }`}
              >
                {o.pctVanNorm === null ? "—" : `${fmtPct(o.pctVanNorm)} v. norm`}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Norm</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {o.norm === null ? "—" : `€ ${fmt1(o.norm)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">ABTN</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Kosten YTD</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {data.kosten.totaalRealisatie === null
                  ? "—"
                  : `€ ${fmt1(data.kosten.totaalRealisatie)} mln`}
              </div>
              <div
                className={`text-xs mt-1 ${
                  data.kosten.binnenBudget === null
                    ? "text-muted"
                    : data.kosten.binnenBudget
                      ? "text-ok-ink"
                      : "text-err-ink"
                }`}
              >
                {data.kosten.binnenBudget === null
                  ? "—"
                  : data.kosten.binnenBudget
                    ? "onder begroting"
                    : "boven begroting"}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Buffer</div>
              <div
                className={`text-2xl font-bold mt-1 ${
                  o.buffer === null
                    ? "text-ink"
                    : o.buffer > 0
                      ? "text-ok-ink"
                      : o.buffer < 0
                        ? "text-err-ink"
                        : "text-ink"
                }`}
              >
                {o.buffer === null ? "—" : `${o.buffer > 0 ? "+" : o.buffer < 0 ? "−" : ""}€ ${fmt1(Math.abs(o.buffer))} mln`}
              </div>
              <div className="text-xs text-muted mt-1">{normDuiding ?? "t.o.v. norm"}</div>
            </div>
          </div>

          {/* Ontwikkeling operationele reserve */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="mb-3">
              <div className="font-semibold text-ink text-sm">Ontwikkeling operationele reserve</div>
              <div className="text-xs text-muted mt-0.5">
                Primo, mutaties naar bron (opbrengsten en resultaten) en ultimo — € mln
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted border-b border-line">
                    <th className="text-left font-medium py-2 pr-3">Post</th>
                    <th className="text-right font-medium py-2 pl-3 whitespace-nowrap">
                      {huidigLabel} <span className="font-normal">huidig</span>
                    </th>
                    {vorigLabel && (
                      <th className="text-right font-medium py-2 pl-3 whitespace-nowrap">
                        {vorigLabel} <span className="font-normal">vorig</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line">
                    <td className="py-2 pr-3 text-ink">Primo</td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {o.primo === null ? "—" : fmt1(o.primo)}
                    </td>
                    {vorigLabel && (
                      <td className="py-2 pl-3 text-right tabular-nums text-muted">
                        {v?.primo == null ? "—" : fmt1(v.primo)}
                      </td>
                    )}
                  </tr>
                  {o.bronnen.map((b) => {
                    const vorigeBron = v?.bronnen.find((x) => x.key === b.key);
                    return (
                      <tr key={b.key} className="border-b border-line">
                        <td className="py-2 pr-3 pl-6 text-ink">
                          {b.key === "gemist_rendement_twk" ? (
                            <>
                              Gemist rendement <span className="text-muted text-xs">(a.g.v. TWK)</span>
                            </>
                          ) : b.key === "kosten" ? (
                            <>
                              Kosten <span className="text-muted text-xs">(geaggregeerd)</span>
                            </>
                          ) : (
                            b.label
                          )}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          <SignedCel waarde={b.waarde} />
                        </td>
                        {vorigLabel && (
                          <td className="py-2 pl-3 text-right tabular-nums">
                            <SignedCel waarde={vorigeBron?.waarde ?? null} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  <tr className="border-b border-line font-semibold">
                    <td className="py-2 pr-3 text-ink">
                      Totaal mutatie <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      <SignedCel waarde={o.totaalMutatie} vet />
                    </td>
                    {vorigLabel && (
                      <td className="py-2 pl-3 text-right tabular-nums">
                        <SignedCel waarde={v?.totaalMutatie ?? null} vet />
                      </td>
                    )}
                  </tr>
                  <tr className="font-semibold">
                    <td className="py-2 pr-3 text-ink">
                      Ultimo <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap">
                      {o.ultimo === null ? "—" : fmt1(o.ultimo)} <Pijl richting={ultimoRichting} />
                    </td>
                    {vorigLabel && (
                      <td className="py-2 pl-3 text-right tabular-nums text-muted">
                        {v?.ultimo == null ? "—" : fmt1(v.ultimo)}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
              <strong className="text-ink">Opbrengsten minus kosten:</strong> de tabel toont de
              reserve-ontwikkeling — opbrengsten/resultaten (premie-/kostenopslag, rendement,
              invaar- en verrekeningsmutaties) minus de{" "}
              <strong className="text-ink">geaggregeerde kosten</strong> = totaal mutatie. De
              kosten zijn hier één post; de uitsplitsing naar kostensoort en de
              begrotingsvergelijking staan hieronder. Premie betreft de kostenopslag. De ultimo is
              dezelfde bron als de operationele reserve op de balans (tab 1).
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {/* Reserve t.o.v. norm */}
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="mb-3">
                <div className="font-semibold text-ink text-sm">Operationele reserve t.o.v. norm</div>
                <div className="text-xs text-muted mt-0.5">Stand, norm en bandbreedte (€ mln)</div>
              </div>
              <NormGauge o={o} />
              <div className="mt-3 bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
                <strong className="text-ink">Status:</strong>{" "}
                {normDuiding ? `${normDuiding}, ` : ""}
                {STATUS_DUIDING[o.status]}
              </div>
            </div>

            {/* Kosten: realisatie vs. begroting */}
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="mb-3">
                <div className="font-semibold text-ink text-sm">Kosten: realisatie vs. begroting</div>
                <div className="text-xs text-muted mt-0.5">
                  Uitvoerings- en beheerkosten YTD (€ mln) — aangeleverd door de uitvoerder
                </div>
              </div>
              <KostenBars kosten={data.kosten} />
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted border-b border-line">
                      <th className="text-left font-medium py-2 pr-3">Post</th>
                      <th className="text-right font-medium py-2 pl-3">Realisatie</th>
                      <th className="text-right font-medium py-2 pl-3">Begroot</th>
                      <th className="text-right font-medium py-2 pl-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-2 pr-3 text-ink">
                        Totaal kosten YTD{" "}
                        <span className="text-muted text-xs italic">(afgeleid)</span>
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {data.kosten.totaalRealisatie === null
                          ? "—"
                          : `€ ${fmt1(data.kosten.totaalRealisatie)}`}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums text-muted">
                        {data.kosten.totaalBegroot === null
                          ? "—"
                          : `€ ${fmt1(data.kosten.totaalBegroot)}`}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {data.kosten.binnenBudget === null ? (
                          <span className="text-muted">—</span>
                        ) : data.kosten.binnenBudget ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap bg-ok-tint text-ok-ink">
                            <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                            Onder budget
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap bg-err-tint text-err-ink">
                            <span className="w-1.5 h-1.5 rounded-full bg-err" />
                            Boven budget
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-3 bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
                <strong className="text-ink">Duiding:</strong> het kostendetail (YTD) is een
                aangeleverde uitsplitsing en wordt bewust niet één-op-één verrekend met de
                geaggregeerde kwartaal-kostenpost in de ontwikkeling hierboven.
              </div>
            </div>
          </div>
        </>
      )}
    </StuurinfoShell>
  );
}
