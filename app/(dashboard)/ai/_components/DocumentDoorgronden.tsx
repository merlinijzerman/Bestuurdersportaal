"use client";

// ============================================================================
//  "Een document doorgronden" — scherpsteltoestand binnen /ai (P2 Deel B).
// ----------------------------------------------------------------------------
//  Stelt de opdracht scherp vóór de assistent begint: één document (kiezer
//  hergebruikt uit de bestaande typeahead), de gewenste secties, en een recap.
//  Géén eigen route (bewust: geen browser-terug, geen deeplink) — dit is een
//  toestand in AssistentClient. Na "Start" landt de gebruiker in het gewone
//  chatvenster met een leesbare gebruikersbeurt (B5).
//
//  Alle sectielogica (beschikbaarheid, startvoorwaarde, de zichtbare zin) komt
//  uit core/lib/doorgrond.ts — één bron van waarheid, gedeeld met de route en
//  de eval. Dit component doet alleen UI + de twee reeds bestaande queries via
//  door de ouder aangereikte callbacks (geen tweede zoekimplementatie).
// ============================================================================

import { useEffect, useState } from "react";
import {
  DOORGROND_SECTIES,
  magDoorgronden,
  sectieBeschikbaar,
  bouwDoorgrondZin,
  type DoorgrondSectieId,
} from "@/core/lib/doorgrond";

export interface DoorgrondDoc {
  id: string;
  titel: string;
  // Datum van toevoegen (documenten.aangemaakt). Optioneel: `initieelDoc` en de
  // vorige-versie-lookup leveren hem niet, de kiezer-suggesties (zoekDocumenten)
  // wél — daar tonen en sorteren we erop.
  aangemaakt?: string | null;
}

export default function DocumentDoorgronden({
  initieelDoc,
  laden,
  zoekDocumenten,
  haalVorigeVersie,
  onStart,
  onAnnuleren,
}: {
  initieelDoc: DoorgrondDoc;
  laden: boolean;
  zoekDocumenten: (q: string) => Promise<DoorgrondDoc[]>;
  haalVorigeVersie: (docId: string) => Promise<DoorgrondDoc | null>;
  onStart: (
    doc: DoorgrondDoc,
    secties: DoorgrondSectieId[],
    vorige: DoorgrondDoc | null
  ) => void;
  onAnnuleren: () => void;
}) {
  const [doc, setDoc] = useState<DoorgrondDoc>(initieelDoc);
  const [vorige, setVorige] = useState<DoorgrondDoc | null>(null);
  const [kiezerOpen, setKiezerOpen] = useState(false);
  const [zoekterm, setZoekterm] = useState("");
  const [suggesties, setSuggesties] = useState<DoorgrondDoc[]>([]);
  // Default: Samenvatting + Bestuurlijke aandachtspunten aan (mockup).
  const [gekozen, setGekozen] = useState<Set<DoorgrondSectieId>>(
    new Set<DoorgrondSectieId>(["samenvatting", "aandachtspunten"])
  );

  const heeftVorige = vorige !== null;

  // Bepaal de eerdere versie van het gekozen document (besluitpunt 2). Zet bij
  // een documentwissel "Afwijkingen" uit als er geen voorganger (meer) is.
  useEffect(() => {
    let geannuleerd = false;
    haalVorigeVersie(doc.id)
      .then((v) => {
        if (geannuleerd) return;
        setVorige(v);
        if (!v) {
          setGekozen((s) => {
            if (!s.has("afwijkingen")) return s;
            const kopie = new Set(s);
            kopie.delete("afwijkingen");
            return kopie;
          });
        }
      })
      .catch(() => {
        if (!geannuleerd) setVorige(null);
      });
    return () => {
      geannuleerd = true;
    };
  }, [doc.id, haalVorigeVersie]);

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

  function kiesDoc(d: DoorgrondDoc) {
    setDoc(d);
    setKiezerOpen(false);
    setZoekterm("");
  }

  function toggleSectie(id: DoorgrondSectieId) {
    if (!sectieBeschikbaar(id, heeftVorige)) return;
    setGekozen((s) => {
      const kopie = new Set(s);
      if (kopie.has(id)) kopie.delete(id);
      else kopie.add(id);
      return kopie;
    });
  }

  const gekozenLijst = DOORGROND_SECTIES.filter((s) => gekozen.has(s.id)).map(
    (s) => s.id
  );
  const magStarten = magDoorgronden(gekozenLijst, heeftVorige) && !laden;

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
          Een document doorgronden
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
        Stel de opdracht scherp voordat ik begin. Zo hoeft u geen goede vraag te
        formuleren — u kiest wat u nodig heeft.
      </p>

      <div className="border border-line rounded-2xl bg-card divide-y divide-line">
        {/* ── Document ── */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-ink">Document</h3>
          <p className="text-xs text-muted mt-0.5">Waarop deze taak wordt uitgevoerd</p>

          {!kiezerOpen ? (
            <div className="mt-3 flex items-center gap-3 border border-accent bg-accent/5 rounded-xl p-3">
              <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{doc.titel}</div>
                <div className="text-xs text-muted mt-0.5">
                  {doc.id === initieelDoc.id
                    ? "automatisch gekozen op basis van wat nu speelt"
                    : heeftVorige
                      ? `eerdere versie aanwezig: «${vorige!.titel}»`
                      : "geen eerdere versie in de bibliotheek"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setKiezerOpen(true);
                  setZoekterm("");
                }}
                className="ml-auto text-xs text-ink border border-line rounded-lg px-3 py-1.5 hover:border-accent transition-colors flex-shrink-0"
              >
                wijzigen
              </button>
            </div>
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
                  // Meest recent toegevoegd bovenaan. De bron levert al gesorteerd
                  // aan; deze sort borgt de volgorde ook als dat ooit verandert.
                  [...suggesties]
                    .sort((a, b) => {
                      const ta = a.aangemaakt ? new Date(a.aangemaakt).getTime() : 0;
                      const tb = b.aangemaakt ? new Date(b.aangemaakt).getTime() : 0;
                      return tb - ta;
                    })
                    .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => kiesDoc(s)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-app-bg transition-colors ${
                        s.id === doc.id ? "bg-accent/10" : ""
                      }`}
                    >
                      <span className="block text-sm text-ink truncate">{s.titel}</span>
                      {s.aangemaakt && (
                        <span className="block text-xs text-muted mt-0.5">
                          Toegevoegd{" "}
                          {new Date(s.aangemaakt).toLocaleDateString("nl-NL")}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Secties ── */}
        <div className="p-4">
          <h3 className="text-sm font-semibold text-ink">Wat wilt u terugkrijgen</h3>
          <p className="text-xs text-muted mt-0.5">
            Elk onderdeel wordt een eigen kop in het antwoord
          </p>
          <div className="mt-3 space-y-2">
            {DOORGROND_SECTIES.map((s) => {
              const geblokkeerd = !sectieBeschikbaar(s.id, heeftVorige);
              const aan = gekozen.has(s.id);
              const hint = geblokkeerd
                ? "Niet beschikbaar — er staat geen eerdere versie van dit stuk in de bibliotheek."
                : s.vereistVorigeVersie && heeftVorige
                  ? `${s.uiHint} Vergeleken met «${vorige!.titel}».`
                  : s.uiHint;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSectie(s.id)}
                  disabled={geblokkeerd}
                  aria-pressed={aan}
                  className={`w-full text-left flex items-start gap-3 border rounded-xl p-3 transition-colors ${
                    geblokkeerd
                      ? "opacity-55 cursor-not-allowed bg-app-bg border-line"
                      : aan
                        ? "border-accent bg-accent/5"
                        : "border-line hover:border-accent"
                  }`}
                >
                  <span
                    className={`w-5 h-5 flex-shrink-0 rounded-md border flex items-center justify-center text-[11px] text-white ${
                      aan ? "bg-accent border-accent" : "border-app-line-strong bg-card"
                    }`}
                    aria-hidden
                  >
                    {aan ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{s.titel}</span>
                    <span className="block text-xs text-muted mt-0.5">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Recap ── */}
      <div className="border border-line rounded-2xl bg-card p-4">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">
          Wat ik ga doen
        </div>
        <p className="text-sm text-ink mt-2">
          {gekozenLijst.length === 0
            ? "Kies minstens één onderdeel — anders weet ik niet wat ik moet opleveren."
            : `Ik voer deze taak uit op «${doc.titel}» en lever ${gekozenLijst.length} ${
                gekozenLijst.length === 1 ? "sectie" : "secties"
              }.`}
        </p>
        {gekozenLijst.length > 0 && (
          <ul className="mt-2 space-y-1">
            {DOORGROND_SECTIES.filter((s) => gekozen.has(s.id)).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm text-ink">
                <span className="text-ok-ink text-xs" aria-hidden>
                  ✓
                </span>
                {s.titel}
              </li>
            ))}
          </ul>
        )}
        <div className="h-px bg-line my-3.5" />
        <p className="text-xs text-muted leading-relaxed">
          Het antwoord verschijnt in dit gesprek en blijft bewaard bij uw gesprekken. De
          vraag, de gebruikte bronnen en het antwoord worden vastgelegd in de Governance
          Log. Tijdens het opstellen ziet u per stap wat er gebeurt.
        </p>
        {gekozenLijst.length > 0 && (
          <p className="text-xs text-muted mt-2 italic">
            Zo verschijnt uw vraag: “{bouwDoorgrondZin(doc.titel, gekozenLijst)}”
          </p>
        )}
        <div className="mt-3.5 flex flex-col gap-2">
          <button
            type="button"
            disabled={!magStarten}
            onClick={() => onStart(doc, gekozenLijst, heeftVorige ? vorige : null)}
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
