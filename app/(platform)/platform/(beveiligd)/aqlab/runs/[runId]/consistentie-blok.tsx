"use client";

// ============================================================================
//  Scherm 6b — Consistentie-overzicht + Iteraties-tab (AQL-3, ADR 0056).
//  Toont stabiliteits- én correctheidsmaten + beide bronmetrics; de Iteraties-tab
//  toont per iteratie de output met een tekst-diff t.o.v. iteratie 1 en markeert
//  verboden variatie (rood) apart van toegestane variatie. Pure SVG/HTML, geen lib.
// ============================================================================

import { useState } from "react";
import type { ConsistentieAggregaat } from "@/lib/aqlab/consistency";
import { woordDiff, heeftVerschil } from "@/lib/aqlab/diff";

export interface IteratieView {
  iteratie: number;
  antwoord: string | null;
  quality_score: number | null;
  gate_status: string | null;
  latency_ms: number | null;
  tokengebruik: { in?: number; out?: number } | null;
  bronnen: string[];
}

const STATUS_BADGE: Record<string, string> = {
  consistent: "bg-ok-tint text-ok-ink",
  light_variation: "bg-warn-tint text-warn-ink",
  review_required: "bg-warn-tint text-warn-ink",
  unstable: "bg-err-tint text-err-ink",
  consistent_but_incorrect: "bg-err-tint text-err-ink",
};
const STATUS_LABEL: Record<string, string> = {
  consistent: "Consistent",
  light_variation: "Lichte variatie",
  review_required: "Review vereist",
  unstable: "Instabiel",
  consistent_but_incorrect: "Consistent maar incorrect",
};

function JaNee({ ok }: { ok: boolean }) {
  return <span className={ok ? "text-ok-ink" : "text-err-ink"}>{ok ? "stabiel" : "wisselt"}</span>;
}
function Pct({ v }: { v: number }) {
  return <span>{Math.round(v * 100)}%</span>;
}

function DiffWeergave({ oud, nieuw }: { oud: string; nieuw: string }) {
  const segs = woordDiff(oud, nieuw);
  if (!heeftVerschil(segs)) return <p className="text-xs text-ink/50">Geen inhoudelijk verschil met iteratie 1 (alleen formulering/witruimte).</p>;
  return (
    <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-app-bg p-2 text-xs leading-relaxed">
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

export default function ConsistentieBlok({
  titel,
  aggregaat,
  iteraties,
}: {
  titel: string;
  aggregaat: ConsistentieAggregaat;
  iteraties: IteratieView[];
}) {
  const [tab, setTab] = useState<"overzicht" | "iteraties">("overzicht");
  const a = aggregaat;
  const eerste = iteraties.find((it) => it.iteratie === Math.min(...iteraties.map((x) => x.iteratie)));

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Consistentie — {titel}</h3>
          <p className="text-xs text-ink/50">
            {a.passed}/{a.total} iteraties gepasseerd · consistency_score {a.consistency_score}
            {a.consistency_required ? " · vereist" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded px-2 py-1 text-sm font-medium ${STATUS_BADGE[a.consistency_status] ?? "bg-app-bg"}`}>
            {STATUS_LABEL[a.consistency_status] ?? a.consistency_status}
          </span>
          <span className={`rounded px-2 py-1 text-xs ${a.release_eligible ? "bg-ok-tint text-ok-ink" : "bg-app-bg text-ink/60"}`}>
            {a.release_eligible ? "release-eligible" : "niet zelfstandig release-eligible"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex gap-1 border-b border-line text-sm">
        {(["overzicht", "iteraties"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 ${tab === t ? "border-b-2 border-accent font-medium text-accent" : "text-ink/60"}`}
          >
            {t === "overzicht" ? "Overzicht" : `Iteraties (${iteraties.length})`}
          </button>
        ))}
      </div>

      {tab === "overzicht" ? (
        <div className="mt-3 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-app-bg p-3 text-xs">
              <div className="mb-1 font-semibold uppercase text-ink/50">Stabiliteit (deterministisch)</div>
              <div>Gate: <JaNee ok={a.gate_stability} /></div>
              <div>Feiten: <JaNee ok={a.fact_stability} /></div>
              <div>
                Bronkeuze: <JaNee ok={a.source_stability} />
                {!a.source_stability_exact && <span className="text-ink/40"> (o.b.v. bron-check; exacte set niet bewaard)</span>}
              </div>
              <div>Format: <JaNee ok={a.format_stability} /></div>
              <div>Score-spreiding: {a.score_spread} (min {a.score_min ?? "—"} / max {a.score_max ?? "—"})</div>
              <div className="text-ink/50">Retrieval (diagnostisch): <JaNee ok={a.retrieval_stability} /></div>
            </div>
            <div className="rounded-lg bg-app-bg p-3 text-xs">
              <div className="mb-1 font-semibold uppercase text-ink/50">Correctheid (ADR 0056)</div>
              <div>Gate-pass-rate: <Pct v={a.gate_pass_rate} /></div>
              <div>Feit-correctheid: <Pct v={a.fact_correctness_rate} /></div>
              <div>Bron-correctheid: <Pct v={a.source_correctness_rate} /></div>
              <div>Format-pass-rate: <Pct v={a.format_pass_rate} /></div>
              {!a.correctheid_gemeten && <div className="mt-1 text-err-ink">Correctheid niet machinaal getoetst — menselijke review vereist.</div>}
              {!a.volledig_gedraaid && <div className="mt-1 text-warn-ink">Onvolledige run ({a.passed}/{a.consistency_iterations} gepland).</div>}
            </div>
          </div>

          {a.consistency_findings.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-ink/50">Bevindingen</div>
              <ul className="mt-1 space-y-1 text-xs">
                {a.consistency_findings.map((f, i) => (
                  <li key={i} className={f.soort === "toegestane_variatie" ? "text-ink/60" : "text-err-ink"}>
                    <span className="font-semibold">[{f.dimensie}]</span> {f.omschrijving}
                    {f.iteraties && f.iteraties.length > 0 && <span className="text-ink/50"> (iteraties {f.iteraties.join(", ")})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-ink/50">
            Gemeten: deterministisch = {a.meetlabels.deterministisch.join(", ")}. Judge (adviserend) ={" "}
            {a.meetlabels.judge.join(", ")}. Mens = {a.meetlabels.mens.join(", ")}. Consistent-fout gedrag scoort
            nooit als vrijgeefbaar (geen schijnzekerheid).
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {/* Verboden variatie expliciet bovenaan. */}
          {a.consistency_findings.some((f) => f.soort !== "toegestane_variatie") && (
            <div className="rounded-lg border border-err-tint bg-err-tint/30 p-2 text-xs text-err-ink">
              Verboden variatie gedetecteerd — zie de rood/doorgestreepte segmenten in de diff hieronder.
            </div>
          )}
          {iteraties.map((it) => (
            <div key={it.iteratie} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-semibold">Iteratie {it.iteratie}</span>
                <span>score {it.quality_score ?? "—"}</span>
                <span>gate {it.gate_status ?? "—"}</span>
                <span>latency {it.latency_ms ?? "—"} ms</span>
                <span>tokens {it.tokengebruik ? `${it.tokengebruik.in ?? 0}/${it.tokengebruik.out ?? 0}` : "—"}</span>
                {it.bronnen.length > 0 && <span>bronnen: {it.bronnen.join(", ")}</span>}
              </div>
              {it.antwoord == null ? (
                <p className="mt-1 text-xs text-ink/50">Antwoordtekst niet bewaard (persist_mode).</p>
              ) : it.iteratie === eerste?.iteratie ? (
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-app-bg p-2 text-xs">{it.antwoord}</pre>
              ) : eerste?.antwoord ? (
                <DiffWeergave oud={eerste.antwoord} nieuw={it.antwoord} />
              ) : (
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-app-bg p-2 text-xs">{it.antwoord}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
