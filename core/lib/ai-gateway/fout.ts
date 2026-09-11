// ============================================================================
//  core/lib/ai-gateway/fout.ts — genormaliseerde foutcategorieën van de gateway
// ----------------------------------------------------------------------------
//  Eén getypeerde fout naar de aanroeper, zonder providerspecifieke details die
//  naar de browser kunnen lekken. `reden` is intern (serverlog/gateway-log);
//  routes vertalen de categorie naar het bestaande veilige foutgedrag.
// ============================================================================

import type { Foutcategorie } from "./contract";

/** Duck-typed (geen import van ai-poort: die importeert de adapter, en de adapter dit bestand). */
function isPoortGesloten(e: unknown): e is { name: string; reden: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "AiPoortGeslotenError" &&
    typeof (e as { reden?: unknown }).reden === "string"
  );
}

export class GatewayFout extends Error {
  readonly categorie: Foutcategorie;
  readonly reden: string;
  readonly herhaalbaar: boolean;
  /** HTTP-status van de provider, indien bekend (alleen voor de serverlog). */
  readonly status: number | null;

  constructor(
    categorie: Foutcategorie,
    reden: string,
    opties?: { herhaalbaar?: boolean; status?: number | null; oorzaak?: unknown }
  ) {
    super(`ai-gateway ${categorie}: ${reden}`, opties?.oorzaak ? { cause: opties.oorzaak } : undefined);
    this.name = "GatewayFout";
    this.categorie = categorie;
    this.reden = reden;
    this.herhaalbaar = opties?.herhaalbaar ?? false;
    this.status = opties?.status ?? null;
  }
}

export function isGatewayFout(e: unknown): e is GatewayFout {
  return e instanceof GatewayFout;
}

/** Vóór de netwerkcall gestopt (configuratie of poort)? Dan is er geen providercall geweest. */
export function isVoorNetwerkGestopt(e: unknown): boolean {
  return isGatewayFout(e) && (e.categorie === "configuratie" || e.categorie === "poort_gesloten");
}

function statusVan(e: unknown): number | null {
  if (typeof e === "object" && e !== null) {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

function naamVan(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const n = (e as { name?: unknown }).name;
    if (typeof n === "string") return n;
  }
  return "";
}

function meldingVan(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

/**
 * Classificeert een fout uit een adapter/SDK/fetch-laag. Bewust duck-typed: de
 * Anthropic-SDK, rauwe fetch-wrappers en een gemockte adapter geven de status
 * en de aard via een structureel veld of alleen via naam/melding door.
 *
 *  * al een GatewayFout            → ongewijzigd door;
 *  * AiPoortGeslotenError          → poort_gesloten (reden van de poort);
 *  * signal afgebroken / *Abort*   → geannuleerd;
 *  * *Timeout* / ETIMEDOUT         → timeout (herhaalbaar);
 *  * 429                           → rate_limit (herhaalbaar);
 *  * 401/403                       → configuratie (sleutel/toegang), niet herhaalbaar;
 *  * 400/404/413/422               → provider, niet herhaalbaar;
 *  * overig (5xx, netwerk)         → provider, herhaalbaar.
 */
/**
 * De afbrekingsreden uit een `signal.reason`, duck-typed. Onze grendels zetten
 * daar een fout met een `reden`-veld in; iets anders levert `null` en dus de
 * conservatieve behandeling.
 */
function afbrekingsredenVan(reason: unknown): "annulering" | "timeout" | null {
  if (typeof reason !== "object" || reason === null) return null;
  const r = (reason as { reden?: unknown }).reden;
  return r === "timeout" || r === "annulering" ? r : null;
}

export function classificeerProviderFout(e: unknown, signal?: AbortSignal): GatewayFout {
  if (isGatewayFout(e)) return e;
  if (isPoortGesloten(e)) {
    return new GatewayFout("poort_gesloten", e.reden, { oorzaak: e });
  }
  const naam = naamVan(e);
  const melding = meldingVan(e);
  const status = statusVan(e);

  if (signal?.aborted || /abort/i.test(naam)) {
    // #356 — WAAROM er is afgebroken bepaalt de auditcategorie, en dat weet
    // alleen de afbreker. Een verlopen eigen deadline en een weggelopen
    // bestuurder breken hetzelfde signaal af; zonder deze uitlezing zou
    // `gateway_log` beide als `geannuleerd` vastleggen en is achteraf niet te
    // zien of het systeem te traag was of de gebruiker weg. De reden is
    // duck-typed: de gateway hoeft de retrievallaag niet te kennen.
    const reden = afbrekingsredenVan(signal?.reason);
    if (reden === "timeout") {
      return new GatewayFout("timeout", "budget_verlopen", { oorzaak: e });
    }
    // Onbekende abort → conservatief `geannuleerd`: liever een afbreking
    // toeschrijven aan de gebruiker dan een systeemtimeout verzinnen die er
    // misschien niet was.
    return new GatewayFout("geannuleerd", "verzoek_afgebroken", { oorzaak: e });
  }
  if (/timeout/i.test(naam) || /\bETIMEDOUT\b|timed out|_timeout$/i.test(melding)) {
    return new GatewayFout("timeout", "provider_timeout", { herhaalbaar: true, status, oorzaak: e });
  }
  if (status === 429) {
    return new GatewayFout("rate_limit", "provider_rate_limit", { herhaalbaar: true, status, oorzaak: e });
  }
  if (status === 401 || status === 403) {
    return new GatewayFout("configuratie", "provider_authenticatie", { status, oorzaak: e });
  }
  if (status !== null && [400, 404, 413, 422].includes(status)) {
    return new GatewayFout("provider", `provider_${status}`, { status, oorzaak: e });
  }
  return new GatewayFout("provider", status !== null ? `provider_${status}` : "provider_fout", {
    herhaalbaar: true,
    status,
    oorzaak: e,
  });
}
