#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EXACT_COUNT_FIELDS = [
  "auth_users",
  "auth_identities",
  "storage_buckets",
  "storage_objects",
];

const VALIDATION_CATEGORIES = new Set([
  "contract",
  "postgres_major",
  "count_auth_users",
  "count_auth_identities",
  "count_storage_buckets",
  "count_storage_objects",
  "count_storage_by_bucket",
  "count_critical_public",
  "content_auth_users",
  "content_auth_identities",
  "content_storage_buckets",
  "content_storage_objects",
  "content_critical_public",
  "policies",
  "triggers",
  "extensions",
  "storage_manifest",
]);

class RestoreValidationError extends Error {
  constructor(message, category) {
    super(`Restore-validatie mislukt: ${message}`);
    this.name = "RestoreValidationError";
    this.category = category;
  }
}

function fail(message, category = "contract") {
  throw new RestoreValidationError(message, VALIDATION_CATEGORIES.has(category) ? category : "contract");
}

export function restoreValidationDiagnostic(error) {
  return {
    category: error instanceof RestoreValidationError && VALIDATION_CATEGORIES.has(error.category)
      ? error.category
      : "unknown",
  };
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is geen object`);
  return value;
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} is geen niet-negatief geheel getal`);
  return value;
}

function normalizeCountMap(value, label) {
  const object = requireObject(value, label);
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => [key, requireCount(count, `${label}.${key}`)]),
  );
}

function normalizeStringSet(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    fail(`${label} is geen lijst met niet-lege strings`);
  }
  if (new Set(value).size !== value.length) fail(`${label} bevat dubbele waarden`);
  return [...value].sort();
}

function normalizeHashTree(value, label) {
  const object = requireObject(value, label);
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, hashOrChildren]) => {
        if (typeof hashOrChildren === "string") {
          if (!/^[0-9a-f]{64}$/.test(hashOrChildren)) fail(`${label}.${key} is geen SHA-256`);
          return [key, hashOrChildren];
        }
        return [key, normalizeHashTree(hashOrChildren, `${label}.${key}`)];
      }),
  );
}

function normalizeObjectHashes(value, label) {
  if (!Array.isArray(value)) fail(`${label} is geen lijst`);
  const normalized = value.map((item, index) => {
    const object = requireObject(item, `${label}[${index}]`);
    for (const key of ["schema", "table", "name", "sha256"]) {
      if (typeof object[key] !== "string" || !object[key]) fail(`${label}[${index}].${key} ontbreekt`);
    }
    if (!/^[0-9a-f]{64}$/.test(object.sha256)) fail(`${label}[${index}].sha256 is geen SHA-256`);
    return { schema: object.schema, table: object.table, name: object.name, sha256: object.sha256 };
  });
  normalized.sort((left, right) =>
    `${left.schema}.${left.table}.${left.name}`.localeCompare(`${right.schema}.${right.table}.${right.name}`),
  );
  const names = normalized.map((item) => `${item.schema}.${item.table}.${item.name}`);
  if (new Set(names).size !== names.length) fail(`${label} bevat dubbele objectnamen`);
  return normalized;
}

function compareCount(source, target, field) {
  const expected = requireCount(source[field], `bron.${field}`);
  const actual = requireCount(target[field], `doel.${field}`);
  if (actual !== expected) fail(`${field}: verwacht ${expected}, aangetroffen ${actual}`, `count_${field}`);
}

function compareCountMap(sourceValue, targetValue, label, category = "contract") {
  const expected = normalizeCountMap(sourceValue, `bron.${label}`);
  const actual = normalizeCountMap(targetValue, `doel.${label}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} wijkt af (verwacht ${JSON.stringify(expected)}, aangetroffen ${JSON.stringify(actual)})`, category);
  }
  return expected;
}

function compareContentHashes(sourceValue, targetValue) {
  const source = normalizeHashTree(sourceValue, "bron.content_sha256");
  const target = normalizeHashTree(targetValue, "doel.content_sha256");
  const sections = [
    "auth_users",
    "auth_identities",
    "storage_buckets",
    "storage_objects",
    "critical_public",
  ];
  const sortedSections = [...sections].sort();
  if (
    JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(sortedSections)
    || JSON.stringify(Object.keys(target).sort()) !== JSON.stringify(sortedSections)
  ) {
    fail("inhoudshashes hebben niet de verplichte database/Auth/Storage-structuur");
  }
  for (const section of sections) {
    if (JSON.stringify(target[section]) !== JSON.stringify(source[section])) {
      fail(`inhoudshashes van ${section} wijken af`, `content_${section}`);
    }
  }
}

function postgresMajor(value, label) {
  if (typeof value !== "string") fail(`${label} ontbreekt`);
  const match = value.match(/^(\d+)(?:\.|$)/);
  if (!match) fail(`${label} heeft geen herkenbare majorversie`);
  return Number(match[1]);
}

function manifestBucketCounts(storage) {
  if (!Array.isArray(storage.buckets)) fail("storage.buckets is geen lijst");
  if (requireCount(storage.bucket_count, "storage.bucket_count") !== storage.buckets.length) {
    fail("storage.bucket_count klopt niet met storage.buckets");
  }

  const counts = {};
  let objectCount = 0;
  let totalBytes = 0;
  for (const bucket of storage.buckets) {
    requireObject(bucket, "storage.bucket");
    if (typeof bucket.id !== "string" || !bucket.id) fail("storage.bucket.id ontbreekt");
    if (Object.hasOwn(counts, bucket.id)) fail(`storage bevat dubbele bucket ${bucket.id}`);
    if (!Array.isArray(bucket.objects)) fail(`storage.${bucket.id}.objects is geen lijst`);
    const bucketObjects = requireCount(bucket.object_count, `storage.${bucket.id}.object_count`);
    const bucketBytes = requireCount(bucket.total_bytes, `storage.${bucket.id}.total_bytes`);
    if (bucketObjects !== bucket.objects.length) fail(`storage.${bucket.id}.object_count klopt niet met objects`);
    counts[bucket.id] = bucketObjects;
    objectCount += bucketObjects;
    totalBytes += bucketBytes;
  }

  if (requireCount(storage.object_count, "storage.object_count") !== objectCount) {
    fail("storage.object_count klopt niet met de buckets");
  }
  if (requireCount(storage.total_bytes, "storage.total_bytes") !== totalBytes) {
    fail("storage.total_bytes klopt niet met de buckets");
  }
  return normalizeCountMap(counts, "storage.objects_by_bucket");
}

export function verifyRestore({ source, target, storage }) {
  requireObject(source, "bronvalidatie");
  requireObject(target, "doelvalidatie");
  requireObject(storage, "storage-manifest");

  if (source.manifest_version !== 2 || target.manifest_version !== 2) {
    fail("database-validatiemanifest 2 is verplicht voor inhoudelijk restorebewijs");
  }
  if (storage.schema_version !== 1) fail("onbekende storage-manifestversie");

  const sourceMajor = postgresMajor(source.postgres_version, "bron.postgres_version");
  const targetMajor = postgresMajor(target.postgres_version, "doel.postgres_version");
  if (sourceMajor !== 17 || targetMajor !== sourceMajor) {
    fail(`PostgreSQL-major wijkt af (bron ${sourceMajor}, doel ${targetMajor}, verwacht 17)`, "postgres_major");
  }

  for (const field of EXACT_COUNT_FIELDS) compareCount(source, target, field);
  const storageCounts = compareCountMap(
    source.storage_objects_by_bucket,
    target.storage_objects_by_bucket,
    "storage_objects_by_bucket",
    "count_storage_by_bucket",
  );
  compareCountMap(
    source.critical_public_counts,
    target.critical_public_counts,
    "critical_public_counts",
    "count_critical_public",
  );

  compareContentHashes(source.content_sha256, target.content_sha256);

  const sourcePolicies = normalizeObjectHashes(source.policies, "bron.policies");
  const targetPolicies = normalizeObjectHashes(target.policies, "doel.policies");
  if (JSON.stringify(targetPolicies) !== JSON.stringify(sourcePolicies)) {
    fail("policydefinities/hashes wijken af", "policies");
  }

  const sourceTriggers = normalizeObjectHashes(source.triggers, "bron.triggers");
  const targetTriggers = normalizeObjectHashes(target.triggers, "doel.triggers");
  if (JSON.stringify(targetTriggers) !== JSON.stringify(sourceTriggers)) {
    fail("triggerdefinities/hashes wijken af", "triggers");
  }

  const sourceExtensions = normalizeStringSet(source.extensions, "bron.extensions");
  const targetExtensions = new Set(normalizeStringSet(target.extensions, "doel.extensions"));
  const missingExtensions = sourceExtensions.filter((extension) => !targetExtensions.has(extension));
  if (missingExtensions.length) fail(`doel mist extensies: ${missingExtensions.join(", ")}`, "extensions");

  const manifestCounts = manifestBucketCounts(storage);
  if (JSON.stringify(manifestCounts) !== JSON.stringify(storageCounts)) {
    fail(
      `Storage-manifest wijkt af van databasevalidatie (manifest ${JSON.stringify(manifestCounts)}, database ${JSON.stringify(storageCounts)})`,
      "storage_manifest",
    );
  }
  if (storage.bucket_count !== source.storage_buckets || storage.object_count !== source.storage_objects) {
    fail("Storage-manifest dekt niet exact alle Storage-metadata uit de bron", "storage_manifest");
  }

  return {
    ok: true,
    postgres_major: targetMajor,
    auth_users: target.auth_users,
    auth_identities: target.auth_identities,
    storage_buckets: target.storage_buckets,
    storage_objects: target.storage_objects,
    storage_total_bytes: storage.total_bytes,
    content_hashes_verified: true,
    policy_count: targetPolicies.length,
    trigger_count: targetTriggers.length,
    critical_public_counts: normalizeCountMap(target.critical_public_counts, "doel.critical_public_counts"),
    source_extensions: sourceExtensions,
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`onbekend argument: ${argument}`);
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`waarde ontbreekt voor --${key}`);
    args.set(key, value);
  }
  return args;
}

async function readJson(filePath, label) {
  if (!filePath) fail(`--${label} ontbreekt`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${label} kon niet als JSON worden gelezen: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyRestore({
    source: await readJson(args.get("source"), "source"),
    target: await readJson(args.get("target"), "target"),
    storage: await readJson(args.get("storage-manifest"), "storage-manifest"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const diagnostic = restoreValidationDiagnostic(error);
    process.stderr.write(`VALIDATION_CATEGORY=${diagnostic.category}\n`);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
