import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArgs, restoreStorage, storageAdminHeaders, storageRestoreDiagnostic } from "./restore-supabase-storage.mjs";

const sourceProject = "aebwiufuegsiwhwpdrfb";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function createFixture(
  objects = [{ name: "2026/voorbeeld.txt", content: Buffer.from("document-inhoud\n", "utf8"), contentType: "text/plain" }],
) {
  const inputDir = await mkdtemp(path.join(os.tmpdir(), "supabase-storage-restore-"));
  const manifestObjects = [];
  for (const object of objects) {
    const objectPath = path.join(inputDir, "documenten", object.name);
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, object.content, { mode: 0o600 });
    manifestObjects.push({
      name: object.name,
      bytes: object.content.length,
      sha256: sha256(object.content),
      content_type: object.contentType ?? "application/octet-stream",
    });
  }
  const totalBytes = objects.reduce((total, object) => total + object.content.length, 0);
  await writeFile(
    path.join(inputDir, "storage-manifest.json"),
    JSON.stringify({
      schema_version: 1,
      generated_utc: "2026-08-17T00:00:00Z",
      source_project: sourceProject,
      bucket_count: 1,
      object_count: objects.length,
      total_bytes: totalBytes,
      buckets: [
        {
          id: "documenten",
          name: "documenten",
          public: false,
          file_size_limit: null,
          allowed_mime_types: null,
          object_count: objects.length,
          total_bytes: totalBytes,
          objects: manifestObjects,
        },
      ],
    }),
    { mode: 0o600 },
  );
  return { inputDir, objects, totalBytes };
}

async function withTargetRef(ref, callback) {
  const previousRef = process.env.TARGET_PROJECT_REF;
  process.env.TARGET_PROJECT_REF = ref;
  try {
    return await callback();
  } finally {
    if (previousRef === undefined) delete process.env.TARGET_PROJECT_REF;
    else process.env.TARGET_PROJECT_REF = previousRef;
  }
}

test("CLI-flags dry-run/no-verify/no-resume vereisen geen waarde", () => {
  assert.deepEqual(
    Object.fromEntries(parseArgs(["--input-dir", "/tmp/restore", "--dry-run", "--no-verify", "--no-resume"])),
    { "input-dir": "/tmp/restore", "dry-run": true, "no-verify": true, "no-resume": true },
  );
});

test("nieuwe secret key gebruikt alleen apikey en publishable wordt geweigerd", () => {
  const secret = `sb_secret_${"a".repeat(24)}`;
  assert.deepEqual(storageAdminHeaders(secret), { apikey: secret });
  assert.throws(() => storageAdminHeaders(`sb_publishable_${"b".repeat(24)}`), /publishable key/i);
  assert.deepEqual(storageAdminHeaders("legacy.service.role"), {
    apikey: "legacy.service.role",
    Authorization: "Bearer legacy.service.role",
  });
});

test("Storage-restore dry-run controleert manifest, lengte en checksum", async () => {
  const fixture = await createFixture();
  try {
    const result = await withTargetRef("restore-oefening", () => restoreStorage({
      baseUrl: "https://restore-oefening.supabase.co",
      serviceRoleKey: "dry-run",
      inputDir: fixture.inputDir,
      dryRun: true,
    }));
    assert.deepEqual(result, {
      bucket_count: 1,
      object_count: 1,
      uploaded_count: 0,
      skipped_count: 0,
      total_bytes: 16,
      dry_run: true,
      resumable: true,
    });
  } finally {
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});

test("Storage-restore wijst bron- en doelproject met dezelfde ref af", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      withTargetRef(sourceProject, () => restoreStorage({
        baseUrl: `https://${sourceProject}.supabase.co`,
        serviceRoleKey: "dry-run",
        inputDir: fixture.inputDir,
        dryRun: true,
      })),
      /bron- en doelproject zijn gelijk/,
    );
  } finally {
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});

test("Storage-restore verifieert private objecten via de geauthenticeerde route", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  const calls = [];
  let createBucketBody;
  try {
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(url);
      const method = init.method ?? "GET";
      calls.push(`${method} ${target.pathname}`);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("apikey"), "service-role-test");
      assert.equal(headers.get("authorization"), "Bearer service-role-test");

      if (method === "GET" && target.pathname === "/storage/v1/bucket/documenten") {
        return Response.json({ message: "missing" }, { status: 404 });
      }
      if (method === "POST" && target.pathname === "/storage/v1/bucket") {
        createBucketBody = JSON.parse(init.body);
        return Response.json({ id: "documenten" });
      }
      if (method === "POST" && target.pathname === "/storage/v1/object/documenten/2026/voorbeeld.txt") {
        return new Response(null, { status: 200 });
      }
      if (method === "GET" && target.pathname === "/storage/v1/object/authenticated/documenten/2026/voorbeeld.txt") {
        return new Response("document-inhoud\n", { headers: { "content-type": "text/plain", "content-length": "16" } });
      }
      throw new Error(`Onverwachte mock-request: ${method} ${target.pathname}`);
    };

    const result = await withTargetRef("restore-oefening", () => restoreStorage({
      baseUrl: "https://restore-oefening.supabase.co",
      serviceRoleKey: "service-role-test",
      inputDir: fixture.inputDir,
      resume: false,
    }));

    assert.equal(result.object_count, 1);
    assert.equal(result.uploaded_count, 1);
    assert.deepEqual(createBucketBody, {
      id: "documenten",
      name: "documenten",
      public: false,
      fileSizeLimit: null,
      allowedMimeTypes: null,
    });
    assert.ok(calls.includes("GET /storage/v1/object/authenticated/documenten/2026/voorbeeld.txt"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});

test("Storage-restore gebruikt het camelCase API-contract en werkt een bestaande bucket bij", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(url);
      const method = init.method ?? "GET";
      if (method === "GET" && target.pathname === "/storage/v1/bucket/documenten") {
        bodies.push({ method });
        return Response.json({ id: "documenten" });
      }
      if (method === "PUT" && target.pathname === "/storage/v1/bucket/documenten") {
        bodies.push({ method, body: JSON.parse(init.body) });
        return Response.json({ message: "updated" });
      }
      if (method === "GET" && target.pathname === "/storage/v1/object/authenticated/documenten/2026/voorbeeld.txt") {
        return new Response("document-inhoud\n");
      }
      throw new Error(`Onverwachte mock-request: ${method} ${target.pathname}`);
    };

    const result = await withTargetRef("restore-oefening", () => restoreStorage({
      baseUrl: "https://restore-oefening.supabase.co",
      serviceRoleKey: "service-role-test",
      inputDir: fixture.inputDir,
    }));

    assert.equal(result.skipped_count, 1);
    assert.deepEqual(bodies, [
      { method: "GET" },
      {
        method: "PUT",
        body: {
          public: false,
          fileSizeLimit: null,
          allowedMimeTypes: null,
        },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});

test("Storage-restorediagnostiek geeft alleen fase en HTTP-status vrij", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ detail: "gevoelige mockdetails" }, { status: 422 });
    await assert.rejects(async () => {
      try {
        await withTargetRef("restore-oefening", () => restoreStorage({
          baseUrl: "https://restore-oefening.supabase.co",
          serviceRoleKey: "service-role-test",
          inputDir: fixture.inputDir,
        }));
      } catch (error) {
        assert.deepEqual(storageRestoreDiagnostic(error), { phase: "bucket_read", httpStatus: "422" });
        throw error;
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});

test("hervat een gedeeltelijke set en dekt grote, lege en Unicode/nested objecten", async () => {
  const objects = [
    { name: "leeg bestand.txt", content: Buffer.alloc(0), contentType: "text/plain" },
    { name: "unicode/ëncodé-groot.bin", content: Buffer.alloc(2 * 1024 * 1024, 0x5a) },
  ];
  const fixture = await createFixture(objects);
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(url);
      const method = init.method ?? "GET";
      calls.push(`${method} ${decodeURIComponent(target.pathname)}`);
      if (method === "GET" && target.pathname === "/storage/v1/bucket/documenten") {
        return Response.json({ message: "missing" }, { status: 404 });
      }
      if (method === "POST" && target.pathname === "/storage/v1/bucket") return Response.json({ id: "documenten" });
      if (method === "GET" && decodeURIComponent(target.pathname).endsWith("/leeg bestand.txt")) {
        return new Response(Buffer.alloc(0), { status: 200 });
      }
      if (method === "GET" && decodeURIComponent(target.pathname).endsWith("/unicode/ëncodé-groot.bin")) {
        const uploaded = calls.some((call) => call === "POST /storage/v1/object/documenten/unicode/ëncodé-groot.bin");
        return uploaded ? new Response(objects[1].content) : new Response("missing", { status: 404 });
      }
      if (method === "POST" && decodeURIComponent(target.pathname).endsWith("/unicode/ëncodé-groot.bin")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Onverwachte mock-request: ${method} ${target.pathname}`);
    };

    const result = await withTargetRef("restore-oefening", () => restoreStorage({
      baseUrl: "https://restore-oefening.supabase.co",
      serviceRoleKey: "service-role-test",
      inputDir: fixture.inputDir,
    }));
    assert.equal(result.object_count, 2);
    assert.equal(result.skipped_count, 1);
    assert.equal(result.uploaded_count, 1);
    assert.ok(calls.includes("GET /storage/v1/object/authenticated/documenten/leeg bestand.txt"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});

test("probeert een mislukte objectupload opnieuw", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  let uploadAttempts = 0;
  try {
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(url);
      const method = init.method ?? "GET";
      if (method === "GET" && target.pathname === "/storage/v1/bucket/documenten") {
        return Response.json({ message: "missing" }, { status: 404 });
      }
      if (method === "POST" && target.pathname === "/storage/v1/bucket") return Response.json({ id: "documenten" });
      if (method === "POST" && target.pathname.includes("/storage/v1/object/documenten/")) {
        uploadAttempts += 1;
        return new Response(null, { status: uploadAttempts === 1 ? 503 : 200 });
      }
      if (method === "GET" && target.pathname.includes("/storage/v1/object/authenticated/documenten/")) {
        return new Response("document-inhoud\n");
      }
      throw new Error(`Onverwachte mock-request: ${method} ${target.pathname}`);
    };

    const result = await withTargetRef("restore-oefening", () => restoreStorage({
      baseUrl: "https://restore-oefening.supabase.co",
      serviceRoleKey: "service-role-test",
      inputDir: fixture.inputDir,
      resume: false,
    }));
    assert.equal(uploadAttempts, 2);
    assert.equal(result.uploaded_count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(fixture.inputDir, { recursive: true, force: true });
  }
});
