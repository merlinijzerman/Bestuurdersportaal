// ============================================================================
//  AI Quality Lab — console (AQL-2). Run-overzicht + "run starten".
//  Leest via de service-role (aqlab_* is deny-by-default); de capability
//  platform.aqlab.operate wordt hier server-side gecontroleerd. De (beveiligd)-
//  layout borgt sessie + platform-identiteit + MFA.
// ============================================================================

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import { createServiceSupabase } from "@/core/lib/supabase-service";
import {
  lijstRuns,
  haalTestsets,
  haalTestcases,
  haalTestsetTellingen,
  haalProductieBaseline,
  haalFixtures,
} from "@/platform/lib/aqlab/console-lees";
import { AQLAB_TOEGESTANE_MODELLEN } from "@/core/lib/aqlab/modellen";
import RunSamenstellenForm, { type BaselineProp } from "./run-samenstellen-form";

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
  const [runs, testsets, testcases, testsetTellingen, fixtures] = await Promise.all([
    lijstRuns(svc),
    haalTestsets(svc),
    haalTestcases(svc),
    haalTestsetTellingen(svc),
    haalFixtures(svc),
  ]);

  // Vaste productie-baseline per testset (laatst vrijgegeven variant).
  const baselineParen = await Promise.all(
    testsets.map(async (t) => [t.id, await haalProductieBaseline(svc, t.id)] as const)
  );
  const baselines: Record<string, BaselineProp> = {};
  for (const [id, b] of baselineParen) {
    if (b) baselines[id] = b;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold">AI Quality Lab</h1>
          <p className="mt-1 text-sm text-ink/70">
            Draait de <strong>exact dezelfde generatie-/retrievalkern als productie</strong> op de
            synthetische golden set en scoort elke output. Scores ondersteunen kwaliteitsborging;
            zij vormen geen juridische garantie en vervangen geen menselijke verantwoordelijkheid.
          </p>
        </div>
        {/* Rustige nav-link naar het feature-dashboard (scherm 7) — geen samenstel-knop. */}
        <Link href="/platform/aqlab/dashboard" className="whitespace-nowrap text-sm text-accent hover:underline">
          Kwaliteit per feature →
        </Link>
      </div>

      {/* Scherm 3 — Run samenstellen (client-form: progressive disclosure + blokkers) */}
      <RunSamenstellenForm
        testsets={testsets}
        testsetTellingen={testsetTellingen}
        testcases={testcases}
        allowlist={AQLAB_TOEGESTANE_MODELLEN}
        baselines={baselines}
        fixtures={fixtures}
      />

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
                  <th className="py-2 pr-4">Naam</th>
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
                      <td className="py-2 pr-4">
                        {r.naam ? <span className="font-medium">{r.naam}</span> : <span className="text-ink/40">— {r.id.slice(0, 8)}</span>}
                      </td>
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
