// ============================================================================
//  Platform — Monitoring (P5/P4-light stoplichtpagina)
// ----------------------------------------------------------------------------
//  Toont de acht signalen uit FO §19 die na deze tranche een bron hebben, elk
//  met een stoplicht, de laatste waarde en een trendlijn over zeven dagen.
//
//  AUTORISATIE — achter `platform.observability.read`, NIET achter de
//  tenant-rol `beheerder`. Dat is no-regret-besluit 1 uit FO §20.1 en de daar
//  expliciet benoemde valkuil ("voor nu even monitoring via beheerder doen").
//  Dubbele check, zoals op de contact-inbox: een vriendelijke voorcheck zodat de
//  gebruiker een uitleg krijgt in plaats van een kale weigering, plus de échte
//  server-side afdwinging binnen withPlatformRead (live AAL2-hercheck,
//  actief-check, capabilitycheck) die óók een result-event schrijft.
//
//  AGGREGAAT-FIRST — er staat geen enkel individu-herleidbaar gegeven op deze
//  pagina. Signalen die op gebruikersgedrag leunen dragen een n-drempel (n<10,
//  besluit 0055) en tonen dan "Onbekend" in plaats van een waarde.
//
//  SIGNAAL 14 — het aantal onvolledige audit-paren staat hier als AGGREGAAT.
//  FO §19 hangt signaal 14 aan `platform.logs.read`; die capability is nodig voor
//  DOORKLIK naar de logregels, en dat kan hier dan ook niet. De telling zelf is
//  privacy-neutraal (geen identiteiten, geen correlatie-id's) en hoort op het
//  operationele dashboard. Bewuste, vastgelegde afwijking — zie besluit 0106.
//
//  ZELFMONITORING — een verouderde snapshot maakt een signaal GRIJS, nooit
//  groen, en bovenaan staat wanneer er voor het laatst is gemeten. Een blinde
//  monitor die "alles in orde" meldt is het risico dat FO §18.2 benoemt.
// ============================================================================

import { withPlatformRead, PlatformError } from "@/platform/lib/platform-wrapper";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import {
  haalMonitoringOverzicht,
  type MonitoringOverzicht,
  type SignaalWeergave,
} from "@/platform/lib/monitoring-lees";
import { SUPPRESSIE_DREMPEL } from "@/core/lib/suppressie";
import Stoplicht, { StoplichtLegenda } from "./_components/Stoplicht";
import Trendlijn from "./_components/Trendlijn";

export const dynamic = "force-dynamic";

const CAPABILITY = "platform.observability.read" as const;

export default async function MonitoringPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const caps = identiteit?.capabilities ?? [];

  if (!caps.includes(CAPABILITY)) {
    return (
      <Omhulsel>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen recht om de monitoring in te zien. Dit vereist{" "}
          <code className="font-mono">{CAPABILITY}</code>.
        </div>
      </Omhulsel>
    );
  }

  let overzicht: MonitoringOverzicht;
  try {
    overzicht = await withPlatformRead(
      { capability: CAPABILITY, handeling: "monitoring.dashboard.inzien" },
      async (svc) => {
        const uit = await haalMonitoringOverzicht(svc);
        // Effect = tellingen, nooit meetwaarden of fondsnamen.
        return {
          resultaat: uit,
          effect: { signalen: uit.signalen.length, snapshotrijen: uit.gelezenRijen },
        };
      }
    );
  } catch (e) {
    if (!(e instanceof PlatformError)) throw e;
    return (
      <Omhulsel>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          De monitoring kon niet worden geopend ({e.foutcode}). Log opnieuw in met
          tweefactorauthenticatie of neem contact op met een platformbeheerder.
        </div>
      </Omhulsel>
    );
  }

  const verouderd = overzicht.signalen.filter((s) => s.verouderd).length;

  return (
    <Omhulsel>
      <MonitorStatus
        laatste={overzicht.laatsteSnapshot}
        verouderd={verouderd}
        leesfout={overzicht.leesfout}
        trendAfgekapt={overzicht.trendAfgekapt}
      />

      <StoplichtLegenda />

      <div className="grid gap-4 lg:grid-cols-2">
        {overzicht.signalen.map((s) => (
          <SignaalKaart key={`${s.signaal}-${s.fondsId ?? "platform"}`} signaal={s} />
        ))}
      </div>

      <p className="text-xs text-ink/50">
        Alle waarden zijn aggregaten. Signalen die op gebruik leunen worden
        onderdrukt bij minder dan {SUPPRESSIE_DREMPEL} waarnemingen
        (besluit 0055). Er is in deze fase géén alerting: rode drempels sturen
        geen bericht — kijk hier, of stel alerting als aparte tranche in.
      </p>
    </Omhulsel>
  );
}

function Omhulsel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Monitoring</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Operationele en technische signalen over de keten: verwerking, AI,
          beschikbaarheid en de volledigheid van het auditspoor. Metadata en
          telemetrie &mdash; geen fondsinhoud en geen gegevens over individuele
          gebruikers.
        </p>
      </div>
      {children}
    </div>
  );
}

/** De monitor over de monitor: leeft de snapshot-job nog? */
function MonitorStatus({
  laatste,
  verouderd,
  leesfout,
  trendAfgekapt,
}: {
  laatste: string | null;
  verouderd: number;
  leesfout: boolean;
  trendAfgekapt: boolean;
}) {
  // Een leesfout is iets ANDERS dan "nog nooit gemeten". Die twee door elkaar
  // halen levert een verkeerde diagnose, met stelligheid gebracht: de operator
  // gaat de cron controleren terwijl de meting gewoon niet gelezen kon worden.
  if (leesfout) {
    return (
      <div className="rounded-lg border border-err/30 bg-err-tint px-4 py-3 text-sm text-err-ink">
        <strong>De monitoringgegevens konden niet worden gelezen.</strong> De
        metingen hieronder zijn daarom niet actueel — dit zegt niets over de
        gezondheid van de keten, alleen dat het dashboard er niet bij kan.
        Controleer de databaseverbinding van het beheer-project.
      </div>
    );
  }
  if (!laatste) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn-tint px-4 py-3 text-sm text-warn-ink">
        <strong>Er is nog nooit gemeten.</strong> De snapshot-job heeft geen enkele
        meting geschreven. Controleer of de cron draait in het beheer-project
        (<code className="font-mono">/api/platform/monitoring/snapshot</code>) en of{" "}
        <code className="font-mono">CRON_SECRET</code> is gezet. Zolang dit zo is,
        zegt geen enkel signaal hieronder iets.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-ink/70">Laatste meting</span>
        <span className="font-medium text-ink">{formatteerTijd(laatste)}</span>
      </div>
      {trendAfgekapt && (
        <p className="mt-2 text-xs text-ink/60">
          De trendlijnen zijn afgekapt op de leeslimiet en tonen minder dan zeven
          dagen. De laatste stand per signaal klopt wel.
        </p>
      )}
      {verouderd > 0 && (
        <p className="mt-2 text-xs text-warn-ink">
          {verouderd === 1
            ? "Eén signaal is niet recent gemeten en staat daarom op Onbekend"
            : `${verouderd} signalen zijn niet recent gemeten en staan daarom op Onbekend`}{" "}
          &mdash; niet op groen. Een stilgevallen meting is geen bewijs dat het goed gaat.
        </p>
      )}
    </div>
  );
}

function SignaalKaart({ signaal: s }: { signaal: SignaalWeergave }) {
  const toelichting = s.onderdrukt
    ? `onderdrukt (n<${s.config.nDrempel})`
    : s.verouderd
      ? "laatste meting te oud voor het meetinterval"
      : null;

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-base font-bold text-ink">{s.config.label}</h2>
          {s.fondsNaam && (
            <p className="mt-0.5 text-xs text-ink/60">Fonds: {s.fondsNaam}</p>
          )}
          {!s.fondsNaam && s.fondsId === null && !s.config.platformbreed && (
            <p className="mt-0.5 text-xs text-ink/60">Niet aan een fonds gekoppeld</p>
          )}
        </div>
        <Stoplicht status={s.status} toelichting={toelichting} />
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-serif text-2xl font-bold text-ink">
          {formatteerWaarde(s)}
        </span>
        {s.n !== null && (
          <span className="text-xs text-ink/50">
            {s.n} {s.n === 1 ? "waarneming" : "waarnemingen"}
          </span>
        )}
      </div>

      <dl className="mt-2 space-y-0.5 text-[11px] text-ink/60">
        <div>
          <span className="font-semibold">Drempels:</span>{" "}
          {beschrijfDrempels(s)}
        </div>
        <div>
          <span className="font-semibold">Meetinterval:</span>{" "}
          {s.config.intervalMinuten} min
          {s.config.vensterMinuten > 0
            ? ` over ${formatteerVenster(s.config.vensterMinuten)}`
            : " (momentopname)"}
        </div>
        <div>
          <span className="font-semibold">Laatste meting:</span>{" "}
          {s.laatsteMeting ? formatteerTijd(s.laatsteMeting) : "nooit"}
        </div>
      </dl>

      {s.config.toelichting && (
        <p className="mt-2 text-[11px] text-ink/50">{s.config.toelichting}</p>
      )}

      {/* Het dekkingsvoorbehoud komt uit de code, niet uit platform_signaal_config:
          het is een eigenschap van de meting en mag niet met een SQL-update
          verdwijnen. Daarom ook visueel apart van de toelichting. */}
      {s.config.dekkingsvoorbehoud && (
        <p className="mt-1.5 rounded border border-line bg-app-bg px-2 py-1 text-[11px] text-ink/60">
          <span className="font-semibold">Dekking:</span>{" "}
          {s.config.dekkingsvoorbehoud}
        </p>
      )}

      <div className="mt-3">
        <Trendlijn
          punten={s.trend}
          status={s.status}
          drempelOranje={s.drempelOranje}
          drempelRood={s.drempelRood}
        />
      </div>

      {s.signaal === "uptime_kern" && <Componenten meta={s.meta} />}
    </section>
  );
}

/** Componentuitsplitsing onder het uptime-signaal — waar zit de storing? */
function Componenten({ meta }: { meta: Record<string, unknown> | null }) {
  const lijst = Array.isArray(meta?.componenten) ? meta.componenten : null;
  if (!lijst) return null;

  return (
    <ul className="mt-3 space-y-1 border-t border-line pt-3">
      {lijst.map((c, i) => {
        const item = c as {
          component?: string;
          status?: string;
          responstijd_ms?: number | null;
          reden?: string | null;
        };
        const status = naarStatus(item.status);
        return (
          <li key={`${item.component}-${i}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-ink/70">{leesbaarComponent(item.component)}</span>
            <span className="flex items-center gap-2">
              {typeof item.responstijd_ms === "number" && (
                <span className="text-ink/50">{item.responstijd_ms} ms</span>
              )}
              <Stoplicht status={status} toelichting={item.reden ?? null} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Opmaak ──────────────────────────────────────────────────────────────────

function formatteerWaarde(s: SignaalWeergave): string {
  if (s.onderdrukt) return "onderdrukt";
  if (s.waarde === null) return "—";
  switch (s.config.eenheid) {
    case "percentage":
      return `${afgerond(s.waarde)}%`;
    case "trend_percentage":
      return `${s.waarde > 0 ? "+" : ""}${afgerond(s.waarde)}%`;
    case "milliseconden":
      return s.waarde >= 1000
        ? `${afgerond(s.waarde / 1000)} s`
        : `${Math.round(s.waarde)} ms`;
    case "aantal":
    default:
      return String(Math.round(s.waarde));
  }
}

function beschrijfDrempels(s: SignaalWeergave): string {
  const oranje = s.drempelOranje;
  const rood = s.drempelRood;
  if (oranje === null && rood === null) return "niet ingesteld";
  const richting = s.config.richting === "lager_is_slechter" ? "vanaf" : "vanaf";
  const eenheid = s.config.eenheid === "milliseconden" ? " ms" : s.config.eenheid.includes("percentage") ? "%" : "";
  const delen: string[] = [];
  if (oranje !== null) delen.push(`aandacht ${richting} ${oranje}${eenheid}`);
  if (rood !== null) delen.push(`verstoord ${richting} ${rood}${eenheid}`);
  return delen.join(", ");
}

function formatteerVenster(minuten: number): string {
  if (minuten % 1440 === 0) {
    const dagen = minuten / 1440;
    return dagen === 1 ? "24 uur" : `${dagen} dagen`;
  }
  if (minuten % 60 === 0) return `${minuten / 60} uur`;
  return `${minuten} min`;
}

function formatteerTijd(iso: string): string {
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

function afgerond(waarde: number): string {
  return (Math.round(waarde * 10) / 10).toLocaleString("nl-NL");
}

function naarStatus(waarde: string | undefined) {
  return waarde === "groen" || waarde === "oranje" || waarde === "rood"
    ? waarde
    : ("onbekend" as const);
}

function leesbaarComponent(sleutel: string | undefined): string {
  const namen: Record<string, string> = {
    back_office: "Back-office",
    tenant_app: "Bestuurdersportaal (app)",
    supabase: "Database",
    storage: "Documentopslag",
    model_api: "Model-API",
    embedding_retrieval: "Embedding & retrieval",
    documentverwerking: "Documentverwerking",
  };
  return sleutel ? namen[sleutel] ?? sleutel : "Onbekend";
}
