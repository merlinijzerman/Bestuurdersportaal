import assert from "node:assert/strict";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { microsoftVaultDbConfig } from "./microsoft-vault-config-core";

const ca = rootCertificates[0]!;
const caBase64 = Buffer.from(ca, "utf8").toString("base64");

test("vaultconfig vereist database-URL en CA", () => {
  assert.throws(() => microsoftVaultDbConfig(undefined, caBase64), /tokenkluis/);
  assert.throws(() => microsoftVaultDbConfig("postgresql://voorbeeld.test/db", undefined), /CA/);
  assert.throws(() => microsoftVaultDbConfig("postgresql://voorbeeld.test/db", "geen-certificaat"), /CA is ongeldig/);
});

test("vaultconfig accepteert alleen PostgreSQL", () => {
  assert.throws(() => microsoftVaultDbConfig("https://voorbeeld.test/db", caBase64), /geen PostgreSQL/);
});

test("vaultconfig valideert de CA en verwijdert conflicterende SSL-queryparameters", () => {
  const config = microsoftVaultDbConfig(
    "postgresql://gebruiker:wachtwoord@voorbeeld.test:6543/postgres?sslmode=require&sslrootcert=oud&bewaar=ja",
    caBase64,
  );
  const url = new URL(config.connectionString);
  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.has("sslrootcert"), false);
  assert.equal(url.searchParams.get("bewaar"), "ja");
  assert.equal(new X509Certificate(config.ca).fingerprint256, new X509Certificate(ca).fingerprint256);
});
