"use client";

// ============================================================================
//  Scherm 3 — Run samenstellen (AQL-5). Client-component met progressive
//  disclosure (velden volgen het run-type), een expliciete baseline→challenger-
//  flow, gevulde modelkeuze (allowlist), instelbare tokens/temperature/top-p met
//  §2B-waarschuwing, benoembare run, en proactieve vereisten/blokkers (de knop
//  wordt geblokkeerd met reden). De server-action (acties.ts) her-valideert alles
//  en pint de challenger-variant append-only (dedup-op-hash) — gating hoort niet
//  uitsluitend in de frontend.
// ============================================================================

import { useActionState, useState } from "react";
import { startRunActie, adHocTestActie } from "./acties";
import ConsistentieBlok, { type IteratieView } from "./runs/[runId]/consistentie-blok";
import type { AdHocConsistentieResultaat } from "@/lib/aqlab/run-orchestrator";
import {
  autoNaam,
  leidGewijzigdeAsAf,
  type ModelProvider,
  type ToegestaanModel,
  type VariantInstellingen,
} from "@/lib/aqlab/modellen";

type RunType = "full_regression" | "subset" | "ad_hoc";

export interface BaselineProp {
  baseline_run_id: string;
  besluit_op: string | null;
  config_naam: string | null;
  variant: VariantInstellingen;
}

export interface RunSamenstellenProps {
  testsets: { id: string; code: string; naam: string }[];
  testsetTellingen: Record<string, number>;
  testcases: { id: string; code: string; titel: string; soort: string; consistency_required: boolean }[];
  allowlist: ToegestaanModel[];
  /** Per testset de vaste productie-baseline (null-key = geen vrijgegeven variant). */
  baselines: Record<string, BaselineProp>;
}

// Leesbare labels voor de afgeleide as (de ruwe waarden zijn DB-enum-strings).
const AS_LABEL: Record<string, string> = {
  geen: "geen wijziging",
  model: "model",
  temperature: "sampling (temperature/top-p)",
  max_tokens: "max tokens",
  retrieval: "retrieval",
  meerdere: "meerdere assen",
};

// AQL-6 — provider-groepering in de challenger-dropdown. Anthropic eerst
// (baseline/productie), daarna de "ander provider dan productie"-challengers.
const PROVIDER_LABEL: Record<ModelProvider, string> = {
  anthropic: "Anthropic — productie",
  openai: "OpenAI — ander provider dan productie",
  mistral: "Mistral — ander provider dan productie",
};
const PROVIDER_BADGE: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  mistral: "Mistral",
};
const PROVIDER_VOLGORDE: ModelProvider[] = ["anthropic", "openai", "mistral"];

const TEMP_OPTIES: { value: string; label: string }[] = [
  { value: "default", label: "provider-default (zoals productie)" },
  { value: "0.0", label: "0.0 — deterministisch" },
  { value: "0.2", label: "0.2 — laag" },
  { value: "0.5", label: "0.5 — midden" },
  { value: "0.7", label: "0.7 — creatief" },
  { value: "1.0", label: "1.0 — hoog" },
];

// Reasoning-effort-opties (AQL-6) — vervangt temperature bij reasoning-modellen.
const EFFORT_OPTIES: { value: string; label: string }[] = [
  { value: "default", label: "provider-default" },
  { value: "minimal", label: "minimal — snelst/goedkoopst" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high — grondigst/duurst" },
];

function kort(id: string): string {
  return id.slice(0, 8);
}

type AdHocState = AdHocConsistentieResultaat | { fout: string } | null;

function bronLabels(bronnen: unknown): string[] {
  if (!Array.isArray(bronnen)) return [];
  return bronnen
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return String(o.bron ?? o.titel ?? o.document_id ?? o.nummer ?? "");
    })
    .filter((s) => s.length > 0);
}

export default function RunSamenstellenForm({
  testsets,
  testsetTellingen,
  testcases,
  allowlist,
  baselines,
}: RunSamenstellenProps) {
  const productiekern = allowlist.find((m) => m.isBaseline) ?? allowlist[0];
  const productiekernVariant: VariantInstellingen = {
    model: productiekern.model_name,
    temperature: null,
    maxTokens: productiekern.defaultMaxTokens,
    topP: null,
    retrieval: {},
  };

  const [runType, setRunType] = useState<RunType>("full_regression");
  const [testSetId, setTestSetId] = useState<string>("");
  const [challengerModel, setChallengerModel] = useState<string>(productiekern.model_name);
  const [toonInstellingen, setToonInstellingen] = useState(false);
  const [tempMode, setTempMode] = useState<string>("default");
  const [maxTokens, setMaxTokens] = useState<number>(productiekern.defaultMaxTokens);
  const [topP, setTopP] = useState<string>("");
  const [reasoningEffort, setReasoningEffort] = useState<string>("default");
  const [adHocVraag, setAdHocVraag] = useState<string>("");
  const [soort, setSoort] = useState<string>("functioneel");
  const [persistMode, setPersistMode] = useState<string>("full_synthetic");

  // Ad-hoc draait SYNCHROON (niet in de wachtrij) en toont het resultaat inline;
  // persist_mode is server-side geforceerd op none (AQL-6.1).
  const [adhocState, adhocFormAction, adhocPending] = useActionState<AdHocState, FormData>(adHocTestActie, null);
  const adhocResultaat = adhocState && !("fout" in adhocState) ? adhocState : null;
  const adhocFout = adhocState && "fout" in adhocState ? adhocState.fout : null;
  const adhocIteraties: IteratieView[] = (adhocResultaat?.iteraties ?? []).map((it) => ({
    iteratie: it.iteratie,
    antwoord: it.antwoord,
    quality_score: it.quality_score,
    gate_status: it.gate_status,
    latency_ms: it.latency_ms,
    tokengebruik: it.tokengebruik,
    bronnen: bronLabels(it.bronnen),
  }));

  const gekozenModel = allowlist.find((m) => m.model_name === challengerModel) ?? productiekern;
  // Reasoning-modellen (o-serie/GPT-5): sampling vergrendeld → toon reasoning-effort
  // i.p.v. temperature/top-p (AQL-6).
  const isReasoning = gekozenModel.redeneermodel === true;

  // Baseline voor de gekozen testset (of productiekern-default als er geen vrijgave is).
  const baseline = testSetId ? baselines[testSetId] ?? null : null;
  const baselineVariant = baseline?.variant ?? productiekernVariant;

  const challengerVariant: VariantInstellingen = {
    model: challengerModel,
    // Reasoning-modellen: temperature/top-p vergrendeld → altijd null; de knop is effort.
    temperature: isReasoning || tempMode === "default" ? null : Number(tempMode),
    maxTokens,
    topP: isReasoning || !topP.trim() ? null : Number(topP),
    reasoningEffort: isReasoning && reasoningEffort !== "default" ? (reasoningEffort as VariantInstellingen["reasoningEffort"]) : null,
    retrieval: {},
  };
  const afgeleideAs = leidGewijzigdeAsAf(baselineVariant, challengerVariant);
  const expliciteSampling = !isReasoning && (tempMode !== "default" || topP.trim() !== "");
  const expliciteEffort = isReasoning && reasoningEffort !== "default";

  // ── Proactieve vereisten/blokkers ──────────────────────────────────────────
  const blokkers: string[] = [];
  const waarschuwingen: string[] = [];

  const geselecteerdeTestset = testsets.find((t) => t.id === testSetId);

  if (testsets.length === 0) {
    blokkers.push("Er is nog geen testset geseed. Draai eerst de golden-set-seed (npm run aqlab:seed:apply).");
  }
  if ((runType === "full_regression" || runType === "subset") && !testSetId) {
    blokkers.push("Kies een testset.");
  }
  if (testSetId && (testsetTellingen[testSetId] ?? 0) === 0) {
    blokkers.push("De gekozen testset bevat geen actieve testcases.");
  }
  if (runType === "ad_hoc" && !adHocVraag.trim()) {
    blokkers.push("Vul een ad-hoc vraag in.");
  }

  // Een volledige vrijgave vereist óók de security/safety-blocking-set. Deze run
  // draait één testset; is dat niet de security/safety-set, dan kan 'accepteren'
  // alleen als die set apart is meegenomen én slaagt (engine-regel, regression-core).
  if (runType === "full_regression" && geselecteerdeTestset && geselecteerdeTestset.code !== "security_safety") {
    waarschuwingen.push(
      "Deze run draait één testset (geen security/safety-blocking-set). Een formeel advies 'accepteren' kan alleen als óók de security/safety-set is meegenomen en slaagt."
    );
  }
  if (expliciteSampling) {
    waarschuwingen.push(
      "Je zet een sampling-parameter expliciet (temperature en/of top-p). Productie laat beide op provider-default — deze variant wijkt dus af van wat live draait. Voor een zuivere vergelijking met de baseline: laat op provider-default. De variant wordt append-only gepind (§2B)."
    );
  }
  // AQL-6 — "ander provider dan productie": productie draait op Claude; een GPT-/
  // Mistral-run test een ánder provider. De gewijzigde as is dan provider + model
  // en het regressiesignaal is minder zuiver toewijsbaar (geen schijnzekerheid).
  if ((runType === "full_regression" || runType === "subset") && gekozenModel.provider !== "anthropic") {
    waarschuwingen.push(
      `Challenger draait op een ander provider dan productie (${PROVIDER_BADGE[gekozenModel.provider]}). Productie draait op Claude; dit test een ánder provider — de gewijzigde as is provider + model en het signaal is minder zuiver aan één oorzaak toe te schrijven. Externe providers draaien uitsluitend op de synthetische golden set (geen echte fondsdata). Baseline en judge blijven Claude.`
    );
  }
  // AQL-6 — reasoning-model: sampling vergrendeld; de knop is reasoning-effort.
  if ((runType === "full_regression" || runType === "subset") && isReasoning) {
    waarschuwingen.push(
      `Dit is een reasoning-model: temperature/top-p zijn vergrendeld en het model besteedt (gefactureerde) verborgen reasoning-tokens vóór het zichtbare antwoord. Zet "max completion tokens" ruim en stuur via reasoning-effort${expliciteEffort ? ` (nu: ${reasoningEffort}, wordt append-only gepind)` : " (nu: provider-default)"}.`
    );
  }
  if ((runType === "full_regression" || runType === "subset") && testSetId && !baseline) {
    waarschuwingen.push(
      "Er is nog geen vrijgegeven baseline voor deze testset; de challenger wordt vergeleken met de productiekern-default."
    );
  }

  const geblokkeerd = blokkers.length > 0;
  const heeftWaarschuwing = waarschuwingen.length > 0;

  const toonVergelijking = runType === "full_regression" || runType === "subset";
  const toonSubset = runType === "subset";
  const toonAdHoc = runType === "ad_hoc";

  const modelOptieLabel = (m: ToegestaanModel) =>
    m.isBaseline ? `Zelfde als productie — ${m.model_name}` : `${m.label} — ${m.model_name}`;

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Run samenstellen</h2>

      {testsets.length === 0 && (
        <div className="mt-3 rounded-lg border border-warn-ink/30 bg-warn-tint p-3 text-xs text-warn-ink">
          Nog geen testset geseed. Seed eerst de synthetische golden set
          (<span className="font-mono">npm run aqlab:seed:apply</span>) en de starter-modelconfiguraties
          (<span className="font-mono">npm run aqlab:seed:modellen</span>).
        </div>
      )}

      <form action={toonAdHoc ? adhocFormAction : startRunActie} className="mt-3 space-y-5">
        {/* Run-naam */}
        <label className="block text-sm">
          <span className="mb-1 block text-ink/70">Naam / label voor deze run <span className="text-ink/40">(optioneel — om 'm later makkelijk terug te vinden)</span></span>
          <input
            name="naam"
            type="text"
            placeholder="bv. Opus-challenger — toeslagbeleid, juli 2026"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
        </label>

        {/* Stap 1 — run-type (stuurt de progressive disclosure) */}
        <fieldset>
          <legend className="mb-1 text-sm text-ink/70">1 · Wat voor run wil je draaien?</legend>
          <input type="hidden" name="run_type" value={runType} />
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["full_regression", "Volledige regressierun", "formeel advies mogelijk"],
              ["subset", "Subset", "indicatief"],
              ["ad_hoc", "Ad-hoc testvraag", "geen formeel advies"],
            ] as const).map(([val, titel, sub]) => (
              <button
                key={val}
                type="button"
                onClick={() => setRunType(val)}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  runType === val ? "border-accent bg-accent/10 text-accent" : "border-line bg-white hover:bg-app-bg"
                }`}
              >
                <div className="font-medium">{titel}</div>
                <div className="text-xs text-ink/50">{sub}</div>
              </button>
            ))}
          </div>
        </fieldset>

        {/* Stap 2 — model/variant. Bij regressie/subset: baseline → challenger.
            Bij ad-hoc: alleen de modelkeuze (geen vergelijking) — de stap blijft
            zichtbaar zodat de nummering 1-2-3 nooit overslaat (AQL-6.1). */}
        <fieldset>
            <legend className="mb-1 text-sm text-ink/70">
              {toonAdHoc ? (
                <>2 · Welk model gebruik je? <span className="text-ink/40">(voor de ad-hoc vraag — geen vergelijking)</span></>
              ) : (
                "2 · Wat vergelijk je? (baseline → challenger)"
              )}
            </legend>
            <p className="mb-2 text-xs text-ink/50">
              {toonAdHoc
                ? "Kies het model/de variant waarmee je de ad-hoc vraag laat beantwoorden. Een ad-hoc run levert geen formeel advies."
                : "Links draait nu live (baseline), rechts zet je een variant ertegenaf (challenger). De gewijzigde as leidt het Lab automatisch af."}
            </p>
            <div className={toonAdHoc ? "grid gap-3" : "grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch"}>
              {/* Baseline (read-only) + pijl — alleen bij vergelijking */}
              {!toonAdHoc && (
              <>
              <div className="rounded-lg border border-line bg-app-bg p-3">
                <div className="text-xs font-semibold uppercase text-ink/50">● Huidig — productie (baseline)</div>
                <div className="mt-1 font-mono text-sm">{baselineVariant.model}</div>
                <div className="mt-1 text-xs text-ink/60">
                  {baseline?.config_naam ?? "Productiekern"} · max_tokens {baselineVariant.maxTokens ?? "kern-default"} ·
                  temperature {baselineVariant.temperature ?? "provider-default"}
                </div>
                <div className="mt-1 text-xs text-ink/50">
                  {baseline
                    ? `Laatst vrijgegeven variant · run ${kort(baseline.baseline_run_id)}${baseline.besluit_op ? ` · ${new Date(baseline.besluit_op).toLocaleDateString("nl-NL")}` : ""}`
                    : "Nog geen vrijgegeven variant — productiekern-default."}
                </div>
              </div>

              <div className="hidden items-center justify-center text-2xl text-ink/40 lg:flex">→</div>
              </>
              )}

              {/* Challenger (bij ad-hoc: het model voor de ad-hoc vraag) */}
              <div className="rounded-lg border border-accent/40 p-3">
                <div className="text-xs font-semibold uppercase text-accent">
                  {toonAdHoc ? "◆ Model voor de ad-hoc vraag" : "◆ Nieuw — wat je test (challenger)"}
                </div>
                <label className="mt-2 block text-sm">
                  <span className="mb-1 block text-ink/70">Kies het model / de variant</span>
                  <select
                    name="challenger_model"
                    value={challengerModel}
                    onChange={(e) => {
                      const m = allowlist.find((x) => x.model_name === e.target.value);
                      setChallengerModel(e.target.value);
                      if (m) setMaxTokens(m.defaultMaxTokens);
                    }}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                  >
                    {PROVIDER_VOLGORDE.map((prov) => {
                      const groep = allowlist.filter((m) => m.provider === prov);
                      if (groep.length === 0) return null;
                      return (
                        <optgroup key={prov} label={PROVIDER_LABEL[prov]}>
                          {groep.map((m) => (
                            <option key={m.model_name} value={m.model_name}>
                              {modelOptieLabel(m)}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      gekozenModel.provider === "anthropic"
                        ? "bg-ink/10 text-ink/60"
                        : "bg-warn-tint text-warn-ink"
                    }`}
                  >
                    {PROVIDER_BADGE[gekozenModel.provider]}
                    {gekozenModel.provider !== "anthropic" && " · ander provider"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink/50">{gekozenModel.toelichting}</p>

                <button
                  type="button"
                  onClick={() => setToonInstellingen((v) => !v)}
                  className="mt-2 rounded-lg border border-dashed border-line px-2 py-1 text-xs text-ink/70 hover:bg-app-bg"
                >
                  ⚙ {toonAdHoc ? "Modelinstellingen" : "Challenger-instellingen"} {toonInstellingen ? "verbergen" : `aanpassen (tokens / ${isReasoning ? "reasoning-effort" : "temperature"})`}
                </button>

                {toonInstellingen && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs">
                      <span className="mb-1 block text-ink/60">
                        {isReasoning ? "Max completion tokens" : "Max tokens"}
                      </span>
                      <input
                        name="max_tokens"
                        type="number"
                        min={256}
                        max={16384}
                        step={100}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                        className="w-full rounded-lg border border-line bg-white px-2 py-1"
                      />
                      {isReasoning && (
                        <span className="mt-0.5 block text-[10px] text-ink/40">
                          incl. verborgen reasoning-tokens — zet ruim
                        </span>
                      )}
                    </label>

                    {isReasoning ? (
                      // Reasoning-modellen: temperature/top-p vergrendeld → effort-knop.
                      <label className="text-xs">
                        <span className="mb-1 block text-ink/60">Reasoning-effort</span>
                        <select
                          name="reasoning_effort"
                          value={reasoningEffort}
                          onChange={(e) => setReasoningEffort(e.target.value)}
                          className="w-full rounded-lg border border-line bg-white px-2 py-1"
                        >
                          {EFFORT_OPTIES.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <span className="mt-0.5 block text-[10px] text-ink/40">
                          temperature/top-p zijn bij dit model vergrendeld
                        </span>
                      </label>
                    ) : (
                      <>
                        <label className="text-xs">
                          <span className="mb-1 block text-ink/60">Temperature</span>
                          <select
                            name="temp_mode"
                            value={tempMode}
                            onChange={(e) => setTempMode(e.target.value)}
                            className="w-full rounded-lg border border-line bg-white px-2 py-1"
                          >
                            {TEMP_OPTIES.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs">
                          <span className="mb-1 block text-ink/60">Top-p (optioneel)</span>
                          <input
                            name="top_p"
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={topP}
                            onChange={(e) => setTopP(e.target.value)}
                            placeholder="provider-default"
                            className="w-full rounded-lg border border-line bg-white px-2 py-1"
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
                {/* Zorg dat de challenger-instellingen ook meegaan als het paneel dicht is.
                    Reasoning-modellen dragen effort mee; chat-modellen temperature/top-p. */}
                {!toonInstellingen && (
                  <>
                    <input type="hidden" name="max_tokens" value={maxTokens} />
                    {isReasoning ? (
                      <input type="hidden" name="reasoning_effort" value={reasoningEffort} />
                    ) : (
                      <>
                        <input type="hidden" name="temp_mode" value={tempMode} />
                        <input type="hidden" name="top_p" value={topP} />
                      </>
                    )}
                  </>
                )}

                {/* Gewijzigde as + "gepind als" — alleen bij een vergelijking (regressie/subset). */}
                {!toonAdHoc && (
                  <>
                    <div className="mt-2 text-xs text-ink/60">
                      Gewijzigde as t.o.v. baseline:{" "}
                      <span className="font-medium">
                        {gekozenModel.provider !== "anthropic" && afgeleideAs !== "geen"
                          ? "provider + model"
                          : AS_LABEL[afgeleideAs]}
                      </span>{" "}
                      <span className="text-ink/40">(automatisch afgeleid)</span>
                    </div>
                    {afgeleideAs === "geen" && (
                      <div className="mt-1 text-xs text-ink/50">Identiek aan de baseline — er valt niets te vergelijken.</div>
                    )}
                    {afgeleideAs === "meerdere" && (
                      <div className="mt-1 text-xs text-warn-ink">Meerdere assen tegelijk gewijzigd — een verschil is straks niet zuiver aan één oorzaak toe te schrijven. Wijzig bij voorkeur één as per run.</div>
                    )}
                    <div className="mt-1 text-xs text-ink/50">Wordt gepind als: <span className="font-mono">{autoNaam(challengerVariant)}</span></div>
                  </>
                )}
              </div>
            </div>
          </fieldset>

        {/* Stap 3 — waarop draait de run (progressive disclosure) */}
        <fieldset>
          <legend className="mb-1 text-sm text-ink/70">3 · Waarop draait de run?</legend>

          {(runType === "full_regression" || runType === "subset") && (
            <label className="block text-sm">
              <span className="mb-1 block text-ink/70">Testset</span>
              <select
                name="test_set_id"
                value={testSetId}
                onChange={(e) => setTestSetId(e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              >
                <option value="">— kies een testset —</option>
                {testsets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.naam} ({t.code}) · {testsetTellingen[t.id] ?? 0} cases
                  </option>
                ))}
              </select>
            </label>
          )}

          {toonSubset && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-ink/70">
                Subset — handmatige testcase-selectie ({testcases.length} beschikbaar)
              </summary>
              <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                {testcases.map((tc) => (
                  <label key={tc.id} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="selected_test_case_ids" value={tc.id} className="rounded border-line" />
                    <span className="font-mono">{tc.code}</span>
                    <span className="text-ink/60">{tc.titel}</span>
                    {tc.soort === "security_blocking" && <span className="text-err-ink">[sec]</span>}
                    {tc.consistency_required && <span className="text-accent">[cons]</span>}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink/50">
                Een subset zonder de blocking-set kan nooit tot advies &apos;accepteren&apos; leiden.
              </p>
            </details>
          )}

          {toonAdHoc && (
            <label className="block text-sm">
              <span className="mb-1 block text-ink/70">Ad-hoc vraag</span>
              <input
                name="ad_hoc_question"
                type="text"
                value={adHocVraag}
                onChange={(e) => setAdHocVraag(e.target.value)}
                placeholder="Stel je eigen testvraag…"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-ink/50">
                Ad-hoc telt niet mee voor de formele regressiescore, tenzij je hem opslaat als officiële testcase.
              </span>
            </label>
          )}

          {/* Consistentie. Bij subset: opt-in met checkbox. Bij ad-hoc draait de
              synchrone motor altijd N iteraties + berekent consistentie — dus geen
              (misleidende) checkbox, alleen het aantal herhalingen. */}
          {(runType === "subset" || runType === "ad_hoc") && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              {!toonAdHoc && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="consistency_enabled" className="rounded border-line" />
                  <span className="text-ink/70">Consistentie meten</span>
                </label>
              )}
              <label className="flex items-center gap-2">
                <span className="text-ink/70">{toonAdHoc ? "Herhalingen (consistentie)" : "Iteraties"}</span>
                <select name="iteraties" className="rounded-lg border border-line bg-white px-2 py-1 text-sm">
                  {!toonAdHoc && <option value="">testcase-default</option>}
                  <option value="3">3 (normaal)</option>
                  <option value="5">5 (governance-kritiek/safety)</option>
                </select>
              </label>
            </div>
          )}
        </fieldset>

        {/* Geavanceerd — soort + opslag/retentie */}
        <details>
          <summary className="cursor-pointer text-sm text-ink/70">Geavanceerd — soort &amp; opslag/retentie</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Soort</span>
              <select
                name="soort"
                value={soort}
                onChange={(e) => setSoort(e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              >
                <option value="functioneel">functioneel</option>
                <option value="security_blocking">security/safety (blocking-set)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Persist-modus</span>
              <select
                name="persist_mode"
                disabled={toonAdHoc}
                value={toonAdHoc ? "none" : persistMode}
                onChange={(e) => setPersistMode(e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="full_synthetic">full_synthetic (alles bewaren — synthetisch)</option>
                <option value="metadata_only">metadata_only (alleen scores/status)</option>
                <option value="none">none (niets persistent)</option>
              </select>
              {toonAdHoc && (
                <span className="mt-1 block text-xs text-ink/50">Vast op &apos;niets bewaren&apos; bij ad-hoc — de test wordt niet opgeslagen.</span>
              )}
            </label>
          </div>
        </details>

        {/* Vereisten/blokkers-paneel. Groen alleen zónder aandachtspunten; met
            openstaande waarschuwingen een neutrale toon (geen groen over een ⚠). */}
        <div className={`rounded-lg border p-3 text-xs ${geblokkeerd ? "border-warn-ink/30 bg-warn-tint" : heeftWaarschuwing ? "border-line bg-app-bg" : "border-ok-ink/30 bg-ok-tint"}`}>
          <div className={`font-semibold ${geblokkeerd ? "text-warn-ink" : heeftWaarschuwing ? "text-ink/80" : "text-ok-ink"}`}>
            {geblokkeerd ? "Nog niet klaar — vul dit eerst aan" : heeftWaarschuwing ? "Klaar om te draaien — let op de aandachtspunten" : "Klaar om te draaien"}
          </div>
          <ul className="mt-1 space-y-0.5">
            {blokkers.map((b, i) => (
              <li key={`b${i}`} className="text-warn-ink">• {b}</li>
            ))}
            {waarschuwingen.map((w, i) => (
              <li key={`w${i}`} className="text-ink/70">⚠ {w}</li>
            ))}
            {!geblokkeerd && waarschuwingen.length === 0 && <li className="text-ok-ink">✓ Alle vereisten voldaan.</li>}
          </ul>
        </div>

        <div>
          <button
            type="submit"
            disabled={geblokkeerd || (toonAdHoc && adhocPending)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {toonAdHoc ? (adhocPending ? "Ad-hoc testen…" : "Ad-hoc testen (niet bewaard)") : "Run in de wachtrij zetten"}
          </button>
          <p className="mt-2 text-xs text-ink/50">
            {toonAdHoc
              ? "Wordt direct getest en niet opgeslagen (persist_mode none). Het resultaat verschijnt hieronder — puur verkennend, telt niet mee voor de formele regressiescore."
              : "De run wordt asynchroon verwerkt door de achtergrond-worker (cron). Ververs deze pagina voor de voortgang."}
          </p>
        </div>
      </form>

      {/* Ad-hoc: synchroon resultaat inline (niet-persistent). */}
      {toonAdHoc && adhocFout && (
        <p className="mt-4 text-sm text-err-ink">Fout: {adhocFout}</p>
      )}
      {toonAdHoc && adhocResultaat && (
        <div className="mt-5 space-y-4">
          <p className="rounded-lg border border-line bg-app-bg p-3 text-xs text-ink/70">
            Niet persistent opgeslagen (persist_mode none) — dit resultaat verdwijnt bij verversen.
          </p>
          <ConsistentieBlok titel="ad-hoc vraag" aggregaat={adhocResultaat.aggregaat} iteraties={adhocIteraties} />
        </div>
      )}
    </section>
  );
}
