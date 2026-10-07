// ============================================================================
//  #322 F4-T2-1 — Selectie, dedup en verrijking: het werk van de ORKESTRATIE.
// ----------------------------------------------------------------------------
//  Verplaatst uit `core/lib/rag.ts`, functioneel ongewijzigd. Besluit 0213
//  punt 5 en ontwerp §4.2 beleggen selectie, deduplicatie, citaatvorming en
//  contextbegrenzing bij de orkestratie; de adapter levert alleen kandidaten en
//  hun rangschikking (rerank + drempel blijven daar, beslissing D1).
//
//  EEN NUANCE, EXPLICIET. De bronsoort-weging en de regime-demotie zijn strikt
//  genomen rangschikking, maar zitten in `weegEnSelecteer` onlosmakelijk in
//  dezelfde stap als dedup en budget-afkap — ze delen de contrafeitelijke
//  selectie die de afvalreden "weging" van "budget" onderscheidt. Ze verhuizen
//  daarom mee. Ze losknippen zou een semantische herbouw zijn, en PR-A moet
//  aantoonbaar nul gedragsverschil opleveren.
//
//  `rag.ts` importeert dit tijdelijk terug zodat C5 (zoeken), C6 (vergelijk) en
//  C7 (AQLab) in PR-A ongewijzigd blijven draaien. T2-2 haalt die terugimport weg.
// ============================================================================
import type { RetrievalFilters, RetrievalMeta } from "../rag";

/**
 * De PROVIDERNEUTRALE kijk die de selectie nodig heeft. Bewust geen
 * `SelectieBron`: dan zou een Microsoftresultaat — dat geen chunk heeft — hier
 * niet doorheen komen en zou de selectie feitelijk Supabase-only zijn.
 * `bibliotheek`, `normgewicht` en `wettelijkRegime` zijn BRONBELEID-gegevens
 * (sectorcuratie en wettelijk regime), geen opslagvorm; ze horen daarom in de
 * neutrale laag thuis.
 */
export interface SelectieBron {
  id: string;
  document_id: string;
  tekst: string;
  rang?: number | null;
  titel: string;
  bibliotheek: string;
  normgewicht: string | null;
  wettelijkRegime: string | null;
  /**
   * R-3 (#492) — juridisch BRONBELEID-gegeven, providerneutraal: welke soort
   * bron dit is (`wetgeving`/`wetsgeschiedenis`/…) en, bij wetsgeschiedenis, het
   * subtype. Optioneel: een adapter zonder documenttype heeft geen juridische
   * rol en houdt het bestaande gedrag.
   */
  documenttype?: string | null;
  wetsgeschiedenisSubtype?: string | null;
  /**
   * #500 — het structuurlabel van de passage ("Artikelsgewijze toelichting —
   * Artikel 150d"), alleen gezet als de adapter het bij een artikelvraag heeft
   * opgehaald. Voedt uitsluitend de exacte-artikelboost.
   */
  structuurLabel?: string | null;
  /** #500 — de kandidaat kwam binnen via het gerichte artikelspoor van de adapter. */
  artikelspoor?: boolean;
  /**
   * #548-R5 — de adapter stelde vast dat de vraag dit juridische document
   * letterlijk noemt; bindt de artikelboost aan dat document.
   */
  genoemdDocument?: boolean;
}
import { weegBronsoort, constraintsVoorProfiel } from "../weeg-bronsoort";
import { weegRegime, isExternKaderVoorFonds } from "../weeg-regime";
import {
  selecteerMetConstraintsMetTrace,
  selecteerChunksMetTrace,
  type RepresentatieConstraints,
} from "../rag-select";
import { isStandaardZichtbaarInRag } from "../generiek-curatie";
import type { JuridischeVraagintentieResultaat } from "../vraagtype";
import {
  bepaalJuridischBeleid,
  herordenJuridisch,
  juridischeRolVan,
  type JuridischBeleidsbesluit,
} from "./juridisch-beleid";
import { boostArtikelpassages, type ArtikelBoost, type Artikelfocus } from "./artikelverwijzing";

// Verplaatst uit rag.ts: de enige aanroeper was weegEnSelecteer hieronder.
function filterZwakkeGeneriek(
  chunks: SelectieBron[],
  filters?: RetrievalFilters
): SelectieBron[] {
  if (filters?.toonZwakkeGeneriek) return chunks;
  return chunks.filter(
    (c) =>
      c.bibliotheek !== "generiek" ||
      isStandaardZichtbaarInRag(c.normgewicht)
  );
}

export type SelectieAfvalReden =
  | "weging"
  | "zwak_generiek"
  | "quotum"
  | "dedup"
  | "budget"
  // R-3 (#492) — alleen mogelijk als een juridisch beleid is toegepast.
  | "juridisch_gedemoveerd"
  | "juridisch_uitgesloten";

/** Selectie-diagnostiek voor retrieval_meta (T3). `selectie` is basis-niveau
 *  (telemetrie, geen identiteit); `selectie_kandidaten` draagt bronidentiteit. */
export interface SelectieDiagnostiek {
  selectie: NonNullable<RetrievalMeta["selectie"]>;
  selectie_kandidaten: NonNullable<RetrievalMeta["selectie_kandidaten"]>;
}

function isGeneriek(c: SelectieBron): boolean {
  return c.bibliotheek === "generiek";
}

type JuridischeSelectiediagnostiek = NonNullable<NonNullable<RetrievalMeta["selectie"]>["juridisch"]>;

/** R-3 — gesloten, inhoudsvrije telemetrie over het toegepaste juridisch beleid. */
function juridischeDiagnostiek(
  besluit: JuridischBeleidsbesluit,
  kandidaten: SelectieBron[],
  gekozen: Set<SelectieBron>,
  herordening: { uitgesloten: SelectieBron[]; gedemoveerd: Set<SelectieBron> },
  artikel: { focus: Artikelfocus; boost: ArtikelBoost<SelectieBron> } | null
): JuridischeSelectiediagnostiek {
  const perRol = (lijst: SelectieBron[]) => {
    const t = { wetgeving: 0, wetsgeschiedenis: 0 };
    for (const c of lijst) {
      const rol = juridischeRolVan(c.documenttype, c.wetsgeschiedenisSubtype);
      if (rol === "geldend_recht") t.wetgeving++;
      else if (rol === "wetsgeschiedenis") t.wetsgeschiedenis++;
    }
    return t;
  };
  return {
    beleid: besluit.beleid,
    poort: besluit.poort,
    kandidaten: perRol(kandidaten),
    geselecteerd: perRol(kandidaten.filter((c) => gekozen.has(c))),
    gedemoveerd: herordening.gedemoveerd.size,
    uitgesloten: herordening.uitgesloten.length,
    // #500 — alleen bij een artikelfocus; tellingen en een vlag, geen nummer of tekst.
    ...(artikel
      ? {
          artikel: {
            verwijzingen: artikel.focus.artikelen.length,
            wet_genoemd: artikel.focus.wet !== null,
            exact: artikel.boost.exact.length,
            geboost: artikel.boost.geboost.length,
            geboost_geselecteerd: artikel.boost.geboost.filter((c) => gekozen.has(c)).length,
            via_artikelspoor: kandidaten.filter((c) => c.artikelspoor === true).length,
            // #548-R5 — alleen bij een aan een genoemd document gebonden focus;
            // anders blijft de #500-diagnostiek byte-identiek.
            ...(artikel.boost.documentGenoemd
              ? { document_genoemd: true, andere_bron_gedemoveerd: artikel.boost.verdrongen.length }
              : {}),
          },
        }
      : {}),
  };
}

function weegEnSelecteer(
  gerangschikt: SelectieBron[],
  filters: RetrievalFilters | undefined,
  maxResults: number,
  maxPerDoc: number,
  constraintsAan: boolean,
  regimeAan: boolean,
  juridisch: JuridischBeleidsbesluit | null = null,
  artikelfocus: Artikelfocus | null = null
): { chunks: SelectieBron[]; diagnostiek: SelectieDiagnostiek } {
  const profiel = filters?.bronsoortprofiel;
  const libVan = (c: SelectieBron) => c.bibliotheek;

  // filters — §8.3 #6: zwakke generieke chunks vallen vóór de selectie af.
  const zichtbaar = filterZwakkeGeneriek(gerangschikt, filters);
  const zichtbaarSet = new Set(zichtbaar);

  // weging (bronsoort) — herordent alleen; behoudt de relevantievolgorde binnen groep.
  const bronGewogen = profiel
    ? weegBronsoort(zichtbaar, libVan, profiel)
    : zichtbaar;

  // T4 regime-demotie — de gereserveerde plek: ná de bronsoort-weging, vóór de
  // representatie-constraints. Demoveert chunks met een NIET-geldend (tegengesteld)
  // regime naar onderaan; `beide`/`algemeen`/NULL nooit. Geen harde uitsluiting.
  // weegRegime is een no-op als het fonds geen specifiek regime heeft, dus met
  // REGIME_WEGING uit óf een leeg/cross-cutting fondsregime is dit gedrag-neutraal.
  const regimeDemoveert =
    regimeAan && (filters?.primairRegime === "pw" || filters?.primairRegime === "wvb");
  const regimeGewogen = regimeDemoveert
    ? weegRegime(bronGewogen, (c) => c.wettelijkRegime, filters?.primairRegime)
    : bronGewogen;

  // R-3 (#492) — juridisch bronbeleid: ná de bronsoort- én de regimeweging. Een
  // door het regime gedemoveerde bron (PW↔Wvb) is voor dit beleid VAST en houdt
  // zijn plek onderaan; het beleid kan de regimeweging dus niet omzeilen.
  // Zonder beleid (`null`, ook bij een dichte poort) is dit exact de oude stap.
  const vastDoorRegime = (c: SelectieBron) =>
    regimeDemoveert && isExternKaderVoorFonds(c.wettelijkRegime, filters?.primairRegime);
  // #500 — exacte artikelpassage: bij een expliciet artikel (poort in
  // `bepaalArtikelfocus`) gaat per document de exact gelabelde juridische
  // passage vooraan, VÓÓR het juridisch beleid. Dat beleid bepaalt daarna de
  // rollen: bij een normvraag blijft wetsgeschiedenis achter de wet; bij een
  // bedoelingsvraag landt de exacte toelichting in de kop. Regime-gedemoveerde
  // bronnen blijven vast. Zonder focus of exacte kandidaat: dezelfde array.
  const artikelBoost =
    juridisch && artikelfocus
      ? boostArtikelpassages(
          regimeGewogen,
          artikelfocus,
          (c) => ({
            documentId: c.document_id,
            documenttype: c.documenttype,
            wetsgeschiedenisSubtype: c.wetsgeschiedenisSubtype,
            structuurLabel: c.structuurLabel,
            tekst: c.tekst,
            titel: c.titel,
            wettelijkRegime: c.wettelijkRegime,
            genoemdDocument: c.genoemdDocument,
          }),
          vastDoorRegime,
          // #548-R5 — bij een gebonden focus mag toelichting uit een ander
          // document alleen mee als het beleid om wetsgeschiedenis vraagt.
          { toelichtingToegestaan: juridisch.beleid !== "geldend_recht" }
        )
      : null;
  const herordening = juridisch
    ? herordenJuridisch(
        artikelBoost ? artikelBoost.volgorde : regimeGewogen,
        (c) => juridischeRolVan(c.documenttype, c.wetsgeschiedenisSubtype),
        juridisch.beleid,
        vastDoorRegime
      )
    : null;
  const gewogen = herordening ? herordening.volgorde : regimeGewogen;
  const uitgeslotenSet = new Set(herordening?.uitgesloten ?? []);

  // representatie-constraints → dedup → budget-afkap. De effectieve constraints
  // worden ALTIJD gelogd, ook bij flag-uit (alle minima 0 = huidig gedrag).
  const constraints: RepresentatieConstraints = constraintsAan
    ? constraintsVoorProfiel(profiel, { maxTotal: maxResults, maxPerSource: maxPerDoc })
    : { fondsMin: 0, generiekMin: 0, perSourceMin: 0, maxPerSource: maxPerDoc, maxTotal: maxResults };

  const trace = constraintsAan
    ? selecteerMetConstraintsMetTrace(gewogen, constraints, libVan)
    : selecteerChunksMetTrace(gewogen, maxResults, maxPerDoc);
  const gekozenSet = new Set(trace.gekozen);
  const redenVanGewogen = new Map(gewogen.map((c, i) => [c, trace.redenen[i]] as const));

  // Contrafeitelijke selectie op de PRE-weging volgorde: zinvol zodra de weging
  // daadwerkelijk demoveert — bronsoort (fonds/generiek; 'gecombineerd' herordent
  // niet) óf regime. `zichtbaar` is de volgorde zónder beide weging-stappen, zodat
  // een chunk die enkel door de weging afvalt op reden "weging" landt (niet budget).
  let zonderWegingSet: Set<SelectieBron> | null = null;
  if (profiel === "fonds" || profiel === "generiek" || regimeDemoveert) {
    const cf = constraintsAan
      ? selecteerMetConstraintsMetTrace(zichtbaar, constraints, libVan)
      : selecteerChunksMetTrace(zichtbaar, maxResults, maxPerDoc);
    zonderWegingSet = new Set(cf.gekozen);
  }

  // R-3 — contrafeitelijke selectie ZONDER alleen het juridisch beleid (wél met
  // bronsoort- en regimeweging). Valt een kandidaat enkel door dat beleid af,
  // dan is de reden `juridisch_gedemoveerd` en niet "weging" of "budget".
  let zonderJuridischSet: Set<SelectieBron> | null = null;
  if (herordening) {
    const cf = constraintsAan
      ? selecteerMetConstraintsMetTrace(regimeGewogen, constraints, libVan)
      : selecteerChunksMetTrace(regimeGewogen, maxResults, maxPerDoc);
    zonderJuridischSet = new Set(cf.gekozen);
  }

  // Kandidatenset vóór selectie = de volledige input van deze stap (incl. de
  // zwak_generiek-drops), zodat "opgehaald maar afgevallen" zichtbaar is.
  // De vijf bestaande sleutels staan er altijd; de twee juridische ALLEEN als
  // een beleid is toegepast — anders blijft de diagnostiek byte-identiek.
  const telling: Partial<Record<SelectieAfvalReden, number>> & Record<
    "weging" | "zwak_generiek" | "quotum" | "dedup" | "budget",
    number
  > = {
    weging: 0,
    zwak_generiek: 0,
    quotum: 0,
    dedup: 0,
    budget: 0,
    ...(herordening ? { juridisch_gedemoveerd: 0, juridisch_uitgesloten: 0 } : {}),
  };
  const perBib = { fonds: 0, generiek: 0 };

  const kandidaten = gerangschikt.map((c) => {
    const bibliotheek = c.bibliotheek;
    const rang = c.rang ?? null;
    if (gekozenSet.has(c)) {
      if (isGeneriek(c)) perBib.generiek++;
      else perBib.fonds++;
      return { document_id: c.document_id, bibliotheek, rang, status: "geselecteerd" as const };
    }
    let reden: SelectieAfvalReden;
    if (!zichtbaarSet.has(c)) {
      reden = "zwak_generiek";
    } else if (uitgeslotenSet.has(c)) {
      reden = "juridisch_uitgesloten";
    } else {
      const r = redenVanGewogen.get(c) ?? "budget";
      reden =
        r === "budget" && zonderJuridischSet?.has(c)
          ? "juridisch_gedemoveerd"
          : r === "budget" && zonderWegingSet?.has(c)
            ? "weging"
            : r;
    }
    telling[reden] = (telling[reden] ?? 0) + 1;
    return { document_id: c.document_id, bibliotheek, rang, status: "afgevallen" as const, reden };
  });

  return {
    chunks: trace.gekozen,
    diagnostiek: {
      selectie: {
        intent: profiel ?? null,
        regime: filters?.modus ?? "alles",
        constraints,
        geselecteerd_per_bibliotheek: perBib,
        afgevallen_telling: telling,
        ...(juridisch && herordening
          ? {
              juridisch: juridischeDiagnostiek(
                juridisch,
                gerangschikt,
                gekozenSet,
                herordening,
                artikelfocus && artikelBoost ? { focus: artikelfocus, boost: artikelBoost } : null
              ),
            }
          : {}),
      },
      selectie_kandidaten: kandidaten,
    },
  };
}

/** Chunk-vormige bron → neutrale selectieview. Eén plek, zodat rag.ts (C5/C6/C7)
 *  en de Supabase-adapter gegarandeerd dezelfde velden aanleveren. */
export function alsSelectieBron(c: {
  id: string;
  document_id: string;
  tekst: string;
  rang?: number | null;
  documenten: { titel: string; bibliotheek: string; normgewicht?: string | null; wettelijk_regime?: string | null };
}): SelectieBron {
  return {
    id: c.id,
    document_id: c.document_id,
    tekst: c.tekst,
    rang: c.rang ?? null,
    titel: c.documenten.titel,
    bibliotheek: c.documenten.bibliotheek,
    normgewicht: c.documenten.normgewicht ?? null,
    wettelijkRegime: c.documenten.wettelijk_regime ?? null,
  };
}

/**
 * De selectiehelft van de oude `naVerwerking`: weging+selectie, de
 * ilike-uitsluiting (B1) en parent-retrieval (D). Draait op de door de adapter
 * gerangschikte kandidaten.
 */
export async function selecteerEnVerrijk(
  kandidaten: SelectieBron[],
  methode: RetrievalMeta["methode"],
  ctx: {
    filters: RetrievalFilters | undefined;
    maxResults: number;
    maxPerDoc: number;
    representatieConstraints: boolean;
    regimeWeging: boolean;
    relevantieDrempel: boolean;
    /**
     * R-3 (#492) — de R-2-intentie van de beurt. De POORT zit hier, centraal
     * (`bepaalJuridischBeleid`); ontbreekt de intentie of blijft de poort dicht,
     * dan is de selectie exact die van vóór R-3.
     */
    juridischeIntentie?: JuridischeVraagintentieResultaat | null;
    /**
     * #500 — de artikelfocus van dit spoor (`bepaalArtikelfocus`, dezelfde poort).
     * Ontbreekt zij, dan is de selectie exact die van vóór #500.
     */
    artikelfocus?: Artikelfocus | null;
  }
): Promise<{ chunks: SelectieBron[]; extra: Partial<RetrievalMeta> }> {
  const extra: Partial<RetrievalMeta> = {};
  const opties = ctx;
  const filters = ctx.filters;
  const maxResults = ctx.maxResults;
  const maxPerDoc = ctx.maxPerDoc;

  // Bronsoort-weging (+ evt. representatie-constraints) + dedup + top-N; werkt op
  // de nieuwe volgorde. De constraint-laag staat achter opties.representatieConstraints.
  // T3 — de selectie-diagnostiek (constraints + kandidaten + drop-redenen) reflecteert
  // deze weeg+select-stap; hij wordt additief in retrieval_meta vastgelegd.
  const sel = weegEnSelecteer(
    kandidaten,
    filters,
    maxResults,
    maxPerDoc,
    opties.representatieConstraints,
    opties.regimeWeging,
    bepaalJuridischBeleid(opties.juridischeIntentie),
    opties.artikelfocus ?? null
  );
  let geselecteerd = sel.chunks;
  extra.selectie = sel.diagnostiek.selectie;
  extra.selectie_kandidaten = sel.diagnostiek.selectie_kandidaten;

  // B1 — ilike-treffers zijn NOOIT citeerbaar: uit de prompt-set gehaald, alleen
  // als audit vastgelegd. Leeg resultaat valt op het bestaande geen-treffers-pad.
  if (opties.relevantieDrempel && methode === "ilike" && geselecteerd.length > 0) {
    extra.zwakke_bronbasis = true;
    extra.mogelijk_gerelateerd = geselecteerd.map((c) => ({
      document_id: c.document_id,
      titel: c.titel,
    }));
    geselecteerd = [];
  }

  // D — parent-retrieval is PROVIDERSPECIFIEK (het haalt siblings uit
  // document_chunks) en is daarom een adapterhook: `verrijkSelectie()`. De
  // orkestratie roept die aan direct ná deze selectie, per spoor, zodat de
  // volgorde identiek blijft aan vóór T2-1.

  return { chunks: geselecteerd, extra };
}
