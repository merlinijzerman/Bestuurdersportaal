"use client";

// ============================================================================
//  OrganisatieprofielTab — tenant-zelfservice op het generieke organisatie-
//  profiel (FO Organisatieprofiel v0.4; besluit 0038 herzien).
// ----------------------------------------------------------------------------
//  Bewerken is voorbehouden aan de beheerder (server-side afgedwongen in
//  /api/organisatieprofiel via organisation.profile.manage). Andere rollen
//  krijgen een read-only weergave. De live preview gebruikt de pure client-safe
//  helper bouwOrganisatieprofielBlok zodat de beheerder exact ziet wat de AI
//  meekrijgt (§7).
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  bouwOrganisatieprofielBlok,
  type Organisatieprofiel,
} from "@/core/lib/organisatieprofiel";

const MAX_STRATEGISCH = 600;

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

// snake_case-formstate → camelCase Organisatieprofiel (voor de preview-helper).
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

function uitProfielrij(rij: Record<string, unknown> | null): Formstate {
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

export default function OrganisatieprofielTab() {
  const [laden, setLaden] = useState(true);
  const [opslaan, setOpslaan] = useState(false);
  const [magBewerken, setMagBewerken] = useState(false);
  const [form, setForm] = useState<Formstate>({ ...LEEG });
  const [bijgewerkt, setBijgewerkt] = useState<{ door: string | null; op: string | null }>({
    door: null,
    op: null,
  });
  const [melding, setMelding] = useState<{ type: "ok" | "fout"; tekst: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/organisatieprofiel");
        if (res.ok) {
          const data = (await res.json()) as {
            profiel: Record<string, unknown> | null;
            rol: string | null;
          };
          setMagBewerken(data.rol === "beheerder");
          setForm(uitProfielrij(data.profiel));
          setBijgewerkt({
            door: (data.profiel?.bijgewerkt_door as string) ?? null,
            op: (data.profiel?.bijgewerkt_op as string) ?? null,
          });
        }
      } finally {
        setLaden(false);
      }
    })();
  }, []);

  function wijzig(key: keyof Formstate, waarde: string) {
    setForm((prev) => ({ ...prev, [key]: waarde }));
    setMelding(null);
  }

  const teLang = STRATEGISCHE_VELDEN.some((v) => form[v.key].trim().length > MAX_STRATEGISCH);

  const preview = useMemo(
    () => bouwOrganisatieprofielBlok(naarOrganisatieprofiel(form)),
    [form]
  );

  async function opslaanProfiel() {
    if (teLang || opslaan) return;
    setMelding(null);
    setOpslaan(true);
    try {
      const res = await fetch("/api/organisatieprofiel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(naarOrganisatieprofiel(form) satisfies Organisatieprofiel),
      });
      if (res.ok) {
        setMelding({ type: "ok", tekst: "Organisatieprofiel opgeslagen." });
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setMelding({ type: "fout", tekst: json.error || "Opslaan mislukt." });
      }
    } catch {
      setMelding({ type: "fout", tekst: "Opslaan mislukt (netwerk)." });
    } finally {
      setOpslaan(false);
    }
  }

  if (laden) {
    return <div className="text-sm text-muted">Organisatieprofiel laden…</div>;
  }

  const leesModus = !magBewerken;

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-serif text-lg font-black text-ink">Organisatieprofiel</h2>
        <p className="text-sm text-muted mt-1 max-w-3xl">
          Generiek contextprofiel van uw organisatie. De AI gebruikt dit als
          organisatiespecifieke context; het weegt onder wet- en regelgeving en
          formele stukken.{" "}
          {leesModus
            ? "Alleen de beheerder van uw fonds kan dit bewerken."
            : "Elke wijziging is direct actief."}
        </p>
      </div>

      {leesModus && (
        <div className="flex items-start gap-3 bg-accent-tint border border-accent/30 rounded-xl px-4 py-3 mb-6 text-sm text-accent-ink">
          <span>ℹ️</span>
          <div>
            U bekijkt het organisatieprofiel alleen ter informatie. Aanpassen doet
            de <strong>beheerder</strong> van uw fonds.
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <fieldset className="bg-white border border-line rounded-xl p-5 space-y-3">
            <legend className="text-xs font-bold uppercase tracking-widest text-muted px-1">
              Feiten
            </legend>
            {FEIT_VELDEN.map((v) => (
              <div key={v.key}>
                <label className="block text-sm font-medium text-ink mb-1">{v.label}</label>
                <input
                  type="text"
                  value={form[v.key]}
                  disabled={leesModus}
                  onChange={(e) => wijzig(v.key, e.target.value)}
                  className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm disabled:bg-app-bg disabled:text-muted"
                />
              </div>
            ))}
          </fieldset>

          <fieldset className="bg-white border border-line rounded-xl p-5 space-y-3">
            <legend className="text-xs font-bold uppercase tracking-widest text-muted px-1">
              Strategie &amp; risicohouding (max. {MAX_STRATEGISCH} tekens per veld)
            </legend>
            {STRATEGISCHE_VELDEN.map((v) => {
              const lengte = form[v.key].trim().length;
              const over = lengte > MAX_STRATEGISCH;
              return (
                <div key={v.key}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-ink">{v.label}</label>
                    <span className={`text-xs ${over ? "font-semibold text-err-ink" : "text-muted"}`}>
                      {lengte}/{MAX_STRATEGISCH}
                    </span>
                  </div>
                  <textarea
                    value={form[v.key]}
                    disabled={leesModus}
                    onChange={(e) => wijzig(v.key, e.target.value)}
                    rows={3}
                    className={`w-full rounded-lg border px-3 py-2 text-sm disabled:bg-app-bg disabled:text-muted ${
                      over ? "border-err" : "border-app-line-strong"
                    }`}
                  />
                  {over && (
                    <p className="mt-1 text-xs font-medium text-err-ink">
                      Maximaal {MAX_STRATEGISCH} tekens (nu {lengte}).
                    </p>
                  )}
                </div>
              );
            })}
          </fieldset>

          <div className="bg-white border border-line rounded-xl p-5">
            <label className="block text-sm font-medium text-ink mb-1">Peildatum (optioneel)</label>
            <input
              type="date"
              value={form.peildatum}
              disabled={leesModus}
              onChange={(e) => wijzig("peildatum", e.target.value)}
              className="rounded-lg border border-app-line-strong px-3 py-2 text-sm disabled:bg-app-bg disabled:text-muted"
            />
          </div>

          {bijgewerkt.door && (
            <p className="text-xs text-muted">
              Laatst bijgewerkt door {bijgewerkt.door}
              {bijgewerkt.op
                ? ` op ${new Date(bijgewerkt.op).toLocaleString("nl-NL")}`
                : ""}
              .
            </p>
          )}

          {melding && (
            <div
              className={`rounded-xl px-4 py-3 text-sm ${
                melding.type === "ok"
                  ? "bg-ok-tint border border-ok/30 text-ok-ink"
                  : "bg-err-tint border border-err/30 text-err-ink"
              }`}
            >
              {melding.tekst}
            </div>
          )}

          {!leesModus && (
            <button
              type="button"
              onClick={opslaanProfiel}
              disabled={opslaan || teLang}
              className="bg-accent text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-accent-ink disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {opslaan ? "Opslaan…" : "Organisatieprofiel opslaan"}
            </button>
          )}
        </div>

        {/* Live preview van het exacte promptblok (§7). */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
            Preview — wat de AI meekrijgt
          </h3>
          {preview ? (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-phase/30 bg-phase-tint/40 p-4 text-xs text-phase-ink">
              {preview.tekst}
            </pre>
          ) : (
            <p className="rounded-xl border border-line bg-app-bg p-4 text-sm text-muted">
              Geen profiel ingevuld — de AI valt terug op algemene kennis.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
