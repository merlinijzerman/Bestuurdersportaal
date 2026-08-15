"use client";
// ============================================================================
//  LicentiesClient — formulier voor public.fonds_licentie (besluit 0178 · OP-2)
// ----------------------------------------------------------------------------
//  Kies een fonds, vul bundel/tarieven/contract-ingangsdatum in, sla op via de
//  server-action `licentieOpslaan` (withPlatform, geaudit). Prefilt de velden
//  met de bestaande licentie zodat wijzigen = het formulier openen en aanpassen.
// ============================================================================

import { useMemo, useState } from "react";
import { licentieOpslaan, type OpslaanResultaat } from "../acties";

export type LicentieRij = {
  fonds_id: string;
  bundel_eur_jaar: number;
  tarief_in_eur_mln: number;
  tarief_uit_eur_mln: number;
  contract_start: string;
  geldig_vanaf: string;
  versie: number;
  bijgewerkt: string | null;
  bijgewerkt_door: string | null;
};

type Veld = { key: string; label: string; type: "number" | "date"; stap?: string; hint?: string };
const VELDEN: Veld[] = [
  { key: "bundel_eur_jaar", label: "Jaarbundel (€/jaar)", type: "number", stap: "1", hint: "Vóór pro rata; wordt vanaf de ingangsdatum verrekend." },
  { key: "tarief_in_eur_mln", label: "Input-tarief (€/mln tokens)", type: "number", stap: "0.01" },
  { key: "tarief_uit_eur_mln", label: "Output-tarief (€/mln tokens)", type: "number", stap: "0.01" },
  { key: "contract_start", label: "Contract-ingangsdatum", type: "date", hint: "Bron voor de pro-rata bundel en de prognose." },
  { key: "geldig_vanaf", label: "Tarief geldig vanaf", type: "date", hint: "Leeg = 1 januari van het contractjaar." },
];

export default function LicentiesClient({
  fondsen,
  licenties,
}: {
  fondsen: { id: string; naam: string }[];
  licenties: LicentieRij[];
}) {
  const licentiePerFonds = useMemo(() => {
    const m = new Map<string, LicentieRij>();
    for (const l of licenties) m.set(l.fonds_id, l);
    return m;
  }, [licenties]);

  const [fondsId, setFondsId] = useState<string>(fondsen[0]?.id ?? "");
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<OpslaanResultaat | null>(null);
  // Formulier remonteert bij fondswissel (key), zodat defaultValue's verversen.
  const huidige = licentiePerFonds.get(fondsId) ?? null;

  async function opslaan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fondsId || bezig) return;
    setBezig(true);
    setMelding(null);
    const fd = new FormData(e.currentTarget);
    const resultaat = await licentieOpslaan(fondsId, fd);
    setMelding(resultaat);
    setBezig(false);
  }

  const veldfouten = melding && !melding.ok ? melding.veldfouten ?? {} : {};

  const standaard = (v: Veld): string => {
    if (!huidige) return "";
    const raw = huidige[v.key as keyof LicentieRij];
    if (raw === null || raw === undefined) return "";
    return String(raw);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-xl border border-line bg-white p-5">
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-ink/60">Fonds</label>
          <select
            className="w-full rounded-lg border border-app-line-control bg-white px-3 py-2 text-sm"
            value={fondsId}
            onChange={(e) => {
              setFondsId(e.target.value);
              setMelding(null);
            }}
          >
            {fondsen.length === 0 && <option value="">Geen fondsen</option>}
            {fondsen.map((f) => (
              <option key={f.id} value={f.id}>
                {f.naam}
                {licentiePerFonds.has(f.id) ? "" : " — nog geen licentie"}
              </option>
            ))}
          </select>
        </div>

        <form key={fondsId} onSubmit={opslaan} className="space-y-4">
          {VELDEN.map((v) => (
            <div key={v.key}>
              <label className="mb-1 block text-xs font-medium text-ink/60" htmlFor={v.key}>
                {v.label}
              </label>
              <input
                id={v.key}
                name={v.key}
                type={v.type}
                step={v.stap}
                min={v.type === "number" ? "0" : undefined}
                defaultValue={standaard(v)}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm ${
                  veldfouten[v.key] ? "border-err" : "border-app-line-control"
                }`}
              />
              {veldfouten[v.key] ? (
                <p className="mt-1 text-xs text-err-ink">{veldfouten[v.key]}</p>
              ) : v.hint ? (
                <p className="mt-1 text-xs text-ink/50">{v.hint}</p>
              ) : null}
            </div>
          ))}

          {melding && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                melding.ok
                  ? "border-ok/40 bg-ok/10 text-ok-ink"
                  : "border-warn/40 bg-warn/10 text-warn-ink"
              }`}
            >
              {melding.ok ? melding.bericht : melding.melding}
            </div>
          )}

          <button
            type="submit"
            disabled={bezig || !fondsId}
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {bezig ? "Opslaan…" : huidige ? "Licentie bijwerken" : "Licentie aanmaken"}
          </button>
        </form>
      </section>

      <aside className="space-y-3">
        <div className="rounded-xl border border-line bg-white p-4 text-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">Huidige licentie</h2>
          {huidige ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-ink/60">Bundel</dt>
              <dd className="text-right tabular-nums">€ {huidige.bundel_eur_jaar.toLocaleString("nl-NL")}/jaar</dd>
              <dt className="text-ink/60">Input</dt>
              <dd className="text-right tabular-nums">€ {huidige.tarief_in_eur_mln}/mln</dd>
              <dt className="text-ink/60">Output</dt>
              <dd className="text-right tabular-nums">€ {huidige.tarief_uit_eur_mln}/mln</dd>
              <dt className="text-ink/60">Contract sinds</dt>
              <dd className="text-right tabular-nums">{huidige.contract_start}</dd>
              <dt className="text-ink/60">Geldig vanaf</dt>
              <dd className="text-right tabular-nums">{huidige.geldig_vanaf}</dd>
              <dt className="text-ink/60">Versie</dt>
              <dd className="text-right tabular-nums">{huidige.versie}</dd>
            </dl>
          ) : (
            <p className="text-ink/60">Dit fonds heeft nog geen licentie. Vul de velden in en sla op.</p>
          )}
          {huidige?.bijgewerkt_door && (
            <p className="mt-3 border-t border-line pt-2 text-[11.5px] text-ink/50">
              Laatst bijgewerkt door {huidige.bijgewerkt_door}
              {huidige.bijgewerkt ? ` op ${new Date(huidige.bijgewerkt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}` : ""}.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-line bg-app-bg px-4 py-3 text-[11.5px] text-ink/60">
          Tarieven excl. btw. Wijzigingen gelden vanaf <em>geldig vanaf</em>; historie
          vóór die datum wordt niet herberekend. Elke wijziging is geaudit
          (<code className="font-mono">platform.config.manage</code>).
        </div>
      </aside>
    </div>
  );
}
