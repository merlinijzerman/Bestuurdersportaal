// ============================================================================
//  core/lib/ai-gateway/secrets.ts — secret-/endpointREFERENTIES → omgevingswaarden
// ----------------------------------------------------------------------------
//  De database bewaart alleen sleutelnamen (ai_gateway_private.provider_profiel
//  .secret_ref/.endpoint_ref). Deze code-allowlist bepaalt welke namen bestaan en
//  vertaalt ze naar `process.env`. Een onbekende referentie faalt gesloten; een
//  vrije URL of key uit de database is daarmee onmogelijk (SSRF/lekrisico).
//  Puur: geen I/O, testbaar met een eigen env-object.
// ============================================================================

import { GatewayFout } from "./fout";

export const SECRET_REFS: ReadonlySet<string> = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "MISTRAL_API_KEY",
]);

export const ENDPOINT_REFS: ReadonlySet<string> = new Set(["OPENAI_BASE_URL", "MISTRAL_CHAT_URL"]);

export interface Credentials {
  apiKey: string;
  /** Alleen gezet als het profiel een endpoint-referentie heeft én de env die kent. */
  baseUrl?: string;
}

export function resolveerCredentials(
  refs: { secretRef: string; endpointRef?: string | null },
  env: Record<string, string | undefined> = process.env
): Credentials {
  if (!SECRET_REFS.has(refs.secretRef)) {
    throw new GatewayFout("configuratie", "secret_ref_onbekend");
  }
  const apiKey = env[refs.secretRef];
  if (!apiKey || !apiKey.trim()) {
    throw new GatewayFout("configuratie", "secret_ontbreekt");
  }
  const uit: Credentials = { apiKey };
  if (refs.endpointRef) {
    if (!ENDPOINT_REFS.has(refs.endpointRef)) {
      throw new GatewayFout("configuratie", "endpoint_ref_onbekend");
    }
    const baseUrl = env[refs.endpointRef];
    if (baseUrl && baseUrl.trim()) {
      let url: URL;
      try {
        url = new URL(baseUrl.trim());
      } catch {
        throw new GatewayFout("configuratie", "endpoint_ongeldig");
      }
      if (url.protocol !== "https:") {
        throw new GatewayFout("configuratie", "endpoint_geen_https");
      }
      uit.baseUrl = url.toString().replace(/\/+$/, "");
    }
  }
  return uit;
}
