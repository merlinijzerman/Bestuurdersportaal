#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const OPAQUE_ADMIN_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const OPAQUE_CLIENT_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,}$/;

function decodeLegacyPayload(key) {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function classifySupabaseKey(key, { purpose, projectRef }) {
  if (typeof key !== "string" || !key) throw new Error("Supabase-key ontbreekt");
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("Project-ref heeft niet het verwachte formaat");

  if (OPAQUE_ADMIN_PATTERN.test(key)) {
    if (purpose !== "admin") throw new Error("Een secret key mag niet als clientkey worden gebruikt");
    return "secret";
  }
  if (OPAQUE_CLIENT_PATTERN.test(key)) {
    if (purpose !== "client") throw new Error("Een publishable key mag niet voor beheerhandelingen worden gebruikt");
    return "publishable";
  }

  const payload = decodeLegacyPayload(key);
  if (!payload) throw new Error("Supabase-key heeft geen ondersteund formaat");
  if (payload.ref !== projectRef) throw new Error("Legacy Supabase-key hoort niet bij het doelproject");
  if (purpose === "admin" && payload.role !== "service_role") {
    throw new Error("Voor beheerhandelingen is een service-role-key vereist");
  }
  if (purpose === "client" && payload.role !== "anon") {
    throw new Error("Voor clienttests is een anon-key vereist");
  }
  return purpose === "admin" ? "legacy_service_role" : "legacy_anon";
}

export function validateManagedKeyPair({ adminKey, clientKey, projectRef }) {
  if (adminKey === clientKey) throw new Error("Admin- en clientkey moeten verschillend zijn");
  return {
    admin_key_type: classifySupabaseKey(adminKey, { purpose: "admin", projectRef }),
    client_key_type: classifySupabaseKey(clientKey, { purpose: "client", projectRef }),
  };
}

async function verifyResponse(response, label) {
  await response.arrayBuffer();
  if (!response.ok) {
    const error = new Error(`${label} faalde`);
    error.httpStatus = response.status;
    throw error;
  }
}

export function managedAdminHeaders(adminKey, adminKeyType) {
  if (adminKeyType === "secret") return { apikey: adminKey };
  if (adminKeyType === "legacy_service_role") {
    return { apikey: adminKey, Authorization: `Bearer ${adminKey}` };
  }
  throw new Error("Ongeldig admin-keytype");
}

export async function verifyManagedKeyConnectivity({ baseUrl, adminKey, clientKey, adminKeyType, fetchImpl = fetch }) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const adminResponse = await fetchImpl(`${normalized}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: managedAdminHeaders(adminKey, adminKeyType),
    signal: AbortSignal.timeout(15_000),
  });
  await verifyResponse(adminResponse, "Admin-keycontrole");

  // Bewust uitsluitend de clientkey: een publishable/anon-key mag nooit het
  // adminendpoint of een beheerclient bereiken.
  const clientResponse = await fetchImpl(`${normalized}/auth/v1/settings`, {
    headers: { apikey: clientKey },
    signal: AbortSignal.timeout(15_000),
  });
  await verifyResponse(clientResponse, "Clientkeycontrole");
}

async function main() {
  const projectRef = process.env.TARGET_PROJECT_REF?.trim();
  const baseUrl = process.env.TARGET_SUPABASE_URL?.trim();
  const adminKey = process.env.TARGET_SUPABASE_ADMIN_KEY?.trim();
  const clientKey = process.env.TARGET_SUPABASE_CLIENT_KEY?.trim();
  if (!projectRef || !baseUrl || !adminKey || !clientKey) {
    throw new Error("Managed keycontrole mist verplichte inputs");
  }
  if (new URL(baseUrl).hostname !== `${projectRef}.supabase.co`) {
    throw new Error("TARGET_SUPABASE_URL hoort niet aantoonbaar bij het doelproject");
  }

  const classification = validateManagedKeyPair({ adminKey, clientKey, projectRef });
  await verifyManagedKeyConnectivity({
    baseUrl,
    adminKey,
    clientKey,
    adminKeyType: classification.admin_key_type,
  });
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    status: "verified",
    ...classification,
    target_binding_verified: true,
    publishable_key_used_for_admin: false,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : null;
    process.stderr.write(`MANAGED_KEY_CHECK_FAILED${status ? `_HTTP_${status}` : ""}\n`);
    process.exitCode = 1;
  });
}
