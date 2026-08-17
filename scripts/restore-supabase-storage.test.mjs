import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { restoreStorage } from "./restore-supabase-storage.mjs";

const sourceProject = "aebwiufuegsiwhwpdrfb";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function createFixture() {
  const inputDir = await mkdtemp(path.join(os.tmpdir(), "supabase-storage-restore-"));
  const content = Buffer.from("document-inhoud\n", "utf8");
  const objectPath = path.join(inputDir, "documenten", "2026", "voorbeeld.txt");
  await mkdir(path.dirname(objectPath), { recursive: true });
  await writeFile(objectPath, content, { mode: 0o600 });
  await writeFile(
    path.join(inputDir, "storage-manifest.json"),
    JSON.stringify({
      schema_version: 1,
      generated_utc: "2026-08-17T00:00:00Z",
      source_project: sourceProject,
      bucket_count: 1,
      object_count: 1,
      total_bytes: content.length,
      buckets: [
        {
          id: "documenten",
          name: "documenten",
          public: false,
          file_size_limit: null,
          allowed_mime_types: null,
          object_count: 1,
          total_bytes: content.length,
          objects: [
            {
              name: "2026/voorbeeld.txt",
              bytes: content.length,
              sha256: sha256(content),
              content_type: "text/plain",
            },
          ],
        },
      ],
    }),
    { mode: 0o600 },
  );
  return inputDir;
}

test("Storage-restore dry-run controleert manifest, lengte en checksum", async () => {
  const inputDir = await createFixture();
  const previousRef = process.env.TARGET_PROJECT_REF;
  process.env.TARGET_PROJECT_REF = "restore-oefening";
  try {
    const result = await restoreStorage({
      baseUrl: "https://restore-oefening.supabase.co",
      serviceRoleKey: "dry-run",
      inputDir,
      dryRun: true,
    });
    assert.deepEqual(result, {
      bucket_count: 1,
      object_count: 1,
      total_bytes: 16,
      dry_run: true,
    });
  } finally {
    if (previousRef === undefined) delete process.env.TARGET_PROJECT_REF;
    else process.env.TARGET_PROJECT_REF = previousRef;
    await rm(inputDir, { recursive: true, force: true });
  }
});

test("Storage-restore wijst bron- en doelproject met dezelfde ref af", async () => {
  const inputDir = await createFixture();
  const previousRef = process.env.TARGET_PROJECT_REF;
  process.env.TARGET_PROJECT_REF = sourceProject;
  try {
    await assert.rejects(
      restoreStorage({
        baseUrl: `https://${sourceProject}.supabase.co`,
        serviceRoleKey: "dry-run",
        inputDir,
        dryRun: true,
      }),
      /bron- en doelproject zijn gelijk/,
    );
  } finally {
    if (previousRef === undefined) delete process.env.TARGET_PROJECT_REF;
    else process.env.TARGET_PROJECT_REF = previousRef;
    await rm(inputDir, { recursive: true, force: true });
  }
});
