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
  return resolveLokaleProviderOrigin(env, "WP4_E2E_AI_PROVIDER", "WP4_E2E_AI_PROVIDER_URL");
}

/**
 * #349 (F4-T1b) — dezelfde omleiding voor de EMBEDDING-provider.
 *
 * Waarom een tweede, LOSSE vlag en niet dezelfde: de embeddingstub en de
 * Anthropic-stub zijn onafhankelijke testmiddelen. Eén gedeelde vlag zou de
 * embeddingsomleiding stilzwijgend aanzetten zodra iemand de chatstub gebruikt
 * (en andersom), en dan is niet meer te zien wélke provider is omgeleid. De
 * dubbele grendel — expliciet 'local', `SEED_DOELOMGEVING=local` én de lokale
 * Supabase-URL — is identiek, zodat Preview en Productie hier nooit in kunnen
 * belanden.
 */
export function resolveMistralBaseUrl(env = process.env) {
  return resolveLokaleProviderOrigin(env, "WP4_E2E_EMBED_PROVIDER", "WP4_E2E_EMBED_PROVIDER_URL");
}

/** Gedeelde grendel. Ongezet = productiegedrag; alles daarbuiten is fail-closed. */
function resolveLokaleProviderOrigin(env, vlagNaam, urlNaam) {
  if (!env[vlagNaam]) return undefined;
  if (env[vlagNaam] !== "local") {
    geblokkeerd(`${vlagNaam} moet exact 'local' zijn.`);
  }
  if (env.SEED_DOELOMGEVING !== "local") {
    geblokkeerd("SEED_DOELOMGEVING moet exact 'local' zijn.");
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL !== LOKALE_SUPABASE_URL) {
    geblokkeerd(`NEXT_PUBLIC_SUPABASE_URL moet exact ${LOKALE_SUPABASE_URL} zijn.`);
  }

  let url;
  try {
    url = new URL(env[urlNaam] ?? "");
  } catch {
    geblokkeerd(`${urlNaam} ontbreekt of is ongeldig.`);
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
