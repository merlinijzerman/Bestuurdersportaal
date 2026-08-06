"use client";

// ============================================================================
//  "Een stuk voorbereiden" — scherpsteltoestand binnen /ai (T2, bureau-stand).
// ----------------------------------------------------------------------------
//  Zusje van DocumentDoorgronden: stelt de opdracht scherp vóór de assistent
//  begint. De gebruiker kiest de STUKSOORT (die de vaste secties bepaalt), een
//  onderwerp, en de bronstukken waarop het concept steunt. Géén eigen route (geen
//  browser-terug, geen deeplink) — dit is een toestand in AssistentClient.
//
//  Alle stuksoort-/sectielogica komt uit core/lib/stukvoorbereiding.ts — één bron
//  van waarheid, gedeeld met de route en de eval. Dit component doet alleen UI +
//  de door de ouder aangereikte documentzoek-callback (geen tweede zoekimpl).
// ============================================================================

import { useEffect, useState } from "react";
import { STUKSOORTEN, bouwStukZin, type Stuksoort } from "@/core/lib/stukvoorbereiding";
import type { DoorgrondDoc } from "./DocumentDoorgronden";

export default function StukVoorbereiden({
  laden,
  zoekDocumenten,
  onStart,
  onAnnuleren,
}: {
  laden: boolean;
  zoekDocumenten: (q: string) => Promise<DoorgrondDoc[]>;
  onStart: (stuksoort: Stuksoort, onderwerp: string, documenten: DoorgrondDoc[]) => void;
  onAnnuleren: () => void;
}) {
  // T5 B1 — drie vertrekpunten. Een bron is niet langer verplicht.
  //  (i)   fondsdocumenten — het concept steunt op gekozen stukken ([Bron N]).
  //  (ii)  deskresearch    — volgt met T4 (compliance-gated), nu nog niet actief.
  //  (iii) onderwerp       — alleen een onderwerp → een bronloos concept-SKELET.
  type Vertrekpunt = "fondsdocumenten" | "deskresearch" | "onderwerp";
  const [vertrekpunt, setVertrekpunt] = useState<Vertrekpunt>("fondsdocumenten");
  const [stuksoort, setStuksoort] = useState<Stuksoort>("bestuursnotitie");
  const [onderwerp, setOnderwerp] = useState("");
  const [documenten, setDocumenten] = useState<DoorgrondDoc[]>([]);
  const [kiezerOpen, setKiezerOpen] = useState(false);
  const [zoekterm, setZoekterm] = useState("");
  const [suggesties, setSuggesties] = useState<DoorgrondDoc[]>([]);

  const VERTREKPUNTEN: {
    id: Vertrekpunt;
    titel: string;
    hint: string;
    beschikbaar: boolean;
  }[] = [
    {
      id: "fondsdocumenten",
      titel: "Fondsdocumenten",
      hint: "Het concept steunt op gekozen stukken; elke bewering krijgt een bronverwijzing.",
      beschikbaar: true,
    },
    {
      id: "onderwerp",
      titel: "Alleen een onderwerp",
      hint: "Een raamwerk zonder bron: alles wat nog moet worden onderbouwd komt onder “Aannames en open punten”.",
      beschikbaar: true,
    },
    {
      id: "deskresearch",
      titel: "Deskresearch-resultaat",
      hint: "Binnenkort — voortbouwen op een deskresearch (volgt met de deskresearch-module).",
      beschikbaar: false,
    },
  ];

  // Documentkiezer — hergebruikt dezelfde suggestiebron als de @-mention.
  useEffect(() => {
    if (!kiezerOpen) return;
    let geannuleerd = false;
    const timer = window.setTimeout(async () => {
      const data = await zoekDocumenten(zoekterm);
      if (!geannuleerd) setSuggesties(data);
    }, 150);
    return () => {
      geannuleerd = true;
      window.clearTimeout(timer);
    };
  }, [kiezerOpen, zoekterm, zoekDocumenten]);

  function toggleDoc(d: DoorgrondDoc) {
    setDocumenten((lijst) =>
      lijst.some((x) => x.id === d.id)
        ? lijst.filter((x) => x.id !== d.id)
        : [...lijst, d]
    );
  }

  // Startvoorwaarde per vertrekpunt: fondsdocumenten vereist ≥1 stuk; alleen-een-
  // onderwerp vereist een ingevuld onderwerp; deskresearch is nog niet actief.
  const bronloos = vertrekpunt === "onderwerp";
  const magStarten =
    !laden &&
    (vertrekpunt === "fondsdocumenten"
      ? documenten.length > 0
      : vertrekpunt === "onderwerp"
      ? onderwerp.trim().length > 0
      : false);

  const stukLabel = STUKSOORTEN.find((s) => s.id === stuksoort)!.titel.toLowerCase();
  const recapTekst =
    vertrekpunt === "deskresearch"
      ? "Kies een ander vertrekpunt — voortbouwen op deskresearch volgt binnenkort."
      : vertrekpunt === "onderwerp"
      ? onderwerp.trim().length === 0
        ? "Vul een onderwerp in — ik lever dan een concept-skelet zonder bron."
        : `Ik stel een concept-${stukLabel} op als raamwerk (zonder bron): alles wat nog onderbouwing vergt komt onder “Aannames en open punten”.`
      : documenten.length === 0
      ? "Kies minstens één bronstuk — het concept steunt op de aangeleverde bronnen."
      : `Ik stel een concept-${stukLabel} op, op basis van ${documenten.length} ${
          documenten.length === 1 ? "stuk" : "stukken"
        }.`;

  return (
    <div className="pb-3 pt-1 space-y-4">
      {/* Kop met kruimelpad + Annuleren */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onAnnuleren}
          className="text-xs font-semibold text-accent hover:text-accent-ink"
        >
          Startpunt ›
        </button>
        <h1 className="font-serif text-xl md:text-2xl font-semibold text-ink">
          Een stuk voorbereiden
        </h1>
        <button
          type="button"
          onClick={onAnnuleren}
          className="ml-auto text-xs text-ink border border-line rounded-lg px-3 py-1.5 hover:border-accent transition-colors"
        >
          Annuleren
        </button>
      </div>

      <p className="text-sm text-muted max-w-prose leading-relaxed">
        De assistent levert een <strong>concept</strong> ter bewerking, geen
        eindproduct. Elk stuk sluit af met een sectie “Aannames en open punten”, en
        een voorstel wordt altijd geformuleerd als voorstel ván het bureau áán het
        bestuur — nooit als besluit.
      </p>

      <div className="border border-line rounded-2xl bg-card divide-y divide-line">
        {/* ── Vertrekpunt (T5 B1) ── */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-ink">Waarop baseert u het stuk?</h3>
          <p className="text-xs text-muted mt-0.5">Een bron is niet verplicht</p>
          <div className="mt-3 space-y-2">
            {VERTREKPUNTEN.map((v) => {
              const aan = v.id === vertrekpunt;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={!v.beschikbaar}
                  onClick={() => {
                    if (!v.beschikbaar) return;
                    setVertrekpunt(v.id);
                    // Wisselen wég van 'fondsdocumenten' leegt de bronselectie: een
                    // verborgen, blijven-hangend stuk zou de parent anders de
                    // bron-variant laten draaien terwijl de UI een bronloos skelet
                    // belooft (auditspoor + gedrag zouden uiteenlopen).
                    if (v.id !== "fondsdocumenten") {
                      setDocumenten([]);
                      setKiezerOpen(false);
                    }
                  }}
                  aria-pressed={aan}
                  className={`w-full text-left flex items-start gap-3 border rounded-xl p-3 transition-colors ${
                    aan
                      ? "border-accent bg-accent/5"
                      : "border-line hover:border-accent"
                  } ${!v.beschikbaar ? "opacity-55 cursor-not-allowed hover:border-line" : ""}`}
                >
                  <span
                    className={`w-5 h-5 flex-shrink-0 rounded-full border flex items-center justify-center text-[11px] text-white ${
                      aan ? "bg-accent border-accent" : "border-app-line-strong bg-card"
                    }`}
                    aria-hidden
                  >
                    {aan ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{v.titel}</span>
                      {!v.beschikbaar && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted border border-line rounded px-1.5 py-0.5">
                          Binnenkort
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted mt-0.5">{v.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Stuksoort ── */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-ink">Soort stuk</h3>
          <p className="text-xs text-muted mt-0.5">Bepaalt de vaste secties</p>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {STUKSOORTEN.map((s) => {
              const aan = s.id === stuksoort;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStuksoort(s.id)}
                  aria-pressed={aan}
                  className={`text-left flex items-start gap-3 border rounded-xl p-3 transition-colors ${
                    aan ? "border-accent bg-accent/5" : "border-line hover:border-accent"
                  }`}
                >
                  <span
                    className={`w-5 h-5 flex-shrink-0 rounded-full border flex items-center justify-center text-[11px] text-white ${
                      aan ? "bg-accent border-accent" : "border-app-line-strong bg-card"
                    }`}
                    aria-hidden
                  >
                    {aan ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{s.titel}</span>
                    <span className="block text-xs text-muted mt-0.5">{s.uiHint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Onderwerp ── */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-ink">Onderwerp</h3>
          <p className="text-xs text-muted mt-0.5">Waar gaat het stuk over?</p>
          <input
            value={onderwerp}
            onChange={(e) => setOnderwerp(e.target.value)}
            placeholder="bv. Wijziging van het beleggingsbeleid"
            className="mt-3 w-full border border-app-line-strong rounded-xl px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {/* ── Bronstukken (alleen bij vertrekpunt 'fondsdocumenten') ── */}
        {vertrekpunt === "fondsdocumenten" && (
        <div className="p-4">
          <h3 className="text-sm font-semibold text-ink">Bronstukken</h3>
          <p className="text-xs text-muted mt-0.5">
            De documenten waarop het concept steunt — elke bewering krijgt een
            bronverwijzing
          </p>

          {documenten.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {documenten.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 border border-accent bg-accent/5 rounded-xl p-2.5"
                >
                  <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" aria-hidden />
                  <span className="min-w-0 text-sm text-ink truncate">{d.titel}</span>
                  <button
                    type="button"
                    onClick={() => toggleDoc(d)}
                    className="ml-auto text-xs text-muted hover:text-danger-ink flex-shrink-0"
                  >
                    verwijderen
                  </button>
                </div>
              ))}
            </div>
          )}

          {!kiezerOpen ? (
            <button
              type="button"
              onClick={() => {
                setKiezerOpen(true);
                setZoekterm("");
              }}
              className="mt-3 text-xs text-ink border border-line rounded-lg px-3 py-1.5 hover:border-accent transition-colors"
            >
              + Stuk toevoegen
            </button>
          ) : (
            <div className="mt-3">
              <input
                autoFocus
                value={zoekterm}
                onChange={(e) => setZoekterm(e.target.value)}
                placeholder="Zoek in de bibliotheek…"
                className="w-full border border-app-line-strong rounded-xl px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line">
                {suggesties.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted">
                    Geen document met deze titel gevonden.
                  </div>
                ) : (
                  suggesties.map((s) => {
                    const gekozen = documenten.some((x) => x.id === s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleDoc(s)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-app-bg transition-colors flex items-center gap-2 ${
                          gekozen ? "bg-accent/10" : ""
                        }`}
                      >
                        <span className="text-xs text-accent w-4" aria-hidden>
                          {gekozen ? "✓" : ""}
                        </span>
                        <span className="block text-sm text-ink truncate">{s.titel}</span>
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setKiezerOpen(false)}
                className="mt-2 text-xs text-muted hover:text-ink"
              >
                Klaar met kiezen
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ── Recap ── */}
      <div className="border border-line rounded-2xl bg-card p-4">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">
          Wat ik ga doen
        </div>
        <p className="text-sm text-ink mt-2">{recapTekst}</p>
        <div className="h-px bg-line my-3.5" />
        <p className="text-xs text-muted leading-relaxed">
          Het concept verschijnt in dit gesprek. De vraag
          {bronloos ? "" : ", de gebruikte bronnen"} en het antwoord worden
          vastgelegd in de Governance Log. U kunt het concept daarna exporteren naar
          Word; die export wordt apart geregistreerd.
        </p>
        <p className="text-xs text-muted mt-2 italic">
          Zo verschijnt uw vraag: “{bouwStukZin(stuksoort, onderwerp)}”
        </p>
        <div className="mt-3.5 flex flex-col gap-2">
          <button
            type="button"
            disabled={!magStarten}
            onClick={() => onStart(stuksoort, onderwerp, bronloos ? [] : documenten)}
            className="w-full text-center bg-accent text-white font-semibold rounded-xl px-4 py-2.5 hover:bg-accent-ink transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
          >
            Start →
          </button>
          <button
            type="button"
            onClick={onAnnuleren}
            className="w-full text-center text-ink border border-line rounded-xl px-4 py-2.5 hover:border-accent transition-colors"
          >
            Terug
          </button>
        </div>
      </div>
    </div>
  );
}
