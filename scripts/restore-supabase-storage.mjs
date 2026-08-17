#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_REQUEST_ATTEMPTS = 4;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ontbreekt`);
  return value;
}

function safeObjectPath(objectName) {
  if (typeof objectName !== "string" || !objectName || objectName.startsWith("/") || objectName.includes("\0")) {
    throw new Error(`Ongeldig Storage-objectpad: ${objectName}`);
  }
  const normalized = path.posix.normalize(objectName);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Storage-objectpad bevat padtraversal: ${objectName}`);
  }
  return normalized;
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

function apiUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(baseUrl, serviceRoleKey, pathname, init, description, maxAttempts = MAX_REQUEST_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(apiUrl(baseUrl, pathname), {
        ...init,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          ...(init?.headers ?? {}),
        },
      });
      if (response.ok) return response;
      lastError = new Error(`${description} gaf HTTP ${response.status}`);
      await response.body?.cancel();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < maxAttempts) await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(`${description} mislukt na ${maxAttempts} pogingen: ${lastError?.message}`);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function uploadObject(baseUrl, serviceRoleKey, bucket, objectName, filePath, contentType) {
  const encodedPath = objectName.split("/").map((part) => encodeURIComponent(part)).join("/");
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await request(
        baseUrl,
        serviceRoleKey,
        `/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        {
          method: "POST",
          duplex: "half",
          headers: {
            "content-type": contentType || "application/octet-stream",
            "x-upsert": "true",
          },
          body: createReadStream(filePath),
        },
        `Storage-upload ${bucket}/${objectName}`,
        1,
      );
      await response.body?.cancel();
      return;
    } catch (error) {
      if (attempt === MAX_REQUEST_ATTEMPTS) throw error;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

async function verifyObject(baseUrl, serviceRoleKey, bucket, objectName, expectedHash) {
  const encodedPath = objectName.split("/").map((part) => encodeURIComponent(part)).join("/");
  const response = await request(
    baseUrl,
    serviceRoleKey,
    `/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedPath}`,
    {},
    `Storage-verificatie ${bucket}/${objectName}`,
  );
  if (!response.body) throw new Error(`Storage-verificatie ${bucket}/${objectName} heeft geen body`);
  const hash = createHash("sha256");
  const digest = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(response.body, digest);
  const actualHash = hash.digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Storage-verificatie ${bucket}/${objectName}: checksum wijkt af`);
  }
}

async function ensureBucket(baseUrl, serviceRoleKey, bucket) {
  const response = await request(
    baseUrl,
    serviceRoleKey,
    "/storage/v1/bucket",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: bucket.id,
        name: bucket.name,
        public: bucket.public,
        file_size_limit: bucket.file_size_limit,
        allowed_mime_types: bucket.allowed_mime_types,
      }),
    },
    `Storage-bucket ${bucket.id} aanmaken`,
  ).catch(async (error) => {
    if (!String(error.message).includes("HTTP 409")) throw error;
    return request(
      baseUrl,
      serviceRoleKey,
      `/storage/v1/bucket/${encodeURIComponent(bucket.id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: bucket.name,
          public: bucket.public,
          file_size_limit: bucket.file_size_limit,
          allowed_mime_types: bucket.allowed_mime_types,
        }),
      },
      `Storage-bucket ${bucket.id} bijwerken`,
    );
  });
  await response.body?.cancel();
}

export async function restoreStorage({ baseUrl, serviceRoleKey, inputDir, dryRun = false, verify = true }) {
  const manifest = JSON.parse(await readFile(path.join(inputDir, "storage-manifest.json"), "utf8"));
  if (manifest.schema_version !== 1) throw new Error("Onbekende storage-manifestversie");
  if (!manifest.source_project) throw new Error("source_project ontbreekt in storage-manifest.json");
  if (!Array.isArray(manifest.buckets)) throw new Error("buckets ontbreekt in storage-manifest.json");
  if (manifest.bucket_count !== manifest.buckets.length) throw new Error("bucket_count klopt niet met het manifest");
  if (new Set(manifest.buckets.map((bucket) => bucket.id)).size !== manifest.buckets.length) {
    throw new Error("manifest bevat dubbele bucket-id's");
  }
  const manifestObjectCount = manifest.buckets.reduce((total, bucket) => total + (bucket.object_count ?? -1), 0);
  const manifestBytes = manifest.buckets.reduce((total, bucket) => total + (bucket.total_bytes ?? -1), 0);
  if (manifest.object_count !== manifestObjectCount) throw new Error("object_count klopt niet met het manifest");
  if (manifest.total_bytes !== manifestBytes) throw new Error("total_bytes klopt niet met het manifest");
  for (const bucket of manifest.buckets) {
    if (!Array.isArray(bucket.objects) || bucket.object_count !== bucket.objects.length) {
      throw new Error(`object_count klopt niet voor bucket ${bucket.id}`);
    }
  }

  const targetProjectRef = process.env.TARGET_PROJECT_REF?.trim();
  if (!targetProjectRef) throw new Error("TARGET_PROJECT_REF ontbreekt");
  if (targetProjectRef !== "local" && targetProjectRef === manifest.source_project) {
    throw new Error("Storage-restore stopt: bron- en doelproject zijn gelijk");
  }
  if (targetProjectRef !== "local" && !baseUrl.includes(targetProjectRef)) {
    throw new Error("TARGET_SUPABASE_URL verwijst niet aantoonbaar naar TARGET_PROJECT_REF");
  }

  const selectedBuckets = process.env.STORAGE_RESTORE_BUCKETS
    ? process.env.STORAGE_RESTORE_BUCKETS.split(",").map((bucket) => bucket.trim()).filter(Boolean)
    : manifest.buckets.map((bucket) => bucket.id);
  const manifestBuckets = manifest.buckets.map((bucket) => bucket.id).sort();
  if (JSON.stringify([...selectedBuckets].sort()) !== JSON.stringify(manifestBuckets)) {
    throw new Error("STORAGE_RESTORE_BUCKETS dekt niet exact alle buckets uit het manifest");
  }

  let uploaded = 0;
  for (const bucket of manifest.buckets) {
    if (!dryRun) await ensureBucket(baseUrl, serviceRoleKey, bucket);
    for (const object of bucket.objects) {
      const objectName = safeObjectPath(object.name);
      const filePath = path.join(inputDir, bucket.id, objectName);
      const fileStat = await stat(filePath);
      if (fileStat.size !== object.bytes) throw new Error(`Lokale Storage-lengte wijkt af: ${bucket.id}/${objectName}`);
      const actualHash = await hashFile(filePath);
      if (actualHash !== object.sha256) throw new Error(`Lokale Storage-checksum wijkt af: ${bucket.id}/${objectName}`);
      if (!dryRun) {
        await uploadObject(baseUrl, serviceRoleKey, bucket.id, objectName, filePath, object.content_type);
        if (verify) await verifyObject(baseUrl, serviceRoleKey, bucket.id, objectName, object.sha256);
      }
      uploaded += 1;
    }
  }
  return { bucket_count: manifest.bucket_count, object_count: uploaded, total_bytes: manifest.total_bytes, dry_run: dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = args.get("input-dir");
  if (!inputDir) throw new Error("--input-dir ontbreekt");
  const dryRun = args.has("dry-run");
  const verify = !args.has("no-verify");
  const result = await restoreStorage({
    baseUrl: requiredEnv("TARGET_SUPABASE_URL"),
    serviceRoleKey: dryRun ? (process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY ?? "dry-run") : requiredEnv("TARGET_SUPABASE_SERVICE_ROLE_KEY"),
    inputDir,
    dryRun,
    verify,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Storage-restore mislukt: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
