// ============================================================================
//  AI Quality Lab — run-overzicht (scherm 6) + scorekaart per output (scherm 5).
//  quality_score (gradueel) STRIKT gescheiden van gate_status (categorisch);
//  geen groen vinkje zonder onderliggend bewijs; per criterium methode +
//  motivatie + bewijs + meetbeperking + human-review + blokkadecriteria; volledige
//  herkomst. Alleen platform-console (nooit de fonds-assurance-view).
// ============================================================================

import Link from "next/link";
import { type OutputMetScores, type ScoreRij } from "@/platform/lib/aqlab/console-lees";
import { PlatformError } from "@/platform/lib/platform-wrapper";
import { leesAqlabRun } from "@/platform/lib/aqlab/platform-lees";
import PerformanceVergelijkingBlok from "./performance-vergelijking-blok";
import { criteriumByKey } from "@/platform/lib/aqlab/criteria";
import { HARDE_BLOKKADE_CHECKS } from "@/platform/lib/aqlab/checks/index";
import { annuleerRunActie, humanReviewActie } from "../../acties";
import RegressieBlok from "./regressie-blok";
import ReleaseBlok from "./release-blok";
import VergelijkingBlok, { type VergelijkingItem } from "./vergelijking-blok";
import ConsistentieBlok, { type IteratieView } from "./consistentie-blok";

function bronLabels(gebruikteBronnen: unknown): string[] {
  if (!Array.isArray(gebruikteBronnen)) return [];
  return gebruikteBronnen
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return String(o.bron ?? o.titel ?? o.document_id ?? "");
    })
    .filter((s) => s.length > 0);
}

export const dynamic = "force-dynamic";

const CAP = "platform.aqlab.operate";
const CAP_REVIEW = "platform.aqlab.review";
const CAP_GOVERN = "platform.aqlab.govern";

function releaseMelding(sp: Record<string, string | undefined>):
  | { soort: "ok" | "fout" | "audit_ok" | "audit_fout" | "verify"; tekst: string }
  | null {
  if (sp.release_ok) return { soort: "ok", tekst: "Vrijgavebesluit vastgelegd (append-only)." };
  if (sp.release_fout) return { soort: "fout", tekst: `Besluit geweigerd: ${sp.release_fout}` };
  if (sp.audit_ok) return { soort: "audit_ok", tekst: "Auditrapport gegenereerd en bevroren (inhoud_hash vastgelegd)." };
  if (sp.audit_fout) return { soort: "audit_fout", tekst: `Auditrapport mislukt: ${sp.audit_fout}` };
  if (sp.verify === "match") return { soort: "verify", tekst: "Integriteit bevestigd: herberekende hash komt overeen." };
  if (sp.verify === "mismatch") return { soort: "audit_fout", tekst: "LET OP: hash komt NIET overeen — rapport gewijzigd/beschadigd." };
  if (sp.verify === "fout") return { soort: "audit_fout", tekst: "Verificatie mislukt (rapport niet leesbaar)." };
  return null;
}

const DISCLAIMER =
  "Scores ondersteunen kwaliteitsborging en releasebesluitvorming, maar vormen geen juridische garantie en vervangen geen menselijke verantwoordelijkheid. De indicatoren meten toetsbare vormen van brongebondenheid, volledigheid en bestuurlijke bruikbaarheid; zij bewijzen niet dat elke feitelijke claim juist is. De eindverantwoordelijkheid voor besluitvorming blijft menselijk (human-in-the-loop).";

const METHODE_LABEL: Record<string, string> = {
  deterministisch: "Deterministisch (hard)",
  heuristisch: "Heuristisch (indicatief)",
  llm_judge: "LLM-as-judge (adviserend)",
  human: "Menselijke review",
};

const GATE_BADGE: Record<string, string> = {
  pass: "bg-ok-tint text-ok-ink",
  geblokkeerd: "bg-err-tint text-err-ink",
  review_vereist: "bg-warn-tint text-warn-ink",
};

const ERNST_KLEUR: Record<string, string> = {
  kritiek: "text-err-ink",
  hoog: "text-warn-ink",
  middel: "text-warn-ink",
  laag: "text-ink/60",
};

function ScoreRegel({ s }: { s: ScoreRij }) {
  const crit = criteriumByKey(s.criterium_code);
  const isBlokkade = HARDE_BLOKKADE_CHECKS.has(s.criterium_code);
  const passLabel =
    s.pass === null ? "— (open)" : s.pass ? "voldoet" : "voldoet niet";
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-3 font-mono text-xs">{s.criterium_code}</td>
      <td className="py-2 pr-3 text-xs">{METHODE_LABEL[s.methode] ?? s.methode}</td>
      <td className="py-2 pr-3 text-xs">
        {s.score != null ? s.score : "—"}
        <span className="ml-1 text-ink/50">({passLabel})</span>
      </td>
      <td className="py-2 pr-3 text-xs">
        {/* Geen groen vinkje zonder bewijs: toon altijd de motivatie. */}
        <div>{s.motivatie || <span className="text-err-ink">— geen motivatie (niet vertrouwen)</span>}</div>
        {s.bewijs != null && (
          <div className="mt-1 text-ink/60">
            Bewijs: <span className="font-mono">{JSON.stringify(s.bewijs).slice(0, 240)}</span>
          </div>
        )}
        {s.judge_model && <div className="mt-1 text-ink/50">Judge-model: {s.judge_model}</div>}
      </td>
      <td className="py-2 pr-3 text-xs text-ink/60">{crit?.limitation ?? "—"}</td>
      <td className="py-2 pr-3 text-xs">
        {isBlokkade ? <span className="text-err-ink">blokkadecriterium</span> : "nee"}
      </td>
      <td className="py-2 text-xs">ja</td>
    </tr>
  );
}

function Scorekaart({
  output,
  magReviewen,
  runId,
}: {
  output: OutputMetScores;
  magReviewen: boolean;
  runId: string;
}) {
  const eff = output;
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      {/* Kop: quality_score (gradueel) STRIKT gescheiden van gate_status (categorisch) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            Output — testcase {output.test_case_id ? output.test_case_id.slice(0, 8) : "ad-hoc"} · iteratie{" "}
            {output.iteratie}
          </h3>
          {output.foutmelding && <p className="text-xs text-err-ink">Fout: {output.foutmelding}</p>}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-xs uppercase text-ink/50">Kwaliteit (gradueel)</div>
            <div className="text-2xl font-bold">{output.quality_score ?? "—"}</div>
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-ink/50">Gate (categorisch)</div>
            <span
              className={`inline-block rounded px-2 py-1 text-sm font-medium ${
                GATE_BADGE[output.gate_status ?? ""] ?? "bg-app-bg"
              }`}
            >
              {output.gate_status ?? "—"}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink/50">
        Kwaliteit en blokkade zijn twee aparte assen: een hoge kwaliteitsscore heft een blokkade
        nooit op.
      </p>

      {/* Volledige herkomst */}
      <div className="mt-4 grid gap-2 rounded-lg bg-app-bg p-3 text-xs sm:grid-cols-2">
        <div>Model: <span className="font-mono">{eff.model_name ?? "—"}</span></div>
        <div>Prompt-versie: <span className="font-mono">{eff.prompt_version_id ?? "productiekern"}</span></div>
        <div>snapshot_hash: <span className="font-mono">{eff.snapshot_hash?.slice(0, 16) ?? "—"}…</span></div>
        <div>
          Effectief: temp={String(eff.temperature_effective)} · max_tokens={String(eff.max_tokens_effective)} ·
          top_p={String(eff.top_p_effective)} · provider_default={String(eff.provider_default_used)}
        </div>
        <div>
          Latency: {eff.latency_ms != null ? `${eff.latency_ms} ms` : "—"} · Tokens:{" "}
          {eff.tokengebruik ? `${eff.tokengebruik.in ?? 0}/${eff.tokengebruik.out ?? 0}` : "—"}
        </div>
        <div>Kosten (schatting): {eff.kosten_indicatie != null ? `± $${Number(eff.kosten_indicatie).toFixed(5)}` : "—"}</div>
        <div>Tijdstip: {eff.tijdstip ? new Date(eff.tijdstip).toLocaleString("nl-NL") : "—"}</div>
      </div>

      {/* Antwoord (indien persistent bewaard) */}
      {output.gegenereerd_antwoord && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink/70">Gegenereerd antwoord</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-app-bg p-3 text-xs">
            {output.gegenereerd_antwoord}
          </pre>
        </details>
      )}

      {/* Scores per criterium */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase text-ink/50">
              <th className="py-1 pr-3">Criterium</th>
              <th className="py-1 pr-3">Methode</th>
              <th className="py-1 pr-3">Score</th>
              <th className="py-1 pr-3">Motivatie + bewijs</th>
              <th className="py-1 pr-3">Meetbeperking</th>
              <th className="py-1 pr-3">Blokkade</th>
              <th className="py-1">Human review</th>
            </tr>
          </thead>
          <tbody>
            {output.scores.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-2 text-xs text-ink/50">
                  Geen scores (persist_mode of geen criteria).
                </td>
              </tr>
            ) : (
              output.scores.map((s) => <ScoreRegel key={s.id} s={s} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Findings */}
      {output.findings.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-ink/50">Bevindingen</div>
          <ul className="mt-1 space-y-1 text-xs">
            {output.findings.map((f) => (
              <li key={f.id}>
                <span className={`font-semibold ${ERNST_KLEUR[f.ernst] ?? ""}`}>[{f.ernst}]</span>{" "}
                <span className="text-ink/50">{f.type}</span> — {f.omschrijving}
                {f.fragment && <span className="text-ink/50"> ({f.fragment})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Human review — mogelijk indien de gebruiker de review-capability heeft */}
      {magReviewen && (
        <form action={humanReviewActie} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <input type="hidden" name="run_output_id" value={output.id} />
          <input type="hidden" name="run_id" value={runId} />
          <label className="text-xs">
            <span className="mb-1 block text-ink/60">Oordeel</span>
            <select name="oordeel" className="rounded-lg border border-line bg-white px-2 py-1 text-xs">
              <option value="bevestigd">bevestigd</option>
              <option value="overruled">overruled</option>
              <option value="geblokkeerd">geblokkeerd</option>
            </select>
          </label>
          <label className="flex-1 text-xs">
            <span className="mb-1 block text-ink/60">Motivatie (verplicht bij overrule/blokkade)</span>
            <input name="motivatie" type="text" className="w-full rounded-lg border border-line bg-white px-2 py-1 text-xs" />
          </label>
          <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            Review vastleggen
          </button>
        </form>
      )}
    </div>
  );
}

export default async function AqlabRunPagina({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { runId } = await params;
  const sp = await searchParams;
  let data;
  try {
    data = await leesAqlabRun(runId);
  } catch (e) {
    if (e instanceof PlatformError && e.status === 403) {
      return (
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-sm text-ink/70">
            Geen toegang. Vereist: <code className="font-mono text-xs">{CAP}</code>.
          </p>
        </div>
      );
    }
    throw e;
  }
  const { run, outputs, vergelijking, baselinePerformance, releaseContext, capabilities: caps } = data;
  const magReviewen = caps.includes(CAP_REVIEW);

  // Scherm 4: baseline-vs-challenger vergelijking (indien baseline gezet).
  const vergelijkingItems: VergelijkingItem[] = (vergelijking?.paren ?? []).map((p) => ({
    test_case_id: p.test_case_id,
    code: p.code,
    vraag: p.vraag,
    baseline_antwoord: p.baseline?.gegenereerd_antwoord ?? null,
    challenger_antwoord: p.challenger?.gegenereerd_antwoord ?? null,
    baseline_score: p.baseline?.quality_score ?? null,
    challenger_score: p.challenger?.quality_score ?? null,
    baseline_gate: p.baseline?.gate_status ?? null,
    challenger_gate: p.challenger?.gate_status ?? null,
  }));

  if (!run) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="text-sm text-ink/70">Run niet gevonden.</p>
        <Link href="/platform/aqlab" className="text-accent hover:underline">
          ← Terug naar het Lab
        </Link>
      </div>
    );
  }

  const perf = run.aggregatie?.performance;
  const regressie = run.aggregatie?.regressie ?? null;
  const consistencyMap = run.aggregatie?.consistency ?? {};
  // Baseline-performance meeladen voor de vergelijkende weergave (scherm 6).
  const baselinePerf = baselinePerformance;
  const releaseCtx = releaseContext;
  const magGovern = caps.includes(CAP_GOVERN);

  // Consistentie-overzicht per testcase (of ad-hoc): groepeer de outputs → iteraties.
  const iteratiesPer = new Map<string, IteratieView[]>();
  for (const o of outputs) {
    const key = o.test_case_id ?? "ad_hoc";
    const lijst = iteratiesPer.get(key) ?? iteratiesPer.set(key, []).get(key)!;
    lijst.push({
      iteratie: o.iteratie,
      antwoord: o.gegenereerd_antwoord,
      quality_score: o.quality_score,
      gate_status: o.gate_status,
      latency_ms: o.latency_ms,
      tokengebruik: o.tokengebruik,
      bronnen: bronLabels(o.gebruikte_bronnen),
    });
  }
  const consistentieGroepen = Object.entries(consistencyMap).map(([key, aggregaat]) => ({
    key,
    titel: key === "ad_hoc" ? "ad-hoc vraag" : `testcase ${key.slice(0, 8)}`,
    aggregaat,
    iteraties: (iteratiesPer.get(key) ?? []).sort((a, b) => a.iteratie - b.iteratie),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/aqlab" className="text-sm text-accent hover:underline">
          ← Terug naar het Lab
        </Link>
        <h1 className="mt-1 font-serif text-2xl font-bold">{run.naam ?? "Run-overzicht"}</h1>
        {run.naam && <p className="text-xs text-ink/50">Run-uitkomst · {run.id.slice(0, 8)}</p>}
      </div>

      {/* Scherm 6 — run header + performance */}
      <section className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs uppercase text-ink/50">Type</div>
            <div className="font-medium">{run.run_type}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-ink/50">Status</div>
            <span className={`inline-block rounded px-2 py-0.5 text-sm ${GATE_BADGE[run.status] ?? "bg-app-bg"}`}>
              {run.status}
            </span>
          </div>
          <div>
            <div className="text-xs uppercase text-ink/50">persist_mode</div>
            <div className="font-mono text-xs">{run.persist_mode}</div>
          </div>
          {(run.status === "queued" || run.status === "running") && (
            <form action={annuleerRunActie} className="ml-auto">
              <input type="hidden" name="run_id" value={run.id} />
              <button className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-app-bg">
                Run annuleren
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-app-bg p-3">
            <div className="text-xs uppercase text-ink/50">Latency</div>
            <div>gem: {perf?.latency_gemiddeld != null ? `${perf.latency_gemiddeld} ms` : "—"}</div>
            <div>mediaan: {perf?.latency_mediaan != null ? `${perf.latency_mediaan} ms` : "—"}</div>
            <div>P95: {perf?.latency_p95 != null ? `${perf.latency_p95} ms` : "—"}</div>
          </div>
          <div className="rounded-lg bg-app-bg p-3">
            <div className="text-xs uppercase text-ink/50">Tokens / kosten</div>
            <div>in/out: {perf ? `${perf.tokens_in ?? 0}/${perf.tokens_out ?? 0}` : "—"}</div>
            <div>kosten (schatting): {run.totale_kosten != null ? `± $${Number(run.totale_kosten).toFixed(4)}` : "—"}</div>
          </div>
          <div className="rounded-lg bg-app-bg p-3">
            <div className="text-xs uppercase text-ink/50">Uitkomsten</div>
            <div>outputs: {perf?.outputs ?? outputs.length}</div>
            <div className="text-err-ink">geblokkeerd: {perf?.aantal_geblokkeerd ?? "—"}</div>
            <div className="text-warn-ink">review vereist: {perf?.aantal_review_vereist ?? "—"}</div>
          </div>
        </div>
        {perf?.langzaamste_test_case_id && (
          <p className="mt-2 text-xs text-ink/60">
            Langzaamste testcase: <span className="font-mono">{perf.langzaamste_test_case_id.slice(0, 8)}</span>
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink/60">
          {run.baseline_run_id && (
            <span>
              baseline: <Link href={`/platform/aqlab/runs/${run.baseline_run_id}`} className="font-mono text-accent hover:underline">{run.baseline_run_id.slice(0, 8)}</Link>
              {run.rol ? ` · rol ${run.rol}` : ""}
            </span>
          )}
          {run.gewijzigde_as && <span>gewijzigde as: {run.gewijzigde_as}</span>}
          {run.promoted_to_testcase && run.promoted_testcase_id && (
            <span className="text-ok-ink">gepromoveerd → testcase {run.promoted_testcase_id.slice(0, 8)}</span>
          )}
        </div>
      </section>

      {/* Scherm 6 — performance vergelijkend (baseline naast challenger) */}
      {baselinePerf && (
        <PerformanceVergelijkingBlok
          baseline={{ naam: baselinePerf.naam, performance: baselinePerf.performance, totale_kosten: baselinePerf.totale_kosten }}
          challenger={{ naam: run.naam ?? null, performance: perf, totale_kosten: run.totale_kosten ?? null }}
        />
      )}

      {/* Scherm 6 — regressierapport (challenger vs baseline) */}
      {regressie && <RegressieBlok regressie={regressie} />}

      {/* Scherm 8 — vrijgavebesluit + auditrapport (AQL-4). */}
      <ReleaseBlok runId={run.id} ctx={releaseCtx} magGovern={magGovern} melding={releaseMelding(sp)} />

      {/* Scherm 4 — outputvergelijking baseline vs challenger */}
      {vergelijkingItems.length > 0 && <VergelijkingBlok items={vergelijkingItems} />}

      {/* Scherm 6b — consistentie-overzicht + Iteraties-tab */}
      {consistentieGroepen.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Consistentie (ADR 0056)</h2>
          {consistentieGroepen.map((g) => (
            <ConsistentieBlok key={g.key} titel={g.titel} aggregaat={g.aggregaat} iteraties={g.iteraties} />
          ))}
        </section>
      )}

      {/* Verplichte disclaimer (§4.4) */}
      <p className="rounded-lg border border-line bg-app-bg p-3 text-xs text-ink/70">{DISCLAIMER}</p>

      {/* Scherm 5 — scorekaart per output */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Scorekaarten per output ({outputs.length})
        </h2>
        {outputs.length === 0 ? (
          <p className="text-sm text-ink/70">
            Nog geen outputs (run in de wachtrij, of persist_mode = none).
          </p>
        ) : (
          outputs.map((o) => <Scorekaart key={o.id} output={o} magReviewen={magReviewen} runId={run.id} />)
        )}
      </section>
    </div>
  );
}
