"use client";

// ============================================================================
//  Fonds-configuratiescherm (T8) — theming, module-manifest, feature flags +
//  wijzigingshistorie met herstel. Leest/writes via /api/instellingen.
// ----------------------------------------------------------------------------
//  BESCHIKBAARHEID ≠ AUTORISATIE: het manifest hieronder zet modules aan/uit voor
//  dit fonds (welke nav-items en welke module-entrypoints beschikbaar zijn). Het
//  is GEEN rechtenmodel — de echte autorisatie zit server-side in
//  requireCapability()/RLS per route. De schrijfacties zelf zijn capability-gated
//  (fonds.config.manage) én DB-rolgated; `mag_beheren` hier is louter UI-cosmetica.
//  Elke wijziging is server-side geversioneerd + append-only gelogd (historie).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import type { BronkeuzeModus, BronkeuzeHerkomst } from "@/core/lib/fonds-config-core";

type ModuleRij = { key: string; label: string; beschikbaar: boolean };
type HistorieRij = {
  id: string;
  config_type: string;
  config_sleutel: string;
  versie: number;
  gebruiker_naam: string | null;
  aangemaakt: string;
};
type InstellingenData = {
  mag_beheren: boolean;
  hybride_zoeken: boolean;
  // T1/T2 — effectieve stand van de representatie-constraintlaag (fonds → env).
  representatie_constraints: boolean;
  // Besluit 0137: effectieve bronkeuze-modus + herkomst (fonds → env → default).
  bronkeuze_modus: {
    effectief: BronkeuzeModus;
    herkomst: BronkeuzeHerkomst;
    fonds_waarde: BronkeuzeModus | null;
  };
  theming: Record<string, string>;
  modules: ModuleRij[];
  flags: Record<string, unknown>;
  overrides: Record<string, string>;
  historie: HistorieRij[];
};

// Besluit 0137 — de drie standen van de bronkeuze-vlag, met de labels/uitleg uit
// de werkopdracht. Eén control voor precies deze vlag (geen generieke flag-editor).
const BRONKEUZE_OPTIES: { waarde: BronkeuzeModus; label: string; uitleg: string }[] = [
  {
    waarde: "blokkerend",
    label: "Vraag vooraf",
    uitleg:
      "De assistent vraagt eerst of u het voor uw fonds of in algemene zin wilt weten.",
  },
  {
    waarde: "antwoord_eerst",
    label: "Antwoord eerst",
    uitleg:
      "De assistent antwoordt fondsgericht en biedt de keuze aan ónder het antwoord.",
  },
  {
    waarde: "uit",
    label: "Altijd fondsgericht",
    uitleg: "Geen vraag en geen keuze; altijd het eigen fonds.",
  },
];

function bronkeuzeLabel(modus: string): string {
  return BRONKEUZE_OPTIES.find((o) => o.waarde === modus)?.label ?? modus;
}

// Herkomst expliciet maken: een lege fonds-vlag mag niet lijken alsof er "niets"
// staat terwijl een env-default of de fail-safe geldt (geen schijnzekerheid).
function bronkeuzeHerkomstTekst(b: InstellingenData["bronkeuze_modus"]): string {
  const label = bronkeuzeLabel(b.effectief);
  if (b.herkomst === "fonds") return `Ingesteld voor dit fonds: ${label}.`;
  if (b.herkomst === "env")
    return `Volgt de platformstandaard: ${label}. Kies een stand om dit voor uw fonds vast te zetten.`;
  return `Standaard: ${label}. Kies een stand om dit voor uw fonds vast te zetten.`;
}

// Themabare tokens (spiegelt de allowlist in lib/fonds-config-core.ts). RGB-tokens
// verwachten een kanaal-triple "r g b" (0–255); letter/url zijn vrije tekst binnen
// het server-side gevalideerde patroon.
const THEMA_VELDEN: { key: string; label: string; hint: string }[] = [
  { key: "accent-rgb", label: "Accentkleur", hint: "r g b, bv. 35 78 112" },
  { key: "accent-ink-rgb", label: "Accent (tekst)", hint: "r g b" },
  { key: "accent-tint-rgb", label: "Accent (tint)", hint: "r g b" },
  { key: "nav-rgb", label: "Navigatie-achtergrond", hint: "r g b" },
  { key: "nav-line-rgb", label: "Navigatie-lijn", hint: "r g b" },
  { key: "nav-accent-rgb", label: "Navigatie-accent", hint: "r g b" },
  { key: "nav-text-rgb", label: "Navigatie-tekst", hint: "r g b" },
  { key: "nav-text-active-rgb", label: "Navigatie-tekst (actief)", hint: "r g b" },
  { key: "logo-letter", label: "Logo-letter", hint: "1–2 tekens, bv. PH" },
  { key: "logo-url", label: "Logo-URL", hint: "/pad of https://…" },
];

const CONFIG_TYPE_LABEL: Record<string, string> = {
  theming: "Theming",
  manifest: "Module",
  flag: "Feature flag",
  override: "Content-override",
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Er ging iets mis");
  return data;
}

export default function ConfigBeheer() {
  const [data, setData] = useState<InstellingenData | null>(null);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);
  const [themaConcept, setThemaConcept] = useState<Record<string, string>>({});

  const laad = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const d = (await jsonFetch("/api/instellingen")) as InstellingenData;
      setData(d);
      setThemaConcept({ ...d.theming });
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Laden mislukt");
    } finally {
      setLaden(false);
    }
  }, []);

  useEffect(() => {
    laad();
  }, [laad]);

  async function schrijf(body: Record<string, unknown>, meldingTekst: string) {
    setBezig(JSON.stringify(body));
    setFout(null);
    setMelding(null);
    try {
      await jsonFetch("/api/instellingen", { method: "POST", body: JSON.stringify(body) });
      setMelding(meldingTekst);
      await laad();
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function bewaarTheming() {
    // Alleen niet-lege velden meesturen; de server valideert + negeert ongeldige.
    const tokens: Record<string, string> = {};
    for (const { key } of THEMA_VELDEN) {
      const v = (themaConcept[key] ?? "").trim();
      if (v) tokens[key] = v;
    }
    await schrijf({ type: "theming", tokens }, "Theming opgeslagen.");
  }

  if (laden) return <div className="text-muted text-sm">Configuratie laden…</div>;
  if (fout && !data)
    return (
      <div className="rounded-lg border border-err/30 bg-err-tint p-3 text-sm text-err-ink">
        {fout}
      </div>
    );
  if (!data) return null;

  if (!data.mag_beheren) {
    return (
      <div className="rounded-xl border border-warn/30 bg-warn-tint p-4 text-warn-ink text-sm">
        U heeft geen rechten om de fonds-configuratie te wijzigen. Dit is voorbehouden
        aan de rol <strong>beheerder</strong> of <strong>voorzitter</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {melding && (
        <div className="rounded-lg border border-ok/30 bg-ok-tint p-3 text-sm text-ok-ink">
          {melding}
        </div>
      )}
      {fout && (
        <div className="rounded-lg border border-err/30 bg-err-tint p-3 text-sm text-err-ink">
          {fout}
        </div>
      )}

      {/* ── Theming ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">Huisstijl (theming)</h2>
        <p className="text-sm text-muted mb-3">
          Kleuren worden als veilige CSS-variabelen toegepast (allowlist; ongeldige
          waarden worden server-side genegeerd). Leeg laten = terugvallen op de
          standaardstijl.
        </p>
        <div className="rounded-xl border border-line bg-white p-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {THEMA_VELDEN.map(({ key, label, hint }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted mb-1">{label}</label>
              <input
                value={themaConcept[key] ?? ""}
                onChange={(e) =>
                  setThemaConcept((s) => ({ ...s, [key]: e.target.value }))
                }
                placeholder={hint}
                className="w-full rounded-lg border border-app-line-strong px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
        <button
          onClick={bewaarTheming}
          disabled={bezig !== null}
          className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
        >
          Theming opslaan
        </button>
      </section>

      {/* ── Module-manifest ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">Modules</h2>
        <p className="text-sm text-muted mb-3">
          Zet modules aan of uit voor dit fonds. Dit bepaalt beschikbaarheid (welke
          nav-items en API-entrypoints toegankelijk zijn) — <strong>geen</strong>{" "}
          rechten. De autorisatie per module blijft server-side geborgd.
        </p>
        <div className="space-y-1.5">
          {data.modules.map((m) => (
            <div
              key={m.key}
              className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-2.5"
            >
              <div className="flex-1">
                <span className="text-sm text-ink">{m.label}</span>
                <span className="ml-2 text-xs text-muted">{m.key}</span>
                {!m.beschikbaar && (
                  <span className="ml-2 rounded bg-app-bg px-1.5 py-0.5 text-xs text-muted">
                    uit
                  </span>
                )}
              </div>
              <button
                onClick={() =>
                  schrijf(
                    { type: "manifest", module_key: m.key, actief: !m.beschikbaar },
                    `Module "${m.label}" ${m.beschikbaar ? "uitgezet" : "aangezet"}.`
                  )
                }
                disabled={bezig !== null}
                className="rounded-lg border border-app-line-strong px-3 py-1 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
              >
                {m.beschikbaar ? "Uitzetten" : "Aanzetten"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature flags ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">Feature flags</h2>
        <p className="text-sm text-muted mb-3">
          Gedragsschakelaars per fonds. Hybride zoeken combineert semantisch en
          trefwoord-zoeken in de AI-assistent.
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-2.5">
          <div className="flex-1">
            <span className="text-sm text-ink">Hybride zoeken</span>
            <span className="ml-2 text-xs text-muted">hybride_zoeken</span>
          </div>
          <button
            onClick={() =>
              schrijf(
                { type: "flag", key: "hybride_zoeken", waarde: !data.hybride_zoeken },
                `Hybride zoeken ${data.hybride_zoeken ? "uitgezet" : "aangezet"}.`
              )
            }
            disabled={bezig !== null}
            className="rounded-lg border border-app-line-strong px-3 py-1 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
          >
            {data.hybride_zoeken ? "Uitzetten" : "Aanzetten"}
          </button>
        </div>

        {/* ── Representatie-constraints (T1/T2) ─────────────────────────────── */}
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-2.5">
          <div className="flex-1">
            <span className="text-sm text-ink">Representatie-constraints</span>
            <span className="ml-2 text-xs text-muted">representatie_constraints</span>
            <p className="mt-0.5 text-xs text-muted">
              Garandeert bij een gecombineerde vraag minimaal één fonds- én één
              generieke bron vóór de budget-afkap (begrip×wet-vragen).
            </p>
          </div>
          <button
            onClick={() =>
              schrijf(
                {
                  type: "flag",
                  key: "representatie_constraints",
                  waarde: !data.representatie_constraints,
                },
                `Representatie-constraints ${
                  data.representatie_constraints ? "uitgezet" : "aangezet"
                }.`
              )
            }
            disabled={bezig !== null}
            className="rounded-lg border border-app-line-strong px-3 py-1 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
          >
            {data.representatie_constraints ? "Uitzetten" : "Aanzetten"}
          </button>
        </div>

        {/* ── Bronkeuze-modus (besluit 0137) — driewegvlag, direct instelbaar ── */}
        <div className="mt-3 rounded-lg border border-line bg-white px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-ink">Bronkeuze in de assistent</span>
            <span className="text-xs text-muted">bronkeuze_modus</span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {BRONKEUZE_OPTIES.map((opt) => {
              const actief = data.bronkeuze_modus.effectief === opt.waarde;
              return (
                <button
                  key={opt.waarde}
                  onClick={() =>
                    schrijf(
                      { type: "flag", key: "bronkeuze_modus", waarde: opt.waarde },
                      `Bronkeuze-modus op "${opt.label}" gezet.`
                    )
                  }
                  disabled={bezig !== null}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-50 ${
                    actief
                      ? "border-accent bg-accent/10"
                      : "border-line hover:bg-app-bg"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm text-ink">
                    <span
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${
                        actief ? "border-accent bg-accent" : "border-app-line-strong"
                      }`}
                    />
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block pl-[1.125rem] text-xs text-muted">
                    {opt.uitleg}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">
            {bronkeuzeHerkomstTekst(data.bronkeuze_modus)}
          </p>
        </div>
      </section>

      {/* ── Wijzigingshistorie + herstel ────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-ink mb-1">Wijzigingshistorie</h2>
        <p className="text-sm text-muted mb-3">
          Append-only auditspoor van configuratiewijzigingen. Herstellen zet de
          waarde van die regel opnieuw als nieuwe versie (traceerbaar, niets wordt
          overschreven).
        </p>
        {data.historie.length === 0 ? (
          <div className="text-muted text-sm">Nog geen wijzigingen vastgelegd.</div>
        ) : (
          <div className="space-y-1.5">
            {data.historie.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink">
                    <span className="font-medium">
                      {CONFIG_TYPE_LABEL[h.config_type] ?? h.config_type}
                    </span>{" "}
                    · {h.config_sleutel}{" "}
                    <span className="text-xs text-muted">v{h.versie}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(h.aangemaakt).toLocaleString("nl-NL")}
                    {h.gebruiker_naam ? ` · ${h.gebruiker_naam}` : ""}
                  </div>
                </div>
                <button
                  onClick={() =>
                    schrijf(
                      { type: "herstel", log_id: h.id },
                      "Configuratie hersteld als nieuwe versie."
                    )
                  }
                  disabled={bezig !== null}
                  className="shrink-0 rounded-lg border border-app-line-strong px-3 py-1 text-sm text-ink hover:bg-app-bg disabled:opacity-50"
                >
                  Herstellen
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
