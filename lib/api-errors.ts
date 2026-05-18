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
//    Vercel-logs. Bij WP7 (Sentry) wordt hier `Sentry.captureException`
//    toegevoegd — alle routes profiteren dan automatisch zonder verdere code-
//    wijzigingen.
//
// 3. **Eén plek voor consistent gedrag.** Eerder lekten 8+ routes
//    `error.message` direct in de response. Door alles via deze helper te
//    laten lopen is het patroon uniform en weet je zeker dat een toekomstige
//    catch ook hardened is.
//
// Gebruik:
//
// ```ts
// import { errorResponse } from "@/lib/api-errors";
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

type ErrorResponseOptions = {
  /** Door naar de gebruiker. Default: generieke Nederlandse melding. */
  userMessage?: string;
  /** HTTP-statuscode. Default: 500. */
  status?: number;
  /** Aanvullende context die in de server-log meegaat (niet in de response). */
  context?: Record<string, unknown>;
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
  console.error(`[${label}]`, error, opts.context ?? "");

  // Hook voor WP7 (Sentry): zodra @sentry/nextjs is geïnstalleerd kun je
  // hier `Sentry.captureException(error, { tags: { route: label }, extra: opts.context })`
  // toevoegen. Alle routes die deze helper gebruiken sturen dan automatisch
  // exceptions naar Sentry — zonder code-wijziging in de routes zelf.

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
  return NextResponse.json({ error: userMessage }, { status });
}
