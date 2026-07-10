// ============================================================================
//  AI Quality Lab — console (AQL-2). Run-overzicht + "run starten".
//  Leest via de service-role (aqlab_* is deny-by-default); de capability
//  platform.aqlab.operate wordt hier server-side gecontroleerd. De (beveiligd)-
//  layout borgt sessie + platform-identiteit + MFA.
// ============================================================================

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import {
  lijstRuns,
  haalTestsets,
  haalModelConfiguraties,
  haalBaselineKandidaten,
  haalTestcases,
} from "@/lib/aqlab/console-lees";
import { startRunActie } from "./acties";

export const dynamic = "force-dynamic";

const CAP = "platform.aqlab.operate";

const STATUS_KLEUR: Record<string, string> = {
  queued: "bg-app-bg text-ink/70",
  running: "bg-accent/10 text-accent",
  done: "bg-ok-tint text-ok-ink",
  failed: "bg-err-tint text-err-ink",
  cancelled: "bg-app-bg text-ink/50",
};

export default async function AqlabConsole() {
  const identiteit = await huidigePlatformIdentiteit();
  const mag = (identiteit?.capabilities ?? []).includes(CAP);

  if (!mag) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <h1 className="font-serif text-2xl font-bold">AI Quality Lab</h1>
        <p className="mt-2 text-sm text-ink/70">
          U hebt geen toegang tot het Lab. Vereist: <code className="font-mono text-xs">{CAP}</code>.
          Vraag toekenning aan bij een platformbeheerder (vier-ogen, geaudit).
        </p>
      </div>
    );
  }

  const svc = createServiceSupabase();
  const [runs, testsets, modelConfigs, baselines, testcases] = await Promise.all([
    lijstRuns(svc),
    haalTestsets(svc),
    haalModelConfiguraties(svc),
    haalBaselineKandidaten(svc),
    haalTestcases(svc),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">AI Quality Lab</h1>
        <p className="mt-1 text-sm text-ink/70">
          Draait de <strong>exact dezelfde generatie-/retrievalkern als productie</strong> op de
          synthetische golden set en scoort elke output. Scores ondersteunen kwaliteitsborging;
          zij vormen geen juridische garantie en vervangen geen menselijke verantwoordelijkheid.
        </p>
      </div>

      {/* Snelkoppelingen (scherm 6b ad-hoc consistentietest + scherm 5a promotie) */}
      <div className="flex flex-wrap gap-3">
        <Link href="/platform/aqlab/adhoc" className="rounded-lg border border-line bg-white px-3 py-2 text-sm hover:bg-app-bg">
          Ad-hoc consistentietest →
        </Link>
        <Link href="/platform/aqlab/promoveren" className="rounded-lg border border-line bg-white px-3 py-2 text-sm hover:bg-app-bg">
          Ad-hoc vraag opslaan als testcase →
        </Link>
      </div>

      {/* Scherm 3 — Run samenstellen */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Run samenstellen</h2>
        <form action={startRunActie} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Run-type</span>
            <select name="run_type" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="full_regression">Volledige regressierun (formeel advies mogelijk)</option>
              <option value="subset">Subset (indicatief)</option>
              <option value="ad_hoc">Ad-hoc testvraag (geen formeel advies)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Testset</span>
            <select name="test_set_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">— kies een testset —</option>
              {testsets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.naam} ({t.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Modelconfiguratie (variant)</span>
            <select name="model_configuration_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">— productiekern-default —</option>
              {modelConfigs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.naam} · {m.model_name}{m.is_baseline ? " (baseline)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Baseline-run (voor regressie)</span>
            <select name="baseline_run_id" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">— geen (geen regressievergelijking) —</option>
              {baselines.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.run_type} · {b.id.slice(0, 8)} · {b.voltooid_op ? new Date(b.voltooid_op).toLocaleDateString("nl-NL") : "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Rol</span>
            <select name="rol" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              <option value="baseline">baseline</option>
              <option value="challenger">challenger</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Gewijzigde as</span>
            <select name="gewijzigde_as" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              <option value="geen">geen</option>
              <option value="prompt">prompt</option>
              <option value="model">model</option>
              <option value="temperature">temperature</option>
              <option value="max_tokens">max_tokens</option>
              <option value="retrieval">retrieval</option>
              <option value="meerdere">meerdere (regressiesignaal niet toewijsbaar)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Soort</span>
            <select name="soort" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
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
          <div className="flex items-center gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="consistency_enabled" className="rounded border-line" />
              <span className="text-ink/70">Consistentie meten (subset/ad-hoc)</span>
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
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-ink/70">Ad-hoc vraag (alleen bij ad-hoc run-type)</span>
            <input name="ad_hoc_question" type="text" placeholder="Optioneel" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
          </label>

          {/* Subset: handmatige testcase-selectie (reproduceerbaar vastgelegd) */}
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-sm text-ink/70">Subset — handmatige testcase-selectie ({testcases.length} beschikbaar)</summary>
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
              Bij consistentie blijft dit één run; de geselecteerde testcases worden meerdere keren als iteratie
              uitgevoerd. Een subset zonder de blocking-set kan nooit tot advies &apos;accepteren&apos; leiden.
            </p>
          </details>

          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              Run in de wachtrij zetten
            </button>
            <p className="mt-2 text-xs text-ink/50">
              De run wordt asynchroon verwerkt door de achtergrond-worker (cron). Ververs deze pagina voor de
              voortgang. Voor een <strong>directe</strong> ad-hoc consistentietest (incl. persist_mode none): gebruik de
              knop bovenaan.
            </p>
          </div>
        </form>
      </section>

      {/* Runs */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Runs ({runs.length})
        </h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-ink/70">Nog geen runs. Start hierboven een run.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink/50">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Outputs</th>
                  <th className="py-2 pr-4">P95 latency</th>
                  <th className="py-2 pr-4">Kosten (schatting)</th>
                  <th className="py-2 pr-4">Gestart</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const perf = r.aggregatie?.performance;
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="py-2 pr-4">{r.run_type}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_KLEUR[r.status] ?? "bg-app-bg"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4">{perf?.outputs ?? "—"}</td>
                      <td className="py-2 pr-4">{perf?.latency_p95 != null ? `${perf.latency_p95} ms` : "—"}</td>
                      <td className="py-2 pr-4">
                        {r.totale_kosten != null ? `± $${Number(r.totale_kosten).toFixed(4)}` : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {r.gestart_op ? new Date(r.gestart_op).toLocaleString("nl-NL") : "—"}
                      </td>
                      <td className="py-2">
                        <Link href={`/platform/aqlab/runs/${r.id}`} className="text-accent hover:underline">
                          Bekijk
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
