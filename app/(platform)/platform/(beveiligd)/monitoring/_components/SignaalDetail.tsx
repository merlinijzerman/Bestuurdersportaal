// ============================================================================
//  SignaalDetail — laag 3: uitklap per rij (voorstel §4). Geen aparte pagina.
// ----------------------------------------------------------------------------
//  Hier pas de volledige verantwoording: grote trendlijn, meetdefinitie, venster,
//  meegestempelde drempels, dekkingsvoorbehoud, de VOLLEDIGE meta, eigenaar en
//  opvolgactie, de uitsplitsing per fonds en de periodesamenvatting.
//
//  De periodesamenvatting rekent op de PERIODE-gesneden trend; de status en de
//  laatste stand hierboven blijven "nu". Voor percentiel- en trendsignalen toont
//  de samenvatting de hoogste + mediane snapshot, nooit een percentiel over
//  percentielen (acceptatie 29).
// ============================================================================

import Stoplicht from "./Stoplicht";
import Trendlijn from "./Trendlijn";
import type { Rij } from "./dashboard-types";
import type { TrendPunt } from "@/platform/lib/monitoring-lees";
import {
  DEKKINGSNIVEAU_LABEL,
  piekEnMediaan,
  toonPiekInPeriode,
  vatPeriodeSamen,
  type Dekkingsniveau,
  type SignaalStatus,
} from "@/platform/lib/monitoring-signalen";
import {
  afgerond,
  beschrijfDrempels,
  formatteerVenster,
  formatteerWaarde,
} from "@/platform/lib/monitoring-format";

const NIVEAU_KLASSE: Record<Dekkingsniveau, string> = {
  volledig: "bg-ok-tint text-ok-ink border-ok/30",
  gedeeltelijk: "bg-warn-tint text-warn-ink border-warn/30",
  indicatief: "bg-app-bg text-ink/70 border-line",
  niet_in_werking: "bg-err-tint text-err-ink border-err/30",
};

function tijd(iso: string | null): string {
  if (!iso) return "nooit";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "onbekend";
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

export default function SignaalDetail({
  rij,
  trendPeriode,
  periodeLabel,
  trendAfgekapt,
  gedekteDagen,
}: {
  rij: Rij;
  trendPeriode: TrendPunt[];
  periodeLabel: string;
  trendAfgekapt: boolean;
  gedekteDagen: number;
}) {
  const { config } = rij;
  const samenvatting = vatPeriodeSamen(trendPeriode, config);
  const piek = toonPiekInPeriode(config)
    ? piekEnMediaan(trendPeriode.map((p) => p.waarde))
    : null;
  // Label eerlijk houden: bij een trendsignaal is de piek een trendpercentage,
  // geen p95. "Nooit een percentiel over percentielen" geldt voor beide, maar de
  // benaming mag niet suggereren dat tokenverbruik een p95 is (acceptatie 29).
  const piekLabel =
    config.eenheid === "trend_percentage"
      ? "Hoogste trendpercentage in de periode"
      : "Hoogste gemeten p95 in de periode";

  return (
    <div className="border-t border-line bg-app-bg/40 px-4 py-4 text-sm">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Links: trend + periodesamenvatting */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Trend &middot; {periodeLabel}
          </p>
          <div className="mt-2">
            <Trendlijn
              punten={trendPeriode}
              status={rij.status}
              drempelOranje={rij.drempelOranje}
              drempelRood={rij.drempelRood}
            />
          </div>
          {trendAfgekapt && (
            <p className="mt-1 text-xs text-warn-ink">
              De trend is afgekapt op de leeslimiet en dekt {gedekteDagen}{" "}
              {gedekteDagen === 1 ? "dag" : "dagen"} in plaats van de gevraagde periode.
            </p>
          )}

          <dl className="mt-3 space-y-1.5">
            <Regel label="Aandeel in orde">
              {samenvatting.aandeelInOrde === null
                ? "geen metingen in de periode"
                : `${afgerond(samenvatting.aandeelInOrde * 100)}% van ${samenvatting.totaal} metingen`}
            </Regel>
            <Regel label="Drempeloverschrijdingen">{samenvatting.overschrijdingen}</Regel>
            <Regel label="Langste aaneengesloten afwijking">
              {samenvatting.langsteAfwijking}{" "}
              {samenvatting.langsteAfwijking === 1 ? "meting" : "metingen"}
            </Regel>
            <Regel label="Zonder geldige uitkomst">
              {samenvatting.onbekend}{" "}
              {samenvatting.onbekend === 1 ? "meting" : "metingen"}
            </Regel>
            {piek && (
              <Regel label={piekLabel}>
                {piek.hoogste === null
                  ? "geen geldige metingen"
                  : `${formatteerWaarde(piek.hoogste, config.eenheid, false)} (mediaan ${
                      piek.mediaan === null
                        ? "—"
                        : formatteerWaarde(piek.mediaan, config.eenheid, false)
                    })`}
              </Regel>
            )}
          </dl>
        </div>

        {/* Rechts: definitie, dekking, eigenaar, opvolgactie */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Wat betekent dit
            </p>
            <p className="mt-1 text-ink/80">{config.betekenis}</p>
          </div>

          <dl className="space-y-1.5">
            <Regel label="Meetdefinitie">{config.toelichting ?? "—"}</Regel>
            <Regel label="Meetinterval">
              {config.intervalMinuten} min
              {config.vensterMinuten > 0
                ? ` over ${formatteerVenster(config.vensterMinuten)}`
                : " (momentopname)"}
            </Regel>
            <Regel label="Meegestempelde drempels">
              {beschrijfDrempels(rij.drempelOranje, rij.drempelRood, config.richting, config.eenheid)}
            </Regel>
            <Regel label="Laatst gemeten">{tijd(rij.laatsteMeting)}</Regel>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                NIVEAU_KLASSE[config.dekkingsniveau]
              }`}
            >
              Dekking: {DEKKINGSNIVEAU_LABEL[config.dekkingsniveau]}
            </span>
          </div>
          {config.dekkingsvoorbehoud && (
            <p className="rounded border border-line bg-white px-2 py-1 text-xs text-ink/60">
              {config.dekkingsvoorbehoud}
            </p>
          )}

          <div className="rounded-lg border border-line bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Wat doe je nu
            </p>
            <p className="mt-1 text-ink/80">{config.opvolgactie}</p>
            <p className="mt-1.5 text-xs text-ink/60">
              <span className="font-semibold">Eigenaar:</span> {config.eigenaar}
            </p>
          </div>
        </div>
      </div>

      {/* Uitsplitsing per fonds — alleen zinvol bij "Alle fondsen" en per-fonds signalen */}
      {!rij.platformbreed && rij.metingen.length > 0 && (
        <FondsUitsplitsing rij={rij} />
      )}

      {/* De volledige meta, letterlijk uitgeklapt */}
      {rij.meta && Object.keys(rij.meta).length > 0 && <MetaLijst meta={rij.meta} />}
    </div>
  );
}

function Regel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
      <dt className="text-xs font-semibold text-ink/60">{label}</dt>
      <dd className="text-right text-xs text-ink/80">{children}</dd>
    </div>
  );
}

function FondsUitsplitsing({ rij }: { rij: Rij }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
        Per fonds
      </p>
      <ul className="mt-2 space-y-1">
        {rij.metingen.map((m) => (
          <li
            key={`${m.signaal}-${m.fondsId ?? "platform"}`}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-ink/70">
              {m.fondsNaam ?? (m.fondsId === null ? "Platformbreed" : "Onbekend fonds")}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-ink/60">
                {m.status === "onbekend"
                  ? "—"
                  : formatteerWaarde(m.waarde, rij.config.eenheid, m.onderdrukt)}
              </span>
              <Stoplicht status={m.status as SignaalStatus} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** De volledige meta letterlijk tonen — tellingen en componentstatussen. */
function MetaLijst({ meta }: { meta: Record<string, unknown> }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
        Meetgegevens (meta)
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(meta).map(([sleutel, waarde]) => (
          <div key={sleutel} className="flex justify-between gap-3 text-xs">
            <dt className="text-ink/60">{sleutel}</dt>
            <dd className="text-right font-mono text-ink/80">{toonWaarde(waarde)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function toonWaarde(waarde: unknown): string {
  if (waarde === null || waarde === undefined) return "—";
  if (typeof waarde === "object") return JSON.stringify(waarde);
  return String(waarde);
}
