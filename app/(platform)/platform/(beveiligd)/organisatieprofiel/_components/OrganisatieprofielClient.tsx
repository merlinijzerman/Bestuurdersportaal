"use client";

// ============================================================================
//  OrganisatieprofielClient (OP-5) — fonds-selector, formulier, tekentellers,
//  live preview van het exacte promptblok (§7).
// ----------------------------------------------------------------------------
//  Schrijven loopt via de server-action organisatieprofielOpslaan (achter
//  withPlatform). De live preview gebruikt bouwOrganisatieprofielBlok uit
//  @/lib/organisatieprofiel (pure functie, type-only imports → client-safe),
//  zodat de beheerder exact ziet wat de AI meekrijgt.
// ============================================================================

import { useMemo, useState } from "react";
import {
  bouwOrganisatieprofielBlok,
  type Organisatieprofiel,
} from "@/lib/organisatieprofiel";
import { organisatieprofielOpslaan, type OpslaanResultaat } from "../acties";

const MAX_STRATEGISCH = 600;

// De acht tekstvelden in DB/form-volgorde (snake_case = form-name = DB-kolom).
const FEIT_VELDEN = [
  { key: "organisatietype", label: "Organisatietype" },
  { key: "uitvoerende_partijen", label: "Uitvoerende partijen" },
  { key: "omvang", label: "Omvang" },
  { key: "kernfeiten", label: "Kernfeiten" },
] as const;

const STRATEGISCHE_VELDEN = [
  { key: "missie", label: "Missie" },
  { key: "visie", label: "Visie" },
  { key: "strategische_speerpunten", label: "Strategische speerpunten" },
  { key: "risicohouding", label: "Risicohouding" },
] as const;

const ALLE_TEKSTVELDEN = [...FEIT_VELDEN, ...STRATEGISCHE_VELDEN];

type VeldKey = (typeof ALLE_TEKSTVELDEN)[number]["key"];

type Formstate = Record<VeldKey, string> & { peildatum: string };

const LEEG: Formstate = {
  organisatietype: "",
  uitvoerende_partijen: "",
  omvang: "",
  kernfeiten: "",
  missie: "",
  visie: "",
  strategische_speerpunten: "",
  risicohouding: "",
  peildatum: "",
};

function tekstOfNull(v: string): string | null {
  const s = v.trim();
  return s.length > 0 ? s : null;
}

// Map de snake_case-formstate naar de camelCase Organisatieprofiel die de helper
// verwacht (lege waarde → null, gelijk aan de server-normalisatie).
function naarOrganisatieprofiel(f: Formstate): Organisatieprofiel {
  return {
    organisatietype: tekstOfNull(f.organisatietype),
    uitvoerendePartijen: tekstOfNull(f.uitvoerende_partijen),
    omvang: tekstOfNull(f.omvang),
    kernfeiten: tekstOfNull(f.kernfeiten),
    missie: tekstOfNull(f.missie),
    visie: tekstOfNull(f.visie),
    strategischeSpeerpunten: tekstOfNull(f.strategische_speerpunten),
    risicohouding: tekstOfNull(f.risicohouding),
    peildatum: tekstOfNull(f.peildatum),
  };
}

// Vult de formstate uit een gelezen profielrij (of leeg als er geen rij is).
function uitProfielrij(rij: Record<string, unknown> | undefined): Formstate {
  if (!rij) return { ...LEEG };
  const lees = (k: string) => (typeof rij[k] === "string" ? (rij[k] as string) : "");
  return {
    organisatietype: lees("organisatietype"),
    uitvoerende_partijen: lees("uitvoerende_partijen"),
    omvang: lees("omvang"),
    kernfeiten: lees("kernfeiten"),
    missie: lees("missie"),
    visie: lees("visie"),
    strategische_speerpunten: lees("strategische_speerpunten"),
    risicohouding: lees("risicohouding"),
    peildatum: lees("peildatum"),
  };
}

export default function OrganisatieprofielClient({
  fondsen,
  profielen,
}: {
  fondsen: { id: string; naam: string }[];
  profielen: Record<string, unknown>[];
}) {
  const profielPerFonds = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const p of profielen) {
      const id = typeof p.fonds_id === "string" ? p.fonds_id : null;
      if (id) map.set(id, p);
    }
    return map;
  }, [profielen]);

  const [fondsId, setFondsId] = useState("");
  const [form, setForm] = useState<Formstate>({ ...LEEG });
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<OpslaanResultaat | null>(null);

  const huidigeProfielrij = fondsId ? profielPerFonds.get(fondsId) : undefined;

  function kiesFonds(id: string) {
    setFondsId(id);
    setMelding(null);
    setForm(uitProfielrij(id ? profielPerFonds.get(id) : undefined));
  }

  function wijzig(key: keyof Formstate, waarde: string) {
    setForm((prev) => ({ ...prev, [key]: waarde }));
    setMelding(null);
  }

  const teLang = STRATEGISCHE_VELDEN.some((v) => form[v.key].trim().length > MAX_STRATEGISCH);

  // Live preview: exact het promptblok dat de AI meekrijgt (§7).
  const preview = useMemo(
    () => bouwOrganisatieprofielBlok(naarOrganisatieprofiel(form)),
    [form]
  );

  const veldfouten = melding && !melding.ok ? melding.veldfouten ?? {} : {};

  async function opslaan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fondsId || teLang || bezig) return;
    setBezig(true);
    setMelding(null);
    const fd = new FormData(e.currentTarget);
    const resultaat = await organisatieprofielOpslaan(fondsId, fd);
    setMelding(resultaat);
    setBezig(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={opslaan} className="space-y-5">
        {/* Fonds-selector */}
        <div>
          <label className="block text-sm font-medium text-ink">Organisatie</label>
          <select
            value={fondsId}
            onChange={(e) => kiesFonds(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">— Kies een organisatie —</option>
            {fondsen.map((f) => (
              <option key={f.id} value={f.id}>
                {f.naam}
                {profielPerFonds.has(f.id) ? " ✓" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink/60">
            ✓ = er is al een profiel opgeslagen voor deze organisatie.
          </p>
        </div>

        {fondsId && (
          <>
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                Feiten
              </legend>
              {FEIT_VELDEN.map((v) => (
                <div key={v.key}>
                  <label className="block text-sm font-medium text-ink">{v.label}</label>
                  <input
                    type="text"
                    name={v.key}
                    value={form[v.key]}
                    onChange={(e) => wijzig(v.key, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                Strategie &amp; risicohouding (max. {MAX_STRATEGISCH} tekens per veld)
              </legend>
              {STRATEGISCHE_VELDEN.map((v) => {
                const lengte = form[v.key].trim().length;
                const over = lengte > MAX_STRATEGISCH;
                return (
                  <div key={v.key}>
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-ink">{v.label}</label>
                      <span className={`text-xs ${over ? "font-semibold text-warn-ink" : "text-ink/50"}`}>
                        {lengte}/{MAX_STRATEGISCH}
                      </span>
                    </div>
                    <textarea
                      name={v.key}
                      value={form[v.key]}
                      onChange={(e) => wijzig(v.key, e.target.value)}
                      rows={3}
                      className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm ${
                        over ? "border-warn" : "border-line"
                      }`}
                    />
                    {(over || veldfouten[v.key]) && (
                      <p className="mt-1 text-xs font-medium text-warn-ink">
                        {veldfouten[v.key] ?? `Maximaal ${MAX_STRATEGISCH} tekens (nu ${lengte}).`}
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>

            <div>
              <label className="block text-sm font-medium text-ink">Peildatum (optioneel)</label>
              <input
                type="date"
                name="peildatum"
                value={form.peildatum}
                onChange={(e) => wijzig("peildatum", e.target.value)}
                className="mt-1 rounded-lg border border-line bg-white px-3 py-2 text-sm"
              />
            </div>

            {huidigeProfielrij?.bijgewerkt_door && (
              <p className="text-xs text-ink/60">
                Laatst bijgewerkt door {String(huidigeProfielrij.bijgewerkt_door)}
                {huidigeProfielrij.bijgewerkt_op
                  ? ` op ${new Date(String(huidigeProfielrij.bijgewerkt_op)).toLocaleString("nl-NL")}`
                  : ""}
                .
              </p>
            )}

            {melding && (
              <div
                className={`rounded-lg px-4 py-3 text-sm ${
                  melding.ok
                    ? "border border-ok/40 bg-ok/10 text-ink"
                    : "border border-warn/40 bg-warn/10 text-ink"
                }`}
              >
                {melding.ok ? melding.bericht : melding.melding}
              </div>
            )}

            <button
              type="submit"
              disabled={bezig || teLang}
              className="rounded-lg bg-nav-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {bezig ? "Bezig met opslaan…" : "Organisatieprofiel opslaan"}
            </button>
          </>
        )}
      </form>

      {/* Live preview van het exacte promptblok (§7). */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Preview — wat de AI meekrijgt
        </h2>
        {preview ? (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-phase/30 bg-phase-tint/40 p-4 text-xs text-phase-ink">
            {preview.tekst}
          </pre>
        ) : (
          <p className="rounded-lg border border-line bg-app-bg p-4 text-sm text-ink/70">
            Geen profiel — de AI valt terug op algemene kennis.
          </p>
        )}
      </div>
    </div>
  );
}
