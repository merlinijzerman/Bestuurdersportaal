// ============================================================================
//  core/lib/audit-meta.ts — Plateau A / A-7 (D-8): metadata-allowlist als
//  bindend contract voor `governance_log.retrieval_meta`.
// ----------------------------------------------------------------------------
//  WAAROM DIT BESTAAT
//
//  Plateau A scheidt spoor en inhoud: `vraag`, `antwoord` en `bronnen` verhuizen
//  naar `governance_log_inhoud` (verwijderbaar). Zonder deze allowlist is die
//  scheiding cosmetisch, want `retrieval_meta` draagt zélf inhoud:
//
//    • `zoekvraag`      — de (soms geherformuleerde) vraag van de gebruiker
//    • `sources[]`      — AssistantSourceDocument.fragment is letterlijke
//                         documenttekst; AssistantSourceWeb.snippet idem
//    • `scope.titels`   — documenttitels uit de gekozen scope
//    • `terugval`       — de gebruikte zoektermen en -query
//    • `jargon_expansie`— de geëxpandeerde zoektermen
//
//  De vraag zou dus gewoon in een append-only, breed leesbaar jsonb-veld blijven
//  staan. Deze module is daarom de dragende maatregel, niet een bijzaak.
//
//  DRIE NIVEAUS
//
//    basis  — operationele telemetrie. Geen inhoud, geen bronidentiteit.
//             Zichtbaar voor iedereen met `governance_audit_read`.
//    bron   — bronIDENTITEIT (document_id, bron, bibliotheek, statussen).
//             Alleen met `governance_audit_read_sources`.
//    inhoud — letterlijke tekst van gebruiker, antwoord of document. Gaat NIET
//             naar `governance_log.retrieval_meta` maar naar
//             `governance_log_inhoud.retrieval_meta_inhoud`, en is daarmee
//             verwijderbaar met het gesprek.
//
//  FAIL-CLOSED: een sleutel die hier niet is geclassificeerd geldt als `inhoud`.
//  Een nieuw veld in RetrievalMeta belandt dus automatisch aan de veilige kant
//  én laat `audit-meta.sanity.ts` falen, zodat de keuze bewust wordt gemaakt.
//
//  LET OP — P5-KOPPELING. De monitoringsignalen lezen rechtstreeks uit
//  `governance_log.retrieval_meta` met de service-role (platform/lib/
//  monitoring-health.ts, monitoring-queries.ts). Deze sleutels MOETEN in `basis`
//  blijven, anders vallen signaal 3, 4 en 6 stil zonder foutmelding:
//    embedding_query_success · duur_model_ms · geselecteerd · zwakke_bronbasis
//    verduidelijking · tokens
//  De sanitytest pint dat vast.
//
//  SPIEGELING IN SQL. `meta_basisniveau()` en `meta_bronniveau()` in de migratie
//  passen dezelfde allowlist toe bij het LEZEN. Dat is geen dubbeling maar een
//  tweede noodzaak: rijen van vóór deze wijziging zijn nooit door de schrijfkant
//  gegaan en worden alleen door de leesprojectie afgeschermd. Beide kanten zijn
//  daarom allowlist-gebaseerd — nooit strip-gebaseerd, want een striplijst kent
//  de sleutels van gisteren niet.
//
//  Pure functies, geen DB-toegang. Getest via core/lib/audit-meta.sanity.ts.
// ============================================================================

export type MetaNiveau = "basis" | "bron" | "inhoud";

/**
 * Operationele telemetrie. Geen inhoud, geen bronidentiteit.
 * Blijft in `governance_log.retrieval_meta` en is zichtbaar met
 * `governance_audit_read`.
 */
export const META_BASIS = [
  // retrieval-uitvoering
  "methode",
  "opgehaald",
  "geselecteerd",
  "embedding_query_success",
  "fallback_reason",
  "rerank",
  "drempel",
  "zwakke_bronbasis",
  "parent",
  // fondsdiscipline (defense-in-depth, increment T4)
  "toegepaste_fonds_filter",
  "namespace_conventie",
  "fondsdiscipline_gedropt",
  "body_fonds_id_genegeerd",
  // presentatie- en moduslaag
  "antwoordmodus",
  "transformatie",
  "bronbasis",
  "inline_meldingen",
  "citaties",
  "source_summary",
  // automatische bronkeuze (increment I-2)
  "bron_intent",
  "bron_vertrouwen",
  "bron_modus_auto",
  "alleen_fondsdocumenten",
  "bron_intent_override",
  "bron_intent_bron",
  "bron_intent_herkomst",
  "portaalstand_gebruikt",
  // profiel- en organisatiesturing (alleen status + veldgroepen, geen inhoud)
  "profielsturing",
  "profielsturing_aspecten",
  "organisatieprofiel",
  "organisatieprofiel_aspecten",
  // signaalvelden
  "startvraag_bron",
  "niet_vastgesteld",
  "verduidelijking",
  "geen_modelcall",
  "context_geneutraliseerd",
  "gereformuleerd",
  // P5-telemetrie — zie de waarschuwing in de header
  "duur_ms",
  "duur_model_ms",
  "tokens",
  "tokendekking",
  // gemengde objecten: hun bron-/inhoudsleutels worden door SUB_NIVEAUS afgesplitst
  "scope",
  "invoer",
  "filters",
  "web",
  "markeringen",
] as const;

/**
 * BronIDENTITEIT: welk document, welke versie, welke status. Geen letterlijke
 * tekst. Blijft in `governance_log.retrieval_meta`, maar is alleen zichtbaar
 * met `governance_audit_read_sources`.
 */
export const META_BRON = [
  "chunks",
  "bronversie_audit",
  "besluitbronnen",
  "mogelijk_gerelateerd",
  "doorgrond",
  // T2 — bureau-stand ("Een stuk voorbereiden"). Draagt taak/stuksoort/secties/
  // bronbereik/promptvariant/rol_context: taak- en sectie-IDENTITEIT, géén
  // documenttekst en géén gebruikersvraag. Zelfde niveau als `doorgrond`.
  "bureau",
  "herkomst",
] as const;

/**
 * Letterlijke tekst van gebruiker, antwoord of document. Verhuist naar
 * `governance_log_inhoud.retrieval_meta_inhoud` en is daarmee verwijderbaar.
 *
 * `sources` staat hier bewust en niet bij `bron`: AssistantSourceDocument draagt
 * een `fragment` met documenttekst en AssistantSourceWeb een `snippet`. De
 * bronidentiteit die een auditor nodig heeft zit in `bronversie_audit` en
 * `chunks`, die géén tekst dragen.
 */
export const META_INHOUD = [
  "zoekvraag",
  "sources",
  "terugval",
  "jargon_expansie",
] as const;

/**
 * Objecten die sleutels van meerdere niveaus mengen. Alles wat hier niet wordt
 * genoemd geldt binnen zo'n object als `basis`.
 *
 * Deze lijst wordt in SQL gespiegeld met `jsonb - 'sleutel'` in
 * `meta_basisniveau()` / `meta_bronniveau()`, zodat ook rijen van vóór plateau A
 * bij het lezen worden ontdaan van hun inhoudsleutels.
 */
export const SUB_NIVEAUS: Record<string, { bron?: string[]; inhoud?: string[] }> = {
  // document_ids = identiteit; titels = documenttitels (inhoud)
  scope: { bron: ["document_ids"], inhoud: ["titels"] },
  // beurten/tekens zijn telemetrie; historie_hash is een vingerafdruk van de
  // gespreksinhoud en hoort daarom bij het verwijderbare deel
  invoer: { inhoud: ["historie_hash"] },
  // procesinstantie_ids zijn objectreferenties
  filters: { bron: ["procesinstantie_ids"] },
  // domeinen en URL's zijn bronidentiteit; tellingen en foutcode zijn telemetrie
  web: { bron: ["gebruikte_bronnen", "bevraagde_domeinen"] },
  // instanties (DNB/AFM/…) komen letterlijk uit het antwoord
  markeringen: { bron: ["instanties"] },
};

/** Alle expliciet geclassificeerde topsleutels. */
export const META_BEKEND: ReadonlySet<string> = new Set<string>([
  ...META_BASIS,
  ...META_BRON,
  ...META_INHOUD,
]);

const BASIS_SET: ReadonlySet<string> = new Set<string>(META_BASIS);
const BRON_SET: ReadonlySet<string> = new Set<string>(META_BRON);

/**
 * Niveau van één topsleutel. Onbekend ⇒ `inhoud` (fail-closed).
 */
export function niveauVan(sleutel: string): MetaNiveau {
  if (BASIS_SET.has(sleutel)) return "basis";
  if (BRON_SET.has(sleutel)) return "bron";
  return "inhoud";
}

type JsonObject = Record<string, unknown>;

function isObject(waarde: unknown): waarde is JsonObject {
  return typeof waarde === "object" && waarde !== null && !Array.isArray(waarde);
}

export interface GesplitsteMeta {
  /** Gaat naar `governance_log.retrieval_meta` — basis + bron, geen inhoud. */
  spoor: JsonObject;
  /** Gaat naar `governance_log_inhoud.retrieval_meta_inhoud` — verwijderbaar. */
  inhoud: JsonObject;
  /**
   * Topsleutels die niet in META_BEKEND staan. Ze zijn fail-closed in `inhoud`
   * beland; de sanitytest faalt hierop zodat een nieuw veld bewust wordt
   * geclassificeerd in plaats van stilzwijgend mee te liften.
   */
  onbekend: string[];
}

/**
 * Splitst een `RetrievalMeta`-object in het deel dat in het append-only
 * auditspoor blijft en het deel dat met het gesprek verwijderbaar is.
 *
 * Gemengde objecten (zie SUB_NIVEAUS) worden per subsleutel gesplitst: het
 * object verschijnt dan in beide helften, elk met alleen de eigen sleutels. Een
 * helft die daardoor leeg zou worden, wordt weggelaten.
 */
export function splitsRetrievalMeta(meta: unknown): GesplitsteMeta {
  const spoor: JsonObject = {};
  const inhoud: JsonObject = {};
  const onbekend: string[] = [];

  if (!isObject(meta)) return { spoor, inhoud, onbekend };

  for (const [sleutel, waarde] of Object.entries(meta)) {
    if (waarde === undefined) continue;

    if (!META_BEKEND.has(sleutel)) {
      onbekend.push(sleutel);
      inhoud[sleutel] = waarde;
      continue;
    }

    const sub = SUB_NIVEAUS[sleutel];
    if (sub && isObject(waarde)) {
      const inhoudSubs = new Set(sub.inhoud ?? []);
      const spoorDeel: JsonObject = {};
      const inhoudDeel: JsonObject = {};
      for (const [subSleutel, subWaarde] of Object.entries(waarde)) {
        if (subWaarde === undefined) continue;
        if (inhoudSubs.has(subSleutel)) inhoudDeel[subSleutel] = subWaarde;
        else spoorDeel[subSleutel] = subWaarde;
      }
      if (Object.keys(spoorDeel).length > 0) spoor[sleutel] = spoorDeel;
      if (Object.keys(inhoudDeel).length > 0) inhoud[sleutel] = inhoudDeel;
      continue;
    }

    if (niveauVan(sleutel) === "inhoud") inhoud[sleutel] = waarde;
    else spoor[sleutel] = waarde;
  }

  return { spoor, inhoud, onbekend };
}

/**
 * Leesprojectie in TypeScript, spiegel van `meta_basisniveau()` /
 * `meta_bronniveau()` in SQL. Gebruikt door de governanceviewer wanneer die
 * rijen buiten de RPC om verwerkt, en door de sanitytest om beide kanten van het
 * contract op één plek te kunnen vergelijken.
 *
 * @param metBronniveau true = `governance_audit_read_sources` aanwezig.
 */
export function projecteerSpoorMeta(
  spoorMeta: unknown,
  metBronniveau: boolean
): JsonObject {
  const uit: JsonObject = {};
  if (!isObject(spoorMeta)) return uit;

  for (const [sleutel, waarde] of Object.entries(spoorMeta)) {
    if (waarde === undefined) continue;

    const niveau = niveauVan(sleutel);
    // Inhoudsleutels horen hier niet te staan, maar rijen van vóór plateau A
    // dragen ze wél. Altijd weglaten.
    if (niveau === "inhoud") continue;
    if (niveau === "bron" && !metBronniveau) continue;

    const sub = SUB_NIVEAUS[sleutel];
    if (sub && isObject(waarde)) {
      const inhoudSubs = new Set(sub.inhoud ?? []);
      const bronSubs = new Set(sub.bron ?? []);
      const deel: JsonObject = {};
      for (const [subSleutel, subWaarde] of Object.entries(waarde)) {
        if (subWaarde === undefined) continue;
        if (inhoudSubs.has(subSleutel)) continue;
        if (bronSubs.has(subSleutel) && !metBronniveau) continue;
        deel[subSleutel] = subWaarde;
      }
      if (Object.keys(deel).length > 0) uit[sleutel] = deel;
      continue;
    }

    uit[sleutel] = waarde;
  }

  return uit;
}
