import { X509Certificate } from "node:crypto";

const SSL_QUERY_PARAMETERS = ["sslmode", "sslrootcert", "sslcert", "sslkey"] as const;

export type MicrosoftVaultDbConfig = {
  connectionString: string;
  ca: string;
};

/**
 * Maakt de TLS-configuratie voor de private Microsoft-vault fail-closed.
 *
 * node-postgres laat SSL-queryparameters uit de connection string voorgaan op
 * het losse `ssl`-object. Daarom verwijderen we die parameters en leveren we
 * de gecontroleerde CA expliciet aan de Pool. `rejectUnauthorized: true` blijft
 * in de server-only adapter staan, zodat certificaat- én hostnaamcontrole actief
 * zijn en een self-signed keten niet stil wordt geaccepteerd.
 */
export function microsoftVaultDbConfig(databaseUrl: string | undefined, caBase64: string | undefined): MicrosoftVaultDbConfig {
  if (!databaseUrl?.trim()) throw new Error("Microsoft-tokenkluis is niet geconfigureerd.");
  if (!caBase64?.trim()) throw new Error("Microsoft-vault-CA is niet geconfigureerd.");

  let url: URL;
  try {
    url = new URL(databaseUrl.trim());
  } catch {
    throw new Error("Microsoft-vault-database-URL is ongeldig.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Microsoft-vault-database-URL gebruikt geen PostgreSQL.");
  }

  let ca: string;
  try {
    ca = Buffer.from(caBase64.trim(), "base64").toString("utf8").trim();
    // Parse valideert zowel de PEM-vorm als de certificaatinhoud.
    void new X509Certificate(ca);
  } catch {
    throw new Error("Microsoft-vault-CA is ongeldig.");
  }

  for (const parameter of SSL_QUERY_PARAMETERS) url.searchParams.delete(parameter);
  return { connectionString: url.toString(), ca };
}
