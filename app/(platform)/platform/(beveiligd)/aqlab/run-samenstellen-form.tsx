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

import { useState } from "react";
import { startRunActie } from "./acties";
import {
  autoNaam,
  leidGewijzigdeAsAf,
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

const TEMP_OPTIES: { value: string; label: string }[] = [
  { value: "default", label: "provider-default (zoals productie)" },
  { value: "0.0", label: "0.0 — deterministisch" },
  { value: "0.2", label: "0.2 — laag" },
  { value: "0.5", label: "0.5 — midden" },
  { value: "0.7", label: "0.7 — creatief" },
  { value: "1.0", label: "1.0 — hoog" },
];

function kort(id: string): string {
  return id.slice(0, 8);
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
  const [adHocVraag, setAdHocVraag] = useState<string>("");
  const [soort, setSoort] = useState<string>("functioneel");

  const gekozenModel = allowlist.find((m) => m.model_name === challengerModel) ?? productiekern;

  // Baseline voor de gekozen testset (of productiekern-default als er geen vrijgave is).
  const baseline = testSetId ? baselines[testSetId] ?? null : null;
  const baselineVariant = baseline?.variant ?? productiekernVariant;

  const challengerVariant: VariantInstellingen = {
    model: challengerModel,
    temperature: tempMode === "default" ? null : Number(tempMode),
    maxTokens,
    topP: topP.trim() ? Number(topP) : null,
    retrieval: {},
  };
  const afgeleideAs = leidGewijzigdeAsAf(baselineVariant, challengerVariant);
  const expliciteTemp = tempMode !== "default";

  // ── Proactieve vereisten/blokkers ──────────────────────────────────────────
  const blokkers: string[] = [];
  const waarschuwingen: string[] = [];

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

  if (runType === "full_regression" && soort !== "security_blocking") {
    waarschuwingen.push(
      "Dit is geen security/safety-set. Een volledige regressie vereist óók een geslaagde security/safety-run; op basis van deze run alleen kan het advies nooit 'accepteren' zijn."
    );
  }
  if (expliciteTemp) {
    waarschuwingen.push(
      "Je zet temperature expliciet. Productie zet 'm niet (provider-default) — deze variant wijkt dus af van wat live draait. Voor een zuivere baseline: laat op provider-default. De variant wordt append-only gepind (§2B)."
    );
  }
  if ((runType === "full_regression" || runType === "subset") && testSetId && !baseline) {
    waarschuwingen.push(
      "Er is nog geen vrijgegeven baseline voor deze testset; de challenger wordt vergeleken met de productiekern-default."
    );
  }

  const geblokkeerd = blokkers.length > 0;

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

      <form action={startRunActie} className="mt-3 space-y-5">
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

        {/* Stap 2 — baseline → challenger (alleen bij regressie/subset) */}
        {toonVergelijking && (
          <fieldset>
            <legend className="mb-1 text-sm text-ink/70">2 · Wat vergelijk je? (baseline → challenger)</legend>
            <p className="mb-2 text-xs text-ink/50">
              Links draait nu live (baseline), rechts zet je een variant ertegenaf (challenger). De gewijzigde as
              leidt het Lab automatisch af.
            </p>
            <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
              {/* Baseline (read-only) */}
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

              {/* Challenger */}
              <div className="rounded-lg border border-accent/40 p-3">
                <div className="text-xs font-semibold uppercase text-accent">◆ Nieuw — wat je test (challenger)</div>
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
                    {allowlist.map((m) => (
                      <option key={m.model_name} value={m.model_name}>
                        {modelOptieLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1 text-xs text-ink/50">{gekozenModel.toelichting}</p>

                <button
                  type="button"
                  onClick={() => setToonInstellingen((v) => !v)}
                  className="mt-2 rounded-lg border border-dashed border-line px-2 py-1 text-xs text-ink/70 hover:bg-app-bg"
                >
                  ⚙ Challenger-instellingen {toonInstellingen ? "verbergen" : "aanpassen (tokens / temperature)"}
                </button>

                {toonInstellingen && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs">
                      <span className="mb-1 block text-ink/60">Max tokens</span>
                      <input
                        name="max_tokens"
                        type="number"
                        min={256}
                        max={8192}
                        step={100}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                        className="w-full rounded-lg border border-line bg-white px-2 py-1"
                      />
                    </label>
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
                  </div>
                )}
                {/* Zorg dat de challenger-instellingen ook meegaan als het paneel dicht is. */}
                {!toonInstellingen && (
                  <>
                    <input type="hidden" name="max_tokens" value={maxTokens} />
                    <input type="hidden" name="temp_mode" value={tempMode} />
                    <input type="hidden" name="top_p" value={topP} />
                  </>
                )}

                <div className="mt-2 text-xs text-ink/60">
                  Gewijzigde as t.o.v. baseline: <span className="font-medium">{afgeleideAs}</span>{" "}
                  <span className="text-ink/40">(automatisch afgeleid)</span>
                </div>
                <div className="mt-1 text-xs text-ink/50">Wordt gepind als: <span className="font-mono">{autoNaam(challengerVariant)}</span></div>
              </div>
            </div>
          </fieldset>
        )}

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

          {/* Consistentie (subset/ad-hoc) */}
          {(runType === "subset" || runType === "ad_hoc") && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="consistency_enabled" className="rounded border-line" />
                <span className="text-ink/70">Consistentie meten</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-ink/70">Iteraties</span>
                <select name="iteraties" className="rounded-lg border border-line bg-white px-2 py-1 text-sm">
                  <option value="">testcase-default</option>
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
              <select name="persist_mode" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
                <option value="full_synthetic">full_synthetic (alles bewaren — synthetisch)</option>
                <option value="metadata_only">metadata_only (alleen scores/status)</option>
                <option value="none">none (niets persistent)</option>
              </select>
            </label>
          </div>
        </details>

        {/* Vereisten/blokkers-paneel */}
        <div className={`rounded-lg border p-3 text-xs ${geblokkeerd ? "border-warn-ink/30 bg-warn-tint" : "border-ok-ink/30 bg-ok-tint"}`}>
          <div className={`font-semibold ${geblokkeerd ? "text-warn-ink" : "text-ok-ink"}`}>
            {geblokkeerd ? "Nog niet klaar — vul dit eerst aan" : "Klaar om te draaien"}
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
            disabled={geblokkeerd}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run in de wachtrij zetten
          </button>
          <p className="mt-2 text-xs text-ink/50">
            De run wordt asynchroon verwerkt door de achtergrond-worker (cron). Ververs deze pagina voor de voortgang.
            Voor een <strong>directe</strong> ad-hoc consistentietest (incl. persist_mode none): gebruik de knop bovenaan.
          </p>
        </div>
      </form>
    </section>
  );
}
