// ============================================================================
//  ai-poort.ts — de ENIGE toegestane weg naar een AI-provider
// ----------------------------------------------------------------------------
//  De preflight (ai-preflight.ts) reserveert ÉÉN KEER per logische actie. Deze
//  poort staat een laag dieper: hij draait vóór IEDERE afzonderlijke
//  providercall. Eén chatvraag kan zo één reservering hebben en toch ruim tien
//  keer langs de poort komen.
//
//  LIVE, GEEN SNAPSHOT, GEEN CACHE. Dat is een bewuste afspraak: reeds verzonden
//  externe calls worden niet afgebroken, maar iedere NOG NIET GESTARTE call moet
//  de actuele schakelaarstand zien. Met een snapshot uit het begin van de actie
//  zou een stop pas bij het volgende verzoek werken — precies de situatie die de
//  kill switch moet voorkomen. De prijs is één kleine indexread per
//  providercall; die is gemeten en aanvaard (besluit 0180).
//
//  FAIL-CLOSED. Een onbereikbare poort betekent GEEN providercall.
//
//  WAAROM DE CLIENT NIET WORDT GEËXPORTEERD
//  `bewaakteAnthropic()` geeft de Anthropic-client uitsluitend BINNEN de
//  callback, ná een geslaagde controle. Er is geen exported accessor waarmee je
//  hem eromheen kunt bemachtigen. Dat maakt de poort niet omzeilbaar door
//  vergeetachtigheid, alleen door hem bewust te slopen — en dát vangt
//  tests/cross-tenant/ai-poort.test.ts af.
//
//  Besluit 0180.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Provider } from "./ai-preflight";
import { resolveAnthropicBaseUrl } from "./ai-provider-endpoint.mjs";

export type { Provider };

/** Reden waarom de poort dichtblijft. Gesaniteerd: geen tellers, geen config. */
export type PoortReden =
  | "globaal_gestopt"
  | "provider_gestopt"
  | "model_niet_toegestaan"
  | "model_buiten_venster"
  | "config_ontbreekt"
  | "poort_onbereikbaar";

/**
 * De poort weigerde. Routes vertalen dit naar een gesaniteerde 503; er gaat
 * bewust geen providerinformatie of configuratiedetail mee naar de client.
 */
export class AiPoortGeslotenError extends Error {
  readonly reden: PoortReden;
  readonly provider: Provider;
  constructor(provider: Provider, reden: PoortReden) {
    super(`ai-poort gesloten: ${provider} (${reden})`);
    this.name = "AiPoortGeslotenError";
    this.provider = provider;
    this.reden = reden;
  }
}

/** Is dit een poortweigering? Handig in `catch`-blokken van routes. */
export function isPoortGesloten(e: unknown): e is AiPoortGeslotenError {
  return e instanceof AiPoortGeslotenError;
}

/**
 * Context voor de poort. `supabase` is de client van de aanroeper: de
 * RLS-client op de tenant-surface, of de service-client in de worker. Beide
 * mogen `fn_ai_poort_check` uitvoeren; die functie leest alleen configuratie en
 * heeft geen identiteit nodig.
 */
export type PoortContext = {
  supabase: SupabaseClient;
  /** Routelabel voor de serverlog, bv. "chat.POST". */
  label?: string;
};

/**
 * Toetst één providercall tegen de actuele stand. Gooit `AiPoortGeslotenError`
 * als de call niet mag; retourneert stil als hij wél mag.
 */
export async function poortCheck(
  ctx: PoortContext,
  provider: Provider,
  model?: string | null
): Promise<void> {
  let data: unknown;
  try {
    const res = await ctx.supabase.rpc("fn_ai_poort_check", {
      p_provider: provider,
      p_model: model ?? null,
    });
    if (res.error) {
      console.error(`[ai-poort]${ctx.label ? ` ${ctx.label}` : ""} check faalde`, res.error.message);
      throw new AiPoortGeslotenError(provider, "poort_onbereikbaar");
    }
    data = res.data;
  } catch (e) {
    if (e instanceof AiPoortGeslotenError) throw e;
    console.error(`[ai-poort]${ctx.label ? ` ${ctx.label}` : ""} check wierp een fout`, e);
    throw new AiPoortGeslotenError(provider, "poort_onbereikbaar");
  }

  if (!data || typeof data !== "object") {
    throw new AiPoortGeslotenError(provider, "poort_onbereikbaar");
  }
  const rec = data as Record<string, unknown>;
  if (rec.toegestaan === true) return;

  const reden = typeof rec.reden === "string" ? (rec.reden as PoortReden) : "poort_onbereikbaar";
  throw new AiPoortGeslotenError(provider, reden);
}

// ── Anthropic ───────────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;

/**
 * De enige Anthropic-client in de codebase. Niet geëxporteerd: hij is alleen
 * bereikbaar binnen de callback van `bewaakteAnthropic`, ná de poortcontrole.
 */
function client(): Anthropic {
  if (!_anthropic) {
    const baseURL = resolveAnthropicBaseUrl();
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 60_000,
      maxRetries: 1,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return _anthropic;
}

/**
 * Voert één Anthropic-call uit achter de poort.
 *
 * ```ts
 * const bericht = await bewaakteAnthropic(ctx, AI_MODEL, (anthropic) =>
 *   anthropic.messages.create({ model: AI_MODEL, ... })
 * );
 * ```
 *
 * Het model wordt MEEGEGEVEN aan de poort en niet uit de callback afgeleid: een
 * route mag de controle niet omzeilen door in de callback een andere
 * modelstring te zetten. `tests/cross-tenant/ai-poort.test.ts` bewaakt dat er
 * geen tweede weg naar de provider ontstaat.
 */
export async function bewaakteAnthropic<T>(
  ctx: PoortContext,
  model: string,
  fn: (anthropic: Anthropic) => Promise<T>
): Promise<T> {
  await poortCheck(ctx, "anthropic", model);
  return fn(client());
}

/**
 * Variant voor het streamingpad, waar de SDK een stream-object teruggeeft in
 * plaats van een promise-resultaat.
 */
export async function bewaakteAnthropicStream<T>(
  ctx: PoortContext,
  model: string,
  fn: (anthropic: Anthropic) => T
): Promise<T> {
  await poortCheck(ctx, "anthropic", model);
  return fn(client());
}

// ── Mistral en OpenAI (rauwe fetch, geen SDK) ───────────────────────────────

/**
 * Voert één Mistral- of OpenAI-call uit achter de poort. Deze providers worden
 * met een rauwe `fetch` aangeroepen; de poort zit ervoor in plaats van eromheen.
 */
export async function bewaakteProviderCall<T>(
  ctx: PoortContext,
  provider: Provider,
  model: string | null,
  fn: () => Promise<T>
): Promise<T> {
  await poortCheck(ctx, provider, model);
  return fn();
}

/**
 * Variant die géén uitzondering gooit maar `null` teruggeeft als de poort dicht
 * is. Bedoeld voor paden die een gesloten poort FUNCTIONEEL mogen opvangen in
 * plaats van met een fout — concreet: de vector-arm van de retrieval, die bij
 * een gestopte Mistral terugvalt op full-text search mét zichtbare melding
 * (routecontract besluit 0180). Gebruik dit NOOIT om een blokkade stil weg te
 * slikken; de aanroeper hoort de degradatie te tonen én vast te leggen.
 */
export async function bewaakteProviderCallOfNull<T>(
  ctx: PoortContext,
  provider: Provider,
  model: string | null,
  fn: () => Promise<T>
): Promise<{ ok: true; waarde: T } | { ok: false; reden: PoortReden }> {
  try {
    await poortCheck(ctx, provider, model);
  } catch (e) {
    if (isPoortGesloten(e)) return { ok: false, reden: e.reden };
    throw e;
  }
  return { ok: true, waarde: await fn() };
}
