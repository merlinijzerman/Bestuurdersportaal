// ============================================================================
//  AI Quality Lab — console (AQL-2). Run-overzicht + "run starten".
//  Leest via de service-role (aqlab_* is deny-by-default); de capability
//  platform.aqlab.operate wordt hier server-side gecontroleerd. De (beveiligd)-
//  layout borgt sessie + platform-identiteit + MFA.
// ============================================================================

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { lijstRuns, haalTestsets } from "@/lib/aqlab/console-lees";
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
  const [runs, testsets] = await Promise.all([lijstRuns(svc), haalTestsets(svc)]);

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

      {/* Run starten */}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Run starten</h2>
        <form action={startRunActie} className="mt-3 grid gap-3 sm:grid-cols-2">
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
            <span className="mb-1 block text-ink/70">Run-type</span>
            <select name="run_type" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="full_regression">Volledige regressierun</option>
              <option value="subset">Subset</option>
              <option value="ad_hoc">Ad-hoc testvraag</option>
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
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Ad-hoc vraag (alleen bij ad-hoc)</span>
            <input
              name="ad_hoc_question"
              type="text"
              placeholder="Optioneel"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Run in de wachtrij zetten
            </button>
            <p className="mt-2 text-xs text-ink/50">
              De run wordt asynchroon verwerkt door de achtergrond-worker (cron). Ververs deze pagina
              voor de voortgang.
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
