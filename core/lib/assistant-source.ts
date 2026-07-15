// ============================================================================
//  lib/assistant-source.ts — Increment I-3 (bronvermelding-transparantie).
// ----------------------------------------------------------------------------
//  Eén uniform bronmodel voor ALLE herkomst van tekst in een AI-antwoord, zodat
//  de bestuurder kan zien waar elk deel vandaan komt — zónder de kennis van het
//  model te begrenzen.
//
//  Drie soorten:
//    • document        — een daadwerkelijk geraadpleegde fonds-/generieke bron
//                        (RAG). Mapt 1-op-1 op de bestaande BronVerwijzing.
//    • web             — een daadwerkelijk via web-retrieval opgehaalde externe
//                        bron (Scenario A, besluit 0072). Gevuld met resultaten
//                        die de Anthropic web_search-tool over de gezaghebbende-
//                        bronnen-whitelist ophaalde en die tegen die whitelist
//                        zijn HERVERIFIEERD (lib/web-whitelist.ts): draagt de
//                        bron-URL, titel, ophaaldatum én het normgewicht van de
//                        matchende whitelist-entry. Blijft achter de env-vlag
//                        WEB_RETRIEVAL_ACTIEF; is die uit, dan draait de assistent
//                        in Scenario B (geen web-bronnen). Nooit een door het
//                        model verzonnen URL (anti-fabricage, besluit hieronder).
//    • model_knowledge — algemene kennis uit het taalmodel zelf (geen externe
//                        bron). Draagt de door het antwoord GENOEMDE bron-instantie
//                        (DNB/AFM/…) als die letterlijk in de tekst staat; nooit
//                        een verzonnen documentverwijzing.
//
//  KERNBESLUIT (anti-fabricage): een bron wordt alleen getoond/geciteerd als de
//  applicatie hem daadwerkelijk heeft opgehaald (document of web) óf als de
//  instantie letterlijk in het antwoord van het model staat (model_knowledge).
//  Er worden NOOIT bronnen, URL's of vindplaatsen verzonnen.
//
//  Pure helpers; geen DB-toegang. Testbaar via lib/assistant-source.sanity.ts.
// ============================================================================

import { isVeiligeUrl } from "./bronsoort";

export type AssistantSourceKind = "document" | "web" | "model_knowledge";

/** Documentbron (RAG) — structureel gelijk aan BronVerwijzing uit lib/rag.ts. */
export interface AssistantSourceDocument {
  kind: "document";
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
}

/** Webbron — alleen geldig met een veilige http(s)-URL (Scenario A). */
export interface AssistantSourceWeb {
  kind: "web";
  url: string;
  titel: string;
  domein: string;
  /** Publicatiedatum van de pagina, indien bekend (page_age). */
  datum?: string | null;
  snippet?: string | null;
  /** Normgewicht van de matchende whitelist-entry (FR-3 weging + UI-badge). */
  normgewicht?: string | null;
  /** Wanneer de applicatie de bron ophaalde (FR-2: ISO-tijdstempel). */
  ophaaldatum?: string | null;
}

/** Algemene kennis uit het taalmodel — draagt de genoemde instantie, geen URL. */
export interface AssistantSourceModelKnowledge {
  kind: "model_knowledge";
  /** 'wetgeving' bij [Volgens wetgeving]; anders 'algemene_kennis'. */
  grond: "algemene_kennis" | "wetgeving";
  /** Canonieke instantie-naam (DNB/AFM/…) of null als geen instantie genoemd is. */
  instantie: string | null;
}

export type AssistantSource =
  | AssistantSourceDocument
  | AssistantSourceWeb
  | AssistantSourceModelKnowledge;

/** Telling per soort + of er live web-retrieval actief was (Scenario A vs B). */
export interface AssistantSourceSamenvatting {
  documenten: number;
  web: number;
  model_kennis: number;
  /** True als voor dít antwoord live web-retrieval is ingezet én ≥1 geverifieerde
   *  webbron opleverde (Scenario A); anders false (Scenario B / geen treffer). */
  web_retrieval_actief: boolean;
}

// ── Documentbron → uniforme source ──────────────────────────────────────────

/**
 * Structurele invoer voor een documentbron. BronVerwijzing (lib/rag.ts) voldoet
 * hieraan; we importeren dat type bewust NIET om dit bestand puur/DB-vrij te
 * houden (rag.ts trekt Supabase mee).
 */
export interface DocumentBronInput {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
}

export function documentBronNaarSource(b: DocumentBronInput): AssistantSourceDocument {
  return {
    kind: "document",
    document_id: b.document_id,
    titel: b.titel,
    bron: b.bron,
    pagina: b.pagina,
    paragraaf: b.paragraaf,
    fragment: b.fragment,
    heeft_origineel: b.heeft_origineel,
    bibliotheek: b.bibliotheek ?? null,
    bronorganisatie: b.bronorganisatie ?? null,
    normgewicht: b.normgewicht ?? null,
    extern_url: b.extern_url ?? null,
    documentstatus: b.documentstatus ?? null,
    bronstatus: b.bronstatus ?? null,
    documentdatum: b.documentdatum ?? null,
    geldig_tot: b.geldig_tot ?? null,
  };
}

// ── Webbron → uniforme source (defensief; pas in gebruik bij echte retrieval) ─

export interface WebBronInput {
  url: string;
  titel?: string | null;
  datum?: string | null;
  snippet?: string | null;
  normgewicht?: string | null;
  ophaaldatum?: string | null;
}

/**
 * Bouw een webbron, maar ALLEEN als de URL veilig (http/https) is. Een onveilige
 * of lege URL levert null — zo komt er nooit een onklikbare/verzonnen webbron in
 * de lijst. Het domein wordt uit de URL afgeleid (geen los in te vullen veld dat
 * kan afwijken van de echte herkomst).
 */
export function webBronNaarSource(b: WebBronInput): AssistantSourceWeb | null {
  if (!isVeiligeUrl(b.url)) return null;
  let domein = "";
  try {
    domein = new URL(b.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return {
    kind: "web",
    url: b.url,
    titel: b.titel && b.titel.trim() !== "" ? b.titel : domein,
    domein,
    datum: b.datum ?? null,
    snippet: b.snippet ?? null,
    normgewicht: b.normgewicht ?? null,
    ophaaldatum: b.ophaaldatum ?? null,
  };
}

// ── Instantie-detectie voor algemene kennis ─────────────────────────────────

/**
 * Bekende bron-instanties die het model bij algemene kennis mag noemen. We tonen
 * uitsluitend instanties die LETTERLIJK in het antwoord staan — dit is detectie,
 * geen toewijzing. Volgorde = prioriteit bij overlap (specifiek vóór algemeen).
 */
const INSTANTIE_PATRONEN: { label: string; regex: RegExp }[] = [
  { label: "Pensioenfederatie", regex: /\bpensioenfederatie\b/i },
  { label: "DNB", regex: /\bDNB\b|\bde nederlandsche bank\b/i },
  { label: "AFM", regex: /\bAFM\b|\bautoriteit financi[eë]le markten\b/i },
  {
    label: "Ministerie van SZW",
    regex: /\bSZW\b|\bsociale zaken(?: en werkgelegenheid)?\b/i,
  },
  { label: "Belastingdienst", regex: /\bbelastingdienst\b/i },
  { label: "Rijksoverheid", regex: /\brijksoverheid\b/i },
];

/** De eerste bekende instantie die letterlijk in `tekst` voorkomt, of null. */
export function detecteerInstantieInTekst(tekst: string): string | null {
  if (!tekst) return null;
  for (const p of INSTANTIE_PATRONEN) {
    if (p.regex.test(tekst)) return p.label;
  }
  return null;
}

/** Alle bekende instanties die letterlijk in `tekst` voorkomen (gededupliceerd). */
export function detecteerInstanties(tekst: string): string[] {
  if (!tekst) return [];
  const gevonden: string[] = [];
  for (const p of INSTANTIE_PATRONEN) {
    if (p.regex.test(tekst) && !gevonden.includes(p.label)) gevonden.push(p.label);
  }
  return gevonden;
}

// Bewust ZONDER g-flag: we gebruiken .test() alleen booleaans. Een g-flag maakt
// .test() stateful (lastIndex blijft staan tussen aanroepen) en geeft dan
// intermitterende false-negatives bij hergebruik van hetzelfde Regexp-object.
const ALGEMENE_KENNIS_MARKER = /\[Algemene kennis\]/i;
const WETGEVING_MARKER = /\[Volgens wetgeving\]/i;

/**
 * Leid de model_knowledge-bronnen af uit een afgerond antwoord. Per marker-soort
 * ([Algemene kennis] / [Volgens wetgeving]) ontstaat één bron per genoemde
 * instantie; staat er geen instantie in het antwoord, dan één bron met
 * instantie=null (transparant: "algemene kennis, instantie niet benoemd").
 *
 * Bewust eenvoudig en deterministisch: we koppelen de in het hele antwoord
 * genoemde instanties aan het aanwezige markertype. Dit is een transparantie-
 * laag, geen forensische toewijzing per zin — en het verzint nooit een instantie
 * die niet in de tekst staat.
 */
export function modelKennisBronnenUitAntwoord(
  antwoord: string
): AssistantSourceModelKnowledge[] {
  if (!antwoord) return [];
  const heeftAlgemeen = ALGEMENE_KENNIS_MARKER.test(antwoord);
  const heeftWetgeving = WETGEVING_MARKER.test(antwoord);
  if (!heeftAlgemeen && !heeftWetgeving) return [];

  const instanties = detecteerInstanties(antwoord);
  const bronnen: AssistantSourceModelKnowledge[] = [];

  const voegToe = (grond: "algemene_kennis" | "wetgeving") => {
    if (instanties.length === 0) {
      bronnen.push({ kind: "model_knowledge", grond, instantie: null });
    } else {
      for (const instantie of instanties) {
        bronnen.push({ kind: "model_knowledge", grond, instantie });
      }
    }
  };

  if (heeftAlgemeen) voegToe("algemene_kennis");
  if (heeftWetgeving) voegToe("wetgeving");
  return bronnen;
}

// ── Samenvatting ────────────────────────────────────────────────────────────

export function bouwSourceSamenvatting(
  sources: AssistantSource[],
  webRetrievalActief = false
): AssistantSourceSamenvatting {
  return {
    documenten: sources.filter((s) => s.kind === "document").length,
    web: sources.filter((s) => s.kind === "web").length,
    model_kennis: sources.filter((s) => s.kind === "model_knowledge").length,
    web_retrieval_actief: webRetrievalActief,
  };
}

/**
 * Markeer-handhaving (audit-signaal, géén blokkade): in pure algemene-kennismodus
 * hoort het antwoord minstens één [Algemene kennis]/[Volgens wetgeving]-marker te
 * dragen. Ontbreken die, dan is de herkomst-transparantie incompleet — dit geeft
 * `true` zodat het zichtbaar wordt in het auditspoor.
 */
export function ontbrekendeAlgemeneKennisMarkering(
  bronModus: "documenten" | "combineren" | "algemeen",
  algemeneKennisMarkers: number
): boolean {
  return bronModus === "algemeen" && algemeneKennisMarkers === 0;
}
