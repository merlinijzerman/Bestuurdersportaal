// ============================================================
//  core/lib/vraag-context.ts — Plateau 1: contextvaste vervolgvragen.
//
//  DOEL
//  Eén vroege, server-side contextresolutie die de actuele beurt omzet naar één
//  zelfstandige `effectieveVraag`. Alle inhoudelijke downstream-beslissingen op
//  de normale informatiepaden (bronintentie, vraagrouter, antwoordmodus,
//  retrievalmodus, bronsoortprofiel, retrieval + fusie, webprofiel, PII, prompt)
//  gebruiken vervolgens diezelfde vraag i.p.v. de losse, onderwerp-arme zin.
//
//  Voorbeeld: na "Wat betekent de solidariteitsreserve?" moet "Breng het
//  wettelijke kader in kaart." worden begrepen als "Breng het wettelijke kader
//  van de solidariteitsreserve in kaart." — generiek, zonder domeinwoordenlijst.
//
//  ONTWERP
//  - De modus-resolver en de detectie-/parse-/fallbackregels zijn PURE functies
//    (geen SDK-imports, deterministisch testbaar; zelfde discipline als
//    query-reformulatie.ts en de rag-select-familie).
//  - De modelcall wordt als functie GEÏNJECTEERD (`roepModelAan`), zodat deze
//    module niets instantieert en de sanitytest hem kan stubben. De route levert
//    een `roepModelAan` die via de enige Anthropic-poort (`bewaakteAnthropic`)
//    op het rewrite-model draait, op temperature 0 (reproduceerbaar, besluit
//    0139), met een echte AbortController-timeout (patroon map-stap route.ts).
//  - Fail-safe: elke fout/timeout/ongeldige/laag-vertrouwen-uitkomst valt terug
//    op de originele vraag. De resolver beslist niets inhoudelijk en claimt niets
//    juridisch; `vertrouwen` is een technisch routersignaal (geen schijnzekerheid).
//  - Plateau 1 gebruikt UITSLUITEND de historie die de client al meestuurt; geen
//    server-side history-fetch, geen nieuwe verwerker, geen gesprekstoestand.
// ============================================================

export type VraagRelatie =
  | "eerste_beurt"
  | "vervolg"
  | "nieuw_onderwerp"
  | "onduidelijk";

export type ContextVertrouwen = "hoog" | "middel" | "laag";

export type ChatcontextModus = "off" | "observe" | "enforce";

export type Resolvermethode =
  | "geen_historie"
  | "overgeslagen"
  | "model"
  | "model_laag_vertrouwen"
  | "fallback";

/** Echte meetmetadata van de modelcall; door de route gevuld via `roepModelAan`. */
export interface ResolverMeting {
  model: string;
  duurMs: number;
  tokensIn: number;
  tokensOut: number;
  timeout: boolean;
  /**
   * Of er daadwerkelijk een PROVIDERCALL is gestart. Een poortweigering vóór de
   * call is GEEN modelcall (false); een timeout nádat de call gestart is telt wél
   * als modelcall (true). Expliciete runtimewaarde — nooit afgeleid uit
   * `resolvermethode`.
   */
  modelAangeroepen: boolean;
  /**
   * Expliciete foutsignaal-flag van de aanroeper. `"providerfout"` = de call was
   * gestart maar de provider/verbinding gaf een fout (géén timeout). Bewust
   * expliciet doorgegeven zodat de resolver een providerfout NIET uit lege tekst
   * hoeft af te leiden. Afwezig bij succes/timeout/poortweigering.
   */
  foutreden?: "providerfout";
}

export interface VraagContext {
  /** Onveranderd; leidend voor zichtbare chat, opslag, toon en governance. */
  origineleVraag: string;
  /** Zelfstandige representatie van de actuele bedoeling (downstream in enforce). */
  effectieveVraag: string;
  /** Het ruwe modelvoorstel — ook bewaard bij laag vertrouwen/fallback (observe-audit). */
  kandidaatVraag: string;
  relatie: VraagRelatie;
  /** Kort onderwerplabel; transient — niet als blijvende basis-telemetrie gelogd. */
  onderwerp: string | null;
  vertrouwen: ContextVertrouwen;
  historieGebruikt: boolean;
  /** enforce && effectief !== origineel — of de effectieve vraag downstream stuurt. */
  afgedwongen: boolean;
  /**
   * Expliciete runtimewaarde: heeft de resolver een providercall (REWRITE_MODEL)
   * daadwerkelijk gestart? Bepaalt of `geen_modelcall` downstream true mag zijn en
   * of REWRITE_MODEL als gebruikt model moet worden geregistreerd. NIET afgeleid
   * uit `resolvermethode`.
   */
  modelAangeroepen: boolean;
  resolvermethode: Resolvermethode;
  fallbackReden?: string;
  meting?: ResolverMeting;
}

export interface Beurt {
  role: "user" | "assistant";
  content: string;
}

// ── Modus-schakelaar ─────────────────────────────────────────────────────────
// Env-vlag CHATCONTEXT_RESOLVER ∈ off | observe | enforce. Pure resolver los van
// de env-lezer (patroon capability-enforce.ts): onbekend/leeg → off (fail-safe).

/** PURE: normaliseer een ruwe modus-waarde. Onbekend/leeg → "off". */
export function resolveChatcontextModus(
  raw: string | null | undefined
): ChatcontextModus {
  const g = (raw ?? "").trim().toLowerCase();
  if (g === "enforce") return "enforce";
  if (g === "observe") return "observe";
  return "off";
}

/** Leest de env-vlag. Apart van de pure functie zodat die testbaar blijft. */
export function chatcontextModus(): ChatcontextModus {
  return resolveChatcontextModus(process.env.CHATCONTEXT_RESOLVER);
}

// ── Transcript ───────────────────────────────────────────────────────────────
// Onderwerpanker = primair de laatste volledige gebruikersvragen. Assistent-
// antwoorden worden aanvullend en strak ingekort meegenomen, zodat een lang
// antwoord het onderwerp niet uit het venster duwt (diagnose §3.3).

const MAX_BEURTEN = 8;
const MAX_USER = 600;
const MAX_ASSISTENT = 300;

function knip(tekst: string, max: number): string {
  const t = tekst.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export function bouwContextTranscript(priorBeurten: Beurt[]): string {
  return priorBeurten
    .slice(-MAX_BEURTEN)
    .map((b) => {
      const label = b.role === "user" ? "Gebruiker" : "Assistent";
      const max = b.role === "user" ? MAX_USER : MAX_ASSISTENT;
      return `${label}: ${knip(b.content, max)}`;
    })
    .join("\n");
}

// ── Prompt ─────────────────────────────────────────────────────────────────
export const CONTEXTRESOLVER_SYSTEEM = `Je beoordeelt of de LAATSTE vraag van een gebruiker op het lopende gesprek leunt, en levert één zelfstandige interpretatie van die vraag voor bronselectie.

Geef UITSLUITEND geldig JSON terug, exact deze vorm en niets eromheen:
{"relatie":"vervolg|nieuw_onderwerp|onduidelijk","effectieveVraag":"…","onderwerp":"… of null","vertrouwen":"hoog|middel|laag"}

Regels:
- "vervolg": de laatste vraag is inhoudelijk onvolledig zonder het gesprek (verwijswoorden zoals "hiervoor/dat/die", of een onderwerp-arme opdracht zoals "breng het kader in kaart", "geef de risico's", "en voor het bestuur?"). Zet "effectieveVraag" dan om naar één zelfstandige vraag waarin het concrete onderwerp uit het gesprek is ingevuld. Behoud vakjargon en eigennamen (bijv. "Wtp", "SPR", "artikel 102 PW"). Zet "onderwerp" op dat onderwerp.
- "nieuw_onderwerp": de laatste vraag introduceert een eigen, zelfstandig onderwerp of wisselt expliciet van onderwerp ("andere vraag: …", "wat is het verschil tussen een APF en een OPF?"). Kopieer de vraag dan ONVERANDERD naar "effectieveVraag" en plak GEEN oud onderwerp aan. "onderwerp" mag null.
- Bij een vergelijking met een eerder onderwerp ("vergelijk dit met de bestemmingsreserve"): behoud BEIDE onderwerpen in "effectieveVraag".
- "onduidelijk": als je het niet met redelijke zekerheid kunt bepalen. Kopieer de vraag onveranderd; "vertrouwen":"laag".
- Verzin nooit een onderwerp dat niet uit het gesprek blijkt. Voeg geen uitleg of toelichting toe; lever een bondige, zoekbare vraag.`;

// ── Parsing (puur) ───────────────────────────────────────────────────────────

const RELATIES: ReadonlySet<string> = new Set([
  "vervolg",
  "nieuw_onderwerp",
  "onduidelijk",
]);
const VERTROUWENS: ReadonlySet<string> = new Set(["hoog", "middel", "laag"]);
const MAX_EFFECTIEVE_LENGTE = 300;

export interface ModelBeoordeling {
  relatie: VraagRelatie;
  effectieveVraag: string;
  onderwerp: string | null;
  vertrouwen: ContextVertrouwen;
}

/**
 * PURE: haalt het eerste JSON-object uit de modeltekst en valideert het strikt.
 * Retourneert null bij afwezig/ongeldig JSON of ontbrekende/ongeldige velden,
 * zodat de resolver veilig kan terugvallen.
 */
export function parseModelBeoordeling(tekst: string): ModelBeoordeling | null {
  const schoon = (tekst ?? "").trim();
  if (!schoon) return null;

  const start = schoon.indexOf("{");
  const eind = schoon.lastIndexOf("}");
  if (start === -1 || eind === -1 || eind <= start) return null;

  let ruw: unknown;
  try {
    ruw = JSON.parse(schoon.slice(start, eind + 1));
  } catch {
    return null;
  }
  if (typeof ruw !== "object" || ruw === null) return null;
  const o = ruw as Record<string, unknown>;

  const relatie = o.relatie;
  const effectief = o.effectieveVraag;
  const vertrouwen = o.vertrouwen;
  const onderwerp = o.onderwerp;

  if (typeof relatie !== "string" || !RELATIES.has(relatie)) return null;
  if (typeof vertrouwen !== "string" || !VERTROUWENS.has(vertrouwen)) return null;
  if (typeof effectief !== "string") return null;
  const effectiefSchoon = effectief.trim();
  if (!effectiefSchoon || effectiefSchoon.length > MAX_EFFECTIEVE_LENGTE) return null;

  const onderwerpSchoon =
    typeof onderwerp === "string" && onderwerp.trim().length > 0
      ? onderwerp.trim()
      : null;

  return {
    relatie: relatie as VraagRelatie,
    effectieveVraag: effectiefSchoon,
    onderwerp: onderwerpSchoon,
    vertrouwen: vertrouwen as ContextVertrouwen,
  };
}

// ── Resolver ─────────────────────────────────────────────────────────────────

function eersteBeurt(origineleVraag: string): VraagContext {
  return {
    origineleVraag,
    effectieveVraag: origineleVraag,
    kandidaatVraag: origineleVraag,
    relatie: "eerste_beurt",
    onderwerp: null,
    vertrouwen: "hoog",
    historieGebruikt: false,
    afgedwongen: false,
    modelAangeroepen: false,
    resolvermethode: "geen_historie",
  };
}

function overgeslagen(origineleVraag: string): VraagContext {
  // Speciaal pad (reflectie/transformatie/scope/…): de route roept ons met
  // magResolveren=false. Geen modelcall; effectief == origineel.
  return {
    origineleVraag,
    effectieveVraag: origineleVraag,
    kandidaatVraag: origineleVraag,
    relatie: "onduidelijk",
    onderwerp: null,
    vertrouwen: "laag",
    historieGebruikt: false,
    afgedwongen: false,
    modelAangeroepen: false,
    resolvermethode: "overgeslagen",
  };
}

function terugval(
  origineleVraag: string,
  reden: string,
  kandidaat: string,
  modelAangeroepen: boolean,
  meting?: ResolverMeting
): VraagContext {
  return {
    origineleVraag,
    effectieveVraag: origineleVraag,
    kandidaatVraag: kandidaat,
    relatie: "onduidelijk",
    onderwerp: null,
    vertrouwen: "laag",
    historieGebruikt: true,
    afgedwongen: false,
    modelAangeroepen,
    resolvermethode: "fallback",
    fallbackReden: reden,
    meting,
  };
}

/**
 * Leidt één zelfstandige `effectieveVraag` af uit de actuele vraag + historie.
 *
 * - Geen historie → eerste_beurt (geen modelcall).
 * - `magResolveren === false` → overgeslagen speciaal pad (geen modelcall).
 * - Anders: één modelcall (geïnjecteerd). Serverseitige afdwinging ná parse:
 *     • nieuw_onderwerp        → effectief = origineel (geen oud onderwerp plakken);
 *     • laag vertrouwen        → effectief = origineel (geen speculatieve context);
 *     • parse/leeg/timeout/fout → fallback naar origineel, fallbackReden gelogd.
 *   Alleen "vervolg" met hoog/middel vertrouwen gebruikt de herschreven vraag.
 *
 * `afgedwongen` = (modus === "enforce" && effectief !== origineel): of de
 * effectieve vraag de downstream-keten werkelijk stuurt.
 */
export async function resolveVraagContext(input: {
  origineleVraag: string;
  priorBeurten: Beurt[];
  modus: "observe" | "enforce";
  magResolveren: boolean;
  roepModelAan: (
    systeem: string,
    gebruiker: string
  ) => Promise<{ tekst: string; meting: ResolverMeting }>;
}): Promise<VraagContext> {
  const { origineleVraag, priorBeurten, modus, magResolveren, roepModelAan } = input;

  if (priorBeurten.length === 0) return eersteBeurt(origineleVraag);
  if (!magResolveren) return overgeslagen(origineleVraag);

  const transcript = bouwContextTranscript(priorBeurten);
  const gebruiker = `GESPREK TOT NU TOE:\n${transcript}\n\nLAATSTE VRAAG: ${origineleVraag}\n\nBeoordeling (JSON):`;

  let tekst = "";
  let meting: ResolverMeting | undefined;
  try {
    const uit = await roepModelAan(CONTEXTRESOLVER_SYSTEEM, gebruiker);
    tekst = uit.tekst;
    meting = uit.meting;
  } catch {
    // Onverwachte fout buiten de gestructureerde uitkomst om: geen bruikbare
    // meetmetadata, dus behandel als geen providercall (conservatief).
    return terugval(origineleVraag, "modelfout", origineleVraag, false);
  }

  const modelAangeroepen = meting?.modelAangeroepen ?? false;

  // Vijf onderscheidbare uitkomsten, in prioriteitsvolgorde. Een providerfout wordt
  // NIET uit lege tekst afgeleid maar uit het expliciete `meting.foutreden`.
  //   timeout        — AbortController brak af ná callstart;
  //   providerfout   — call gestart, provider/verbinding gaf een fout;
  //   poort_geweigerd — call niet gestart (bewaakteAnthropic weigerde);
  //   lege_respons   — succesvolle response zónder tekst;
  //   onparseerbaar  — response zonder geldig JSON-contract.
  if (meting?.timeout) {
    return terugval(origineleVraag, "timeout", origineleVraag, modelAangeroepen, meting);
  }
  if (meting?.foutreden === "providerfout") {
    return terugval(origineleVraag, "providerfout", origineleVraag, modelAangeroepen, meting);
  }

  const beoordeling = parseModelBeoordeling(tekst);
  if (!beoordeling) {
    const reden = tekst.trim()
      ? "onparseerbaar"
      : modelAangeroepen
        ? "lege_respons"
        : "poort_geweigerd";
    return terugval(origineleVraag, reden, origineleVraag, modelAangeroepen, meting);
  }

  const kandidaat = beoordeling.effectieveVraag;

  // Onderwerpwisseling / zelfstandige vraag: nooit oud onderwerp plakken.
  if (beoordeling.relatie === "nieuw_onderwerp") {
    return {
      origineleVraag,
      effectieveVraag: origineleVraag,
      kandidaatVraag: kandidaat,
      relatie: "nieuw_onderwerp",
      onderwerp: beoordeling.onderwerp,
      vertrouwen: beoordeling.vertrouwen,
      historieGebruikt: true,
      afgedwongen: false,
      modelAangeroepen,
      resolvermethode: "model",
      meting,
    };
  }

  // Lage zekerheid of "onduidelijk": originele vraag leidend, geen speculatie.
  if (beoordeling.vertrouwen === "laag" || beoordeling.relatie === "onduidelijk") {
    return {
      origineleVraag,
      effectieveVraag: origineleVraag,
      kandidaatVraag: kandidaat,
      relatie: beoordeling.relatie,
      onderwerp: beoordeling.onderwerp,
      vertrouwen: beoordeling.vertrouwen,
      historieGebruikt: true,
      afgedwongen: false,
      modelAangeroepen,
      resolvermethode: "model_laag_vertrouwen",
      meting,
    };
  }

  // "vervolg" met hoog/middel vertrouwen: de herschreven vraag stuurt downstream.
  const effectief = kandidaat;
  return {
    origineleVraag,
    effectieveVraag: effectief,
    kandidaatVraag: kandidaat,
    relatie: "vervolg",
    onderwerp: beoordeling.onderwerp,
    vertrouwen: beoordeling.vertrouwen,
    historieGebruikt: true,
    afgedwongen: modus === "enforce" && effectief.trim() !== origineleVraag.trim(),
    modelAangeroepen,
    resolvermethode: "model",
    meting,
  };
}

// ── Logvorm ────────────────────────────────────────────────────────────────
// Compacte telemetrie voor retrieval_meta.invoer.context (basis; append-only).
// Bevat GEEN letterlijke vraagtekst en GEEN historie — de kandidaatvraag wordt
// apart, verwijderbaar, gelogd via invoer.context_kandidaat_vraag.

export interface ContextTelemetrie {
  modus: ChatcontextModus;
  relatie: VraagRelatie;
  vertrouwen: ContextVertrouwen;
  historie_gebruikt: boolean;
  resolvermethode: Resolvermethode;
  afgedwongen: boolean;
  /** Expliciet: heeft de resolver een providercall gestart (niet afgeleid). */
  model_aangeroepen: boolean;
  fallback_reden?: string;
  model?: string;
  duur_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  timeout?: boolean;
}

export function contextTelemetrie(
  ctx: VraagContext,
  modus: ChatcontextModus
): ContextTelemetrie {
  const t: ContextTelemetrie = {
    modus,
    relatie: ctx.relatie,
    vertrouwen: ctx.vertrouwen,
    historie_gebruikt: ctx.historieGebruikt,
    resolvermethode: ctx.resolvermethode,
    afgedwongen: ctx.afgedwongen,
    model_aangeroepen: ctx.modelAangeroepen,
  };
  if (ctx.fallbackReden) t.fallback_reden = ctx.fallbackReden;
  if (ctx.meting) {
    t.model = ctx.meting.model;
    t.duur_ms = ctx.meting.duurMs;
    t.tokens_in = ctx.meting.tokensIn;
    t.tokens_out = ctx.meting.tokensOut;
    t.timeout = ctx.meting.timeout;
  }
  return t;
}
