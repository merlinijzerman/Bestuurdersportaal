import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalStuurinfoPremie } from "@/core/lib/stuurinfo-bron";
import { formatteerPeriode, richtingVan, type Richting } from "@/core/lib/stuurinfo-balans";
import type { Ontwikkeling } from "@/core/lib/stuurinfo-ontwikkeling";
import type { UitputtingAfleiding } from "@/core/lib/stuurinfo-premie";
import { StuurinfoShell } from "../_components/StuurinfoShell";

// ============================================================
//  Bestuurdersdashboard — tab 7 Premie- & compensatiebeleid (T16, 0077).
//  Premie-opbrengsten per component (€ per periode + % van de premiegrond-
//  slag, beide aangeleverd; totaal afgeleid), de ontwikkeling van het
//  compensatiedepot (primo → mutaties naar bron → totaal mutatie → ultimo,
//  uitputtend) en de meerjaren-uitputtingsprognose (aangeleverde ALM-reeks,
//  met ondergrens). De depot-ultimo komt van de reserve-rij — DEZELFDE bron
//  als het compensatiedepot op de balans (tab 1, één bron per bedrag).
//  BEWUST VERWIJDERD (werkopdracht-besluit 7): premiedekkingsgraad-KPI en
//  het blok "premiedekking & wie compenseert wie".
//  Data onder fonds-RLS; presentatie volgt het goedgekeurde prototype
//  (stuurinformatie-prototype.html, tab 7).
//  WERKHYPOTHESE (compliancegevoelig): de premiesplitsing/grondslagdefinitie
//  en de depot-mutatiedefinities komen van de uitvoerder — valideren
//  (zie decisions/0077).
// ============================================================

const fmt1 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ±-notatie met echte minus (U+2212), 1 decimaal — prototype-conventie. */
const fmtSigned1 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))}`;

function Pijl({ richting }: { richting: Richting | null }) {
  if (richting === "op") return <span className="text-ok-ink text-[11px]">▲</span>;
  if (richting === "neer") return <span className="text-err-ink text-[11px]">▼</span>;
  return null;
}

/** ±-cel met kleur (groen = voedt het depot, rood = put uit) — prototype. */
function SignedCel({ waarde, vet }: { waarde: number | null; vet?: boolean }) {
  if (waarde === null) return <span className="text-muted">—</span>;
  const kleur = waarde > 0 ? "text-ok-ink" : waarde < 0 ? "text-err-ink" : "text-ink";
  return <span className={`${kleur} ${vet ? "font-semibold" : ""}`}>{fmtSigned1(waarde)}</span>;
}

// ── Uitputtingsgrafiek (pure SVG, prototype-geometrie 460×220) ───────────────
function UitputtingChart({ u }: { u: UitputtingAfleiding }) {
  if (u.punten.length === 0) {
    return (
      <div className="text-sm text-muted">
        Geen uitputtingsprognose beschikbaar voor deze periode. De prognose is een aangeleverde
        ALM-reeks (upload/levering — geen handinvoer).
      </div>
    );
  }
  const yMax = Math.max(...u.punten.map((p) => p.waarde), u.ondergrensBedrag ?? 0) * 1.1 || 1;
  const x0 = 40;
  const x1 = 450;
  const yTop = 10;
  const yAs = 180;
  const stapX = u.punten.length > 1 ? (x1 - 12 - (x0 + 20)) / (u.punten.length - 1) : 0;
  const xVan = (i: number) => x0 + 20 + i * stapX;
  const yVan = (w: number) => yAs - (w / yMax) * (yAs - yTop);
  const halfWaarde = yMax / 2;
  const punten = u.punten.map((p, i) => ({ ...p, x: xVan(i), y: yVan(p.waarde) }));
  return (
    <svg viewBox="0 0 460 220" className="w-full h-auto" role="img" aria-label="Uitputting compensatiedepot">
      <line x1={x0} y1={yTop} x2={x0} y2={yAs} stroke="#e6e8ec" />
      <line x1={x0} y1={yAs} x2={x1} y2={yAs} stroke="#e6e8ec" />
      <line x1={x0} y1={yVan(halfWaarde)} x2={x1} y2={yVan(halfWaarde)} stroke="#f0f1f4" />
      <text x={8} y={yVan(yMax / 1.1) + 4} fontSize={10} fill="#6b7280">
        {Math.round(yMax / 1.1)}
      </text>
      <text x={8} y={yVan(halfWaarde) + 4} fontSize={10} fill="#6b7280">
        {Math.round(halfWaarde)}
      </text>
      <text x={14} y={yAs + 4} fontSize={10} fill="#6b7280">
        0
      </text>
      {u.ondergrensBedrag !== null && (
        <>
          <line
            x1={x0}
            y1={yVan(u.ondergrensBedrag)}
            x2={x1}
            y2={yVan(u.ondergrensBedrag)}
            stroke="#b45309"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text x={x1} y={yVan(u.ondergrensBedrag) - 4} fontSize={9.5} fill="#8a4208" textAnchor="end">
            ondergrens € {fmt1(u.ondergrensBedrag)} mln
          </text>
        </>
      )}
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.5}
        points={punten.map((p) => `${p.x},${p.y}`).join(" ")}
      />
      <g fill="var(--accent)">
        {punten.map((p) => (
          <circle key={p.jaar} cx={p.x} cy={p.y} r={3.5} />
        ))}
      </g>
      <g fontSize={9.5} fill="#6b7280" textAnchor="middle">
        {punten.map((p) => (
          <text key={p.jaar} x={p.x} y={196}>
            {p.jaar}
          </text>
        ))}
      </g>
    </svg>
  );
}

export default async function PremiePage({
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
    haalStuurinfoPremie(fondsId, typeof periode === "string" ? periode : undefined),
  ]);
  const fondsNaam = fondsRes.data?.naam ?? "";

  const huidigLabel = data.gekozenPeriode ? formatteerPeriode(data.gekozenPeriode.periode) : null;
  const vorigLabel = data.vorigePeriode ? formatteerPeriode(data.vorigePeriode.periode) : null;
  const d: Ontwikkeling = data.depotHuidig;
  const dv = data.depotVorig;
  const u = data.uitputting;
  const heeftData =
    d.stand !== null || d.totaalMutatie !== null || data.premie.totaalHuidig !== null;
  const ultimoRichting =
    d.ultimo !== null && dv?.ultimo != null ? richtingVan(d.ultimo, dv.ultimo) : null;

  return (
    <StuurinfoShell
      actieveTab="premie"
      fondsNaam={fondsNaam}
      regelingLabel={data.regelingLabel}
      gekozenPeriode={data.gekozenPeriode}
      periodes={data.periodes}
      financieringsgraad={data.financieringsgraad}
    >
      {!data.gekozenPeriode ? (
        <div className="si-card text-sm text-muted">
          Er zijn nog geen rapportageperiodes beschikbaar voor dit fonds.
        </div>
      ) : !heeftData ? (
        <div className="si-card text-sm text-muted">
          Geen premie- en compensatiedata beschikbaar voor {huidigLabel}. Een voorzitter of
          beheerder kan de gegevens invoeren via Beheer › Stuurinformatie (sectie Premie &amp;
          compensatie).
        </div>
      ) : (
        <>
          {/* Consistentie-signaal: afgeleide ultimo ≠ balans-stand */}
          {!d.consistent && (
            <div className="bg-err-tint border-l-2 border-err rounded-r-lg px-4 py-3 text-xs text-err-ink">
              <strong>Inconsistentie:</strong> primo + totaal mutatie (€{" "}
              {d.ultimo === null ? "—" : fmt1(d.ultimo)} mln) wijkt af van het compensatiedepot uit
              de balans (€ {d.stand === null ? "—" : fmt1(d.stand)} mln). Controleer de invoer via
              Beheer › Stuurinformatie — de balans en de mutaties horen op elkaar te sluiten (één
              bron per bedrag).
            </div>
          )}

          {/* KPI-rij — kwartaaltotaal afgeleid (besluit Merlin, geen jaarpremie-kpi) */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
          >
            <div className="si-kpi">
              <div className="text-xs text-muted">Totaal premie {huidigLabel}</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {data.premie.totaalHuidig === null ? "—" : `€ ${fmt1(data.premie.totaalHuidig)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">
                {data.premie.totaalPct === null ? "—" : `${fmt2(data.premie.totaalPct)}% v. grondslag`}
              </div>
            </div>
            <div className="si-kpi">
              <div className="text-xs text-muted">Compensatiedepot</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {d.stand === null ? "—" : `€ ${fmt1(d.stand)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">
                {u.gevuldPct === null ? "—" : `${fmt1(u.gevuldPct)}% van de startomvang`}
              </div>
            </div>
            <div className="si-kpi">
              <div className="text-xs text-muted">Toekenning / jaar</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {data.toekenningJaar === null ? "—" : `€ ${fmt1(data.toekenningJaar)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">compensatie</div>
            </div>
            <div className="si-kpi">
              <div className="text-xs text-muted">Prognose (ALM)</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {u.laatsteJaar === null || u.laatsteWaarde === null
                  ? "—"
                  : `€ ${fmt1(u.laatsteWaarde)} mln in ${u.laatsteJaar}`}
              </div>
              <div
                className={`text-xs mt-1 ${
                  u.kruisjaarOndergrens === null ? "text-muted" : "text-warn-ink"
                }`}
              >
                {u.kruisjaarOndergrens === null
                  ? "geen ondergrens-kruising in de prognose"
                  : `onder de ondergrens ± ${u.kruisjaarOndergrens}`}
              </div>
            </div>
          </div>

          {/* Premie-opbrengsten naar component */}
          <div className="si-card">
            <div className="mb-3">
              <div className="font-semibold text-ink text-sm">Premie-opbrengsten naar component</div>
              <div className="text-xs text-muted mt-0.5">
                Opbrengst per premiecomponent, per periode (€ mln) — met aandeel in de
                premiegrondslag
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="si-tabel">
                <thead>
                  <tr>
                    <th className="text-left">Premiecomponent</th>
                    <th className="text-right">% grondslag</th>
                    <th className="text-right whitespace-nowrap">
                      {huidigLabel} <span className="font-normal">huidig</span>
                    </th>
                    {vorigLabel && (
                      <th className="text-right whitespace-nowrap">
                        {vorigLabel} <span className="font-normal">vorig</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.premie.regels.map((r) => (
                    <tr key={r.key}>
                      <td className="text-ink">{r.label}</td>
                      <td className="si-num">
                        {r.pct === null ? "—" : `${fmt2(r.pct)}%`}
                      </td>
                      <td className="si-num">
                        {r.huidig === null ? "—" : fmt1(r.huidig)}
                      </td>
                      {vorigLabel && (
                        <td className="si-num text-muted">
                          {r.vorig === null ? "—" : fmt1(r.vorig)}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="si-totaalrij font-semibold">
                    <td className="text-ink">
                      Totaal premie <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                    </td>
                    <td className="si-num">
                      {data.premie.totaalPct === null ? "—" : `${fmt2(data.premie.totaalPct)}%`}
                    </td>
                    <td className="si-num">
                      {data.premie.totaalHuidig === null ? "—" : fmt1(data.premie.totaalHuidig)}
                    </td>
                    {vorigLabel && (
                      <td className="si-num text-muted">
                        {data.premie.totaalVorig === null ? "—" : fmt1(data.premie.totaalVorig)}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 si-note">
              <strong className="text-ink">% grondslag:</strong> elke component als percentage van
              de premiegrondslag; samen de totale premie. De{" "}
              <strong className="text-ink">opslagen</strong> (uitvoerings- en toekomstige kosten)
              voeden mede de operationele reserve (tab 6); de spaarpremie gaat naar de persoonlijke
              pensioenvermogens. €-bedragen en percentages zijn aangeleverd door de uitvoerder.
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {/* Ontwikkeling compensatiedepot */}
            <div className="si-card">
              <div className="mb-3">
                <div className="font-semibold text-ink text-sm">Ontwikkeling compensatiedepot</div>
                <div className="text-xs text-muted mt-0.5">
                  Primo, mutaties naar bron en ultimo — € mln
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="si-tabel">
                  <thead>
                    <tr>
                      <th className="text-left">Post</th>
                      <th className="text-right whitespace-nowrap">
                        {huidigLabel} <span className="font-normal">huidig</span>
                      </th>
                      {vorigLabel && (
                        <th className="text-right whitespace-nowrap">
                          {vorigLabel} <span className="font-normal">vorig</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-ink">Primo</td>
                      <td className="si-num">
                        {d.primo === null ? "—" : fmt1(d.primo)}
                      </td>
                      {vorigLabel && (
                        <td className="si-num text-muted">
                          {dv?.primo == null ? "—" : fmt1(dv.primo)}
                        </td>
                      )}
                    </tr>
                    {d.bronnen.map((b) => {
                      const vorigeBron = dv?.bronnen.find((x) => x.key === b.key);
                      return (
                        <tr key={b.key}>
                          <td className="pl-6 text-ink">
                            {b.key === "onttrekkingen" ? (
                              <>
                                Onttrekkingen{" "}
                                <span className="text-muted text-xs">(compensatietoekenning)</span>
                              </>
                            ) : (
                              b.label
                            )}
                          </td>
                          <td className="si-num">
                            <SignedCel waarde={b.waarde} />
                          </td>
                          {vorigLabel && (
                            <td className="si-num">
                              <SignedCel waarde={vorigeBron?.waarde ?? null} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    <tr className="font-semibold">
                      <td className="text-ink">
                        Totaal mutatie{" "}
                        <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                      </td>
                      <td className="si-num">
                        <SignedCel waarde={d.totaalMutatie} vet />
                      </td>
                      {vorigLabel && (
                        <td className="si-num">
                          <SignedCel waarde={dv?.totaalMutatie ?? null} vet />
                        </td>
                      )}
                    </tr>
                    <tr className="si-totaalrij font-semibold">
                      <td className="text-ink">
                        Ultimo <span className="text-muted text-xs italic font-normal">(afgeleid)</span>
                      </td>
                      <td className="si-num whitespace-nowrap">
                        {d.ultimo === null ? "—" : fmt1(d.ultimo)} <Pijl richting={ultimoRichting} />
                      </td>
                      {vorigLabel && (
                        <td className="si-num text-muted">
                          {dv?.ultimo == null ? "—" : fmt1(dv.ultimo)}
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3 si-note">
                <strong className="text-ink">Uitputtend:</strong> het depot is bedoeld om te worden
                uitgeput — de onttrekkingen (compensatietoekenning) overtreffen doorgaans de
                opbrengsten. De ultimo is dezelfde bron als het compensatiedepot op de balans
                (tab 1). De meerjarenprognose staat hiernaast.
              </div>
            </div>

            {/* Uitputtingsprognose */}
            <div className="si-card">
              <div className="mb-3">
                <div className="font-semibold text-ink text-sm">Uitputting compensatiedepot</div>
                <div className="text-xs text-muted mt-0.5">
                  Prognose stand bij ongewijzigde toekenning (€ mln) — aangeleverde ALM-reeks
                </div>
              </div>
              <UitputtingChart u={u} />
              <div className="mt-3 si-note">
                <strong className="text-ink">Signalering:</strong>{" "}
                {u.kruisjaarOndergrens !== null ? (
                  <>
                    bij ongewijzigd beleid daalt het depot rond {u.kruisjaarOndergrens} onder de
                    ondergrens
                    {u.laatsteJaar !== null && u.laatsteWaarde !== null
                      ? ` en resteert er in ${u.laatsteJaar} nog € ${fmt1(u.laatsteWaarde)} mln`
                      : ""}
                    . Vraagt om een bestuursbesluit over vulling of aanpassing van de toekenning.
                  </>
                ) : (
                  <>
                    de prognose kruist de ondergrens niet binnen de aangeleverde reeks. De
                    prognose-methodiek (ALM) is van de uitvoerder/adviseur — niet in het portaal
                    berekend.
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </StuurinfoShell>
  );
}
