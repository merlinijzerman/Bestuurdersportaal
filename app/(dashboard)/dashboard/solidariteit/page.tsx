import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalStuurinfoSolidariteit } from "@/core/lib/stuurinfo-bron";
import { formatteerPeriode, richtingVan, type Richting } from "@/core/lib/stuurinfo-balans";
import type { SoliOntwikkeling } from "@/core/lib/stuurinfo-soli";
import { StuurinfoShell } from "../_components/StuurinfoShell";

// ============================================================
//  Bestuurdersdashboard — tab 5 Solidariteitsbeleid (T15, decisions/0076).
//  Ontwikkeling van de solidariteitsreserve met de vulling uitgesplitst naar
//  bron (premie, rendement, resultaat micro-langleven ±, overrendements-
//  bijdrage → netto vulling), de positie t.o.v. de bandbreedte (band-gauge)
//  en de evenwichtigheidsduiding. Netto vulling, begin- en eindstand zijn
//  AFGELEID (stuurinfo-soli.ts); de stand + band komen van de soli-reserve-rij
//  — DEZELFDE bron als het tab 1-stoplicht (één bron). Micro-langleven is
//  herleidbaar tot het biometrische resultaat van tab 3 (later ticket).
//  Data onder fonds-RLS; presentatie volgt het goedgekeurde prototype
//  (stuurinformatie-prototype.html, tab 5).
//  WERKHYPOTHESE (compliancegevoelig): de vulregels (welke bronnen de reserve
//  voeden) volgen de ABTN — valideren met de actuaris (zie decisions/0076).
// ============================================================

const fmt1 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${fmt1(n)}%`;
/** ±-notatie met echte minus (U+2212), 1 decimaal — prototype-conventie. */
const fmtSigned1 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))}`;
const fmtBand = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const BASIS_LABEL: Record<string, string> = {
  technische_voorziening: "van de technische voorziening",
  kapitalen: "van de kapitalen",
};

const STATUS_CHIP: Record<
  SoliOntwikkeling["status"],
  { tekst: string; chip: string; dot: string }
> = {
  ok: { tekst: "Binnen band", chip: "bg-ok-tint text-ok-ink", dot: "bg-ok" },
  onder: { tekst: "Onder ondergrens", chip: "bg-err-tint text-err-ink", dot: "bg-err" },
  boven: { tekst: "Boven bovengrens", chip: "bg-warn-tint text-warn-ink", dot: "bg-warn" },
  monitoring: { tekst: "Monitoring", chip: "bg-app-bg text-muted", dot: "" },
};

const STATUS_DUIDING: Record<SoliOntwikkeling["status"], string> = {
  ok: "comfortabel binnen de band. Bij de bovengrens schrijven de vulregels uitdeling voor; bij de ondergrens juist extra vulling / geen uitdeling.",
  onder:
    "onder de ondergrens — de vulregels schrijven extra vulling voor en géén uitdeling. Agenderen voor het bestuur.",
  boven:
    "boven de bovengrens — de vulregels schrijven uitdeling voor. Wanneer en aan wie is een expliciet bestuursbesluit, geen automatisme.",
  monitoring: "geen bandbreedte of stand% beschikbaar — positie niet toetsbaar.",
};

function Chip({ status }: { status: SoliOntwikkeling["status"] }) {
  const chip = STATUS_CHIP[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${chip.chip}`}
    >
      {chip.dot ? (
        <span className={`w-1.5 h-1.5 rounded-full ${chip.dot}`} />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--muted)" }} />
      )}
      {chip.tekst}
    </span>
  );
}

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

// ── Band-gauge (pure SVG, prototype-geometrie 460×130) ──────────────────────
function BandGauge({ o }: { o: SoliOntwikkeling }) {
  if (o.gaugePositie === null || o.ondergrens === null || o.bovengrens === null) {
    return (
      <div className="text-sm text-muted">
        Geen bandbreedte of stand% beschikbaar voor deze periode — de positie in de band kan niet
        worden getoond.
      </div>
    );
  }
  const x = 60 + o.gaugePositie * 360;
  return (
    <svg viewBox="0 0 460 130" className="w-full h-auto" role="img" aria-label="Solidariteitsreserve binnen band">
      <defs>
        <linearGradient id="soliBand" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fdf1e1" />
          <stop offset="0.15" stopColor="#e7f4ee" />
          <stop offset="0.85" stopColor="#e7f4ee" />
          <stop offset="1" stopColor="#fdf1e1" />
        </linearGradient>
      </defs>
      <rect x={60} y={40} width={360} height={26} rx={6} fill="url(#soliBand)" stroke="#e6e8ec" />
      <line x1={x} x2={x} y1={30} y2={76} stroke="var(--accent)" strokeWidth={3} />
      <circle cx={x} cy={53} r={7} fill="var(--accent)" />
      {o.pctWaarde !== null && (
        <text x={x} y={22} fontSize={11} fill="var(--accent)" textAnchor="middle" fontWeight={700}>
          {fmtPct(o.pctWaarde)} (nu)
        </text>
      )}
      <text x={60} y={88} fontSize={11} fill="#6b7280" textAnchor="middle">
        {fmtBand(o.ondergrens)}%
      </text>
      <text x={60} y={102} fontSize={10} fill="#8a4208" textAnchor="middle">
        ondergrens
      </text>
      <text x={420} y={88} fontSize={11} fill="#6b7280" textAnchor="middle">
        {fmtBand(o.bovengrens)}%
      </text>
      <text x={420} y={102} fontSize={10} fill="#8a4208" textAnchor="middle">
        bovengrens
      </text>
    </svg>
  );
}

export default async function SolidariteitPage({
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
    haalStuurinfoSolidariteit(fondsId, typeof periode === "string" ? periode : undefined),
  ]);
  const fondsNaam = fondsRes.data?.naam ?? "";

  const huidigLabel = data.gekozenPeriode ? formatteerPeriode(data.gekozenPeriode.periode) : null;
  const vorigLabel = data.vorigePeriode ? formatteerPeriode(data.vorigePeriode.periode) : null;
  const o = data.huidig;
  const v = data.vorig;
  const heeftData = o.stand !== null || o.nettoVulling !== null;
  const basisLabel = (data.pctBasis && BASIS_LABEL[data.pctBasis]) || "van de kapitalen";
  const eindRichting =
    o.eindstand !== null && v?.eindstand != null ? richtingVan(o.eindstand, v.eindstand) : null;

  return (
    <StuurinfoShell
      actieveTab="solidariteit"
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
          Geen solidariteitsdata beschikbaar voor {huidigLabel}. Een voorzitter of beheerder kan de
          vulling invoeren via Beheer › Stuurinformatie (sectie Solidariteit).
        </div>
      ) : (
        <>
          {/* Consistentie-signaal: afgeleide eindstand ≠ balans-stand */}
          {!o.consistent && (
            <div className="bg-err-tint border-l-2 border-err rounded-r-lg px-4 py-3 text-xs text-err-ink">
              <strong>Inconsistentie:</strong> beginstand + netto vulling − uitdeling (€{" "}
              {o.eindstand === null ? "—" : fmt1(o.eindstand)} mln) wijkt af van de reservestand uit
              de balans (€ {o.stand === null ? "—" : fmt1(o.stand)} mln). Controleer de invoer via
              Beheer › Stuurinformatie — de balans en de vulling horen op elkaar te sluiten (één
              bron per bedrag).
            </div>
          )}

          {/* KPI-rij (prototypevolgorde) */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
          >
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Stand solidariteitsreserve</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {o.stand === null ? "—" : `€ ${fmt1(o.stand)} mln`}
              </div>
              <div className="text-xs text-ok-ink mt-1">
                {o.pctWaarde === null ? "—" : `${fmtPct(o.pctWaarde)} ${basisLabel}`}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Netto vulling {huidigLabel}</div>
              <div
                className={`text-2xl font-bold mt-1 ${
                  o.nettoVulling === null
                    ? "text-ink"
                    : o.nettoVulling > 0
                    ? "text-ok-ink"
                    : o.nettoVulling < 0
                    ? "text-err-ink"
                    : "text-ink"
                }`}
              >
                {o.nettoVulling === null ? "—" : `${fmtSigned1(o.nettoVulling)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">som van de bronnen</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Uitdeling {huidigLabel}</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {o.uitdeling === null ? "—" : `€ ${fmt1(o.uitdeling)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">
                {o.uitdeling === 0 ? "geen aanwending" : "aanwending dit kwartaal"}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Bandbreedte</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {o.ondergrens !== null && o.bovengrens !== null
                  ? `${fmtBand(o.ondergrens)}–${fmtBand(o.bovengrens)}%`
                  : "—"}
              </div>
              <div className="text-xs text-muted mt-1">ABTN</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {/* Band-gauge */}
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="mb-3">
                <div className="font-semibold text-ink text-sm">Stand t.o.v. bandbreedte</div>
                <div className="text-xs text-muted mt-0.5">
                  Solidariteitsreserve als % {basisLabel} — positie binnen de band
                </div>
              </div>
              <BandGauge o={o} />
              <div className="mt-3 bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
                <strong className="text-ink">Status:</strong> {STATUS_DUIDING[o.status]}
              </div>
            </div>

            {/* Ontwikkeling solidariteitsreserve */}
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="mb-3">
                <div className="font-semibold text-ink text-sm">Ontwikkeling solidariteitsreserve</div>
                <div className="text-xs text-muted mt-0.5">
                  Beginstand, mutatie naar bron, uitdeling en eindstand — € mln
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
                      <td className="py-2 pr-3 text-ink">Beginstand</td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {o.beginstand === null ? "—" : fmt1(o.beginstand)}
                      </td>
                      {vorigLabel && (
                        <td className="py-2 pl-3 text-right tabular-nums text-muted">
                          {v?.beginstand == null ? "—" : fmt1(v.beginstand)}
                        </td>
                      )}
                    </tr>
                    {o.bronnen.map((b) => {
                      const vorigeBron = v?.bronnen.find((x) => x.key === b.key);
                      return (
                        <tr key={b.key} className="border-b border-line">
                          <td className="py-2 pr-3 pl-6 text-ink">
                            {b.label}
                            {b.key === "micro_langleven" && (
                              <span className="text-muted text-xs"> (± · zie tab 3)</span>
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
                        Netto vulling <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        <SignedCel waarde={o.nettoVulling} vet />
                      </td>
                      {vorigLabel && (
                        <td className="py-2 pl-3 text-right tabular-nums">
                          <SignedCel waarde={v?.nettoVulling ?? null} vet />
                        </td>
                      )}
                    </tr>
                    <tr className="border-b border-line">
                      <td className="py-2 pr-3 text-ink">Uitdeling</td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {o.uitdeling === null ? "—" : fmt1(o.uitdeling)}
                      </td>
                      {vorigLabel && (
                        <td className="py-2 pl-3 text-right tabular-nums text-muted">
                          {v?.uitdeling == null ? "—" : fmt1(v.uitdeling)}
                        </td>
                      )}
                    </tr>
                    <tr className="border-b border-line font-semibold">
                      <td className="py-2 pr-3 text-ink">
                        Eindstand <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap">
                        {o.eindstand === null ? "—" : fmt1(o.eindstand)} <Pijl richting={eindRichting} />
                      </td>
                      {vorigLabel && (
                        <td className="py-2 pl-3 text-right tabular-nums text-muted">
                          {v?.eindstand == null ? "—" : fmt1(v.eindstand)}
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td colSpan={vorigLabel ? 3 : 2} className="py-1" />
                    </tr>
                    <tr className="border-b border-line">
                      <td className="py-2 pr-3 text-ink">Stand % {basisLabel}</td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {o.pctWaarde === null ? "—" : fmtPct(o.pctWaarde)}
                      </td>
                      {vorigLabel && (
                        <td className="py-2 pl-3 text-right tabular-nums text-muted">
                          {v?.pctWaarde == null ? "—" : fmtPct(v.pctWaarde)}
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-ink">
                        Positie in band
                        {o.ondergrens !== null && o.bovengrens !== null && (
                          <span className="text-muted text-xs">
                            {" "}
                            ({fmtBand(o.ondergrens)}–{fmtBand(o.bovengrens)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        <Chip status={o.status} />
                      </td>
                      {vorigLabel && (
                        <td className="py-2 pl-3 text-right">
                          {v ? <Chip status={v.status} /> : <span className="text-muted">—</span>}
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Duiding — mutatie naar bron + evenwichtigheid (prototype) */}
          <div className="bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
            <strong className="text-ink">Mutatie naar bron:</strong> de reserve muteert door premie,
            beleggingsrendement, het <strong className="text-ink">resultaat op micro-langleven</strong>{" "}
            (sterfte — kan positief óf negatief zijn; onderbouwing in tab 3 Biometrische
            rendementen) en een overrendementsbijdrage. Netto vulling = de som hiervan, minus
            eventuele uitdeling. Door de bron te tonen zie je wélke resultaten de reserve voeden of
            juist drukken — relevant voor de evenwichtigheidstoets. Vul- en uitdeelregels blijven
            een expliciet bestuursbesluit.
          </div>
        </>
      )}
    </StuurinfoShell>
  );
}
