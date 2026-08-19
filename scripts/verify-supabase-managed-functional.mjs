#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const CANARY_FLAG = "bestuurdersportaal_managed_restore_canary";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

class FunctionalCheckError extends Error {
  constructor(category, details = undefined) {
    super("Managed functionele controle faalde");
    this.name = "FunctionalCheckError";
    this.category = category;
    this.details = details;
  }
}

function safeDiagnosticToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value)
    ? value
    : undefined;
}

export function safeAuthErrorDetails(error) {
  const details = {};
  const name = safeDiagnosticToken(error?.name);
  const code = safeDiagnosticToken(error?.code);
  if (name) details.name = name;
  if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) {
    details.status = error.status;
  }
  if (code) details.code = code;
  return details;
}

function fail(category, details = undefined) {
  throw new FunctionalCheckError(category, details);
}

function assertNoError(error, category) {
  if (error) fail(category, safeAuthErrorDetails(error));
}

function securePath(candidate, secureRoot, label) {
  if (!candidate || !secureRoot || !isAbsolute(candidate) || !isAbsolute(secureRoot)) {
    fail(`${label}_path`);
  }
  const rel = relative(resolve(secureRoot), resolve(candidate));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${label}_outside_encrypted_root`);
  }
  return resolve(candidate);
}

export function chooseTenantFixtures(domains, documents) {
  if (!Array.isArray(domains) || !Array.isArray(documents)) fail("fixture_contract");
  const hostByFund = new Map();
  for (const row of domains) {
    if (row?.actief === true && UUID_PATTERN.test(row.fonds_id ?? "") && HOST_PATTERN.test(row.host ?? "")) {
      if (!hostByFund.has(row.fonds_id)) hostByFund.set(row.fonds_id, row.host.toLowerCase());
    }
  }
  const fixtures = [];
  const distinctFunds = new Set();
  for (const row of documents) {
    if (
      row?.actief === true &&
      UUID_PATTERN.test(row.fonds_id ?? "") &&
      UUID_PATTERN.test(row.id ?? "") &&
      typeof row.opslag_pad === "string" &&
      row.opslag_pad.startsWith(`${row.fonds_id}/`) &&
      hostByFund.has(row.fonds_id)
    ) {
      fixtures.push({
        fonds_id: row.fonds_id,
        host: hostByFund.get(row.fonds_id),
        document_id: row.id,
        storage_path: row.opslag_pad,
      });
      distinctFunds.add(row.fonds_id);
    }
  }
  if (distinctFunds.size < 2) fail("two_tenant_fixtures_unavailable");
  return fixtures;
}

export function validateCanaryState(state) {
  if (!state || state.schema_version !== 1 || !Array.isArray(state.canaries) || state.canaries.length !== 2) {
    fail("canary_state_contract");
  }
  for (const entry of state.canaries) {
    if (
      !UUID_PATTERN.test(entry?.user_id ?? "") ||
      !UUID_PATTERN.test(entry?.fonds_id ?? "") ||
      !UUID_PATTERN.test(entry?.document_id ?? "") ||
      typeof entry?.email !== "string" ||
      typeof entry?.password !== "string" ||
      typeof entry?.storage_path !== "string" ||
      !entry.storage_path.startsWith(`${entry.fonds_id}/`) ||
      !HOST_PATTERN.test(entry?.host ?? "")
    ) {
      fail("canary_state_entry");
    }
  }
  if (state.canaries[0].fonds_id === state.canaries[1].fonds_id) fail("canary_state_same_tenant");
  return state;
}

export function buildFunctionalEvidence({ staleRemoved, loginChecks, rlsChecks, storageChecks }) {
  const evidence = {
    schema_version: 1,
    status: "verified",
    canary_users_created: 2,
    stale_canary_users_removed: staleRemoved,
    real_password_logins: loginChecks,
    user_jwts_verified: loginChecks,
    rls_positive_checks: rlsChecks.positive,
    rls_negative_checks: rlsChecks.negative,
    cross_tenant_denials: rlsChecks.crossTenant,
    private_storage_positive_checks: storageChecks.positive,
    private_storage_cross_tenant_denials: storageChecks.negative,
    distinct_tenants_tested: 2,
  };
  if (
    !Number.isSafeInteger(staleRemoved) || staleRemoved < 0 ||
    loginChecks !== 2 ||
    rlsChecks.positive !== 4 ||
    rlsChecks.negative !== 4 ||
    rlsChecks.crossTenant !== 4 ||
    storageChecks.positive !== 2 ||
    storageChecks.negative !== 2
  ) {
    fail("functional_evidence_incomplete");
  }
  return evidence;
}

let createClientFactory;

async function makeClient(baseUrl, key) {
  if (!createClientFactory) {
    ({ createClient: createClientFactory } = await import("@supabase/supabase-js"));
  }
  return createClientFactory(baseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function removeCanaries(admin, userIds) {
  const ids = [...new Set(userIds.filter((id) => UUID_PATTERN.test(id ?? "")))];
  if (ids.length === 0) return 0;
  const { error: auditError } = await admin.from("document_inzage").delete().in("gebruiker_id", ids);
  assertNoError(auditError, "canary_audit_cleanup");
  let removed = 0;
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) removed += 1;
  }
  return removed;
}

async function removeStaleCanaries(admin) {
  const ids = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    assertNoError(error, "stale_canary_inventory");
    const users = data?.users ?? [];
    for (const user of users) {
      if (user?.app_metadata?.[CANARY_FLAG] === true) ids.push(user.id);
    }
    if (users.length < 100) break;
    if (page === 20) fail("stale_canary_inventory_limit");
  }
  return removeCanaries(admin, ids);
}

async function discoverFixtures(admin) {
  const { data: domains, error: domainError } = await admin
    .from("tenant_domains")
    .select("host,fonds_id,actief")
    .eq("actief", true)
    .limit(200);
  assertNoError(domainError, "tenant_domain_inventory");

  const { data: documents, error: documentError } = await admin
    .from("documenten")
    .select("id,fonds_id,opslag_pad,actief")
    .eq("actief", true)
    .eq("bibliotheek", "fonds")
    .not("fonds_id", "is", null)
    .not("opslag_pad", "is", null)
    .order("aangemaakt", { ascending: false })
    .limit(500);
  assertNoError(documentError, "document_fixture_inventory");

  const candidates = chooseTenantFixtures(domains, documents);
  const usable = [];
  const usableFunds = new Set();
  for (const fixture of candidates) {
    if (usableFunds.has(fixture.fonds_id)) continue;
    const { data, error } = await admin.storage.from("documenten").download(fixture.storage_path);
    if (!error && data && data.size > 0) {
      usable.push(fixture);
      usableFunds.add(fixture.fonds_id);
      if (usable.length === 2) break;
    }
  }
  if (usable.length !== 2) fail("physical_storage_fixture_unavailable");
  return usable;
}

async function createCanary(admin, fixture, runId, ordinal) {
  const token = randomBytes(12).toString("hex");
  const email = `restore-drill-${runId}-${ordinal}-${token}@restore-drill.invalid`;
  const password = `Aa1!${randomBytes(24).toString("base64url")}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      fonds_id: fixture.fonds_id,
      [CANARY_FLAG]: true,
      restore_drill_run_id: runId,
    },
    user_metadata: { naam: `Restore drill canary ${ordinal}` },
  });
  assertNoError(error, "canary_create");
  if (!UUID_PATTERN.test(data?.user?.id ?? "")) fail("canary_create_contract");
  return {
    user_id: data.user.id,
    email,
    password,
    ...fixture,
  };
}

async function loginCanary(baseUrl, clientKey, canary) {
  const client = await makeClient(baseUrl, clientKey);
  const { data, error } = await client.auth.signInWithPassword({
    email: canary.email,
    password: canary.password,
  });
  assertNoError(error, "canary_password_login");
  if (!data?.session?.access_token || data.user?.id !== canary.user_id) fail("canary_jwt_contract");
  const { data: verified, error: verifyError } = await client.auth.getUser(data.session.access_token);
  assertNoError(verifyError, "canary_jwt_verify");
  if (verified?.user?.id !== canary.user_id) fail("canary_jwt_subject");
  return client;
}

async function verifyRls(client, own, foreign) {
  const { data: ownProfile, error: ownProfileError } = await client
    .from("profielen").select("id,fonds_id").eq("id", own.user_id);
  assertNoError(ownProfileError, "rls_own_profile");
  if (ownProfile?.length !== 1 || ownProfile[0].fonds_id !== own.fonds_id) fail("rls_own_profile_result");

  const { data: foreignProfile, error: foreignProfileError } = await client
    .from("profielen").select("id").eq("id", foreign.user_id);
  assertNoError(foreignProfileError, "rls_foreign_profile");
  if (foreignProfile?.length !== 0) fail("rls_foreign_profile_visible");

  const { data: ownDocument, error: ownDocumentError } = await client
    .from("documenten").select("id,fonds_id").eq("id", own.document_id);
  assertNoError(ownDocumentError, "rls_own_document");
  if (ownDocument?.length !== 1 || ownDocument[0].fonds_id !== own.fonds_id) fail("rls_own_document_result");

  const { data: foreignDocument, error: foreignDocumentError } = await client
    .from("documenten").select("id").eq("id", foreign.document_id);
  assertNoError(foreignDocumentError, "rls_foreign_document");
  if (foreignDocument?.length !== 0) fail("rls_foreign_document_visible");

  const { data: ownObject, error: ownObjectError } = await client.storage
    .from("documenten").download(own.storage_path);
  assertNoError(ownObjectError, "storage_own_download");
  if (!ownObject || ownObject.size <= 0) fail("storage_own_download_empty");

  const { data: foreignObject, error: foreignObjectError } = await client.storage
    .from("documenten").download(foreign.storage_path);
  if (!foreignObjectError || foreignObject) fail("storage_cross_tenant_visible");
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function setup({ admin, baseUrl, clientKey, statePath, evidencePath, runId }) {
  const staleRemoved = await removeStaleCanaries(admin);
  const fixtures = await discoverFixtures(admin);
  const canaries = [];
  try {
    for (let index = 0; index < fixtures.length; index += 1) {
      canaries.push(await createCanary(admin, fixtures[index], runId, index + 1));
    }
    const state = validateCanaryState({ schema_version: 1, run_id: runId, canaries });
    await writePrivateJson(statePath, state);

    const clients = [];
    for (const canary of canaries) clients.push(await loginCanary(baseUrl, clientKey, canary));
    await verifyRls(clients[0], canaries[0], canaries[1]);
    await verifyRls(clients[1], canaries[1], canaries[0]);
    for (const client of clients) await client.auth.signOut({ scope: "local" });

    const evidence = buildFunctionalEvidence({
      staleRemoved,
      loginChecks: 2,
      rlsChecks: { positive: 4, negative: 4, crossTenant: 4 },
      storageChecks: { positive: 2, negative: 2 },
    });
    await writePrivateJson(evidencePath, evidence);
  } catch (error) {
    try {
      await removeCanaries(admin, canaries.map((entry) => entry.user_id));
    } catch {
      // De volgende run verwijdert gemarkeerde canaries vóór nieuwe fixtures.
    }
    throw error;
  }
}

async function cleanup({ admin, statePath, evidencePath }) {
  const state = validateCanaryState(JSON.parse(await readFile(statePath, "utf8")));
  const removed = await removeCanaries(admin, state.canaries.map((entry) => entry.user_id));
  if (removed !== 2) fail("canary_cleanup_incomplete");
  const { data, error } = await admin.from("profielen").select("id").in(
    "id",
    state.canaries.map((entry) => entry.user_id),
  );
  assertNoError(error, "canary_cleanup_verify");
  if (data?.length !== 0) fail("canary_profiles_remain");
  await writePrivateJson(evidencePath, {
    schema_version: 1,
    status: "verified",
    canary_users_removed: 2,
    canary_profiles_remaining: 0,
  });
}

async function purgeStale({ admin, evidencePath }) {
  const removed = await removeStaleCanaries(admin);
  await writePrivateJson(evidencePath, {
    schema_version: 1,
    status: "verified",
    stale_canary_users_removed: removed,
  });
}

function parseArgs(argv) {
  const result = { mode: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] == null) fail("arguments");
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!new Set(["purge-stale", "setup", "cleanup"]).has(args.mode)) fail("mode");
  const secureRoot = process.env.MANAGED_RESTORE_ROOT;
  const evidencePath = securePath(args.evidence, secureRoot, "evidence");
  const baseUrl = process.env.TARGET_SUPABASE_URL?.trim();
  const adminKey = process.env.TARGET_SUPABASE_ADMIN_KEY?.trim();
  const clientKey = process.env.TARGET_SUPABASE_CLIENT_KEY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!baseUrl || !adminKey || !clientKey || !runId) fail("environment");
  const admin = await makeClient(baseUrl, adminKey);
  if (args.mode === "purge-stale") {
    await purgeStale({ admin, evidencePath });
    return;
  }
  const statePath = securePath(args.state, secureRoot, "state");
  if (args.mode === "setup") {
    await setup({ admin, baseUrl, clientKey, statePath, evidencePath, runId });
  } else {
    await cleanup({ admin, statePath, evidencePath });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = error instanceof FunctionalCheckError ? error.category : "unknown";
    const details = error instanceof FunctionalCheckError ? error.details : undefined;
    const suffix = details && Object.keys(details).length > 0 ? `:${JSON.stringify(details)}` : "";
    process.stderr.write(`MANAGED_FUNCTIONAL_CHECK_FAILED:${category}${suffix}\n`);
    process.exitCode = 1;
  });
}
