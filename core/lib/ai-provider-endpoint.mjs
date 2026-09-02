const LOKALE_SUPABASE_URL = "http://127.0.0.1:54321";

function geblokkeerd(reden) {
  throw new Error(`E2E AI GEBLOKKEERD: ${reden}`);
}

/**
 * Geeft uitsluitend in de expliciete lokale WP4-E2E-modus een alternatieve
 * Anthropic-base-URL terug. Zonder vlag blijft de productieclient ongewijzigd.
 * De dubbele grendel voorkomt dat een Preview- of productieomgeving ooit naar
 * een testprovider kan worden omgeleid.
 */
export function resolveAnthropicBaseUrl(env = process.env) {
  if (!env.WP4_E2E_AI_PROVIDER) return undefined;
  if (env.WP4_E2E_AI_PROVIDER !== "local") {
    geblokkeerd("WP4_E2E_AI_PROVIDER moet exact 'local' zijn.");
  }
  if (env.SEED_DOELOMGEVING !== "local") {
    geblokkeerd("SEED_DOELOMGEVING moet exact 'local' zijn.");
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL !== LOKALE_SUPABASE_URL) {
    geblokkeerd(`NEXT_PUBLIC_SUPABASE_URL moet exact ${LOKALE_SUPABASE_URL} zijn.`);
  }

  let url;
  try {
    url = new URL(env.WP4_E2E_AI_PROVIDER_URL ?? "");
  } catch {
    geblokkeerd("WP4_E2E_AI_PROVIDER_URL ontbreekt of is ongeldig.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    geblokkeerd("de provider-URL moet een lokale http-origin zonder credentials zijn.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    geblokkeerd("de provider-URL mag geen pad, query of fragment bevatten.");
  }
  return url.origin;
}
