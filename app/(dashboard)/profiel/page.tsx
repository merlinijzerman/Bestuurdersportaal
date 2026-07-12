"use client";

// ============================================================================
//  Mijn profiel — Increment F (FO §14). Strikt zelfbeheer: een gebruiker
//  bewerkt uitsluitend het eigen profiel (server-side via profile.manage.own
//  + RLS). De keuzes komen UITSLUITEND uit de eigen fonds-catalogus
//  (fonds-specifieke records; globale templates zijn niet koppelbaar).
//
//  Het profiel PRIORITEERT de AI-voorbereiding, het filtert of verbergt de
//  gedeelde feitenbasis niet — dat staat als toelichting op de pagina.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  ZICHTBARE_ANTWOORDMODI,
  ANTWOORDMODUS_LABEL,
} from "@/core/lib/vraagtype";
import OrganisatieprofielTab from "./_components/OrganisatieprofielTab";

const MAX_SECUNDAIRE = 3;
const MIN_FOCUS = 3;
const MAX_FOCUS = 5;

const DETAILNIVEAUS = [
  { value: "beknopt", label: "Beknopt" },
  { value: "standaard", label: "Standaard" },
  { value: "uitgebreid", label: "Uitgebreid" },
];
const ANTWOORDVOORKEUREN = [
  { value: "kern-eerst", label: "Kern eerst" },
  { value: "puntsgewijs", label: "Puntsgewijs" },
  { value: "lopende tekst", label: "Lopende tekst" },
];

interface CatalogusItem {
  id: string;
  naam: string;
  omschrijving: string | null;
  fonds_id: string | null;
  categorie?: string | null;
  actief?: boolean;
}

// A/B/C-indeling van gremia (zie migratie 2026-06-24). Volgorde bepaalt de
// weergavevolgorde van de kopjes; "overig" vangt records zonder categorie op
// (bv. fonds-kopieën van vóór de backfill).
const GREMIA_CATEGORIEEN: { sleutel: string; label: string }[] = [
  { sleutel: "fondsorgaan", label: "Fondsorganen" },
  { sleutel: "bestuurscommissie", label: "Bestuurscommissies" },
  { sleutel: "extern_ketenpartner", label: "Externe ketenpartners" },
  { sleutel: "overig", label: "Overig" },
];

async function laadCatalogus(pad: string): Promise<CatalogusItem[]> {
  const res = await fetch(pad);
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: CatalogusItem[] };
  // Alleen fonds-specifieke records (globale templates met fonds_id NULL zijn
  // niet koppelbaar, composite-FK) én alleen ACTIEVE items: gedeactiveerde
  // organen mogen niet meer als keuze verschijnen.
  return (json.items ?? []).filter((i) => i.fonds_id && i.actief !== false);
}

// Tekstknop om een keuzelijst in/uit te klappen.
function InklapKnop({
  open,
  aantal,
  onClick,
}: {
  open: boolean;
  aantal: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 text-sm font-medium text-ink hover:underline"
    >
      {open
        ? "▲ Inklappen"
        : aantal > 0
          ? "▾ Wijzigen of meer toevoegen"
          : "▾ Kiezen"}
    </button>
  );
}

type Tab = "mij" | "org";

function TabKnop({
  actief,
  onClick,
  children,
}: {
  actief: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition ${
        actief
          ? "border-accent text-ink"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function ProfielPage() {
  const [tab, setTab] = useState<Tab>("mij");
  const [laden, setLaden] = useState(true);
  const [opslaan, setOpslaan] = useState(false);
  const [melding, setMelding] = useState<{ type: "ok" | "fout"; tekst: string } | null>(null);

  const [expertises, setExpertises] = useState<CatalogusItem[]>([]);
  const [gremia, setGremia] = useState<CatalogusItem[]>([]);
  const [focusgebieden, setFocusgebieden] = useState<CatalogusItem[]>([]);

  const [naam, setNaam] = useState("");
  const [bestuurlijkeRol, setBestuurlijkeRol] = useState("");
  const [primaireExpertiseId, setPrimaireExpertiseId] = useState<string>("");
  const [antwoordvoorkeur, setAntwoordvoorkeur] = useState<string>("");
  const [standaardAiModus, setStandaardAiModus] = useState<string>("");
  const [detailniveau, setDetailniveau] = useState<string>("");
  const [secundaire, setSecundaire] = useState<string[]>([]);
  const [gekozenGremia, setGekozenGremia] = useState<string[]>([]);
  const [gekozenFocus, setGekozenFocus] = useState<string[]>([]);

  // Inklap-status per keuzelijst. Standaard ingeklapt: dan toont het profiel
  // alleen de GEKOZEN chips en blijft de pagina rustig. Uitklappen onthult de
  // volledige keuzelijst om te wijzigen/toevoegen.
  const [expOpen, setExpOpen] = useState(false);
  const [gremOpen, setGremOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [profielRes, exp, grem, focus] = await Promise.all([
          fetch("/api/profiel"),
          laadCatalogus("/api/expertises"),
          laadCatalogus("/api/gremia"),
          laadCatalogus("/api/focusgebieden"),
        ]);
        setExpertises(exp);
        setGremia(grem);
        setFocusgebieden(focus);

        if (profielRes.ok) {
          const data = (await profielRes.json()) as {
            profiel: {
              naam: string | null;
              bestuurlijke_rol: string | null;
              primaire_expertise_id: string | null;
              antwoordvoorkeur: string | null;
              standaard_ai_modus: string | null;
              detailniveau: string | null;
            };
            secundaire_expertise_ids: string[];
            gremium_ids: string[];
            focusgebied_ids: string[];
          };
          // Opgeslagen selecties opschonen tegen de ACTIEVE catalogus: organen die
          // sinds de laatste opslag zijn gedeactiveerd of verwijderd, vallen hier
          // weg zodat ze bij de eerstvolgende opslag ook echt loskomen (geen
          // onzichtbare reststand in de database).
          const expIds = new Set(exp.map((e) => e.id));
          const gremIds = new Set(grem.map((g) => g.id));
          const focusIds = new Set(focus.map((f) => f.id));

          const primair = data.profiel.primaire_expertise_id ?? "";
          setNaam(data.profiel.naam ?? "");
          setBestuurlijkeRol(data.profiel.bestuurlijke_rol ?? "");
          setPrimaireExpertiseId(expIds.has(primair) ? primair : "");
          setAntwoordvoorkeur(data.profiel.antwoordvoorkeur ?? "");
          setStandaardAiModus(data.profiel.standaard_ai_modus ?? "");
          setDetailniveau(data.profiel.detailniveau ?? "");
          setSecundaire((data.secundaire_expertise_ids ?? []).filter((id) => expIds.has(id)));
          setGekozenGremia((data.gremium_ids ?? []).filter((id) => gremIds.has(id)));
          const geldigeFocus = (data.focusgebied_ids ?? []).filter((id) => focusIds.has(id));
          setGekozenFocus(geldigeFocus);
          // Focusgebieden kennen een minimum (≥3). Bij een (nog) leeg profiel
          // tonen we de keuzelijst meteen uitgeklapt zodat de bestuurder wordt
          // uitgenodigd te kiezen; bij een gevuld profiel blijft het rustig
          // ingeklapt met alleen de gekozen chips.
          if (geldigeFocus.length === 0) setFocusOpen(true);
        }
      } finally {
        setLaden(false);
      }
    })();
  }, []);

  // Secundaire expertises mogen niet de primaire bevatten.
  const secundaireKandidaten = useMemo(
    () => expertises.filter((e) => e.id !== primaireExpertiseId),
    [expertises, primaireExpertiseId]
  );

  function wisselSet(
    huidig: string[],
    id: string,
    max: number
  ): string[] {
    if (huidig.includes(id)) return huidig.filter((x) => x !== id);
    if (huidig.length >= max) return huidig; // grens bereikt — negeer
    return [...huidig, id];
  }

  const focusBuitenBereik =
    gekozenFocus.length > 0 && (gekozenFocus.length < MIN_FOCUS || gekozenFocus.length > MAX_FOCUS);

  async function opslaanProfiel() {
    setMelding(null);
    setOpslaan(true);
    try {
      const res = await fetch("/api/profiel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam: naam.trim() || null,
          bestuurlijke_rol: bestuurlijkeRol || null,
          primaire_expertise_id: primaireExpertiseId || null,
          antwoordvoorkeur: antwoordvoorkeur || null,
          standaard_ai_modus: standaardAiModus || null,
          detailniveau: detailniveau || null,
          secundaire_expertise_ids: secundaire,
          gremium_ids: gekozenGremia,
          focusgebied_ids: gekozenFocus,
        }),
      });
      if (res.ok) {
        setMelding({ type: "ok", tekst: "Profiel opgeslagen." });
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
    return <div className="p-4 sm:p-6 lg:p-7 text-sm text-muted">Profiel laden…</div>;
  }

  const geenCatalogus =
    expertises.length === 0 && gremia.length === 0 && focusgebieden.length === 0;

  return (
    <div className="p-4 sm:p-6 lg:p-7">
      <div className="mb-6">
        <h1 className="font-serif text-xl font-black text-ink">Mijn profiel</h1>
      </div>

      <div className="mb-6 flex gap-1 border-b border-line">
        <TabKnop actief={tab === "mij"} onClick={() => setTab("mij")}>
          Mijn profiel
        </TabKnop>
        <TabKnop actief={tab === "org"} onClick={() => setTab("org")}>
          Organisatieprofiel
        </TabKnop>
      </div>

      {tab === "org" ? (
        <OrganisatieprofielTab />
      ) : (
        <div className="max-w-3xl">
          <p className="text-sm text-muted mb-6">
            Uw profiel personaliseert de AI-voorbereiding (welke aandachtspunten en kritische
            vragen vóórkomen).
          </p>

          <div className="flex items-start gap-3 bg-accent-tint border border-accent/30 rounded-xl px-4 py-3 mb-6 text-sm text-accent-ink">
        <span>ℹ️</span>
        <div>
          Het profiel <strong>prioriteert</strong>, het <strong>filtert niet</strong>: de
          gedeelde bestuurlijke kern en de bronnen blijven voor iedereen gelijk en zichtbaar.
          In de AI-assistent kunt u met één klik terug naar het{" "}
          <strong>algemeen perspectief</strong>.
        </div>
      </div>

      {geenCatalogus && (
        <div className="flex items-start gap-3 bg-warn-tint border border-warn/30 rounded-xl px-4 py-3 mb-6 text-sm text-warn-ink">
          <span>⚠️</span>
          <div>
            Er zijn nog geen fonds-specifieke expertises, gremia of focusgebieden ingericht.
            Vraag de beheerder om de catalogus te vullen (Catalogus &amp; organen) voordat u
            koppelingen kiest.
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Naam — weergavenaam op het platform */}
        <section className="bg-white border border-line rounded-xl p-5">
          <h2 className="font-bold text-ink mb-1">Naam</h2>
          <p className="text-xs text-muted mb-4">
            Uw weergavenaam op het platform (in de zijbalk en bij uw acties). Leeg laten
            houdt de huidige naam aan.
          </p>
          <label className="block text-sm font-medium text-ink mb-1">Weergavenaam</label>
          <input
            type="text"
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="Bijv. Marieke de Vries"
            maxLength={120}
            className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm"
          />
        </section>

        {/* Bestuurlijke rol + voorkeuren */}
        <section className="bg-white border border-line rounded-xl p-5">
          <h2 className="font-bold text-ink mb-4">Bestuurlijke rol &amp; voorkeuren</h2>

          <label className="block text-sm font-medium text-ink mb-1">
            Functionele bestuurlijke rol
          </label>
          <input
            type="text"
            value={bestuurlijkeRol}
            onChange={(e) => setBestuurlijkeRol(e.target.value)}
            placeholder="Bijv. voorzitter beleggingscommissie"
            className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm mb-1"
          />
          <p className="text-xs text-muted mb-4">
            Functioneel, ter context voor de AI. Dit bepaalt geen rechten of autorisatie.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Standaard AI-modus
              </label>
              <select
                value={standaardAiModus}
                onChange={(e) => setStandaardAiModus(e.target.value)}
                className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Automatisch</option>
                {ZICHTBARE_ANTWOORDMODI.map((m) => (
                  <option key={m} value={m}>
                    {ANTWOORDMODUS_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Detailniveau</label>
              <select
                value={detailniveau}
                onChange={(e) => setDetailniveau(e.target.value)}
                className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {DETAILNIVEAUS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Antwoordvoorkeur
              </label>
              <select
                value={antwoordvoorkeur}
                onChange={(e) => setAntwoordvoorkeur(e.target.value)}
                className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {ANTWOORDVOORKEUREN.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Expertise */}
        <section className="bg-white border border-line rounded-xl p-5">
          <h2 className="font-bold text-ink mb-1">Expertise</h2>
          <p className="text-xs text-muted mb-4">
            Eén primaire expertise; maximaal {MAX_SECUNDAIRE} secundaire.
          </p>

          <label className="block text-sm font-medium text-ink mb-1">
            Primaire expertise
          </label>
          <select
            value={primaireExpertiseId}
            onChange={(e) => {
              const id = e.target.value;
              setPrimaireExpertiseId(id);
              setSecundaire((s) => s.filter((x) => x !== id));
            }}
            className="w-full border border-app-line-strong rounded-lg px-3 py-2 text-sm mb-4"
          >
            <option value="">—</option>
            {expertises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.naam}
              </option>
            ))}
          </select>

          <label className="block text-sm font-medium text-ink mb-2">
            Secundaire expertises{" "}
            <span className="text-xs text-muted">
              ({secundaire.length}/{MAX_SECUNDAIRE})
            </span>
          </label>

          {/* Ingeklapt: alleen de gekozen expertises (klik = verwijderen). */}
          {!expOpen && (
            <div className="flex flex-wrap gap-2">
              {secundaire.length === 0 ? (
                <span className="text-sm text-muted">
                  Nog geen secundaire expertise gekozen.
                </span>
              ) : (
                secundaireKandidaten
                  .filter((e) => secundaire.includes(e.id))
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() =>
                        setSecundaire((s) => wisselSet(s, e.id, MAX_SECUNDAIRE))
                      }
                      className="px-3 py-1.5 rounded-full text-sm border bg-accent text-white border-accent"
                    >
                      {e.naam} ✕
                    </button>
                  ))
              )}
            </div>
          )}

          {/* Uitgeklapt: volledige keuzelijst. */}
          {expOpen && (
            <div className="flex flex-wrap gap-2">
              {secundaireKandidaten.map((e) => {
                const aan = secundaire.includes(e.id);
                const vol = !aan && secundaire.length >= MAX_SECUNDAIRE;
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={vol}
                    onClick={() => setSecundaire((s) => wisselSet(s, e.id, MAX_SECUNDAIRE))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      aan
                        ? "bg-accent text-white border-accent"
                        : vol
                          ? "bg-app-bg text-muted border-line cursor-not-allowed"
                          : "bg-white text-ink border-app-line-strong hover:border-accent"
                    }`}
                  >
                    {e.naam}
                  </button>
                );
              })}
            </div>
          )}

          <InklapKnop
            open={expOpen}
            aantal={secundaire.length}
            onClick={() => setExpOpen((o) => !o)}
          />
        </section>

        {/* Gremia — gegroepeerd per categorie (Fondsorganen / Bestuurscommissies
            / Externe ketenpartners). */}
        <section className="bg-white border border-line rounded-xl p-5">
          <h2 className="font-bold text-ink mb-1">Commissies &amp; gremia</h2>
          <p className="text-xs text-muted mb-4">
            ({gekozenGremia.length} gekozen)
          </p>

          {/* Ingeklapt: alleen de gekozen gremia (klik = verwijderen). */}
          {!gremOpen && (
            <div className="flex flex-wrap gap-2">
              {gekozenGremia.length === 0 ? (
                <span className="text-sm text-muted">
                  Nog geen commissies of gremia gekozen.
                </span>
              ) : (
                gremia
                  .filter((g) => gekozenGremia.includes(g.id))
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setGekozenGremia((s) =>
                          wisselSet(s, g.id, Number.MAX_SAFE_INTEGER)
                        )
                      }
                      className="px-3 py-1.5 rounded-full text-sm border bg-accent text-white border-accent"
                    >
                      {g.naam} ✕
                    </button>
                  ))
              )}
            </div>
          )}

          {/* Uitgeklapt: volledige keuzelijst, gegroepeerd per categorie. */}
          {gremOpen && (
            <div className="space-y-5">
              {GREMIA_CATEGORIEEN.map((cat) => {
                const items = gremia.filter(
                  (g) => (g.categorie ?? "overig") === cat.sleutel
                );
                if (items.length === 0) return null;
                return (
                  <div key={cat.sleutel}>
                    <div className="text-xs font-bold uppercase tracking-widest text-muted mb-2">
                      {cat.label}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {items.map((g) => {
                        const aan = gekozenGremia.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() =>
                              setGekozenGremia((s) =>
                                wisselSet(s, g.id, Number.MAX_SAFE_INTEGER)
                              )
                            }
                            className={`px-3 py-1.5 rounded-full text-sm border transition ${
                              aan
                                ? "bg-accent text-white border-accent"
                                : "bg-white text-ink border-app-line-strong hover:border-accent"
                            }`}
                          >
                            {g.naam}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <InklapKnop
            open={gremOpen}
            aantal={gekozenGremia.length}
            onClick={() => setGremOpen((o) => !o)}
          />
        </section>

        {/* Focusgebieden */}
        <section className="bg-white border border-line rounded-xl p-5">
          <h2 className="font-bold text-ink mb-1">Kritische focusgebieden</h2>
          <p className="text-xs text-muted mb-4">
            Kies er {MIN_FOCUS} tot {MAX_FOCUS}.{" "}
            <span className={focusBuitenBereik ? "text-err-ink font-medium" : ""}>
              ({gekozenFocus.length} gekozen)
            </span>
          </p>
          {/* Ingeklapt: alleen de gekozen focusgebieden (klik = verwijderen). */}
          {!focusOpen && (
            <div className="flex flex-wrap gap-2">
              {gekozenFocus.length === 0 ? (
                <span className="text-sm text-muted">
                  Nog geen focusgebieden gekozen.
                </span>
              ) : (
                focusgebieden
                  .filter((f) => gekozenFocus.includes(f.id))
                  .map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() =>
                        setGekozenFocus((s) => wisselSet(s, f.id, MAX_FOCUS))
                      }
                      className="px-3 py-1.5 rounded-full text-sm border bg-accent text-white border-accent"
                    >
                      {f.naam} ✕
                    </button>
                  ))
              )}
            </div>
          )}

          {/* Uitgeklapt: volledige keuzelijst. */}
          {focusOpen && (
            <div className="flex flex-wrap gap-2">
              {focusgebieden.map((f) => {
                const aan = gekozenFocus.includes(f.id);
                const vol = !aan && gekozenFocus.length >= MAX_FOCUS;
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={vol}
                    onClick={() => setGekozenFocus((s) => wisselSet(s, f.id, MAX_FOCUS))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${
                      aan
                        ? "bg-accent text-white border-accent"
                        : vol
                          ? "bg-app-bg text-muted border-line cursor-not-allowed"
                          : "bg-white text-ink border-app-line-strong hover:border-accent"
                    }`}
                  >
                    {f.naam}
                  </button>
                );
              })}
            </div>
          )}

          <InklapKnop
            open={focusOpen}
            aantal={gekozenFocus.length}
            onClick={() => setFocusOpen((o) => !o)}
          />
        </section>
      </div>

      {melding && (
        <div
          className={`mt-6 rounded-xl px-4 py-3 text-sm ${
            melding.type === "ok"
              ? "bg-ok-tint border border-ok/30 text-ok-ink"
              : "bg-err-tint border border-err/30 text-err-ink"
          }`}
        >
          {melding.tekst}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={opslaanProfiel}
          disabled={opslaan || focusBuitenBereik}
          className="bg-accent text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-accent-ink disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {opslaan ? "Opslaan…" : "Profiel opslaan"}
        </button>
        {focusBuitenBereik && (
          <span className="text-xs text-err-ink">
            Kies {MIN_FOCUS}–{MAX_FOCUS} focusgebieden (of geen) om op te slaan.
          </span>
        )}
      </div>
        </div>
      )}
    </div>
  );
}
