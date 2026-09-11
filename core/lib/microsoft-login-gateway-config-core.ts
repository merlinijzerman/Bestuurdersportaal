// ============================================================================
//  core/lib/microsoft-login-gateway-config-core.ts — pure verbindingsconfiguratie
//  voor de aparte databaserol login_gateway (Microsoft-login fase 1B, #335, T1).
// ----------------------------------------------------------------------------
//  Patroon core/lib/ai-gateway/config-db-core.ts: fail-closed TLS. SSL-query-
//  parameters uit de URL worden verwijderd en de gecontroleerde CA gaat expliciet
//  naar de Pool (rejectUnauthorized blijft in de server-only adapter op true).
//  Eén bewuste uitzondering: de lokale wegwerp-stack heeft geen TLS; alleen mét
//  de expliciete vlag `LOGIN_GATEWAY_DB_SSL=uit` én `SEED_DOELOMGEVING=local` mag
//  de verbinding zonder TLS — dezelfde dubbele grendel als de AI-gateway.
//  Puur: geen I/O, geen server-imports → testbaar met tsx/node.
// ============================================================================

import { X509Certificate } from "node:crypto";

const SSL_QUERY_PARAMETERS = ["sslmode", "sslrootcert", "sslcert", "sslkey"] as const;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type LoginGatewayDbConfig =
  | { connectionString: string; ssl: { ca: string } }
  | { connectionString: string; ssl: false };

export function loginGatewayDbConfig(
  databaseUrl: string | undefined,
  caBase64: string | undefined,
  opties: { sslUit?: string; doelomgeving?: string } = {}
): LoginGatewayDbConfig {
  if (!databaseUrl?.trim()) throw new Error("Login-gateway-database is niet geconfigureerd.");

  let url: URL;
  try {
    url = new URL(databaseUrl.trim());
  } catch {
    throw new Error("Login-gateway-database-URL is ongeldig.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Login-gateway-database-URL gebruikt geen PostgreSQL.");
  }
  for (const parameter of SSL_QUERY_PARAMETERS) url.searchParams.delete(parameter);

  if (opties.sslUit === "uit") {
    if (!LOOPBACK.has(url.hostname) || opties.doelomgeving !== "local") {
      throw new Error(
        "Login-gateway-database zonder TLS is alleen toegestaan op de lokale wegwerp-stack (loopback + SEED_DOELOMGEVING=local)."
      );
    }
    return { connectionString: url.toString(), ssl: false };
  }

  if (!caBase64?.trim()) throw new Error("Login-gateway-database-CA is niet geconfigureerd.");
  let ca: string;
  try {
    ca = Buffer.from(caBase64.trim(), "base64").toString("utf8").trim();
    void new X509Certificate(ca);
  } catch {
    throw new Error("Login-gateway-database-CA is ongeldig.");
  }
  return { connectionString: url.toString(), ssl: { ca } };
}
