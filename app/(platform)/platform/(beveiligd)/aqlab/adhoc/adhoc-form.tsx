"use client";

// ============================================================================
//  Scherm 6b — Ad-hoc consistentietest (client). Draait N iteraties SYNCHROON
//  (in-proces) via de server-action en toont het consistentie-aggregaat + de
//  Iteraties-tab direct. Respecteert persist_mode: bij 'none' wordt niets
//  persistent opgeslagen (alleen getoond).
// ============================================================================

import { useActionState } from "react";
import { adHocConsistentieActie } from "../acties";
import ConsistentieBlok, { type IteratieView } from "../runs/[runId]/consistentie-blok";
import type { AdHocConsistentieResultaat } from "@/platform/lib/aqlab/run-orchestrator";

type State = AdHocConsistentieResultaat | { fout: string } | null;

function bronLabels(bronnen: unknown): string[] {
  if (!Array.isArray(bronnen)) return [];
  return bronnen.map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return String(o.bron ?? o.titel ?? o.document_id ?? o.nummer ?? "");
  }).filter((s) => s.length > 0);
}

export default function AdHocForm({
  modelConfigs,
  fixtures,
}: {
  modelConfigs: { id: string; naam: string; model_name: string }[];
  fixtures: { code: string; titel: string }[];
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(adHocConsistentieActie, null);
  const resultaat = state && !("fout" in state) ? state : null;
  const fout = state && "fout" in state ? state.fout : null;

  const iteraties: IteratieView[] = (resultaat?.iteraties ?? []).map((it) => ({
    iteratie: it.iteratie,
    antwoord: it.antwoord,
    quality_score: it.quality_score,
    gate_status: it.gate_status,
    latency_ms: it.latency_ms,
    tokengebruik: it.tokengebruik,
    bronnen: bronLabels(it.bronnen),
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Ad-hoc consistentietest</h2>
        <p className="mt-1 text-xs text-ink/50">
          Deze test telt niet mee voor de formele regressiescore, tenzij je hem opslaat als officiële testcase. De
          iteraties draaien binnen één (synchrone) run. Bij persist_mode <span className="font-mono">none</span> wordt
          niets persistent opgeslagen — alleen getoond.
        </p>
        <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-ink/70">Vraag</span>
            <input name="vraag" required className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder="Bijv. Vat de kern van dit memo samen." />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Rol</span>
            <select name="rol" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">bestuurder</option>
              <option value="voorzitter">voorzitter</option>
              <option value="beheerder">beheerder</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Aantal herhalingen</span>
            <select name="iteraties" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="3">3 (normaal)</option>
              <option value="5">5 (governance-kritiek/safety)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Modelconfiguratie</span>
            <select name="model_configuration_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">productiekern-default</option>
              {modelConfigs.map((m) => (
                <option key={m.id} value={m.id}>{m.naam} · {m.model_name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Persist-modus</span>
            <select name="persist_mode" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="none">none (niets persistent — alleen tonen)</option>
              <option value="metadata_only">metadata_only (scores/status)</option>
              <option value="full_synthetic">full_synthetic (alles bewaren)</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-ink/70">Broncontext (fixture-codes, komma-gescheiden)</span>
            <input name="fixture_ids" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" placeholder={fixtures.slice(0, 2).map((f) => f.code).join(", ")} />
            <span className="mt-1 block text-xs text-ink/40">Beschikbaar: {fixtures.slice(0, 8).map((f) => f.code).join(", ")}{fixtures.length > 8 ? "…" : ""}</span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {pending ? "Iteraties draaien…" : "Consistentietest draaien"}
            </button>
          </div>
        </form>
        {fout && <p className="mt-2 text-sm text-err-ink">Fout: {fout}</p>}
      </section>

      {resultaat && (
        <>
          <p className="rounded-lg border border-line bg-app-bg p-3 text-xs text-ink/70">
            {resultaat.persisted
              ? `Opgeslagen (persist_mode ${resultaat.persist_mode}). Run ${resultaat.run_id?.slice(0, 8)}.`
              : "Niet persistent opgeslagen (persist_mode none) — dit resultaat verdwijnt bij verversen."}
          </p>
          <ConsistentieBlok titel="ad-hoc vraag" aggregaat={resultaat.aggregaat} iteraties={iteraties} />
        </>
      )}
    </div>
  );
}
