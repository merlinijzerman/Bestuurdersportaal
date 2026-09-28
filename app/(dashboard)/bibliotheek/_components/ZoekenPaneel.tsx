"use client";

// ============================================================================
//  ZoekenPaneel — uitgebreid (semantisch) zoeken binnen de Documentbibliotheek.
// ----------------------------------------------------------------------------
//  Increment H, verplaatst uit de losse /zoeken-pagina naar een herbruikbaar
//  component dat in de Documentbibliotheek leeft (knop "Uitgebreid zoeken").
//  Dezelfde GET /api/zoeken, nu via de centrale retrievalorkestratie (#369),
//  met dezelfde scope-vóór-ranking en RLS (SECURITY INVOKER). Resultaten per
//  document (max. 3 chunktreffers) gegroepeerd op procesinstantie (dossier).
// ============================================================================

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
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
/**
 * #463 — WAAR je zoekt: in het portaal, in de gekoppelde SharePoint-bron of in
 * beide. Bewust een eigen as, los van {@link Bronsoort}: die betekent
 * fonds/generiek BINNEN de portaalretrieval en gaat als zodanig naar
 * /api/zoeken. Hergebruik zou die betekenis stil laten schuiven.
 */
export type Zoekbron = "alles" | "portaal" | "sharepoint";

const ZOEKBRON_OPTIES: { waarde: Zoekbron; label: string; uitleg: string }[] = [
  { waarde: "alles", label: "Alles", uitleg: "Portaaldocumenten én SharePoint" },
  { waarde: "portaal", label: "Portaal", uitleg: "Alleen documenten in het portaal (inhoud)" },
  { waarde: "sharepoint", label: "SharePoint", uitleg: "Alleen de gekoppelde SharePoint-map (naam, map en type)" },
];

interface SharePointHit {
  ref: string;
  naam: string;
  bestandstype: string | null;
  extensie: string | null;
  mappad: string;
  gewijzigdOp: string | null;
  previewMogelijk: boolean;
  webUrl: string | null;
}

type SharePointStand =
  | { status: "idle" }
  | { status: "laden" }
  | { status: "fout"; melding: string }
  | {
      status: "klaar";
      resultaten: SharePointHit[];
      totaal: number;
      boomAfgekapt: boolean;
      resultatenAfgekapt: boolean;
      map: string | null;
    };

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", docx: "Word", doc: "Word", pptx: "PowerPoint", ppt: "PowerPoint", xlsx: "Excel", xls: "Excel" };

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
  metSharePoint = false,
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
  /**
   * #463 — bied SharePoint als zoekbron aan (alleen op de fondstab). Of de bron
   * er werkelijk is, bepaalt de server: zonder actieve vlag of bron blijft het
   * paneel exact het bestaande portaalpaneel.
   */
  metSharePoint?: boolean;
} = {}) {
  const [q, setQ] = useState("");
  const [modus, setModus] = useState<Modus>("alles");
  const [bronsoort, setBronsoort] = useState<Bronsoort>(vasteBronsoort ?? "alles");
  const [procesinstantieFilter, setProcesinstantieFilter] = useState<string>("alles");
  const [zoekbron, setZoekbron] = useState<Zoekbron>("alles");
  const [sharepointBeschikbaar, setSharepointBeschikbaar] = useState(false);
  const [sharepoint, setSharepoint] = useState<SharePointStand>({ status: "idle" });

  const [resultaten, setResultaten] = useState<ZoekResultaat[]>([]);
  const [procesinstanties, setProcesinstanties] = useState<Procesinstantie[]>([]);
  const [meta, setMeta] = useState<ZoekMeta | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [laden, setLaden] = useState(false);
  const [gezocht, setGezocht] = useState(false);

  // Houd de aanvraagvolgorde bij zodat een trage respons een nieuwere niet overschrijft.
  const aanvraagTeller = useRef(0);
  // Aparte teller voor SharePoint: de twee bronnen lopen parallel en mogen
  // elkaars (verouderde) antwoorden niet wegpoetsen.
  const sharepointTeller = useRef(0);

  // Is er voor dit fonds een actieve SharePoint-bron? Alleen DB, geen Graph-call.
  useEffect(() => {
    if (!metSharePoint) return;
    let actief = true;
    void (async () => {
      try {
        const r = await fetch("/api/microsoft/sharepoint/status", { cache: "no-store" });
        const json = (await r.json().catch(() => null)) as { beschikbaar?: boolean; bron?: unknown } | null;
        if (actief) setSharepointBeschikbaar(Boolean(r.ok && json?.beschikbaar && json.bron));
      } catch {
        if (actief) setSharepointBeschikbaar(false);
      }
    })();
    return () => { actief = false; };
  }, [metSharePoint]);

  const sharepointActief = metSharePoint && sharepointBeschikbaar;
  const effectieveZoekbron: Zoekbron = sharepointActief ? zoekbron : "portaal";

  const zoekSharePoint = useCallback(async (term: string) => {
    const ditNummer = ++sharepointTeller.current;
    setSharepoint({ status: "laden" });
    try {
      const res = await fetch(`/api/microsoft/sharepoint/zoeken?${new URLSearchParams({ q: term }).toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (ditNummer !== sharepointTeller.current) return;
      if (!res.ok || !data) {
        setSharepoint({ status: "fout", melding: data?.error ?? "Zoeken in SharePoint is nu niet gelukt." });
      } else if (!data.beschikbaar) {
        setSharepointBeschikbaar(false);
        setSharepoint({ status: "idle" });
      } else {
        setSharepoint({
          status: "klaar",
          resultaten: data.resultaten ?? [],
          totaal: data.totaal ?? 0,
          boomAfgekapt: Boolean(data.boomAfgekapt),
          resultatenAfgekapt: Boolean(data.resultatenAfgekapt),
          map: data.bron?.map ?? null,
        });
      }
    } catch {
      if (ditNummer !== sharepointTeller.current) return;
      setSharepoint({ status: "fout", melding: "Zoeken in SharePoint is nu niet gelukt." });
    }
  }, []);

  const zoek = useCallback(
    async (
      zoekterm: string,
      huidigeModus: Modus,
      huidigeBronsoort: Bronsoort,
      huidigProces: string,
      huidigeZoekbron: Zoekbron = "portaal",
      alleenPortaal = false
    ) => {
      const term = zoekterm.trim();
      if (term.length < 2) {
        setResultaten([]);
        setProcesinstanties([]);
        setMeta(null);
        setMelding(term.length === 0 ? null : "Voer minimaal 2 tekens in.");
        setGezocht(false);
        sharepointTeller.current++;
        setSharepoint({ status: "idle" });
        return;
      }

      // SharePoint loopt los en parallel: een fout of timeout daar raakt de
      // portaalresultaten niet, en andersom.
      if (!alleenPortaal) {
        if (huidigeZoekbron !== "portaal") void zoekSharePoint(term);
        else { sharepointTeller.current++; setSharepoint({ status: "idle" }); }
      }

      if (huidigeZoekbron === "sharepoint") {
        aanvraagTeller.current++;
        setResultaten([]);
        setProcesinstanties([]);
        setMeta(null);
        setMelding(null);
        setLaden(false);
        setGezocht(true);
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
    [zoekSharePoint]
  );

  // Wisselt de gebruiker van tab, dan verandert `vasteBronsoort` en herhalen we de
  // lopende zoekopdracht meteen in de andere bibliotheek — zonder dat hij zijn
  // zoekterm opnieuw hoeft te typen. Staat er nog geen zoekterm, dan zetten we
  // alleen de scope; er wordt dan niets bevraagd.
  useEffect(() => {
    if (vasteBronsoort === undefined || vasteBronsoort === bronsoort) return;
    setBronsoort(vasteBronsoort);
    if (gezocht) zoek(q, modus, vasteBronsoort, procesinstantieFilter, effectieveZoekbron);
    // `zoek` is stabiel (useCallback op een stabiele zoekSharePoint); de overige
    // waarden zijn de huidige filterstand die we ongewijzigd meenemen.
  }, [vasteBronsoort, bronsoort, gezocht, q, modus, procesinstantieFilter, effectieveZoekbron, zoek]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    zoek(q, modus, bronsoort, procesinstantieFilter, effectieveZoekbron);
  }

  // Een filterwijziging zoekt direct opnieuw (als er al een zoekterm staat).
  // Filters die alleen de portaalretrieval raken (tijdsperiode, bronsoort,
  // dossier) laten een lopend SharePoint-resultaat ongemoeid.
  function wijzigModus(nieuw: Modus) {
    setModus(nieuw);
    if (gezocht) zoek(q, nieuw, bronsoort, procesinstantieFilter, effectieveZoekbron, true);
  }
  function wijzigBronsoort(nieuw: Bronsoort) {
    setBronsoort(nieuw);
    if (gezocht) zoek(q, modus, nieuw, procesinstantieFilter, effectieveZoekbron, true);
  }
  function wijzigProces(nieuw: string) {
    setProcesinstantieFilter(nieuw);
    if (gezocht) zoek(q, modus, bronsoort, nieuw, effectieveZoekbron, true);
  }
  function wijzigZoekbron(nieuw: Zoekbron) {
    setZoekbron(nieuw);
    if (gezocht) zoek(q, modus, bronsoort, procesinstantieFilter, nieuw);
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
        {sharepointActief && (
          <> In SharePoint zoekt u op bestandsnaam, map en bestandstype, live met uw eigen rechten.</>
        )}
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
            maxLength={200}
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
          {sharepointActief && (
            <div>
              <div className="text-xs font-semibold text-muted mb-1">Zoeken in</div>
              <div className="flex gap-1 bg-app-bg p-1 rounded-lg w-fit" role="group" aria-label="Zoekbron">
                {ZOEKBRON_OPTIES.map((o) => (
                  <button
                    key={o.waarde}
                    type="button"
                    onClick={() => wijzigZoekbron(o.waarde)}
                    title={o.uitleg}
                    aria-pressed={zoekbron === o.waarde}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      zoekbron === o.waarde
                        ? "bg-white text-ink shadow-sm"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {effectieveZoekbron !== "sharepoint" && (
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
          )}

          {vasteBronsoort === undefined && effectieveZoekbron !== "sharepoint" && (
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

          {procesinstanties.length > 0 && effectieveZoekbron !== "sharepoint" && (
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

      {effectieveZoekbron !== "sharepoint" && (
      <section aria-label="Portaalresultaten">
      {sharepointActief && gezocht && (
        <h2 className="text-sm font-bold text-ink mb-2 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted text-[11px] font-semibold">Portaal</span>
          Portaaldocumenten
        </h2>
      )}
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
      </section>
      )}

      {effectieveZoekbron !== "portaal" && sharepoint.status !== "idle" && (
        <SharePointResultaten stand={sharepoint} />
      )}
    </div>
  );
}

/** #463 — SharePoint-resultaten met eigen laad-, leeg-, fout- en afgekapt-
 * status. Staat los van het portaalblok: een SharePoint-fout laat de
 * portaalresultaten ongemoeid. Openen loopt via de bestaande veilige
 * preview (/bibliotheek/sharepoint/[ref]) of de Microsoft 365-link. */
function SharePointResultaten({ stand }: { stand: SharePointStand }) {
  return (
    <section aria-label="SharePoint-resultaten" className="mt-8">
      <h2 className="text-sm font-bold text-ink mb-2 flex items-center gap-2">
        <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted text-[11px] font-semibold border border-line">SharePoint</span>
        SharePoint-documenten
        {stand.status === "klaar" && stand.map && (
          <span className="text-[11px] font-normal text-muted">in {stand.map}</span>
        )}
      </h2>
      {stand.status === "laden" ? (
        <div className="text-sm text-muted py-4" role="status">SharePoint doorzoeken…</div>
      ) : stand.status === "fout" ? (
        <div className="bg-warn-tint border border-warn/30 rounded-lg px-4 py-3 text-sm text-warn-ink" role="status">
          {stand.melding} Eventuele portaalresultaten blijven gewoon zichtbaar.
        </div>
      ) : stand.status === "klaar" ? (
        <>
          <div className="text-xs text-muted mb-2">
            {stand.totaal} {stand.totaal === 1 ? "document" : "documenten"} gevonden op naam, map of type
            {stand.resultatenAfgekapt && ` · de eerste ${stand.resultaten.length} worden getoond, verfijn uw zoekterm`}
          </div>
          {stand.boomAfgekapt && (
            <div className="mb-2 text-xs text-muted" role="status">
              De SharePoint-map is groter dan het maximum dat in één keer kan worden doorzocht; niet alle documenten zijn meegenomen.
            </div>
          )}
          {stand.resultaten.length === 0 ? (
            <div className="text-sm text-muted py-4">Geen SharePoint-documenten gevonden voor deze zoekterm.</div>
          ) : (
            <div className="space-y-2">
              {stand.resultaten.map((d) => (
                <div key={d.ref} className="bg-white border border-line rounded-xl p-4 hover:border-accent transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {d.previewMogelijk ? (
                        <Link href={`/bibliotheek/sharepoint/${d.ref}`} className="font-semibold text-ink text-sm hover:text-accent transition-colors">
                          {d.naam}
                        </Link>
                      ) : (
                        <div className="font-semibold text-ink text-sm">{d.naam}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
                        <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold border border-line">SharePoint</span>
                        <span className="px-2 py-0.5 rounded-full bg-app-bg text-muted font-semibold">
                          {d.bestandstype ? TYPE_LABEL[d.bestandstype] ?? d.bestandstype.toUpperCase() : d.extensie ? d.extensie.toUpperCase() : "Bestand"}
                        </span>
                        <span className="truncate" title={d.mappad || "Hoofdmap"}>📁 {d.mappad || "Hoofdmap"}</span>
                        {d.gewijzigdOp && <span>{new Date(d.gewijzigdOp).toLocaleDateString("nl-NL")}</span>}
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-xs">
                      {d.previewMogelijk ? (
                        <Link href={`/bibliotheek/sharepoint/${d.ref}`} className="font-semibold text-accent hover:underline">Preview</Link>
                      ) : (
                        <span className="text-muted" title="Dit bestandstype kan niet in de browser worden getoond.">Geen preview</span>
                      )}
                      {d.webUrl && (
                        <a href={d.webUrl} target="_blank" rel="noopener noreferrer" className="ml-3 font-semibold text-accent hover:underline">Openen in Microsoft 365</a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
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
