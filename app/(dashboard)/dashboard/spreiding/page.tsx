import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalStuurinfoSpreiding } from "@/core/lib/stuurinfo-bron";
import { formatteerPeriode, type Richting } from "@/core/lib/stuurinfo-balans";
import type { SpreidingRegel } from "@/core/lib/stuurinfo-spreiding";
import { StuurinfoShell } from "../_components/StuurinfoShell";

// ============================================================
//  Bestuurdersdashboard — tab 4 Spreidingsbeleid (T15, decisions/0076).
//  Model collectieve uitkeringsfase: kerncijfertabel (beschikbaar vermogen −
//  voorziening = spreidingsvermogen; financieringsgraad; aanpassingsfactor)
//  + financieringsgraad-trend met bandbreedte. Spreidingsvermogen en FG zijn
//  AFGELEID (stuurinfo-spreiding.ts); de aanpassingsfactor is een aangeleverde
//  waarde van de actuaris (ABTN) en wordt bewust niet nagerekend. Data uit
//  fonds_stuurinfo_kpi/-reeks onder fonds-RLS; presentatie volgt het
//  goedgekeurde prototype (stuurinformatie-prototype.html, tab 4).
//  WERKHYPOTHESE (compliancegevoelig): collectieve-uitkeringsfase-model en
//  band 85–115 — valideren met de actuaris (zie decisions/0076).
// ============================================================

const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });
const fmtBedrag = (n: number) =>
  Number.isInteger(n)
    ? fmt(n)
    : n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt1 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${fmt1(n)}%`;
const fmtSignedPct = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;

function Pijl({ richting }: { richting: Richting | null }) {
  if (richting === "op") return <span className="text-ok-ink text-[11px]">▲</span>;
  if (richting === "neer") return <span className="text-err-ink text-[11px]">▼</span>;
  return null;
}

/** Celtekst per eenheid (mln = hele € mln; pct = 1 dec; pct_signed = ±2 dec). */
function celTekst(r: SpreidingRegel, waarde: number | null): string {
  if (waarde === null) return "—";
  if (r.eenheid === "mln") return fmtBedrag(waarde);
  if (r.eenheid === "pct_signed") return fmtSignedPct(waarde);
  return fmtPct(waarde);
}

// ── FG-trendgrafiek (pure SVG, prototype-geometrie 720×250, y: 80–120%) ─────
function FgTrendChart({
  reeks,
  bandOnder,
  bandBoven,
}: {
  reeks: Array<{ label: string; waarde: number }>;
  bandOnder: number | null;
  bandBoven: number | null;
}) {
  const y = (v: number) => 20 + (120 - v) * 4.5;
  const n = reeks.length;
  const x = (i: number) => (n === 1 ? 375 : 60 + i * (630 / (n - 1)));
  const pad = reeks.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.waarde).toFixed(1)}`).join(" ");
  const laatste = reeks[n - 1];
  const grid = [120, 110, 100, 90, 80];

  return (
    <svg
      viewBox="0 0 720 250"
      className="w-full h-auto"
      role="img"
      aria-label="Financieringsgraad uitkeringsfase"
    >
      {grid.map((v) => (
        <g key={v}>
          <line
            x1={40}
            x2={712}
            y1={y(v)}
            y2={y(v)}
            stroke={v === 100 ? "#e6e8ec" : "#f0f1f4"}
            strokeWidth={1}
          />
          <text x={8} y={y(v) + 3} fontSize={10} fill="#6b7280">
            {v}%
          </text>
        </g>
      ))}
      {bandBoven !== null && (
        <line x1={40} x2={712} y1={y(bandBoven)} y2={y(bandBoven)} stroke="#e0b978" strokeWidth={2} strokeDasharray="8,5" />
      )}
      {bandOnder !== null && (
        <line x1={40} x2={712} y1={y(bandOnder)} y2={y(bandOnder)} stroke="#e0b978" strokeWidth={2} strokeDasharray="8,5" />
      )}
      <path d={pad} fill="none" stroke="#C4622D" strokeWidth={2.5} />
      {laatste && (
        <text
          x={x(n - 1)}
          y={y(laatste.waarde) - 7}
          fontSize={11}
          fill="#C4622D"
          textAnchor="end"
          fontWeight={600}
        >
          {fmt1(laatste.waarde)}%
        </text>
      )}
      {reeks.map((p, i) => (
        <text key={p.label + i} x={x(i)} y={222} fontSize={9.5} fill="#6b7280" textAnchor="middle">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

export default async function SpreidingPage({
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
    haalStuurinfoSpreiding(fondsId, typeof periode === "string" ? periode : undefined),
  ]);
  const fondsNaam = fondsRes.data?.naam ?? "";

  const huidigLabel = data.gekozenPeriode ? formatteerPeriode(data.gekozenPeriode.periode) : null;
  const vorigLabel = data.vorigePeriode ? formatteerPeriode(data.vorigePeriode.periode) : null;
  const heeftData =
    data.kerncijfers.beschikbaar !== null ||
    data.kerncijfers.voorziening !== null ||
    data.kerncijfers.aanpassingsfactor !== null;

  const fgRegel = data.tabel.find((r) => r.key === "financieringsgraad");
  const fgMutatie =
    fgRegel && fgRegel.huidig !== null && fgRegel.vorig !== null
      ? fgRegel.huidig - fgRegel.vorig
      : null;
  const { bandOnder, bandBoven } = data.kerncijfers;

  return (
    <StuurinfoShell
      actieveTab="spreiding"
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
          Geen spreidingsdata beschikbaar voor {huidigLabel}. Een voorzitter of beheerder kan de
          kerncijfers invoeren via Beheer › Stuurinformatie (sectie Spreiding).
        </div>
      ) : (
        <>
          {/* KPI-rij (prototypevolgorde) */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
          >
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Financieringsgraad uitkeringsfase</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {data.afgeleid.financieringsgraad === null ? "—" : fmtPct(data.afgeleid.financieringsgraad)}
              </div>
              <div
                className={`text-xs mt-1 ${
                  fgMutatie === null ? "text-muted" : fgMutatie > 0 ? "text-ok-ink" : fgMutatie < 0 ? "text-err-ink" : "text-muted"
                }`}
              >
                {fgMutatie === null || !vorigLabel
                  ? "—"
                  : `${fgMutatie > 0 ? "▲ +" : fgMutatie < 0 ? "▼ −" : ""}${fmt1(Math.abs(fgMutatie))} %-pt t.o.v. ${vorigLabel}`}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Aanpassingsfactor (na spreiden)</div>
              <div
                className={`text-2xl font-bold mt-1 ${
                  data.kerncijfers.aanpassingsfactor === null
                    ? "text-ink"
                    : data.kerncijfers.aanpassingsfactor > 0
                    ? "text-ok-ink"
                    : data.kerncijfers.aanpassingsfactor < 0
                    ? "text-err-ink"
                    : "text-ink"
                }`}
              >
                {data.kerncijfers.aanpassingsfactor === null
                  ? "—"
                  : fmtSignedPct(data.kerncijfers.aanpassingsfactor)}
              </div>
              <div className="text-xs text-muted mt-1">toegekend dit kwartaal</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Spreidingsvermogen</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {data.afgeleid.spreidingsvermogen === null
                  ? "—"
                  : `€ ${fmtBedrag(data.afgeleid.spreidingsvermogen)} mln`}
              </div>
              <div className="text-xs text-muted mt-1">nog uit te smeren</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Bandbreedte</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {bandOnder !== null && bandBoven !== null ? `${fmt(bandOnder)}–${fmt(bandBoven)}%` : "—"}
              </div>
              <div className="text-xs text-muted mt-1">beleid</div>
            </div>
          </div>

          {/* Kerncijfertabel — ontwikkeling collectieve uitkeringsfase */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="mb-4">
              <div className="font-semibold text-ink text-sm">
                Ontwikkeling collectieve uitkeringsfase
              </div>
              <div className="text-xs text-muted mt-0.5">
                Beschikbaar vermogen, benodigde voorziening en het verschil (spreidingsvermogen) — €
                mln
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
                  {data.tabel.map((r, i) => {
                    // Spacer tussen de €-regels en de percentageregels (prototype).
                    const spacer = r.key === "financieringsgraad";
                    const vet = r.key === "spreidingsvermogen";
                    return (
                      <SpreidingRij
                        key={r.key}
                        r={r}
                        vet={vet}
                        spacerBoven={spacer && i > 0}
                        toonVorig={!!vorigLabel}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
              <strong className="text-ink">Zo lees je dit:</strong> het{" "}
              <strong className="text-ink">spreidingsvermogen</strong> is het verschil tussen wat er
              is (beschikbaar) en wat nodig is voor de uitkeringen (voorziening). Een positief saldo
              is een buffer die niet in één keer, maar <strong className="text-ink">uitgesmeerd</strong>{" "}
              in de uitkeringen wordt verwerkt. De{" "}
              <strong className="text-ink">aanpassingsfactor (na spreiden)</strong> is wat er dit
              kwartaal daadwerkelijk aan de uitkeringen wordt toegekend
              {data.kerncijfers.aanpassingsfactor !== null && data.kerncijfers.aanpassingsfactor !== 0 && (
                <>
                  : {fmtSignedPct(data.kerncijfers.aanpassingsfactor)} betekent dat de uitkeringen
                  met {fmtSignedPct(Math.abs(data.kerncijfers.aanpassingsfactor)).slice(1)}{" "}
                  {data.kerncijfers.aanpassingsfactor > 0 ? "stijgen" : "dalen"}
                </>
              )}
              . De factor komt kant-en-klaar van de actuaris (ABTN) en wordt hier bewust niet
              nagerekend.
            </div>
          </div>

          {/* FG-trend met bandbreedte */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="mb-4">
              <div className="font-semibold text-ink text-sm">
                Financieringsgraad collectieve uitkeringsfase
              </div>
              <div className="text-xs text-muted mt-0.5">
                Verloop t.o.v. de bandbreedte
                {bandOnder !== null && bandBoven !== null
                  ? ` (${fmt(bandOnder)}–${fmt(bandBoven)}%)`
                  : ""}
              </div>
            </div>

            {data.maandreeks.length === 0 ? (
              <div className="text-sm text-muted">
                Geen maandreeks beschikbaar voor {huidigLabel} — de reeks wordt via de
                gegevensaanlevering (upload) gevuld.
              </div>
            ) : (
              <>
                <FgTrendChart reeks={data.maandreeks} bandOnder={bandOnder} bandBoven={bandBoven} />
                <div className="flex items-center gap-4 mt-2 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-[3px] rounded" style={{ background: "#C4622D" }} />
                    Financieringsgraad uitkeringsfase
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-[3px] rounded" style={{ background: "#e0b978" }} />
                    Bandbreedte
                  </span>
                </div>
                <div className="mt-3 bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
                  Verloop van de financieringsgraad van de collectieve uitkeringsfase over de
                  getoonde maanden, ten opzichte van de bandbreedte uit het spreidingsbeleid.
                </div>
              </>
            )}
          </div>

          {/* Evenwichtigheids-aandachtspunt (prototype) */}
          <div className="bg-app-bg border-l-2 border-accent rounded-r-lg px-4 py-3 text-xs text-muted">
            <strong className="text-ink">Aandachtspunt evenwichtigheid:</strong> uitsmeren schuift
            resultaat door de tijd — nieuwe gepensioneerden en zittende gepensioneerden delen anders
            in het spreidingsvermogen. Expliciet toetsen of dat evenwichtig uitpakt.
          </div>
        </>
      )}
    </StuurinfoShell>
  );
}

function SpreidingRij({
  r,
  vet,
  spacerBoven,
  toonVorig,
}: {
  r: SpreidingRegel;
  vet: boolean;
  spacerBoven: boolean;
  toonVorig: boolean;
}) {
  return (
    <>
      {spacerBoven && (
        <tr>
          <td colSpan={toonVorig ? 3 : 2} className="py-1" />
        </tr>
      )}
      <tr className="border-b border-line last:border-0">
        <td className={`py-2 pr-3 ${vet ? "font-semibold" : ""} text-ink`}>
          {r.label}
          {r.afgeleid && <span className="text-muted text-xs italic"> (afgeleid)</span>}
        </td>
        <td className={`py-2 pl-3 text-right tabular-nums whitespace-nowrap ${vet ? "font-semibold" : ""}`}>
          {celTekst(r, r.huidig)} <Pijl richting={r.richting} />
        </td>
        {toonVorig && (
          <td className={`py-2 pl-3 text-right tabular-nums text-muted ${vet ? "font-semibold" : ""}`}>
            {celTekst(r, r.vorig)}
          </td>
        )}
      </tr>
    </>
  );
}
