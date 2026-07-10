"use client";

// ============================================================================
//  Scherm 4 — Outputvergelijking baseline vs challenger (AQL-3). Volledige
//  outputs naast elkaar + tekst-diff (toevoegingen/verwijderingen gemarkeerd).
//  Pure SVG/HTML, geen chart-lib. Alleen platform-console (nooit de assurance-view).
// ============================================================================

import { woordDiff, heeftVerschil } from "@/lib/aqlab/diff";

export interface VergelijkingItem {
  test_case_id: string | null;
  code: string | null;
  vraag: string | null;
  baseline_antwoord: string | null;
  challenger_antwoord: string | null;
  baseline_score: number | null;
  challenger_score: number | null;
  baseline_gate: string | null;
  challenger_gate: string | null;
}

function Diff({ oud, nieuw }: { oud: string; nieuw: string }) {
  const segs = woordDiff(oud, nieuw);
  if (!heeftVerschil(segs)) return <p className="text-xs text-ink/50">Geen inhoudelijk verschil.</p>;
  return (
    <pre className="whitespace-pre-wrap rounded-lg bg-app-bg p-2 text-xs leading-relaxed">
      {segs.map((s, i) =>
        s.type === "gelijk" ? (
          <span key={i}>{s.tekst}</span>
        ) : s.type === "toegevoegd" ? (
          <span key={i} className="rounded bg-ok-tint text-ok-ink">{s.tekst}</span>
        ) : (
          <span key={i} className="rounded bg-err-tint text-err-ink line-through">{s.tekst}</span>
        )
      )}
    </pre>
  );
}

export default function VergelijkingBlok({ items }: { items: VergelijkingItem[] }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Outputvergelijking (baseline vs challenger)</h2>
      <div className="mt-3 space-y-5">
        {items.map((it) => (
          <div key={it.test_case_id ?? "ad_hoc"} className="rounded-lg border border-line p-3">
            <div className="text-sm font-semibold">{it.code ?? it.test_case_id?.slice(0, 8) ?? "ad-hoc"}</div>
            {it.vraag && <p className="text-xs text-ink/60">{it.vraag}</p>}
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase text-ink/50">Baseline (score {it.baseline_score ?? "—"} · gate {it.baseline_gate ?? "—"})</div>
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-app-bg p-2 text-xs">{it.baseline_antwoord ?? "— geen tekst (persist_mode) —"}</pre>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-ink/50">Challenger (score {it.challenger_score ?? "—"} · gate {it.challenger_gate ?? "—"})</div>
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-app-bg p-2 text-xs">{it.challenger_antwoord ?? "— geen tekst (persist_mode) —"}</pre>
              </div>
            </div>
            {it.baseline_antwoord && it.challenger_antwoord && (
              <div className="mt-2">
                <div className="text-xs font-semibold uppercase text-ink/50">Verschil (challenger t.o.v. baseline)</div>
                <Diff oud={it.baseline_antwoord} nieuw={it.challenger_antwoord} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
