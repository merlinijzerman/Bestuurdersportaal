import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppSmokeEvidence,
  classifySmokePath,
  formatSmokeDiagnostic,
  validateAppCanaryState,
} from "./run-supabase-managed-app-smoke.mjs";

const state = {
  schema_version: 1,
  canaries: [
    {
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      document_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      host: "a.example.nl",
      email: "a@example.invalid",
      password: "Aa1!password",
    },
    {
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      document_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      host: "b.example.nl",
      email: "b@example.invalid",
      password: "Aa1!password",
    },
  ],
};

test("accepteert alleen een volledige tweecanary-state", () => {
  assert.equal(validateAppCanaryState(state).canaries.length, 2);
  assert.throws(() => validateAppCanaryState({ schema_version: 1, canaries: [state.canaries[0]] }));
});

test("app-evidence bevat alleen booleans en aantallen", () => {
  const evidence = buildAppSmokeEvidence({
    real_browser_login: true,
    dashboard_rendered: true,
    document_list_rendered: true,
    document_list_api_authorized: true,
    private_download_authorized: true,
    private_download_headers_safe: true,
    cross_tenant_download_denied: true,
  });
  assert.equal(evidence.app_routes_verified, 3);
  assert.equal(Object.hasOwn(evidence, "document_id"), false);
  assert.equal(Object.hasOwn(evidence, "email"), false);
});

test("app-evidence faalt als een negatieve isolatiecheck ontbreekt", () => {
  assert.throws(() => buildAppSmokeEvidence({
    real_browser_login: true,
    dashboard_rendered: true,
    document_list_rendered: true,
    document_list_api_authorized: true,
    private_download_authorized: true,
    private_download_headers_safe: true,
    cross_tenant_download_denied: false,
  }));
});

test("routediagnose plet elke onbekende of gegevensdragende URL", () => {
  assert.equal(classifySmokePath("http://a.example.nl:3000/login?next=/x"), "/login");
  assert.equal(classifySmokePath("http://a.example.nl:3000/"), "/");
  assert.equal(
    classifySmokePath("http://a.example.nl:3000/api/documents/cccccccc-cccc-4ccc-8ccc-cccccccccccc/bestand"),
    "other"
  );
  assert.equal(classifySmokePath("geen-url"), "unknown");
});

test("diagnose publiceert uitsluitend booleans en geclassificeerde routes", () => {
  const line = formatSmokeDiagnostic({
    pathname: "/login",
    root_path: "/login",
    login_error: true,
    login_busy: false,
    auth_cookie: false,
  });
  assert.equal(line, "pathname=/login;root_path=/login;login_error=true;login_busy=false;auth_cookie=false");
});

test("diagnose weigert vrije tekst, cookiewaarden en onbekende velden", () => {
  const line = formatSmokeDiagnostic({
    pathname: "http://a.example.nl:3000/login",
    root_path: "/bibliotheek",
    auth_cookie: true,
    email: "a@example.invalid",
    cookie: "sb-access-token=geheim",
    foutmelding: "Inloggen mislukt",
  });
  assert.equal(line, "root_path=/bibliotheek;auth_cookie=true");
  assert.equal(line.includes("example.invalid"), false);
  assert.equal(line.includes("geheim"), false);
});
