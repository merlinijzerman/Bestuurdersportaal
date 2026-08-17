import { strict as assert } from "node:assert";
import test from "node:test";

import { captureInventory, extractVercelEnvironmentNames, sanitizeForInventory, summarizeInventoryFailures } from "./capture-platform-inventory.mjs";

test("platform-inventory verwijdert secretachtige velden recursief", () => {
  const result = sanitizeForInventory({
    site_url: "https://example.supabase.co",
    jwt_secret: "niet-in-inventory",
    nested: { client_secret: "niet-in-inventory", enabled: true },
    list: [{ api_key: "niet-in-inventory", name: "google" }],
  });

  assert.deepEqual(result, {
    site_url: "https://example.supabase.co",
    nested: { enabled: true },
    list: [{ name: "google" }],
  });
});

test("platform-inventory logt alleen component en HTTP-status", () => {
  const result = summarizeInventoryFailures([
    { component: "supabase.auth", error: "Supabase auth gaf HTTP 403 met gevoelig detail" },
    { component: "supabase.functions", error: "netwerkfout met gevoelig detail" },
  ]);

  assert.deepEqual(result, [
    { component: "supabase.auth", http_status: 403 },
    { component: "supabase.functions", http_status: null },
  ]);
  assert.equal(JSON.stringify(result).includes("gevoelig detail"), false);
});

test("platform-inventory neemt alleen Vercel-variabelenamen over", () => {
  const result = extractVercelEnvironmentNames({
    envs: [{ id: "env-1", key: "SUPABASE_SERVICE_ROLE_KEY", value: "niet-in-inventory", target: ["production"] }],
  });

  assert.deepEqual(result, [{
    id: "env-1",
    key: "SUPABASE_SERVICE_ROLE_KEY",
    target: ["production"],
    type: null,
    gitBranch: null,
    customEnvironmentIds: null,
    comment: null,
    createdAt: null,
    updatedAt: null,
  }]);
  assert.equal(JSON.stringify(result).includes("niet-in-inventory"), false);
});

test("platform-inventory publiceert alleen een complete inventaris", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const target = new URL(url);
      if (target.hostname === "api.supabase.com") return Response.json({ enabled: true, site_url: "https://example.supabase.co" });
      if (target.pathname.endsWith("/env")) {
        return Response.json({ envs: [{ id: "env-1", key: "PUBLIC_URL", value: "niet-in-inventory" }] });
      }
      if (target.hostname === "api.vercel.com") return Response.json({ name: "bestuurdersportaal" });
      throw new Error(`Onverwachte mock-request: ${url}`);
    };

    const inventory = await captureInventory({
      projectRef: "aebwiufuegsiwhwpdrfb",
      supabaseManagementToken: "test-token",
      vercelProjectIds: ["bestuurdersportaal", "bestuurdersportaal-beheer"],
      vercelToken: "test-token",
      capturedUtc: "2026-08-17T00:00:00.000Z",
    });

    assert.equal(inventory.status, "complete");
    assert.equal(inventory.redaction.secret_values_captured, false);
    assert.equal(JSON.stringify(inventory).includes("niet-in-inventory"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("platform-inventory markeert ontbrekende read-only scopes als partial", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const target = new URL(url);
      if (target.hostname === "api.supabase.com" && target.pathname.endsWith("/config/auth")) {
        return new Response("forbidden", { status: 403 });
      }
      if (target.pathname.endsWith("/env")) return Response.json({ envs: [] });
      if (target.hostname === "api.supabase.com" || target.hostname === "api.vercel.com") return Response.json({});
      throw new Error(`Onverwachte mock-request: ${url}`);
    };

    const inventory = await captureInventory({
      projectRef: "aebwiufuegsiwhwpdrfb",
      supabaseManagementToken: "test-token",
      vercelProjectIds: ["bestuurdersportaal"],
      vercelToken: "test-token",
    });

    assert.equal(inventory.status, "partial");
    assert.equal(inventory.coverage.supabase_auth_config, false);
    assert.ok(inventory.failures.some((failure) => failure.component === "supabase.auth"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
