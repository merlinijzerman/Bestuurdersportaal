"use client";
// ============================================================================
//  AI-begrenzing — beheerweergave en bediening (besluit 0180)
// ----------------------------------------------------------------------------
//  Toont de vier kill switches, de maandtellers voor heel Preview, per fonds en
//  per gebruiker, de modelallowlist en de externe providerbackstops. Bedienen
//  gebeurt via de server-acties; élke mutatie loopt daar door withPlatform met
//  live AAL2, een capabilitycheck en de twee-fasen-audit.
//
//  DRIE UX-REGELS DIE HIER HARD ZIJN
//   1. Kleur is nooit de enige drager (besluiten 0097/0101): elke status draagt
//      kleur + woord + vorm, net als Stoplicht in de monitoringmodule.
//   2. Vereisten en blokkers staan VÓÓR de actie zichtbaar, niet pas als
//      foutmelding erna. Wie een verzoek niet mag goedkeuren, ziet dat staan —
//      hij krijgt geen knop die daarna weigert.
//   3. Geen verzonnen zekerheden: zolang er geen provider-API wordt ingelezen
//      staat er letterlijk "providerverbruik niet live beschikbaar", en niet
//      een bedrag dat er geloofwaardig uitziet.
// ============================================================================

import { useState, useTransition } from "react";
import type {
  AiBegrenzingOverzicht,
  AllowlistRij,
  SwitchWeergave,
} from "@/platform/lib/ai-begrenzing-lees";
import { STATUS_WOORD, type QuotaStand, type QuotaStatus } from "@/core/lib/ai-quota-kern";
import {
  switchStoppen,
  heractiveringAanvragen,
  heractiveringGoedkeuren,
  heractiveringAfwijzen,
  heractiveringIntrekken,
  quotumWijzigen,
  allowlistWijzigen,
  type ActieResultaat,
} from "../acties";

type Props = {
  overzicht: AiBegrenzingOverzicht;
  /** Wie kijkt er mee — bepaalt welke bediening zichtbaar is. */
  ikId: string | null;
  magBedienen: boolean;
  magConfigureren: boolean;
};

const SCHAKELAAR_LABEL: Record<string, string> = {
  globaal: "Alle Preview-AI",
  anthropic: "Anthropic",
  mistral: "Mistral",
  openai: "OpenAI (challenger)",
};

const QUOTUM_LABEL: Record<string, string> = {
  gebruiker_maand: "AI-acties per gebruiker",
  fonds_maand: "AI-acties per fonds",
  globaal_maand: "AI-acties heel Preview",
  ocr_fonds_maand: "OCR-pagina's per fonds",
};

// ── Statuschip: kleur + woord + vorm ────────────────────────────────────────

const QUOTA_KLASSEN: Record<QuotaStatus, string> = {
  ruim: "bg-ok-tint text-ok-ink border-ok/30",
  waarschuwing: "bg-warn-tint text-warn-ink border-warn/30",
  verhoogd: "bg-warn-tint text-warn-ink border-warn/40",
  geblokkeerd: "bg-err-tint text-err-ink border-err/30",
};

function Vorm({ status }: { status: QuotaStatus }) {
  const g = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  if (status === "ruim") {
    return (
      <svg {...g}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.5 8.3 L7 10.8 L11.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "geblokkeerd") {
    return (
      <svg {...g}>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 5 L11 11 M11 5 L5 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  // waarschuwing en verhoogd delen de driehoek; het woord onderscheidt ze.
  return (
    <svg {...g}>
      <path d="M8 1.5 L15 14 L1 14 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6 V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function StandChip({ stand }: { stand: QuotaStand }) {
  const pct = Math.round(stand.aandeel * 100);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${QUOTA_KLASSEN[stand.status]}`}
      title={`${stand.gebruikt} van ${stand.limiet} gebruikt`}
    >
      <Vorm status={stand.status} />
      {STATUS_WOORD[stand.status]} · {pct}%
    </span>
  );
}

function Meter({ stand }: { stand: QuotaStand }) {
  const breedte = Math.min(100, Math.round(stand.aandeel * 100));
  const kleur =
    stand.status === "geblokkeerd" ? "bg-err" : stand.status === "ruim" ? "bg-ok" : "bg-warn";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-bg" aria-hidden>
      <div className={`h-full ${kleur}`} style={{ width: `${breedte}%` }} />
    </div>
  );
}

// ── Schakelaarstatus ────────────────────────────────────────────────────────

function SchakelaarChip({ status }: { status: SwitchWeergave["status"] }) {
  const map = {
    actief: { woord: "Actief", klassen: "bg-ok-tint text-ok-ink border-ok/30" },
    gestopt: { woord: "Gestopt", klassen: "bg-err-tint text-err-ink border-err/30" },
    heractivering_aangevraagd: {
      woord: "Heractivering aangevraagd",
      klassen: "bg-warn-tint text-warn-ink border-warn/30",
    },
  } as const;
  const w = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${w.klassen}`}>
      <Vorm status={status === "actief" ? "ruim" : status === "gestopt" ? "geblokkeerd" : "waarschuwing"} />
      {w.woord}
    </span>
  );
}

// ── Hoofdcomponent ──────────────────────────────────────────────────────────

export default function AiBegrenzingClient({ overzicht, ikId, magBedienen, magConfigureren }: Props) {
  const [melding, setMelding] = useState<ActieResultaat | null>(null);
  const [bezig, start] = useTransition();
  const [zoek, setZoek] = useState("");

  const draai = (fn: (fd: FormData) => Promise<ActieResultaat>) => (fd: FormData) => {
    start(async () => setMelding(await fn(fd)));
  };

  const gefilterd = overzicht.gebruikers.filter(
    (g) =>
      zoek.trim() === "" ||
      g.naam.toLowerCase().includes(zoek.toLowerCase()) ||
      g.fondsNaam.toLowerCase().includes(zoek.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {melding && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            melding.ok
              ? "border-ok/30 bg-ok-tint text-ok-ink"
              : "border-err/30 bg-err-tint text-err-ink"
          }`}
        >
          {melding.ok ? melding.bericht : melding.melding}
        </div>
      )}

      {overzicht.quotaOntbreekt.length > 0 && (
        <div className="rounded-lg border border-err/30 bg-err-tint px-4 py-3 text-sm text-err-ink">
          <strong>Deze omgeving is nog niet geconfigureerd.</strong> De volgende quota ontbreken:{" "}
          {overzicht.quotaOntbreekt.map((s) => QUOTUM_LABEL[s]).join(", ")}. Zolang een quotum
          ontbreekt weigert de begrenzing élke AI-actie — dat is opzet (fail-closed), maar het
          betekent wel dat de AI hier niet werkt.
        </div>
      )}

      {/* ── Schakelaars ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-serif text-lg font-bold">Schakelaars</h2>
        <p className="mt-1 text-sm text-ink/70">
          Stoppen gaat onmiddellijk in en blokkeert nieuwe aanroepen. Een al verzonden aanroep bij
          de provider wordt niet afgebroken. Heractiveren vereist twee verschillende beheerders.
        </p>

        <div className="mt-4 space-y-4">
          {overzicht.switches.map((s) => (
            <SchakelaarKaart
              key={s.sleutel}
              s={s}
              ikId={ikId}
              magBedienen={magBedienen}
              bezig={bezig}
              draai={draai}
            />
          ))}
        </div>
      </section>

      {/* ── Platformteller ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-bold">Verbruik deze maand</h2>
          <p className="text-xs text-ink/60">
            Kalendermaand {overzicht.maand.slice(0, 7)} in UTC. De grens loopt om 00:00 UTC, dus in
            Nederland één of twee uur ná middernacht.
          </p>
        </div>

        <div className="mt-4 rounded-lg border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Heel Preview</span>
            <StandChip stand={overzicht.globaal} />
          </div>
          <p className="mt-1 text-sm text-ink/70">
            {overzicht.globaal.gebruikt} van {overzicht.globaal.limiet} AI-acties gebruikt;{" "}
            {overzicht.globaal.resterend} resterend.
          </p>
          <div className="mt-2">
            <Meter stand={overzicht.globaal} />
          </div>
        </div>

        {overzicht.verlopenActies > 0 && (
          <p className="mt-3 text-xs text-ink/60">
            {overzicht.verlopenActies} actie(s) deze maand zijn verlopen verklaard: het proces is
            halverwege gestopt en de lease is verstreken. Het verbruik telt mee — een oplopend
            aantal is een signaal, geen achtergrondruis.
          </p>
        )}
        {overzicht.afgekapt && (
          <p className="mt-3 text-xs text-err-ink">
            Let op: er zijn meer verbruiksregels dan deze weergave inleest. De getallen hieronder
            zijn een ondergrens.
          </p>
        )}
      </section>

      {/* ── Per fonds ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-serif text-lg font-bold">Per fonds</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink/60">
                <th className="py-2 pr-3">Fonds</th>
                <th className="py-2 pr-3">AI-acties</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">OCR-pagina&apos;s</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {overzicht.fondsen.map((f) => (
                <tr key={f.fondsId} className="border-b border-line/60">
                  <td className="py-2 pr-3">{f.naam}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {f.ai.gebruikt} / {f.ai.limiet}
                  </td>
                  <td className="py-2 pr-3">
                    <StandChip stand={f.ai} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {f.ocr.gebruikt} / {f.ocr.limiet}
                  </td>
                  <td className="py-2">
                    <StandChip stand={f.ocr} />
                  </td>
                </tr>
              ))}
              {overzicht.fondsen.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-ink/60">
                    Geen fondsen gevonden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Per gebruiker ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg font-bold">Per gebruiker</h2>
          <input
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek op naam of fonds"
            className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm"
            aria-label="Zoek gebruiker"
          />
        </div>
        <p className="mt-1 text-sm text-ink/70">
          Alleen gebruikers met verbruik deze maand. Aantallen, geen inhoud.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink/60">
                <th className="py-2 pr-3">Gebruiker</th>
                <th className="py-2 pr-3">Fonds</th>
                <th className="py-2 pr-3">AI-acties</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {gefilterd.map((g) => (
                <tr key={g.gebruikerId} className="border-b border-line/60">
                  <td className="py-2 pr-3">{g.naam}</td>
                  <td className="py-2 pr-3">{g.fondsNaam}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {g.ai.gebruikt} / {g.ai.limiet}
                  </td>
                  <td className="py-2">
                    <StandChip stand={g.ai} />
                  </td>
                </tr>
              ))}
              {gefilterd.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-ink/60">
                    {zoek ? "Geen gebruiker gevonden." : "Nog geen verbruik deze maand."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Quota ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-serif text-lg font-bold">Quota</h2>
        <p className="mt-1 text-sm text-ink/70">
          Een wijziging geldt onmiddellijk en laat een openstaand heractiveringsverzoek vervallen —
          dat verzoek is dan immers op een andere situatie beoordeeld. Nul betekent volledig dicht,
          niet onbeperkt.
        </p>
        {!magConfigureren && (
          <p className="mt-2 text-sm text-ink/60">
            U kunt deze waarden inzien maar niet wijzigen. Wijzigen vereist{" "}
            <code className="font-mono">platform.config.manage</code>.
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(Object.keys(QUOTUM_LABEL) as (keyof typeof QUOTUM_LABEL)[]).map((sleutel) => (
            <form
              key={sleutel}
              action={draai(quotumWijzigen)}
              className="rounded-lg border border-line p-3"
            >
              <input type="hidden" name="quotum_sleutel" value={sleutel} />
              <label className="block text-sm font-medium" htmlFor={`q-${sleutel}`}>
                {QUOTUM_LABEL[sleutel]}
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id={`q-${sleutel}`}
                  name="waarde"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={overzicht.quota[sleutel as keyof typeof overzicht.quota] ?? ""}
                  disabled={!magConfigureren || bezig}
                  className="w-32 rounded-lg border border-app-line-control px-3 py-1.5 text-sm tabular-nums"
                />
                <button
                  type="submit"
                  disabled={!magConfigureren || bezig}
                  className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Opslaan
                </button>
              </div>
            </form>
          ))}
        </div>
      </section>

      {/* ── Modelallowlist ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-serif text-lg font-bold">Toegestane modellen</h2>
        <p className="mt-1 text-sm text-ink/70">
          Een model dat hier niet actief staat wordt server-side geweigerd; er is geen stille
          terugval naar een ruimer model. Een tijdelijk venster vervalt vanzelf na de eindtijd —
          daar is geen beheerhandeling voor nodig.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink/60">
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Venster</th>
              </tr>
            </thead>
            <tbody>
              {overzicht.allowlist.map((r) => (
                <AllowlistRegel key={`${r.provider}:${r.model}`} r={r} />
              ))}
            </tbody>
          </table>
        </div>
        {magConfigureren && (
          <form action={draai(allowlistWijzigen)} className="mt-4 rounded-lg border border-line p-3">
            <p className="text-sm font-medium">Model toevoegen of wijzigen</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select name="provider" className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm" aria-label="Provider">
                <option value="anthropic">anthropic</option>
                <option value="mistral">mistral</option>
                <option value="openai">openai</option>
              </select>
              <input name="model" placeholder="model-id" className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm" aria-label="Model-id" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="actief" value="aan" defaultChecked /> Actief
              </label>
              <span />
              <label className="text-xs text-ink/60">
                Venster begin (optioneel)
                <input type="datetime-local" name="venster_start" className="mt-1 block w-full rounded-lg border border-app-line-control px-3 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-ink/60">
                Venster eind (optioneel)
                <input type="datetime-local" name="venster_eind" className="mt-1 block w-full rounded-lg border border-app-line-control px-3 py-1.5 text-sm" />
              </label>
            </div>
            <textarea
              name="reden"
              rows={2}
              placeholder="Reden (verplicht bij een tijdelijk venster, minimaal 10 tekens)"
              className="mt-2 w-full rounded-lg border border-app-line-control px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={bezig}
              className="mt-2 rounded-lg border border-app-line-control px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Opslaan
            </button>
          </form>
        )}
      </section>

      {/* ── Providerbackstops ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="font-serif text-lg font-bold">Externe providerlimieten</h2>
        <p className="mt-1 text-sm text-ink/70">
          Deze limieten staan bij de provider zelf en werken onafhankelijk van de schakelaars
          hierboven. Ze zijn de laatste vangrail: een heractivering hier kan een provider-harde
          limiet, een leeg tegoed of een ingetrokken sleutel niet opheffen.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="font-medium">Anthropic</p>
            <p className="mt-1 text-ink/70">
              Harde maandlimiet USD 200; waarschuwingen op USD 75 en USD 120. Werkbudget USD 150.
            </p>
          </div>
          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="font-medium">Mistral</p>
            <p className="mt-1 text-ink/70">
              Prepaid, EUR 10 tegoed, auto-recharge uit. Dit account biedt géén maandelijkse
              spendlimiet; het tegoed is daarmee feitelijk strenger dan de besloten USD 40.
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-lg border border-line bg-app-bg px-3 py-2 text-sm text-ink/70">
          <strong>Providerverbruik niet live beschikbaar.</strong> Er wordt geen provider-API
          uitgelezen; de bedragen hierboven zijn de ingestelde limieten, niet het actuele verbruik.
        </p>
      </section>
    </div>
  );
}

// ── Deelcomponenten ─────────────────────────────────────────────────────────

function AllowlistRegel({ r }: { r: AllowlistRij }) {
  const venster =
    r.vensterStart === null
      ? "—"
      : r.vensterActief
        ? "Tijdelijk venster: nu open"
        : "Tijdelijk venster: gesloten";
  const bruikbaar = r.actief && (r.vensterStart === null || r.vensterActief === true);
  return (
    <tr className="border-b border-line/60">
      <td className="py-2 pr-3">{r.provider}</td>
      <td className="py-2 pr-3 font-mono text-xs">{r.model}</td>
      <td className="py-2 pr-3">
        <StandChip
          stand={{
            gebruikt: 0,
            limiet: 1,
            aandeel: bruikbaar ? 0 : 1,
            resterend: bruikbaar ? 1 : 0,
            status: bruikbaar ? "ruim" : "geblokkeerd",
          }}
        />
      </td>
      <td className="py-2 text-ink/70">{venster}</td>
    </tr>
  );
}

function SchakelaarKaart({
  s,
  ikId,
  magBedienen,
  bezig,
  draai,
}: {
  s: SwitchWeergave;
  ikId: string | null;
  magBedienen: boolean;
  bezig: boolean;
  draai: (fn: (fd: FormData) => Promise<ActieResultaat>) => (fd: FormData) => void;
}) {
  const verzoek = s.openVerzoek;
  const ikBenAanvrager = Boolean(verzoek && ikId && verzoek.aangevraagdDoor === ikId);

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{SCHAKELAAR_LABEL[s.sleutel] ?? s.sleutel}</span>
        <SchakelaarChip status={s.status} />
      </div>

      {s.reden && (
        <p className="mt-2 text-sm text-ink/70">
          <span className="font-medium">Reden:</span> {s.reden}
        </p>
      )}
      {s.gewijzigdOp && (
        <p className="mt-1 text-xs text-ink/60">
          Laatst gewijzigd {new Date(s.gewijzigdOp).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}
          {s.gewijzigdDoorEmail ? ` door ${s.gewijzigdDoorEmail}` : ""}.
        </p>
      )}

      {/* Openstaand verzoek: vereisten vóór de actie zichtbaar (UX-principe). */}
      {verzoek && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn-tint px-3 py-2 text-sm text-warn-ink">
          <p className="font-medium">Heractiveringsverzoek open</p>
          <p className="mt-1">
            Ingediend door {verzoek.aangevraagdDoorEmail ?? verzoek.aangevraagdDoor} op{" "}
            {new Date(verzoek.aangevraagdOp).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}.
          </p>
          <p className="mt-1">
            <span className="font-medium">Reden:</span> {verzoek.reden}
          </p>
          <p className="mt-2">
            {ikBenAanvrager
              ? "U heeft dit verzoek zelf ingediend en kunt het daarom niet goedkeuren. Een tweede bevoegde beheerder moet dat doen. U kunt uw verzoek wel intrekken."
              : "U kunt dit verzoek goedkeuren of afwijzen."}
          </p>
        </div>
      )}

      {!magBedienen ? (
        <p className="mt-3 text-sm text-ink/60">
          U kunt deze schakelaar inzien maar niet bedienen. Vereist{" "}
          <code className="font-mono">platform.security.operate</code>.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {s.status === "actief" && (
            <form action={draai(switchStoppen)} className="space-y-2">
              <input type="hidden" name="sleutel" value={s.sleutel} />
              <textarea
                name="reden"
                rows={2}
                required
                minLength={10}
                placeholder="Reden voor de stop (verplicht, minimaal 10 tekens) — komt in het auditspoor"
                className="w-full rounded-lg border border-app-line-control px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={bezig}
                className="rounded-lg border border-err/40 bg-err-tint px-3 py-1.5 text-sm text-err-ink disabled:opacity-50"
              >
                Stoppen
              </button>
            </form>
          )}

          {s.status === "gestopt" && (
            <form action={draai(heractiveringAanvragen)} className="space-y-2">
              <input type="hidden" name="sleutel" value={s.sleutel} />
              <textarea
                name="reden"
                rows={2}
                required
                minLength={10}
                placeholder="Waarom kan dit weer aan? (verplicht) — de tweede beheerder beoordeelt hierop"
                className="w-full rounded-lg border border-app-line-control px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={bezig}
                className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Heractivering aanvragen
              </button>
            </form>
          )}

          {s.status === "heractivering_aangevraagd" && (
            <div className="flex flex-wrap gap-2">
              {ikBenAanvrager ? (
                <form action={draai(heractiveringIntrekken)}>
                  <input type="hidden" name="sleutel" value={s.sleutel} />
                  <button
                    type="submit"
                    disabled={bezig}
                    className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Mijn verzoek intrekken
                  </button>
                </form>
              ) : (
                <>
                  <form action={draai(heractiveringGoedkeuren)}>
                    <input type="hidden" name="sleutel" value={s.sleutel} />
                    <button
                      type="submit"
                      disabled={bezig}
                      className="rounded-lg border border-ok/40 bg-ok-tint px-3 py-1.5 text-sm text-ok-ink disabled:opacity-50"
                    >
                      Goedkeuren en aanzetten
                    </button>
                  </form>
                  <form action={draai(heractiveringAfwijzen)}>
                    <input type="hidden" name="sleutel" value={s.sleutel} />
                    <button
                      type="submit"
                      disabled={bezig}
                      className="rounded-lg border border-app-line-control px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      Afwijzen
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
