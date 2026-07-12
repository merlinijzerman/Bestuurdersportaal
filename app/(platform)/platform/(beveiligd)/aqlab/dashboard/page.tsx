// app/(platform)/platform/(beveiligd)/aqlab/dashboard/page.tsx
// -----------------------------------------------------------------------------
// Scherm 7 — Dashboard kwaliteit per feature (platform-console, AQL-4). Per
// AI-feature geaggregeerde metrics met bij elke metric "wat betekent dit / hoe
// gemeten / wat níet", en het steekproefkarakter (aantal outputs) expliciet
// zichtbaar. Pure HTML/SVG, geen chart-library. Alleen platform-console.
// -----------------------------------------------------------------------------

import Link from "next/link";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import { createServiceSupabase } from "@/platform/lib/supabase-service";
import { haalKwaliteitDashboard } from "@/platform/lib/aqlab/dashboard-lees";

export const dynamic = "force-dynamic";

const CAP = "platform.aqlab.operate";

function Metric({ label, waarde, wat, hoe, niet }: { label: string; waarde: React.ReactNode; wat: string; hoe: string; niet: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink/60">{label}</span>
        <span className="font-serif text-lg font-bold text-ink">{waarde}</span>
      </div>
      <dl className="mt-1.5 space-y-0.5 text-[11px] text-ink/60">
        <div><span className="font-semibold">Wat:</span> {wat}</div>
        <div><span className="font-semibold">Hoe gemeten:</span> {hoe}</div>
        <div><span className="font-semibold">Wat níet:</span> {niet}</div>
      </dl>
    </div>
  );
}

export default async function KwaliteitDashboard() {
  const identiteit = await huidigePlatformIdentiteit();
  if (!identiteit?.capabilities.includes(CAP)) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-sm text-ink/70">Geen toegang. Vereist: <code className="font-mono text-xs">{CAP}</code>.</p>
      </div>
    );
  }

  const svc = createServiceSupabase();
  const rijen = await haalKwaliteitDashboard(svc);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/aqlab" className="text-sm text-accent hover:underline">← Terug naar het Lab</Link>
        <h1 className="mt-1 font-serif text-2xl font-bold">Kwaliteit per feature</h1>
        <p className="text-sm text-ink/60">
          Geaggregeerd over de laatste voltooide run per feature. Scores hebben een
          steekproefkarakter — het aantal getoetste outputs staat er expliciet bij.
        </p>
      </div>

      {rijen.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-5 text-sm text-ink/70">
          Nog geen features geregistreerd. (De golden set is nog niet geseed — zie de seeding-gate.)
        </div>
      ) : (
        rijen.map((r) => (
          <section key={r.feature_id} className="rounded-xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-lg font-bold">{r.naam}</h2>
              <code className="font-mono text-xs text-ink/50">{r.code}</code>
              <span className="ml-auto text-xs text-ink/50">
                {r.aantal_outputs} outputs
                {r.laatste_run_op ? ` · laatste run ${new Date(r.laatste_run_op).toLocaleDateString("nl-NL")}` : " · nog geen voltooide run"}
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metric
                label="Gem. kwaliteitsscore"
                waarde={r.gem_quality_score ?? "—"}
                wat="Gemiddelde graduele score (0–100) over de outputs."
                hoe="Deterministische + heuristische checks + adviserende judge."
                niet="Geen garantie per afzonderlijke output; gate blokkeert los van de score."
              />
              <Metric
                label="Geblokkeerde outputs"
                waarde={r.aantal_geblokkeerd}
                wat="Outputs met een harde blokkade (gate = geblokkeerd)."
                hoe="Blokkade-gate (o.a. herkomstlabel/hallucinatie), los van de score."
                niet="Zegt niets over de gemiddelde kwaliteit — één blokkade telt hard."
              />
              <Metric
                label="Openstaande reviews"
                waarde={r.aantal_review_vereist}
                wat="Outputs die menselijke aftekening vereisen."
                hoe="Gate = review_vereist (bv. judge-twijfel of review_verplicht)."
                niet="Nog geen oordeel — vereist een mens (human-in-the-loop)."
              />
              <Metric
                label="Open kritieke bevindingen"
                waarde={r.open_kritieke_bevindingen}
                wat="Kritieke findings met status 'open'."
                hoe="Findings ernst=kritiek gekoppeld aan de run-outputs."
                niet="Blokkeert vrijgave; een hoge gemiddelde score overrulet dit niet."
              />
              <Metric
                label="Laatste releasestatus"
                waarde={r.laatste_release_status ?? "—"}
                wat="Meest recente vrijgave-status van de feature."
                hoe="Laatste append-only regel in aqlab_release_decisions."
                niet="Statustaal 'vrijgegeven voor gebruik' ≠ juridische garantie."
              />
              <Metric
                label="Laatste releaseadvies"
                waarde={r.laatste_release_advies ?? "—"}
                wat="Advies van de run (accepteren/aanpassen/blokkeren)."
                hoe="Regressie + consistentie + blokkades (AQL-3)."
                niet="Advies ≠ besluit; vrijgave blijft een mensbesluit."
              />
            </div>

            {r.laatste_run_id && (
              <Link href={`/platform/aqlab/runs/${r.laatste_run_id}`} className="mt-3 inline-block text-sm text-accent hover:underline">
                → Laatste run + vrijgave/audit
              </Link>
            )}
          </section>
        ))
      )}
    </div>
  );
}
