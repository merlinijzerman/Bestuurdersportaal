#!/usr/bin/env node

/**
 * Maak een volledige, metadata-gebonden kopie van Supabase Storage.
 *
 * De databaseback-up bevat alleen Storage-metadata. Dit script haalt de
 * fysieke bytes via de Storage API op en schrijft daarnaast een manifest met
 * per-object SHA-256. Het script faalt als de expliciete bucketlijst niet
 * exact overeenkomt met wat Supabase teruggeeft; een nieuwe bucket kan zo
 * niet stil buiten de back-up vallen.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_SIZE = 1000;
const MAX_REQUEST_ATTEMPTS = 4;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ontbreekt`);
  return value;
}

function parseBuckets(value) {
  const buckets = value
    .split(",")
    .map((bucket) => bucket.trim())
    .filter(Boolean);

  if (buckets.length === 0) throw new Error("STORAGE_BACKUP_BUCKETS is leeg");
  if (new Set(buckets).size !== buckets.length) {
    throw new Error("STORAGE_BACKUP_BUCKETS bevat dubbele bucketnamen");
  }
  for (const bucket of buckets) {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) {
      throw new Error(`Ongeldige bucketnaam in STORAGE_BACKUP_BUCKETS: ${bucket}`);
    }
  }
  return buckets;
}

export function safeObjectPath(objectName) {
  if (
    typeof objectName !== "string" ||
    objectName.length === 0 ||
    objectName.includes("\0") ||
    objectName.startsWith("/")
  ) {
    throw new Error("Ongeldig Storage-objectpad");
  }

  const normalized = path.posix.normalize(objectName);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Storage-objectpad bevat padtraversal");
  }
  return normalized;
}

function apiUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, init, description) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      lastError = new Error(`${description} gaf HTTP ${response.status}`);
      await response.body?.cancel();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < MAX_REQUEST_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }

  throw new Error(`${description} mislukt na ${MAX_REQUEST_ATTEMPTS} pogingen: ${lastError?.message}`);
}

async function getJson(baseUrl, serviceRoleKey, pathname, description) {
  const response = await fetchWithRetry(
    apiUrl(baseUrl, pathname),
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    },
    description,
  );
  return response.json();
}

async function listBuckets(baseUrl, serviceRoleKey) {
  const buckets = await getJson(baseUrl, serviceRoleKey, "/storage/v1/bucket", "Storage-bucketlijst");
  if (!Array.isArray(buckets)) throw new Error("Storage-bucketlijst heeft geen arrayformaat");
  return buckets;
}

async function listPrefix(baseUrl, serviceRoleKey, bucket, prefix = "") {
  const objects = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await fetchWithRetry(
      apiUrl(baseUrl, `/storage/v1/object/list/${encodeURIComponent(bucket)}`),
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          prefix,
          limit: PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      },
      `Storage-lijst ${bucket}/${prefix}`,
    );

    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Storage-lijst ${bucket}/${prefix} heeft geen arrayformaat`);
    objects.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const result = [];
  for (const entry of objects) {
    if (!entry || typeof entry.name !== "string") {
      throw new Error(`Storage-lijst ${bucket}/${prefix} bevat een ongeldig item`);
    }

    const name = safeObjectPath(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (entry.id == null) {
      result.push(...(await listPrefix(baseUrl, serviceRoleKey, bucket, `${name}/`)));
    } else {
      result.push({ ...entry, name });
    }
  }
  return result;
}

function objectDownloadUrl(baseUrl, bucket, objectName) {
  const encodedPath = objectName.split("/").map((part) => encodeURIComponent(part)).join("/");
  return apiUrl(baseUrl, `/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedPath}`);
}

async function downloadObject(baseUrl, serviceRoleKey, bucket, object, outputDir) {
  const relativePath = safeObjectPath(object.name);
  const destination = path.join(outputDir, bucket, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });

  const response = await fetchWithRetry(
    objectDownloadUrl(baseUrl, bucket, relativePath),
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
    `Storage-download ${bucket}/${relativePath}`,
  );

  if (!response.body) throw new Error(`Storage-download ${bucket}/${relativePath} heeft geen body`);

  const hash = createHash("sha256");
  let bytes = 0;
  const digest = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(response.body, digest, createWriteStream(destination, { mode: 0o600 }));

  const expectedLength = response.headers.get("content-length");
  if (expectedLength && Number(expectedLength) !== bytes) {
    throw new Error(`Storage-download ${bucket}/${relativePath} heeft een afwijkende lengte`);
  }

  return {
    name: relativePath,
    bytes,
    sha256: hash.digest("hex"),
    content_type: object.metadata?.mimetype ?? object.metadata?.contentType ?? null,
    etag: object.etag ?? null,
    updated_at: object.updated_at ?? null,
    created_at: object.created_at ?? null,
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Onbekend argument: ${argument}`);
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Waarde ontbreekt voor --${key}`);
    args.set(key, value);
  }
  return args;
}

export async function backupStorage({ baseUrl, serviceRoleKey, sourceProject, buckets, outputDir, generatedUtc }) {
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const discovered = await listBuckets(baseUrl, serviceRoleKey);
  const discoveredIds = discovered.map((bucket) => bucket.id).sort();
  const expectedIds = [...buckets].sort();
  if (JSON.stringify(discoveredIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `Storage-buckets wijken af; verwacht=${expectedIds.join(",")} aangetroffen=${discoveredIds.join(",")}`,
    );
  }

  const manifestBuckets = [];
  for (const bucketName of buckets) {
    const bucket = discovered.find((candidate) => candidate.id === bucketName);
    const listedObjects = await listPrefix(baseUrl, serviceRoleKey, bucketName);
    const objectManifest = [];
    for (const object of listedObjects) {
      objectManifest.push(await downloadObject(baseUrl, serviceRoleKey, bucketName, object, outputDir));
    }

    manifestBuckets.push({
      id: bucketName,
      name: bucket.name ?? bucketName,
      public: bucket.public ?? false,
      file_size_limit: bucket.file_size_limit ?? null,
      allowed_mime_types: bucket.allowed_mime_types ?? null,
      object_count: objectManifest.length,
      total_bytes: objectManifest.reduce((total, object) => total + object.bytes, 0),
      objects: objectManifest,
    });
  }

  const manifest = {
    schema_version: 1,
    generated_utc: generatedUtc,
    source_project: sourceProject,
    bucket_count: manifestBuckets.length,
    object_count: manifestBuckets.reduce((total, bucket) => total + bucket.object_count, 0),
    total_bytes: manifestBuckets.reduce((total, bucket) => total + bucket.total_bytes, 0),
    buckets: manifestBuckets,
  };
  const manifestPath = path.join(outputDir, "storage-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { manifest, manifestPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args.get("output-dir");
  if (!outputDir) throw new Error("--output-dir ontbreekt");

  const result = await backupStorage({
    baseUrl: requiredEnv("SUPABASE_URL"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    sourceProject: requiredEnv("SUPABASE_PROJECT_REF"),
    buckets: parseBuckets(requiredEnv("STORAGE_BACKUP_BUCKETS")),
    outputDir,
    generatedUtc: requiredEnv("BACKUP_TIMESTAMP"),
  });

  const manifestStat = await stat(result.manifestPath);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      bucket_count: result.manifest.bucket_count,
      object_count: result.manifest.object_count,
      total_bytes: result.manifest.total_bytes,
      manifest_bytes: manifestStat.size,
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Storage-back-up mislukt: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
