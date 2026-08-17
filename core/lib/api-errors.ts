// ============================================================================
// API-error sanitization helper — Route A WP6
// ----------------------------------------------------------------------------
// Centrale plek waar elke API-route zijn server-fouten doorheen jaagt. Doel:
//
// 1. **Geen Supabase-detail-lekken in responses.** Supabase-foutmeldingen
//    kunnen kolomnamen, tabelnamen, of zelfs row-data lekken — handig voor een
//    aanvaller om je schema te leren kennen. Daarom retourneert deze helper
//    altijd een generieke, gebruiksvriendelijke Nederlandse melding zonder
//    technische details.
//
// 2. **Server-side logging blijft volledig.** De originele error wordt naar
//    `console.error` geschreven met een route-label voor traceerbaarheid in
//    Vercel-logs. Sinds P5 (2026-08-03) gaat daarnaast een GESANITEERDE,
//    gestructureerde regel naar `app_errors` — alle routes die deze helper
//    gebruiken profiteren automatisch, zonder wijziging in de routes zelf.
//    Dat sluit de openstaande helft van besluit 0005 (WP7 in-stack, geen Sentry).
//
// 3. **Eén plek voor consistent gedrag.** Eerder lekten 8+ routes
//    `error.message` direct in de response. Door alles via deze helper te
//    laten lopen is het patroon uniform en weet je zeker dat een toekomstige
//    catch ook hardened is.
//
// Gebruik:
//
// ```ts
// import { errorResponse } from "@/core/lib/api-errors";
// // ...
// catch (error) {
//   return errorResponse("agendapunten.POST", error);
// }
// ```
//
// Voor specifieke gebruiksvriendelijke meldingen (bv. "Aanmaken procedure
// mislukt") kun je de optionele `userMessage` meegeven:
//
// ```ts
// return errorResponse("procedures.POST", error, {
//   userMessage: "Aanmaken procedure mislukt. Probeer het opnieuw of neem contact op.",
// });
// ```
// ============================================================================

import { NextResponse } from "next/server";
import { logAppFout } from "./app-fout-schrijf";
import type { FoutCategorie, FoutSeverity } from "./app-fout";

type ErrorResponseOptions = {
  /** Door naar de gebruiker. Default: generieke Nederlandse melding. */
  userMessage?: string;
  /** HTTP-statuscode. Default: 500. */
  status?: number;
  /**
   * Aanvullende context die in de server-log meegaat (niet in de response).
   * In `app_errors` landen hiervan alleen de SLEUTELS, nooit de waarden.
   */
  context?: Record<string, unknown>;
  /**
   * Overrides voor de foutclassificatie in `app_errors`. Alleen invullen als de
   * route het beter weet dan de afleiding uit label + status + foutvorm.
   */
  categorie?: FoutCategorie;
  severity?: FoutSeverity;
  /** Koppelt de foutregel aan een platform_event_log-correlatie, waar van toepassing. */
  correlatieId?: string | null;
};

const DEFAULT_USER_MESSAGE =
  "Er ging iets mis bij het verwerken van uw verzoek. Probeer het opnieuw of neem contact op met de beheerder.";

/**
 * Standaard error-response voor API-routes.
 *
 * - Logt de originele error naar console.error met routelabel + optionele
 *   context, zodat Vercel-logs de volledige stack tonen.
 * - Retourneert een NextResponse met alleen een generieke fout-melding —
 *   geen `error.message`, geen `.toString()`, geen stack.
 *
 * @param label   Korte identifier van de route (bv. "agendapunten.POST"),
 *                gebruikt als log-prefix en straks als Sentry-tag.
 * @param error   De gevangen fout. Mag van elk type zijn (unknown).
 * @param opts    Optionele overrides voor user-message, status en context.
 */
export function errorResponse(
  label: string,
  error: unknown,
  opts: ErrorResponseOptions = {}
): NextResponse {
  const status = opts.status ?? 500;
  const userMessage = opts.userMessage ?? DEFAULT_USER_MESSAGE;

  // Server-side logging — volledige error gaat naar Vercel-logs.
  // BEWUST geen client-leak: deze regel is alleen voor de operator.
  // Dit blijft het EERSTE spoor en staat bewust vóór het wegschrijven: een fout
  // tijdens een DB-storing landt niet in app_errors (aanvaarde schuld, 0005),
  // maar staat dan nog steeds hier.
  console.error(`[${label}]`, error, opts.context ?? "");

  // P5: gesaniteerde, gestructureerde regel naar app_errors. Fire-and-forget —
  // draait in after(), werpt nooit, en kan deze response niet vertragen of
  // blokkeren. De sanitatie (welke velden wél en niet mee mogen) staat in
  // core/lib/app-fout.ts; de negatieve controle in core/lib/app-fout.sanity.ts.
  logAppFout({
    label,
    error,
    httpStatus: status,
    categorie: opts.categorie,
    severity: opts.severity,
    context: opts.context,
    correlatieId: opts.correlatieId ?? null,
  });

  return NextResponse.json({ error: userMessage }, { status });
}

/**
 * Variant voor 400-fouten met een specifieke user-facing reden (bv.
 * validatie-fouten). De reden wordt wél naar de gebruiker gestuurd omdat het
 * een gevalideerde, veilige string is (geen Supabase-leak). Server-log krijgt
 * dezelfde reden als context.
 *
 * Gebruik:
 *
 * ```ts
 * return badRequest("documents.upload", "Bestandstype niet ondersteund");
 * ```
 */
export function badRequest(label: string, userMessage: string, status: number = 400): NextResponse {
  console.warn(`[${label}] 400 ${userMessage}`);
  // BEWUST NIET naar app_errors: dit zijn afgekeurde gebruikersinvoer-gevallen
  // (75 aanroepen in de codebase, elke verkeerde upload of lege vraag telt mee).
  // Geen enkel signaal uit deze tranche leest categorie 'validatie', dus het
  // levert alleen ruis en volume op. Herzien zodra er een validatiesignaal komt.
  return NextResponse.json({ error: userMessage }, { status });
}

/**
 * HTTP 429-response voor rate limiting (Route A WP2).
 *
 * Gesanitiseerde, leesbare Nederlandse melding mét een concrete hint wanneer het
 * weer mag, plus een `Retry-After`-header (seconden) zodat clients netjes kunnen
 * terugschakelen. Geen Supabase-/teller-details in de response.
 *
 * @param label   Routelabel voor server-log (bv. "chat.POST").
 * @param resetAt Moment waarop er weer ruimte komt; mag null zijn (onbekend).
 */
export function rateLimited(label: string, resetAt: Date | null): NextResponse {
  const nu = Date.now();
  const secondenTotReset =
    resetAt && resetAt.getTime() > nu
      ? Math.ceil((resetAt.getTime() - nu) / 1000)
      : 60;

  const hint = formatteerResetHint(secondenTotReset);
  const userMessage = `U heeft te veel verzoeken achter elkaar gedaan. Probeer het ${hint} opnieuw.`;

  console.warn(`[${label}] 429 rate limited — reset over ~${secondenTotReset}s`);

  // P5 signaal 5: dit is de enige bron die 90 dagen meegaat voor
  // rate-limit-incidenten. `rate_limit_events` is dat niet — fn_rate_limit_check
  // verwijdert verlopen rijen bij elke check (2026_06_10_rate_limiting.sql), dus
  // historische incidenten zijn daar niet telbaar.
  //
  // GEEN BEWIJSMATERIAAL. app_errors is een operationele logtabel: niet
  // append-only, 90 dagen retentie, met de service-role verwijderbaar
  // (besluit 0104). Een incident dat meldplichtig kán zijn (art. 33/34) moet
  // daarom óók een spoor in platform_event_log of governance_log krijgen; deze
  // regel is een signaal, geen vastlegging.
  logAppFout({
    label,
    error: new Error("rate limit bereikt"),
    httpStatus: 429,
    categorie: "rate_limiting",
    severity: "laag",
  });

  return NextResponse.json(
    { error: userMessage },
    { status: 429, headers: { "Retry-After": String(secondenTotReset) } }
  );
}

/**
 * HTTP 429 voor een bereikt MAANDQUOTUM (AI-begrenzing, besluit 0180).
 *
 * Bewust een eigen helper naast `rateLimited()`: een burstlimiet en een
 * maandquotum voelen voor de gebruiker totaal anders. "Probeer het over 30
 * seconden opnieuw" is bij een vol maandtegoed misleidend — daarom een eigen
 * tekst en een `Retry-After` die tot de eerste van de volgende kalendermaand
 * loopt.
 *
 * De melding noemt NOOIT tellerstanden van andere gebruikers of fondsen, en
 * evenmin welke grens precies is geraakt op een manier die iets over andere
 * tenants prijsgeeft (FR-1).
 *
 * @param bereik Welk tegoed op is, in gebruikerstaal.
 */
export function quotumBereikt(
  label: string,
  bereik: "gebruiker" | "fonds" | "platform" | "ocr",
  resetSeconden: number | null
): NextResponse {
  const seconden = resetSeconden && resetSeconden > 0 ? resetSeconden : 3600;

  const tekst: Record<typeof bereik, string> = {
    gebruiker:
      "U heeft uw maandtegoed voor AI-functies gebruikt. Volgende maand staat het weer open.",
    fonds:
      "Het maandtegoed voor AI-functies van uw fonds is bereikt. Volgende maand staat het weer open.",
    platform:
      "Het maandtegoed voor AI-functies van deze omgeving is bereikt. Volgende maand staat het weer open.",
    ocr: "Het maandtegoed voor tekstherkenning van uw fonds is bereikt. Volgende maand staat het weer open.",
  };

  console.warn(`[${label}] 429 quotum bereikt (${bereik}) — reset over ~${seconden}s`);
  logAppFout({
    label,
    error: new Error(`ai-quotum bereikt: ${bereik}`),
    httpStatus: 429,
    categorie: "rate_limiting",
    severity: "laag",
  });

  return NextResponse.json(
    { error: tekst[bereik] },
    { status: 429, headers: { "Retry-After": String(seconden) } }
  );
}

/**
 * HTTP 503 wanneer de AI-begrenzing een call tegenhoudt: een kill switch staat
 * uit, het model staat niet (meer) op de allowlist, of de begrenzing zelf is
 * onbereikbaar en het pad valt fail-closed dicht.
 *
 * De respons is gesaniteerd: geen providernaam, geen configuratie, geen
 * modelstring. Dat de AI tijdelijk uit staat is genoeg voor de gebruiker; het
 * waaróm hoort in het beheerscherm en het auditspoor, niet in een API-antwoord.
 */
export function aiGeblokkeerd(label: string, interneReden: string): NextResponse {
  console.warn(`[${label}] 503 ai-begrenzing: ${interneReden}`);
  // `retrieval_ai` is de bestaande categorie voor het AI-domein (FO §18.1); de
  // CHECK op app_errors.categorie kent geen eigen waarde voor de begrenzing en
  // dat is het niet waard om een migratie voor te doen.
  logAppFout({
    label,
    error: new Error(`ai-begrenzing blokkeert: ${interneReden}`),
    httpStatus: 503,
    categorie: "retrieval_ai",
    severity: "middel",
  });

  return NextResponse.json(
    {
      error:
        "De AI-functies zijn op dit moment uitgeschakeld. Neem contact op met uw beheerder als dit onverwacht is.",
    },
    { status: 503 }
  );
}

/**
 * HTTP 409 bij een duplicaat: dezelfde actie loopt al, of dezelfde
 * idempotentiesleutel wordt hergebruikt voor andere inhoud. In beide gevallen
 * gaat er GEEN providercall uit — dat is precies het punt.
 */
export function duplicaatVerzoek(label: string, conflict: boolean): NextResponse {
  console.warn(`[${label}] 409 ${conflict ? "sleutelconflict" : "actie loopt al"}`);
  return NextResponse.json(
    {
      error: conflict
        ? "Dit verzoek kon niet worden verwerkt. Vernieuw de pagina en probeer het opnieuw."
        : "Deze actie loopt al. Wacht tot hij klaar is.",
    },
    { status: 409 }
  );
}

/** Maakt een korte NL-tijdshint ("over circa 3 minuten") van een aantal seconden. */
function formatteerResetHint(seconden: number): string {
  if (seconden <= 90) {
    return `over circa ${Math.max(1, Math.round(seconden / 10) * 10)} seconden`;
  }
  const minuten = Math.ceil(seconden / 60);
  return `over circa ${minuten} ${minuten === 1 ? "minuut" : "minuten"}`;
}
