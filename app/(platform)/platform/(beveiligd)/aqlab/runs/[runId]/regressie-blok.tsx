// ============================================================================
//  Scherm 6 — Regressierapport (AQL-3). Challenger-vs-baseline: releaseadvies +
//  per-testcase delta's. Advies is een VOORSTEL (besluit = AQL-4); indicatief bij
//  subset/ad-hoc. Server-rendered (geen client-state).
// ============================================================================

import type { RegressieResultaat } from "@/platform/lib/aqlab/regression-core";

const ADVIES_BADGE: Record<string, string> = {
  accepteren: "bg-ok-tint text-ok-ink",
  aanpassen: "bg-warn-tint text-warn-ink",
  blokkeren: "bg-err-tint text-err-ink",
  review_required: "bg-app-bg text-ink/70",
};
const STATUS_KLEUR: Record<string, string> = {
  verbeterd: "text-ok-ink",
  gelijk: "text-ink/60",
  regressie: "text-warn-ink",
  nieuwe_blokkade: "text-err-ink",
};

export default function RegressieBlok({ regressie }: { regressie: RegressieResultaat }) {
  const r = regressie;
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Regressierapport (challenger vs baseline)</h2>
        <div className="flex items-center gap-2">
          {r.indicatief && <span className="rounded bg-app-bg px-2 py-1 text-xs text-ink/60">indicatief</span>}
          {r.release_advies && (
            <span className={`rounded px-2 py-1 text-sm font-medium ${ADVIES_BADGE[r.release_advies] ?? "bg-app-bg"}`}>
              advies: {r.release_advies}
            </span>
          )}
        </div>
      </div>

      {!r.geldig ? (
        <p className="mt-2 text-sm text-warn-ink">Regressie niet geldig berekenbaar: {r.reden}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-lg bg-app-bg p-2 text-xs"><span className="text-ink/50">verbeteringen</span><div className="text-ok-ink">{r.tellingen.verbeteringen}</div></div>
            <div className="rounded-lg bg-app-bg p-2 text-xs"><span className="text-ink/50">regressies</span><div className="text-warn-ink">{r.tellingen.regressies}</div></div>
            <div className="rounded-lg bg-app-bg p-2 text-xs"><span className="text-ink/50">nieuwe blokkades</span><div className="text-err-ink">{r.tellingen.nieuwe_blokkades}</div></div>
            <div className="rounded-lg bg-app-bg p-2 text-xs"><span className="text-ink/50">open reviews</span><div>{r.tellingen.openstaande_reviews}</div></div>
          </div>

          {r.advies_redenen.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-ink/70">
              {r.advies_redenen.map((m, i) => (
                <li key={i}>• {m}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-ink/50">
                  <th className="py-1 pr-3">Testcase</th>
                  <th className="py-1 pr-3">Baseline</th>
                  <th className="py-1 pr-3">Challenger</th>
                  <th className="py-1 pr-3">Delta</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Consistentie</th>
                  <th className="py-1">Review</th>
                </tr>
              </thead>
              <tbody>
                {r.per_testcase.map((t) => (
                  <tr key={t.test_case_id} className="border-t border-line">
                    <td className="py-1 pr-3 font-mono text-xs">{t.code ?? t.test_case_id.slice(0, 8)}</td>
                    <td className="py-1 pr-3 text-xs">{t.baseline_score ?? "—"}</td>
                    <td className="py-1 pr-3 text-xs">{t.challenger_score ?? "—"}</td>
                    <td className={`py-1 pr-3 text-xs ${t.delta != null && t.delta < 0 ? "text-warn-ink" : t.delta != null && t.delta > 0 ? "text-ok-ink" : ""}`}>
                      {t.delta != null ? (t.delta > 0 ? `+${t.delta}` : t.delta) : "—"}
                    </td>
                    <td className={`py-1 pr-3 text-xs ${STATUS_KLEUR[t.status] ?? ""}`}>{t.status}</td>
                    <td className="py-1 pr-3 text-xs">{t.consistency_status ?? "—"}</td>
                    <td className="py-1 text-xs">{t.review_verplicht ? "ja" : "nee"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink/50">
            Advies is een voorstel voor de Governance Owner — het formele vrijgavebesluit wordt in AQL-4 vastgelegd
            (human-in-the-loop). Bij een openstaande kritieke blokkade of niet-gehaalde security/safety-case is
            &apos;accepteren&apos; uitgesloten.
          </p>
        </>
      )}
    </section>
  );
}
