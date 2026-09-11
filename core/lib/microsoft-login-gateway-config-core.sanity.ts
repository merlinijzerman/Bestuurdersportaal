import assert from "node:assert/strict";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { loginGatewayDbConfig } from "./microsoft-login-gateway-config-core";

const ca = rootCertificates[0]!;
const caBase64 = Buffer.from(ca, "utf8").toString("base64");

test("login-gatewayconfig vereist database-URL en CA en accepteert alleen PostgreSQL", () => {
  assert.throws(() => loginGatewayDbConfig(undefined, caBase64), /niet geconfigureerd/);
  assert.throws(() => loginGatewayDbConfig("postgresql://voorbeeld.test/db", undefined), /CA is niet geconfigureerd/);
  assert.throws(() => loginGatewayDbConfig("postgresql://voorbeeld.test/db", "geen-certificaat"), /CA is ongeldig/);
  assert.throws(() => loginGatewayDbConfig("https://voorbeeld.test/db", caBase64), /geen PostgreSQL/);
  assert.throws(() => loginGatewayDbConfig("niet-een-url", caBase64), /ongeldig/);
});

test("login-gatewayconfig verwijdert conflicterende SSL-queryparameters en pint de CA", () => {
  const config = loginGatewayDbConfig(
    "postgresql://login_gateway.ref:wachtwoord@voorbeeld.test:6543/postgres?sslmode=require&sslrootcert=oud&bewaar=ja",
    caBase64
  );
  const url = new URL(config.connectionString);
  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.has("sslrootcert"), false);
  assert.equal(url.searchParams.get("bewaar"), "ja");
  assert.notEqual(config.ssl, false);
  if (config.ssl !== false) {
    assert.equal(new X509Certificate(config.ssl.ca).fingerprint256, new X509Certificate(ca).fingerprint256);
  }
});

test("zonder TLS alleen op loopback én met SEED_DOELOMGEVING=local (dubbele grendel)", () => {
  const lokaal = loginGatewayDbConfig("postgresql://login_gateway:x@127.0.0.1:54322/postgres", undefined, {
    sslUit: "uit",
    doelomgeving: "local",
  });
  assert.equal(lokaal.ssl, false);
  assert.throws(
    () => loginGatewayDbConfig("postgresql://login_gateway:x@db.voorbeeld.test:5432/postgres", undefined, { sslUit: "uit", doelomgeving: "local" }),
    /alleen toegestaan op de lokale wegwerp-stack/
  );
  assert.throws(
    () => loginGatewayDbConfig("postgresql://login_gateway:x@127.0.0.1:54322/postgres", undefined, { sslUit: "uit", doelomgeving: "preview" }),
    /alleen toegestaan op de lokale wegwerp-stack/
  );
  // Zonder de vlag blijft TLS verplicht, ook op loopback.
  assert.throws(() => loginGatewayDbConfig("postgresql://login_gateway:x@127.0.0.1:54322/postgres", undefined, { doelomgeving: "local" }), /CA is niet geconfigureerd/);
});
