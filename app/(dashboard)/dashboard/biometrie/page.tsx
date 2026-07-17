import { createServerSupabase } from "@/core/lib/supabase-server";
import { vereisModuleToegang } from "@/core/lib/module-gate-page";
import { haalStuurinfoBiometrie } from "@/core/lib/stuurinfo-bron";
import { formatteerPeriode } from "@/core/lib/stuurinfo-balans";
import type {
  BiometriePeriode,
  LanglevenOverzicht,
  RisicodekkingTabel,
} from "@/core/lib/stuurinfo-biometrie";
import { StuurinfoShell } from "../_components/StuurinfoShell";

// ============================================================
//  Bestuurdersdashboard — tab 3 Biometrische rendementen (T17, decisions/0078).
//  Drie sobere ontwikkelingstabellen (langleven, PP/WZP, AO/PVI) met het
//  netto/resultaat AFGELEID (stuurinfo-biometrie.ts) + een KPI-strook. De
//  oude staafgrafiek "biometrisch resultaat naar bron" is bewust vervallen.
//
//  Verrekening met de reserves (één bron over de tabs):
//   - netto langleven → solidariteitsreserve (tab 5, langleven-post in de
//     ontwikkeling — dezelfde bron, geen dubbele invoer);
//   - resultaten PP/WZP + AO/PVI → operationele reserve (tab 6, afgeleide
//     mutatieregels);
//   - binnengekomen risicopremies = de risicopremie-componenten van tab 7
//     (premie_component) — read-only referentie, één bron.
//
//  Data onder fonds-RLS; presentatie volgt het goedgekeurde prototype
//  (stuurinformatie-prototype.html, tab 3).
//  WERKHYPOTHESE (compliancegevoelig, actuarieel te valideren): de
//  verrekenrichting (langleven → soli; risicodekkingen → operationeel) en de
//  vrijval bij overlijden als aparte langleven-post naast micro-langleven zijn
//  nog niet ABTN-bevestigd.
// ============================================================

const fmt1 = (n: number) =>
  n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** ±-notatie met echte minus (U+2212), 1 decimaal — prototype-conventie. */
const fmtSigned1 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))}`;

/** ±-cel met kleur (groen = opbrengst, rood = last) — prototype. */
function SignedCel({ waarde, vet }: { waarde: number | null; vet?: boolean }) {
  if (waarde === null) return <span className="text-muted">—</span>;
  const kleur = waarde > 0 ? "text-ok-ink" : waarde < 0 ? "text-err-ink" : "text-ink";
  return <span className={`${kleur} ${vet ? "font-semibold" : ""}`}>{fmtSigned1(waarde)}</span>;
}

/** KPI-tegel met ±-kleuring (mln) + delta t.o.v. het voorgaande kwartaal. */
function Kpi({
  label,
  waarde,
  vorig,
  sub,
}: {
  label: string;
  waarde: number | null;
  vorig: number | null;
  sub: string;
}) {
  const kleur =
    waarde === null ? "text-ink" : waarde > 0 ? "text-ok-ink" : waarde < 0 ? "text-err-ink" : "text-ink";
  const delta = waarde !== null && vorig !== null ? waarde - vorig : null;
  return (
    <div className="si-kpi">
      <div className="si-kpi-label">{label}</div>
      <div className={`si-kpi-waarde ${kleur}`}>
        {waarde === null ? "—" : `€ ${fmtSigned1(waarde)} mln`}
      </div>
      <div className="si-kpi-sub">
        {delta === null ? sub : `${fmtSigned1(delta)} mln t.o.v. vorig kwartaal`}
      </div>
    </div>
  );
}

/** Eén risicodekkingstabel (PP/WZP of AO/PVI): premie − toegekend = resultaat. */
function RisicoTabel({
  titel,
  premieLabel,
  toegekendLabel,
  resultaatLabel,
  premieBetreft,
  toegekendBetreft,
  tabel,
  note,
}: {
  titel: string;
  premieLabel: React.ReactNode;
  toegekendLabel: string;
  resultaatLabel: string;
  premieBetreft: string;
  toegekendBetreft: string;
  tabel: RisicodekkingTabel;
  note: React.ReactNode;
}) {
  return (
    <div className="si-card">
      <div className="mb-1 font-semibold text-ink text-sm">{titel}</div>
      <div className="text-xs text-muted mb-3">
        Binnengekomen risicopremie minus toegekende dekkingen (€ mln) — verrekend met de
        operationele reserve
      </div>
      <div className="overflow-x-auto">
        <table className="si-tabel">
          <thead>
            <tr>
              <th className="text-left">Bron</th>
              <th className="si-num">Resultaat</th>
              <th className="text-left">Betreft</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{premieLabel}</td>
              <td className="si-num">
                <SignedCel waarde={tabel.premie} />
              </td>
              <td className="text-muted">{premieBetreft}</td>
            </tr>
            <tr>
              <td>{toegekendLabel}</td>
              <td className="si-num">
                <SignedCel waarde={tabel.toegekend} />
              </td>
              <td className="text-muted">{toegekendBetreft}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="si-totaalrij">
              <td>{resultaatLabel}</td>
              <td className="si-num">
                <SignedCel waarde={tabel.resultaat} vet />
              </td>
              <td className="text-muted">→ operationele reserve</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="si-note mt-3">{note}</div>
    </div>
  );
}

function LanglevenTabel({ langleven }: { langleven: LanglevenOverzicht }) {
  const betreft: Record<string, string> = {
    micro: "Gepensioneerden",
    macro: "Alle cohorten",
    vrijval: "Gepensioneerden",
  };
  return (
    <div className="si-card">
      <div className="mb-1 font-semibold text-ink text-sm">Toelichting &amp; effect op kapitalen</div>
      <div className="text-xs text-muted mb-3">
        Langleven-resultaat naar bron (€ mln) — verrekend met de solidariteitsreserve
      </div>
      <div className="overflow-x-auto">
        <table className="si-tabel">
          <thead>
            <tr>
              <th className="text-left">Bron</th>
              <th className="si-num">Resultaat</th>
              <th className="text-left">Grootste effect op</th>
            </tr>
          </thead>
          <tbody>
            {langleven.bronnen.map((b) => (
              <tr key={b.key}>
                <td>{b.label}</td>
                <td className="si-num">
                  <SignedCel waarde={b.waarde} />
                </td>
                <td className="text-muted">{betreft[b.key] ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="si-totaalrij">
              <td>Netto langleven resultaat</td>
              <td className="si-num">
                <SignedCel waarde={langleven.netto} vet />
              </td>
              <td className="text-muted">→ solidariteitsreserve</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="si-note mt-3">
        <strong className="text-ink">Verrekening met de solidariteitsreserve:</strong> het
        langleven-resultaat kent zowel lasten (micro- en macro-langleven, doordat mensen langer
        leven dan verondersteld) als een <strong className="text-ink">opbrengst</strong>: de vrijval
        van kapitaal bij overlijden. Het{" "}
        <strong className="text-ink">netto langleven resultaat</strong> wordt verrekend met de
        solidariteitsreserve (zie tab 5) — dezelfde bron, geen dubbele invoer. Macro-langleven
        (aanpassing prognosetafel) domineert doorgaans het negatieve resultaat.
      </div>
    </div>
  );
}

const heeftBiometrie = (b: BiometriePeriode): boolean =>
  b.langleven.bronnen.some((r) => r.waarde !== null) ||
  b.ppwzp.toegekend !== null ||
  b.aopvi.toegekend !== null;

export default async function BiometriePage({
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
    haalStuurinfoBiometrie(fondsId, typeof periode === "string" ? periode : undefined),
  ]);
  const fondsNaam = fondsRes.data?.naam ?? "";

  const huidigLabel = data.gekozenPeriode ? formatteerPeriode(data.gekozenPeriode.periode) : null;
  const o = data.huidig;
  const v = data.vorig;
  const bronVan = (b: BiometriePeriode, key: string) =>
    b.langleven.bronnen.find((r) => r.key === key)?.waarde ?? null;

  return (
    <StuurinfoShell
      actieveTab="biometrie"
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
      ) : !heeftBiometrie(o) ? (
        <div className="si-card text-sm text-muted">
          Geen biometrische data beschikbaar voor {huidigLabel}. Een voorzitter of beheerder kan de
          bronnen invoeren via Beheer › Stuurinformatie (sectie 3 · Biometrisch).
        </div>
      ) : (
        <>
          {/* KPI-strook (prototypevolgorde) */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
          >
            <Kpi
              label="Netto langleven resultaat"
              waarde={o.langleven.netto}
              vorig={v?.langleven.netto ?? null}
              sub={huidigLabel ?? ""}
            />
            <Kpi
              label="Micro-langleven"
              waarde={bronVan(o, "micro")}
              vorig={v ? bronVan(v, "micro") : null}
              sub="individueel"
            />
            <Kpi
              label="Macro-langleven"
              waarde={bronVan(o, "macro")}
              vorig={v ? bronVan(v, "macro") : null}
              sub="trend"
            />
            <Kpi
              label="Vrijval bij overlijden"
              waarde={bronVan(o, "vrijval")}
              vorig={v ? bronVan(v, "vrijval") : null}
              sub="kapitaalvrijval"
            />
          </div>

          <LanglevenTabel langleven={o.langleven} />

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            <RisicoTabel
              titel="Resultaat partner-/wezenpensioen (PP/WZP)"
              premieLabel={
                <>
                  Binnengekomen premie <span className="text-muted text-xs">(risicopremie PP/WZP)</span>
                </>
              }
              toegekendLabel="Toegekende PP/WZP"
              resultaatLabel="Resultaat PP/WZP"
              premieBetreft="van actieven"
              toegekendBetreft="aan nabestaanden"
              tabel={o.ppwzp}
              note={
                <>
                  <strong className="text-ink">Verrekening met de operationele reserve:</strong> de
                  risicodekking PP/WZP is de binnengekomen risicopremie minus de in de periode
                  toegekende partner-/wezenpensioenen. Het saldo loopt via de operationele reserve
                  (tab 6). De binnengekomen premie is dezelfde bron als de risicopremie PP/WZP in
                  tab 7.
                </>
              }
            />
            <RisicoTabel
              titel="Resultaat AO / premievrijstelling (AO/PVI)"
              premieLabel={
                <>
                  Binnengekomen premie{" "}
                  <span className="text-muted text-xs">(risicopremie AOP + PVI)</span>
                </>
              }
              toegekendLabel="Toegekende AO / premievrijstelling"
              resultaatLabel="Resultaat AO/PVI"
              premieBetreft="van actieven"
              toegekendBetreft="arbeidsongeschikten"
              tabel={o.aopvi}
              note={
                <>
                  <strong className="text-ink">Verrekening met de operationele reserve:</strong> de
                  risicodekking AO/PVI is de binnengekomen risicopremie minus de toegekende
                  arbeidsongeschiktheidspensioenen en premievrijstellingen. Het saldo loopt via de
                  operationele reserve (tab 6). De binnengekomen premie is dezelfde bron als de
                  risicopremies AOP en PVI in tab 7.
                </>
              }
            />
          </div>

          <div className="si-req">
            <strong className="text-ink">Data nodig:</strong> gehanteerde biometrische grondslagen
            (prognosetafel, ervaringssterfte); langleven-resultaat per bron; binnengekomen
            risicopremie en toegekende dekkingen (PP/WZP en AO/PVI) per periode. Cohort-/tijdreeksen
            per leeftijd komen via upload/API — niet met de hand. Verrekenrichting en de
            vrijval-post: actuarieel te valideren (werkhypothese).
          </div>
        </>
      )}
    </StuurinfoShell>
  );
}
