import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalStuurinfoBalans, type KpiTegel, type ReserveRegel } from "@/core/lib/stuurinfo-bron";
import { formatteerPeriode, type BalansRegel, type Richting } from "@/core/lib/stuurinfo-balans";
import { StuurinfoShell } from "./_components/StuurinfoShell";

// ============================================================
//  Bestuurdersdashboard — tab 1 Balans (T13, AZL-lijn).
//  Herstructureerde balans (activa 2 posten; passiva-hiërarchie eigen
//  vermogen → toetsvermogen + solidariteitsreserve + compensatiedepot) +
//  Overzicht reserves (ABTN-band + afgeleid stoplicht) + periodemodel
//  (gekozen periode vs. voorgaand kwartaal, paginabrede periodefilter).
//  Data uit fonds_stuurinfo_periode/-reeks/-reserve/-kpi onder fonds-RLS;
//  alle cijfers zijn synthetische demo-data. Server-side gate:
//  beschikbaarheid (manifest) + capability (stuurinformatie.view) + RLS.
//  Subtotalen, balansevenwicht en stoplicht zijn AFGELEID (stuurinfo-balans.ts).
// ============================================================

const fmt = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 0 });
const fmtBedrag = (n: number) =>
  Number.isInteger(n)
    ? fmt(n)
    : n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt1 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${fmt1(n)}%`;

function Pijl({ richting }: { richting: Richting | null }) {
  if (richting === "op") return <span className="text-ok-ink text-[11px]">▲</span>;
  if (richting === "neer") return <span className="text-err-ink text-[11px]">▼</span>;
  return <span className="text-muted text-[11px]">–</span>;
}

function KpiMutatie({ tegel, vorigLabel }: { tegel: KpiTegel; vorigLabel: string | null }) {
  if (tegel.mutatie === null || !vorigLabel) return <div className="text-xs text-muted mt-1">—</div>;
  const positief = tegel.mutatie > 0;
  const teken = positief ? "+" : tegel.mutatie < 0 ? "−" : "";
  const eenheid = tegel.mutatieEenheid === "pt" ? " %-pt" : "%";
  return (
    <div
      className={`text-xs mt-1 ${
        positief ? "text-ok-ink" : tegel.mutatie < 0 ? "text-err-ink" : "text-muted"
      }`}
    >
      {positief ? "▲" : tegel.mutatie < 0 ? "▼" : ""} {teken}
      {fmt1(Math.abs(tegel.mutatie))}
      {eenheid} t.o.v. {vorigLabel}
    </div>
  );
}

const RESERVE_CHIP: Record<
  ReserveRegel["status"],
  { tekst: string; chip: string; dot: string }
> = {
  ok: { tekst: "Binnen band", chip: "bg-ok-tint text-ok-ink", dot: "bg-ok" },
  onder: { tekst: "Onder ondergrens", chip: "bg-err-tint text-err-ink", dot: "bg-err" },
  boven: { tekst: "Boven bovengrens", chip: "bg-warn-tint text-warn-ink", dot: "bg-warn" },
  monitoring: { tekst: "Monitoring", chip: "bg-app-bg text-muted", dot: "" },
};

export default async function DashboardPage({
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
    haalStuurinfoBalans(fondsId, typeof periode === "string" ? periode : undefined),
  ]);
  const fondsNaam = fondsRes.data?.naam ?? "";

  const huidigLabel = data.gekozenPeriode ? formatteerPeriode(data.gekozenPeriode.periode) : null;
  const vorigLabel = data.vorigePeriode ? formatteerPeriode(data.vorigePeriode.periode) : null;
  // Balansdata aanwezig = op minstens één zijde meer dan de afgeleide totaalrij.
  // Beide zijden meewegen: een aanlevering met alléén passiva moet de balans
  // (en dus het niet-sluitend-signaal) tonen, niet de lege-staat.
  const heeftBalans =
    data.balans.activa.length > 1 || data.balans.evenwicht.totaalPassiva !== 0;

  return (
    <StuurinfoShell
      actieveTab="balans"
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
      ) : !heeftBalans ? (
        <div className="si-card text-sm text-muted">
          Geen balansdata beschikbaar voor {huidigLabel}.
        </div>
      ) : (
        <>
          {/* KPI-rij */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
          >
            {data.kpiTegels.map((k) => (
              <div key={k.key} className="si-kpi">
                <div className="text-xs text-muted">{k.label}</div>
                <div className="text-2xl font-bold text-ink mt-1">
                  {k.waarde === null
                    ? "—"
                    : k.eenheid === "pct"
                    ? fmtPct(k.waarde)
                    : `€ ${fmt(k.waarde)} mln`}
                </div>
                <KpiMutatie tegel={k} vorigLabel={vorigLabel} />
              </div>
            ))}
          </div>

          {/* Balans */}
          <div className="si-card">
            <div className="mb-4">
              <div className="font-semibold text-ink text-sm">Balans</div>
              <div className="text-xs text-muted mt-0.5">
                Marktwaarde, € mln — balans van het fonds. Vergelijking met het voorgaande
                kwartaal.
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
                        {vorigLabel} <span className="font-normal">vorig kwartaal</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <SectieKop titel="Activa" kolommen={vorigLabel ? 3 : 2} />
                  {data.balans.activa.map((r) => (
                    <BalansTabelRij key={r.key} r={r} toonVorig={!!vorigLabel} />
                  ))}
                  <SectieKop titel="Passiva" kolommen={vorigLabel ? 3 : 2} />
                  {data.balans.passiva.map((r) => (
                    <BalansTabelRij key={r.key} r={r} toonVorig={!!vorigLabel} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Balansevenwicht — afgeleide validatie, geen invoerveld */}
            {data.balans.evenwicht.sluit ? (
              <div className="mt-4 si-note">
                <strong className="text-ink">Structuur:</strong> cohorten verhuisd naar tab 2,
                activa teruggebracht tot twee posten, eigen vermogen volgt de hiërarchie
                toetsvermogen + solidariteitsreserve + compensatiedepot.{" "}
                <strong className="text-ink">
                  Beide balanszijden sluiten op € {fmt(data.balans.evenwicht.totaalActiva)} mln.
                </strong>
              </div>
            ) : (
              <div className="mt-4 bg-err-tint border-l-2 border-err rounded-r-lg px-4 py-3 text-xs text-err-ink">
                <strong>Balans sluit niet:</strong> totaal activa €{" "}
                {fmtBedrag(data.balans.evenwicht.totaalActiva)} mln vs. totaal passiva €{" "}
                {fmtBedrag(data.balans.evenwicht.totaalPassiva)} mln (verschil €{" "}
                {data.balans.evenwicht.verschil < 0 ? "−" : ""}
                {fmtBedrag(Math.abs(data.balans.evenwicht.verschil))} mln). Controleer de
                aanlevering voor {huidigLabel}.
              </div>
            )}
          </div>

          {/* Overzicht reserves */}
          <div className="si-card">
            <div className="mb-4">
              <div className="font-semibold text-ink text-sm">Overzicht van de reserves</div>
              <div className="text-xs text-muted mt-0.5">
                Stand t.o.v. bandbreedtes uit de financiële opzet (ABTN) — met stoplichtstatus
              </div>
            </div>

            {data.reserves.length === 0 ? (
              <div className="text-sm text-muted">
                Geen reservestanden beschikbaar voor {huidigLabel}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="si-tabel">
                  <thead>
                    <tr>
                      <th className="text-left">Reserve / maatstaf</th>
                      <th className="text-right">Stand</th>
                      <th className="text-right">Stand %</th>
                      <th className="text-right">Ondergrens</th>
                      <th className="text-right">Bovengrens</th>
                      <th className="text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reserves.map((r) => {
                      const chip = RESERVE_CHIP[r.status];
                      return (
                        <tr key={r.key} className="last:border-0">
                          <td className="text-ink">{r.label}</td>
                          <td className="si-num">
                            € {fmtBedrag(r.stand)} mln
                          </td>
                          <td className="si-num">
                            {r.pctWaarde === null ? "—" : fmtPct(r.pctWaarde)}
                          </td>
                          <td className="si-num text-muted">
                            {r.ondergrens === null ? "—" : fmtPct(r.ondergrens)}
                          </td>
                          <td className="si-num text-muted">
                            {r.bovengrens === null ? "—" : fmtPct(r.bovengrens)}
                          </td>
                          <td>
                            <span
                              className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${chip.chip}`}
                            >
                              {chip.dot ? (
                                <span className={`w-1.5 h-1.5 rounded-full ${chip.dot}`} />
                              ) : (
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ background: "var(--muted)" }}
                                />
                              )}
                              {chip.tekst}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 si-note">
              <strong className="text-ink">Grenzen:</strong> alleen de solidariteitsreserve heeft
              een formele bandbreedte uit de ABTN — daar geldt de stoplichttoets. De overige
              reserves worden ter informatie getoond («monitoring»): stand + ontwikkeling, nog
              zonder onder-/bovengrens.{" "}
              <strong className="text-ink">Compensatiedepot:</strong> uitputting wordt als
              prognose gevolgd in tab 7, niet als bandtoets hier.
            </div>
          </div>
        </>
      )}
    </StuurinfoShell>
  );
}

function SectieKop({ titel, kolommen }: { titel: string; kolommen: number }) {
  return (
    <tr>
      <td
        colSpan={kolommen}
        className="bg-app-bg text-[11px] uppercase tracking-wider text-muted font-semibold py-1.5 px-2 rounded-sm"
      >
        {titel}
      </td>
    </tr>
  );
}

function BalansTabelRij({ r, toonVorig }: { r: BalansRegel; toonVorig: boolean }) {
  const inspring = r.niveau === 2 ? "pl-10" : r.niveau === 1 ? "pl-6" : "";
  const stijl = r.subtotaal
    ? r.key === "toetsvermogen"
      ? "italic text-ink"
      : "font-semibold text-ink"
    : r.niveau === 2
    ? "text-muted"
    : "text-ink";
  return (
    <tr className={`last:border-0${r.subtotaal && r.key !== "toetsvermogen" ? " si-totaalrij" : ""}`}>
      <td className={`${inspring} ${stijl}`}>
        {r.label}
        {r.key === "tv" && <span className="text-muted italic"> (kapitalen deelnemers)</span>}
      </td>
      <td className={`si-num whitespace-nowrap ${r.subtotaal ? "font-semibold" : ""}`}>
        {fmtBedrag(r.huidig)} <Pijl richting={r.richting} />
      </td>
      {toonVorig && (
        <td className={`si-num text-muted ${r.subtotaal ? "font-semibold" : ""}`}>
          {r.vorig === null ? "—" : fmtBedrag(r.vorig)}
        </td>
      )}
    </tr>
  );
}
