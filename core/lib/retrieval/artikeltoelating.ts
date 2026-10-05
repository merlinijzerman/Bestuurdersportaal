// ============================================================================
//  #500 hotfix — toelating van het artikelspoor ZONDER `zoek_chunks`.
// ----------------------------------------------------------------------------
//  PUUR: geen I/O. Levert (1) het toelatingspredicaat op één rij en (2) de
//  PostgREST-filters voor de id-begrensde opvraging. De adapter (`rag.ts`,
//  `vulAanMetArtikelkandidaten`) voert de opvraging uit onder RLS.
//
//  WAAROM. Het artikelspoor liet nieuwe exacte passages toe via
//  `zoek_chunks(p_query => '"artikel 150d" OR "art 150d"', p_limit => 200,
//  p_document_ids => …)`. Op Productie eindigde die aanroep in 57014 (8 s
//  statement_timeout). `zoek_chunks` is `LANGUAGE sql` met `SET search_path`
//  en wordt dus nooit ingelijnd (generiek plan). In het CONCRETE plan
//  verhinderde de combinatie van de RLS-policy, de functievorm (`cross join
//  websearch_to_tsquery`) en het niet-leakproof `@@`-predicaat het GIN-pad:
//  een seq scan over alle 18.418 chunks, met `auth.uid()` per rij in de
//  SELECT-policy en een nested loop die `documenten` per chunkrij opnieuw
//  scande. Gemeten als authenticated: 3,9 s warm / 46k buffers.
//
//  WAT HIER STAAT. De opzoeking heeft de kandidaten al EXACT aangewezen (≤
//  `ARTIKEL_OPZOEK_MAX` id's). De toelating hoeft dus niet te zoeken, alleen te
//  FILTEREN: `document_chunks?id=in.(…)` onder RLS, met dezelfde frase-
//  voorwaarde (`zoek_vector @@ websearch_to_tsquery('dutch', frase)`, alleen
//  nog op die paar rijen) en EXPLICIET dezelfde filters als `zoek_chunks` +
//  `rpcFilterParams` + `p_fonds_id` + documentscope — gespiegeld op de laatste
//  definitie (supabase/migrations/2026_08_12_t4_regime_borging.sql §7a):
//
//    d.actief = true
//    c.documentstatus is distinct from 'gearchiveerd'
//    c.zoek_vector @@ websearch_to_tsquery('dutch', p_query)       (alleen DB)
//    p_document_ids is null or c.document_id = any(p_document_ids)
//    p_modus = 'actueel' ⇒ c.documentstatus in (vastgesteld, van_kracht)
//        and coalesce(c.bronstatus,'actief') = 'actief'
//        and (c.geldig_vanaf is null or c.geldig_vanaf <= p_peildatum)
//        and (c.geldig_tot   is null or c.geldig_tot   >= p_peildatum)
//    p_bronstatus          ⇒ coalesce(c.bronstatus,'actief') = any(…)
//    p_documentstatus      ⇒ c.documentstatus     = any(…)
//    p_procesinstantie_ids ⇒ c.procesinstantie_id = any(…)
//    p_bronsoort           ⇒ c.bibliotheek        = any(…)
//    p_fonds_id            ⇒ d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek'
//    c.bibliotheek is distinct from 'generiek' or (c.documentstatus = 'van_kracht'
//        and coalesce(c.bronstatus,'actief') = 'actief'
//        and (d.volgende_review is null or d.volgende_review >= p_peildatum))
//
//  Twee lagen, bewust dubbel:
//    - `toelatingsfilters` zet alles wat op de chunkrij of de documentrij
//      zelf staat als PostgREST-filter (de database weigert dus al);
//    - `voldoetAanZoekfilters` past de VOLLEDIGE set nog eens toe op elke
//      teruggekomen rij, inclusief de twee regels die een chunk- én een
//      documentkolom combineren (fonds, generiek-review). Dat predicaat is
//      gezaghebbend; RLS blijft daaronder de primaire tenantgrens en
//      `handhaafFondsdiscipline` daarboven de extra app-grens.
//
//  NULL-semantiek volgt SQL: `x = any(…)` met x NULL is NIET waar (weigeren);
//  `x is distinct from 'y'` met x NULL is waar (toelaten).
//
//  Peildatum: `zoek_chunks` valt zonder `p_peildatum` terug op `current_date`
//  van de database (UTC op Supabase). Hier is de peildatum altijd expliciet:
//  de aanroeper geeft `effectievePeildatum(filters)` (UTC-datum) mee.
// ============================================================================

/**
 * De filtervelden die `rpcFilterParams` (core/lib/rag.ts) naar `zoek_chunks`
 * stuurt. Structureel gelijk aan dat deel van `RetrievalFilters`; hier los
 * gedeclareerd zodat deze pure module de retrievalkern niet importeert (het
 * F4-censusregister blijft ongewijzigd).
 */
export interface Zoekfilters {
  modus?: string;
  peildatum?: string;
  bronstatus?: string[] | null;
  documentstatus?: string[] | null;
  procesinstantie_ids?: string[] | null;
  bronsoort?: string[] | null;
}

/** De bovengrens op het aantal id's per toelating (= de opzoeklimiet). */
export const ARTIKEL_TOELATING_ID_MAX = 50;

/** De kolommen die de toelating opvraagt (chunk + documentrij via inner join). */
export const TOELATING_SELECT =
  "id, document_id, tekst, pagina, paragraaf, chunk_index, documentstatus, bronstatus, documentdatum, " +
  "geldig_vanaf, geldig_tot, procesinstantie_id, bronorganisatie, normgewicht, extern_url, " +
  "wettelijk_regime, bibliotheek, " +
  "documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, volgende_review, actief)";

/** Eén rij zoals de toelatingsopvraging haar teruggeeft. */
export interface ToelatingsRij {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  documentstatus: string | null;
  bronstatus: string | null;
  documentdatum: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  procesinstantie_id: string | null;
  bronorganisatie: string | null;
  normgewicht: string | null;
  extern_url: string | null;
  wettelijk_regime: string | null;
  /** c.bibliotheek — de chunkkolom waarop `zoek_chunks` filtert. */
  bibliotheek: string | null;
  documenten: {
    titel: string;
    bron: string;
    /** d.bibliotheek — wat `zoek_chunks` teruggeeft als `bibliotheek`. */
    bibliotheek: string;
    opslag_pad: string | null;
    fonds_id: string | null;
    volgende_review: string | null;
    actief: boolean | null;
  } | null;
}

export interface Toelatingsparameters {
  /** De exact aangewezen chunk-id's (≤ `ARTIKEL_TOELATING_ID_MAX`). */
  ids: readonly string[];
  /** De frasequery (`artikelFrasequery`), alleen DB-zijdig toegepast. */
  frase: string | null;
  /** Documentscope van het spoor (`p_document_ids`); null = geen scope. */
  documentscope: readonly string[] | null;
  filters?: Zoekfilters;
  /** `p_fonds_id`; null = geen expliciete fondsfilter (RLS-only). */
  fondsId: string | null;
  /** De effectieve peildatum (ISO YYYY-MM-DD). */
  peildatum: string;
}

type Rij = Pick<
  ToelatingsRij,
  "id" | "document_id" | "documentstatus" | "bronstatus" | "geldig_vanaf" | "geldig_tot" | "procesinstantie_id" | "bibliotheek"
> & { documenten: Pick<NonNullable<ToelatingsRij["documenten"]>, "actief" | "fonds_id" | "volgende_review"> | null };

const bronstatusVan = (r: Rij): string => r.bronstatus ?? "actief";
/** SQL `x = any(lijst)`: NULL is nooit lid. */
const lid = (x: string | null, lijst: readonly string[]): boolean => x !== null && lijst.includes(x);

/**
 * De toelatingsregels, elk met een naam, zodat een test er één kan weglaten en
 * moet zien dat de pariteitsmatrix dan rood wordt (negatieve controle).
 */
export interface Toelatingsregel {
  naam: string;
  geldt(r: Rij, p: Toelatingsparameters): boolean;
}

export const TOELATINGSREGELS: readonly Toelatingsregel[] = [
  { naam: "exacte_id", geldt: (r, p) => p.ids.includes(r.id) },
  { naam: "document_actief", geldt: (r) => r.documenten?.actief === true },
  { naam: "niet_gearchiveerd", geldt: (r) => r.documentstatus !== "gearchiveerd" },
  { naam: "documentscope", geldt: (r, p) => p.documentscope === null || p.documentscope.includes(r.document_id) },
  {
    naam: "modus_actueel",
    geldt: (r, p) =>
      p.filters?.modus !== "actueel" ||
      (lid(r.documentstatus, ["vastgesteld", "van_kracht"]) &&
        bronstatusVan(r) === "actief" &&
        (r.geldig_vanaf === null || r.geldig_vanaf <= p.peildatum) &&
        (r.geldig_tot === null || r.geldig_tot >= p.peildatum)),
  },
  { naam: "bronstatus", geldt: (r, p) => !p.filters?.bronstatus || p.filters.bronstatus.includes(bronstatusVan(r)) },
  { naam: "documentstatus", geldt: (r, p) => !p.filters?.documentstatus || lid(r.documentstatus, p.filters.documentstatus) },
  {
    naam: "procesinstantie",
    geldt: (r, p) => !p.filters?.procesinstantie_ids || lid(r.procesinstantie_id, p.filters.procesinstantie_ids),
  },
  { naam: "bronsoort", geldt: (r, p) => !p.filters?.bronsoort || lid(r.bibliotheek, p.filters.bronsoort) },
  {
    naam: "fonds",
    geldt: (r, p) => p.fondsId === null || (r.documenten?.fonds_id ?? null) === p.fondsId || r.bibliotheek === "generiek",
  },
  {
    naam: "generiek_gepubliceerd",
    geldt: (r) => r.bibliotheek !== "generiek" || (r.documentstatus === "van_kracht" && bronstatusVan(r) === "actief"),
  },
  {
    naam: "generiek_review",
    geldt: (r, p) => {
      if (r.bibliotheek !== "generiek") return true;
      const review = r.documenten?.volgende_review ?? null;
      return review === null || review >= p.peildatum;
    },
  },
];

/** Het gezaghebbende predicaat: laat `zoek_chunks` (op de filters) deze rij toe? */
export function voldoetAanZoekfilters(
  r: Rij,
  p: Toelatingsparameters,
  regels: readonly Toelatingsregel[] = TOELATINGSREGELS
): boolean {
  return regels.every((regel) => regel.geldt(r, p));
}

// ── PostgREST-filters ───────────────────────────────────────────────────────

export type Toelatingsfilter =
  | { op: "in"; kolom: string; waarden: string[] }
  | { op: "eq"; kolom: string; waarde: boolean | string }
  | { op: "or"; expressie: string }
  | { op: "textSearch"; kolom: "zoek_vector"; query: string; config: "dutch"; type: "websearch" };

/** Een waarde binnen een `or=(…)`-expressie: altijd gequote, `"` en `\` ontsnapt. */
function q(waarde: string): string {
  return `"${waarde.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
const inLijst = (lijst: readonly string[]) => `(${lijst.map(q).join(",")})`;

/**
 * De DB-zijdige filters, in een vaste volgorde. Alles wat op één tabel staat,
 * zit erin; de twee regels die chunk- en documentkolom combineren (fonds,
 * generiek-review) staan in het predicaat. Zo weigert de database al wat hij
 * kan weigeren, en is de uitkomst ook bij een gedeeltelijke filterset exact.
 */
export function toelatingsfilters(p: Toelatingsparameters): Toelatingsfilter[] {
  const f = p.filters;
  const uit: Toelatingsfilter[] = [
    { op: "in", kolom: "id", waarden: [...new Set(p.ids)].sort() },
    { op: "eq", kolom: "documenten.actief", waarde: true },
    { op: "or", expressie: "documentstatus.is.null,documentstatus.neq.gearchiveerd" },
  ];
  // Een artikelmatch vergt ook een exacte frase; een afgebakende sectie heeft
  // al een exact document- en ID-bereik, en haar vervolgchunks hoeven de
  // paragraaftitel niet afzonderlijk te bevatten.
  if (p.frase !== null) uit.push({ op: "textSearch", kolom: "zoek_vector", query: p.frase, config: "dutch", type: "websearch" });
  if (p.documentscope !== null) uit.push({ op: "in", kolom: "document_id", waarden: [...p.documentscope] });
  if (f?.modus === "actueel") {
    uit.push(
      { op: "in", kolom: "documentstatus", waarden: ["vastgesteld", "van_kracht"] },
      { op: "or", expressie: "bronstatus.is.null,bronstatus.eq.actief" },
      { op: "or", expressie: `geldig_vanaf.is.null,geldig_vanaf.lte.${q(p.peildatum)}` },
      { op: "or", expressie: `geldig_tot.is.null,geldig_tot.gte.${q(p.peildatum)}` }
    );
  }
  if (f?.bronstatus) {
    uit.push(
      f.bronstatus.includes("actief")
        ? { op: "or", expressie: `bronstatus.is.null,bronstatus.in.${inLijst(f.bronstatus)}` }
        : { op: "in", kolom: "bronstatus", waarden: [...f.bronstatus] }
    );
  }
  if (f?.documentstatus) uit.push({ op: "in", kolom: "documentstatus", waarden: [...f.documentstatus] });
  if (f?.procesinstantie_ids) uit.push({ op: "in", kolom: "procesinstantie_id", waarden: [...f.procesinstantie_ids] });
  if (f?.bronsoort) uit.push({ op: "in", kolom: "bibliotheek", waarden: [...f.bronsoort] });
  // Generiek: gepubliceerd (chunkkolommen). De review-helft staat op de
  // documentrij en zit in het predicaat.
  uit.push({
    op: "or",
    expressie: "bibliotheek.is.null,bibliotheek.neq.generiek,and(documentstatus.eq.van_kracht,or(bronstatus.is.null,bronstatus.eq.actief))",
  });
  return uit;
}

/** Minimale builder-vorm (supabase-js PostgrestFilterBuilder) die de filters nodig hebben. */
export interface ToelatingsBuilder<T> {
  in(kolom: string, waarden: readonly string[]): T;
  eq(kolom: string, waarde: boolean | string): T;
  or(expressie: string): T;
  textSearch(kolom: string, query: string, opties: { config: string; type: "websearch" }): T;
}

/** Past de filters in volgorde toe op een PostgREST-builder. */
export function pasToelatingsfiltersToe<T extends ToelatingsBuilder<T>>(builder: T, filters: Toelatingsfilter[]): T {
  let b = builder;
  for (const f of filters) {
    if (f.op === "in") b = b.in(f.kolom, f.waarden);
    else if (f.op === "eq") b = b.eq(f.kolom, f.waarde);
    else if (f.op === "or") b = b.or(f.expressie);
    else b = b.textSearch(f.kolom, f.query, { config: f.config, type: f.type });
  }
  return b;
}
