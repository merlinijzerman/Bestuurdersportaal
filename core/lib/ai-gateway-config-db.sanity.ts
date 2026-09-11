import assert from "node:assert/strict";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { aiGatewayDbConfig } from "./ai-gateway/config-db-core";

const ca = rootCertificates[0]!;
const caBase64 = Buffer.from(ca, "utf8").toString("base64");

test("gatewayconfig vereist database-URL en CA en accepteert alleen PostgreSQL", () => {
  assert.throws(() => aiGatewayDbConfig(undefined, caBase64), /niet geconfigureerd/);
  assert.throws(() => aiGatewayDbConfig("postgresql://voorbeeld.test/db", undefined), /CA is niet geconfigureerd/);
  assert.throws(() => aiGatewayDbConfig("postgresql://voorbeeld.test/db", "geen-certificaat"), /CA is ongeldig/);
  assert.throws(() => aiGatewayDbConfig("https://voorbeeld.test/db", caBase64), /geen PostgreSQL/);
});

test("gatewayconfig verwijdert conflicterende SSL-queryparameters en pint de CA", () => {
  const config = aiGatewayDbConfig(
    "postgresql://ai_gateway.ref:wachtwoord@voorbeeld.test:6543/postgres?sslmode=require&sslrootcert=oud&bewaar=ja",
    caBase64
  );
  const url = new URL(config.connectionString);
  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.has("sslrootcert"), false);
  assert.equal(url.searchParams.get("bewaar"), "ja");
  assert.ok(config.ssl !== false);
  assert.equal(new X509Certificate(config.ssl.ca).fingerprint256, new X509Certificate(ca).fingerprint256);
});

test("TLS uit is alleen toegestaan op loopback mét SEED_DOELOMGEVING=local (dubbele grendel)", () => {
  const lokaal = aiGatewayDbConfig("postgresql://ai_gateway:x@127.0.0.1:54322/postgres", undefined, {
    sslUit: "uit",
    doelomgeving: "local",
  });
  assert.equal(lokaal.ssl, false);
  assert.throws(
    () => aiGatewayDbConfig("postgresql://ai_gateway:x@db.project.supabase.co:6543/postgres", undefined, { sslUit: "uit", doelomgeving: "local" }),
    /alleen toegestaan op de lokale wegwerp-stack/
  );
  assert.throws(
    () => aiGatewayDbConfig("postgresql://ai_gateway:x@127.0.0.1:54322/postgres", undefined, { sslUit: "uit", doelomgeving: "preview" }),
    /alleen toegestaan op de lokale wegwerp-stack/
  );
  // Zonder de vlag geldt de CA-eis ook op loopback.
  assert.throws(() => aiGatewayDbConfig("postgresql://ai_gateway:x@127.0.0.1:54322/postgres", undefined, { doelomgeving: "local" }), /CA/);
});
