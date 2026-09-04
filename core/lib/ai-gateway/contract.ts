// ============================================================================
//  core/lib/ai-gateway/contract.ts — het typed contract van de centrale AI-gateway
// ----------------------------------------------------------------------------
//  M365 fase 2B (#311). Provider-NEUTRAAL: geen SDK-types. De route bouwt haar
//  prompt zoals altijd (system-blokken, berichten, retrieval, [Bron N]) en geeft
//  die als `GenereerVerzoek` aan de gateway; de gateway bepaalt server-side uit
//  fonds + taaktype welk goedgekeurd profiel/model geldt, toetst de poort (kill
//  switch/allowlist) en roept de adapter aan. Provider en model komen NOOIT uit
//  het verzoek van de browser en NOOIT uit een letterlijke modelstring op de
//  call-site (zie tests/cross-tenant/ai-poort.test.ts).
//
//  Wat bewust NIET hier zit: retrieval, promptopbouw, citaatsemantiek en de
//  vervolgvragen-marker. Die blijven exact waar ze zijn.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type Provider = "anthropic" | "openai" | "mistral";

/** Configuratiegroep in de database (ai_gateway_private.fonds_configuratie). */
export type Taakgroep = "generatie" | "hulp_sterk" | "concept" | "hulp_snel";

/**
 * Stabiele taaktype-identificatie per call-site; gaat integraal mee in de
 * gateway-log zodat latere verfijning van de taakgroepen mogelijk blijft (R1).
 * Platformbrede taken (fonds = null) hebben GEEN taakgroep: hun model komt uit
 * een expliciete, door de allowlist gedekte `modelOverride`.
 */
export type Taaktype =
  | "chat_generatie"
  | "chat_contextresolutie"
  | "chat_reformulatie"
  | "chat_vraagrouter"
  | "chat_mapstap"
  | "rerank"
  | "vergelijk_dimensies"
  | "vergelijk_waarde"
  | "samenvatting"
  | "context_prefix"
  | "semantische_extractie"
  | "afschrift_concept"
  | "besluit_concept"
  | "aqlab_generatie"
  | "aqlab_judge";

export const TAAKGROEP_VAN_TAAKTYPE: Readonly<Record<Taaktype, Taakgroep | null>> = {
  chat_generatie: "generatie",
  vergelijk_waarde: "generatie",
  chat_contextresolutie: "hulp_sterk",
  chat_reformulatie: "hulp_sterk",
  samenvatting: "concept",
  afschrift_concept: "concept",
  besluit_concept: "concept",
  chat_vraagrouter: "hulp_snel",
  chat_mapstap: "hulp_snel",
  rerank: "hulp_snel",
  vergelijk_dimensies: "hulp_snel",
  context_prefix: "hulp_snel",
  semantische_extractie: "hulp_snel",
  aqlab_generatie: null,
  aqlab_judge: null,
};

export function isTaaktype(waarde: string): waarde is Taaktype {
  return Object.prototype.hasOwnProperty.call(TAAKGROEP_VAN_TAAKTYPE, waarde);
}

export type Actor =
  | { soort: "gebruiker"; id: string }
  | { soort: "systeem"; proces: string };

/**
 * Server-side vastgestelde context. `fondsId` komt uit de sessiecontext van
 * withFondsRoute of uit de job-rij — nooit uit de body. `actieId` is het bewijs
 * van de preflight-reservering (quotum/idempotentie); zonder reservering weigert
 * de gateway, zodat geen hulpfunctie het quotum kan omzeilen.
 */
export interface GatewayContext {
  /** RLS-client (tenant) of service-client (worker); alleen voor fn_ai_poort_check. */
  supabase: SupabaseClient;
  fondsId: string | null;
  actor: Actor;
  actieId: string | null;
  /** requestId van de wrapper of de job-id; landt in de gateway-log. */
  correlatieId: string;
  /** Routelabel voor serverlog en gateway-log, bv. "chat.POST". */
  label: string;
}

/** Structureel gelijk aan een Anthropic TextBlockParam, zonder de SDK te importeren. */
export interface TekstBlok {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" } | null;
}

export interface Bericht {
  role: "user" | "assistant";
  content: string;
}

/**
 * Neutrale tools. `webzoek` wordt door de Anthropic-adapter op de web_search-
 * servertool gemapt; een adapter die een tool niet ondersteunt faalt gesloten.
 */
export type NeutraleTool =
  | { soort: "webzoek"; domeinen: string[]; maxGebruik: number }
  | {
      soort: "functie";
      naam: string;
      beschrijving: string;
      schema: Record<string, unknown>;
      /** true → de provider MOET deze tool aanroepen (tool_choice). */
      verplicht?: boolean;
    };

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Alleen voor platformbrede taaktypes (fonds = null, bv. AQLab): expliciete,
 * door de DB-allowlist en de poort gedekte provider/modelkeuze. Voor
 * fondsgebonden taaktypes wordt een override GEWEIGERD.
 */
export interface ModelOverride {
  provider: Provider;
  model: string;
  redeneermodel?: boolean;
  reasoningEffort?: ReasoningEffort | null;
}

export interface GenereerVerzoek {
  taaktype: Taaktype;
  /** System-prompt: string óf blokken — wordt ongewijzigd doorgegeven (byte-pariteit). */
  systeem: string | TekstBlok[];
  berichten: Bericht[];
  maxTokens: number;
  /** null/undefined → provider-default (zoals de streaming-route altijd deed). */
  temperature?: number | null;
  topP?: number | null;
  tools?: NeutraleTool[];
  /** Harde SDK-/HTTP-timeout voor deze call. */
  timeoutMs?: number;
  /** Annulering door de aanroeper (eigen timer of clientafbraak). */
  signal?: AbortSignal;
  modelOverride?: ModelOverride;
}

export interface Usage {
  in: number;
  out: number;
  cacheLezen: number;
  cacheCreatie: number;
  /** in + cacheLezen + cacheCreatie + out. */
  totaal: number;
}

export type StopReden = "einde" | "max_tokens" | "stop_sequence" | "tool" | "onbekend";

export interface GenereerResultaat {
  tekst: string;
  /**
   * Ruwe content-blokken van de provider, UITSLUITEND voor server-side extractie
   * van tool-uitvoer (web_search-citaties, functie-argumenten). Nooit naar de
   * browser doorgeven.
   */
  inhoud: unknown[];
  stopReden: StopReden;
  usage: Usage;
  latencyMs: number;
  provider: Provider;
  model: string;
  profielId: string;
  /** Versie van de fondsconfiguratie; null bij een platformbrede override. */
  configVersie: number | null;
}

export interface StreamHandle {
  /** Vervangt `claudeStream.on("text", …)`. Delta's vóór registratie worden gebufferd. */
  onTekst(cb: (delta: string) => void): void;
  /** Vervangt `finalMessage()`; logt daarna de auditregel. */
  afronden(): Promise<GenereerResultaat>;
}

export type Foutcategorie =
  | "configuratie"
  | "poort_gesloten"
  | "provider"
  | "timeout"
  | "rate_limit"
  | "geannuleerd";

export interface AiGateway {
  genereer(ctx: GatewayContext, verzoek: GenereerVerzoek): Promise<GenereerResultaat>;
  stream(ctx: GatewayContext, verzoek: GenereerVerzoek): Promise<StreamHandle>;
}
