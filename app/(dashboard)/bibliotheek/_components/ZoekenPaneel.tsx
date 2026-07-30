"use client";

// ============================================================================
//  ZoekenPaneel — uitgebreid (semantisch) zoeken binnen de Documentbibliotheek.
// ----------------------------------------------------------------------------
//  Increment H, verplaatst uit de losse /zoeken-pagina naar een herbruikbaar
//  component dat in de Documentbibliotheek leeft (knop "Uitgebreid zoeken").
//  Gedrag is ONGEWIJZIGD: dezelfde GET /api/zoeken, dezelfde retrieval-RPC's
//  (zoek_chunks / zoek_chunks_hybride, Increment G), dezelfde scope-vóór-ranking
//  en RLS (SECURITY INVOKER → tenant-isolatie blijft gelden). Resultaten per
//  document (max. 3 chunktreffers) gegroepeerd op procesinstantie (dossier).
// ============================================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { bronkaartLabels, isVeiligeUrl } from "@/core/lib/bronsoort";

interface Treffer {
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
}

interface ZoekResultaat {
  document_id: string;
  titel: string;
  bron: string;
  bibliotheek: string | null;
  procesinstantie_id: string | null;
  documentstatus: string | null;
  bronstatus: string | null;
  documentdatum: string | null;
  geldig_tot: string | null;
  bronorganisatie: string | null;
  normgewicht: string | null;
  extern_url: string | null;
  heeft_origineel: boolean;
  treffers: Treffer[];
}

interface Procesinstantie {
  id: string;
  titel: string;
}

interface ZoekMeta {
  methode: string;
  opgehaald: number;
  geselecteerd: number;
  modus: string;
}

type Modus = "alles" | "actueel" | "historisch";
type Bronsoort = "alles" | "fonds" | "generiek";

const MODUS_OPTIES: { waarde: Modus; label: string; uitleg: string }[] = [
  { waarde: "alles", label: "Alles", uitleg: "Actuele én historische documenten" },
  { waarde: "actueel", label: "Actueel", uitleg: "Alleen geldige documenten (op vandaag)" },
  { waarde: "historisch", label: "Historisch", uitleg: "Inclusief vervallen documenten" },
];

const BRONSOORT_OPTIES: { waarde: Bronsoort; label: string }[] = [
  { waarde: "alles", label: "Alle bronnen" },
  { waarde: "fonds", label: "Fondsdocumenten" },
  { waarde: "generiek", label: "Generiek / extern kader" },
];

const NIET_GEKOPPELD = "__niet_gekoppeld__";

export default function ZoekenPaneel({
  vasteBronsoort,
}: {
  /**
   * Bronsoort die van BUITEN wordt opgelegd (30-07-2026). De bibliotheek kent twee
   * tabs — Fondsbibliotheek en Generiek — en die tabs bepalen sinds deze wijziging
   * ook wat je doorzoekt. Is deze prop gezet, dan vervalt de eigen bronsoort-keuze:
   * twee bedieningselementen die hetzelfde doen leveren alleen verwarring op over
   * welke van de twee wint. Zonder prop (andere aanroepers) blijft het paneel zich
   * gedragen zoals voorheen, inclusief de dropdown.
   */
  vasteBronsoort?: Bronsoort;
} = {}) {
  const [q, setQ] = useState("");
  const [modus, setModus] = useState<Modus>("alles");
  const [bronsoort, setBronsoort] = useState<Bronsoort>(vasteBronsoort ?? "alles");
  const [procesinstantieFilter, setProcesinstantieFilter] = useState<string>("alles");

  const [resultaten, setResultaten] = useState<ZoekResultaat[]>([]);
  const [procesinstanties, setProcesinstanties] = useState<Procesinstantie[]>([]);
  const [meta, setMeta] = useState<ZoekMeta | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [laden, setLaden] = useState(false);
  const [gezocht, setGezocht] = useState(false);

  // Houd de aanvraagvolgorde bij zodat een trage respons een nieuwere niet overschrijft.
  const aanvraagTeller = useRef(0);

  const zoek = useCallback(
    async (
      zoekterm: string,
      huidigeModus: Modus,
      huidigeBronsoort: Bronsoort,
      huidigProces: string
    ) => {
      const term = zoekterm.trim();
      if (term.length < 2) {
        setResultaten([]);
        setProcesinstanties([]);
        setMeta(null);
        setMelding(term.length === 0 ? null : "Voer minimaal 2 tekens in.");
        setGezocht(false);
        return;
      }

      const ditNummer = ++aanvraagTeller.current;
      setLaden(true);
      setMelding(null);

      const params = new URLSearchParams({ q: term, modus: huidigeModus, bronsoort: huidigeBronsoort });
      // procesinstantie-filter wordt server-side toegepast (retrieval-scope).
      if (huidigProces !== "alles" && huidigProces !== NIET_GEKOPPELD) {
        params.set("procesinstantie", huidigProces);
      }

      try {
        const res = await fetch(`/api/zoeken?${params.toString()}`);
        const data = await res.json();
        if (ditNummer !== aanvraagTeller.current) return; // verouderde respons

        if (!res.ok) {
          setMelding(data?.error ?? "Zoeken is niet gelukt.");
          setResultaten([]);
          setProcesinstanties([]);
          setMeta(null);
        } else {
          setResultaten(data.resultaten ?? []);
          setProcesinstanties(data.procesinstanties ?? []);
          setMeta(data.meta ?? null);
          setMelding(data.melding ?? null);
        }
        setGezocht(true);
      } catch {
        if (ditNummer !== aanvraagTeller.current) return;
        setMelding("Er ging iets mis bij het zoeken. Probeer het opnieuw.");
      } finally {
        if (ditNummer === aanvraagTeller.current) setLaden(false);
      }
    },
    []
  );

  // Wisselt de gebruiker van tab, dan verandert `vasteBronsoort` en herhalen we de
  // lopende zoekopdracht meteen in de andere bibliotheek — zonder dat hij zijn
  // zoekterm opnieuw hoeft te typen. Staat er nog geen zoekterm, dan zetten we
  // alleen de scope; er wordt dan niets bevraagd.
  useEffect(() => {
    if (vasteBronsoort === undefined || vasteBronsoort === bronsoort) return;
    setBronsoort(vasteBronsoort);
    if (gezocht) zoek(q, modus, vasteBronsoort, procesinstantieFilter);
    // `zoek` is stabiel (useCallback met lege deps); de overige waarden zijn de
    // huidige filterstand die we ongewijzigd meenemen.
  }, [vasteBronsoort, bronsoort, gezocht, q, modus, procesinstantieFilter, zoek]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    zoek(q, modus, bronsoort, procesinstantieFilter);
  }

  // Een filterwijziging zoekt direct opnieuw (als er al een zoekterm staat).
  function wijzigModus(nieuw: Modus) {
    setModus(nieuw);
    if (gezocht) zoek(q, nieuw, bronsoort, procesinstantieFilter);
  }
  function wijzigBronsoort(nieuw: Bronsoort) {
    setBronsoort(nieuw);
    if (gezocht) zoek(q, modus, nieuw, procesinstantieFilter);
  }
  function wijzigProces(nieuw: string) {
    setProcesinstantieFilter(nieuw);
    if (gezocht) zoek(q, modus, bronsoort, nieuw);
  }

  // Groepeer de resultaten per procesinstantie (dossier) voor de weergave.
  const titelPerProces = new Map(procesinstanties.map((p) => [p.id, p.titel]));
  const groepen = new Map<string, ZoekResultaat[]>();
  for (const r of resultaten) {
    const sleutel = r.procesinstantie_id ?? NIET_GEKOPPELD;
    const lijst = groepen.get(sleutel) ?? [];
    lijst.push(r);
    groepen.set(sleutel, lijst);
  }
  const groepSleutels = [...groepen.keys()].sort((a, b) => {
    if (a === NIET_GEKOPPELD) return 1; // "niet gekoppeld" altijd onderaan
    if (b === NIET_GEKOPPELD) return -1;
    return (titelPerProces.get(a) ?? "").localeCompare(titelPerProces.get(b) ?? "");
  });

  return (
    <div>
      <p className="text-sm text-muted mb-4">
        Doorzoek de kennisbasis op de inhoud van documenten — dezelfde bronnen en
        relevantie als de AI-assistent, maar dan als doorzoekbare lijst.
      </p>

      {/* Zoekformulier */}
      <form onSubmit={onSubmit} className="space-y-3 mb-5">
        <div className="flex items-center gap-2 bg-white border border-line rounded-xl px-4 py-3">
          <span className="text-muted">🔎</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek op een woord of zin, bijv. ‘premievrijstelling bij arbeidsongeschiktheid’"
            className="flex-1 outline-none text-sm text-ink bg-transparent"
            autoFocus
          />
          <button
            type="submit"
            disabled={laden}
            className="bg-accent text-white font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-accent-ink transition-colors disabled:opacity-50"
          >
            {laden ? "Bezig…" : "Zoeken"}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-xs font-semibold text-muted mb-1">Tijdsperiode</div>
            <div className="flex gap-1 bg-app-bg p-1 rounded-lg w-fit">
              {MODUS_OPTIES.map((o) => (
                <button
                  key={o.waarde}
                  type="button"
                  onClick={() => wijzigModus(o.waarde)}
                  title={o.uitleg}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    modus === o.waarde
                      ? "bg-white text-ink shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {vasteBronsoort === undefined && (
            <div>
              <div className="text-xs font-semibold text-muted mb-1">Bronsoort</div>
              <select
                value={bronsoort}
                onChange={(e) => wijzigBronsoort(e.target.value as Bronsoort)}
                className="border border-line rounded-lg px-3 py-1.5 text-sm outline-none focus:border-accent bg-white"
              >
                {BRONSOORT_OPTIES.map((o) => (
                  <option key={o.waarde} value={o.waarde}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {procesinstanties.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted mb-1">Dossier</div>
              <select
                value={procesinstantieFilter}
                onChange={(e) => wijzigProces(e.target.value)}
                className="border border-line rounded-lg px-3 py-1.5 text-sm outline-none focus:border-accent bg-white max-w-[260px]"
              >
                <option value="alles">Alle dossiers</option>
                {procesinstanties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titel}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </form>

      {/* Meta-/relevantieregel */}
      {meta && gezocht && (
        <div className="text-xs text-muted mb-3">
          {resultaten.length} {resultaten.length === 1 ? "document" : "documenten"} gevonden ·{" "}
          {meta.methode === "hybride" ? "hybride zoeken (tekst + betekenis)" : "tekstzoeken"} ·{" "}
          {meta.opgehaald} fragmenten doorzocht
        </div>
      )}

      {/* Melding (bv. te korte zoekterm) */}
      {melding && (
        <div className="mb-4 bg-warn-tint border border-warn/30 rounded-lg px-4 py-3 text-sm text-warn-ink">
          {melding}
        </div>
      )}

      {/* Resultaten */}
      {laden ? (
        <div className="text-center py-12 text-muted">Zoeken…</div>
      ) : gezocht && resultaten.length === 0 && !melding ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔎</div>
          <h3 className="font-semibold text-ink mb-1">Geen resultaten</h3>
          <p className="text-sm text-muted">
            Geen documenten gevonden voor deze zoekterm en filters. Probeer andere
            bewoordingen of verruim de filters (bijv. tijdsperiode op ‘Alles’).
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groepSleutels.map((sleutel) => {
            const groep = groepen.get(sleutel)!;
            const dossierTitel =
              sleutel === NIET_GEKOPPELD
                ? "Niet aan een dossier gekoppeld"
                : titelPerProces.get(sleutel) ?? "Onbekend dossier";
            return (
              <div key={sleutel}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-muted text-sm">
                    {sleutel === NIET_GEKOPPELD ? "📄" : "📂"}
                  </span>
                  <h2 className="text-sm font-bold text-ink">{dossierTitel}</h2>
                  <span className="text-[11px] text-muted">({groep.length})</span>
                </div>
                <div className="space-y-2">
                  {groep.map((r) => (
                    <Resultaatkaart key={r.document_id} r={r} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Resultaatkaart({ r }: { r: ZoekResultaat }) {
  const labels = bronkaartLabels({
    bibliotheek: r.bibliotheek,
    normgewicht: r.normgewicht,
    geldig_tot: r.geldig_tot,
  });
  const externLink = isVeiligeUrl(r.extern_url) ? r.extern_url : null;

  return (
    <div className="bg-white border border-line rounded-xl p-4 hover:border-accent transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-app-bg rounded-lg flex items-center justify-center text-lg flex-shrink-0">
          📋
        </div>
        <div className="flex-1 min-w-0">
          {r.heeft_origineel ? (
            <a
              href={`/api/documents/${r.document_id}/bestand`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ink text-sm hover:text-accent transition-colors"
              title="Origineel openen"
            >
              {r.titel}
            </a>
          ) : (
            <div className="font-semibold text-ink text-sm">{r.titel}</div>
          )}

          {/* Metadatabadges */}
          <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold">
              {r.bron}
            </span>
            {labels.isGeneriek && (
              <span className="px-2 py-0.5 rounded-full bg-accent-tint text-accent-ink font-semibold border border-accent/30">
                {labels.bronsoortLabel}
              </span>
            )}
            {labels.isGeneriek && (
              <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold">
                {labels.normgewichtLabel}
              </span>
            )}
            {labels.vervallen && (
              <span className="px-2 py-0.5 rounded-full bg-err-tint text-err-ink font-semibold border border-err/30">
                {labels.vervallenLabel}
              </span>
            )}
            {r.documentstatus && (
              <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold">
                {r.documentstatus}
              </span>
            )}
            {r.bronorganisatie && <span>{r.bronorganisatie}</span>}
            {r.documentdatum && (
              <span>{new Date(r.documentdatum).toLocaleDateString("nl-NL")}</span>
            )}
            {externLink && (
              <a
                href={externLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline hover:text-accent font-semibold"
              >
                Externe bron ↗
              </a>
            )}
          </div>

          {/* Treffers (chunkfragmenten) */}
          <div className="mt-2 space-y-1.5">
            {r.treffers.map((t, i) => {
              const ankerLink =
                r.heeft_origineel && t.pagina
                  ? `/api/documents/${r.document_id}/bestand#page=${t.pagina}`
                  : null;
              return (
                <div
                  key={i}
                  className="text-xs text-muted bg-app-bg rounded-lg px-3 py-2 border border-line"
                >
                  <div className="flex items-center gap-2 mb-0.5 text-[11px] text-muted">
                    {t.pagina && (
                      <span>
                        {ankerLink ? (
                          <a
                            href={ankerLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent underline"
                          >
                            Pagina {t.pagina}
                          </a>
                        ) : (
                          <>Pagina {t.pagina}</>
                        )}
                      </span>
                    )}
                    {t.paragraaf && <span>· {t.paragraaf}</span>}
                  </div>
                  <span className="text-ink">{t.fragment}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
