import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { backupStorage } from "./backup-supabase-storage.mjs";

function response(body, init = {}) {
  return new Response(body, init);
}

test("Storage-back-up haalt alle objecten recursief op en schrijft hashes", async () => {
  const originalFetch = globalThis.fetch;
  const outputDir = await mkdtemp(path.join(tmpdir(), "bestuurdersportaal-storage-test-"));
  const calls = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(url);
      calls.push(`${init.method ?? "GET"} ${target.pathname}`);
      if (target.pathname === "/storage/v1/bucket") {
        return response(JSON.stringify([
          { id: "documenten", name: "documenten", public: false },
        ]), { headers: { "content-type": "application/json" } });
      }
      if (target.pathname === "/storage/v1/object/list/documenten") {
        const payload = JSON.parse(init.body);
        if (payload.prefix === "") {
          return response(JSON.stringify([{ id: null, name: "fonds" }]), {
            headers: { "content-type": "application/json" },
          });
        }
        assert.equal(payload.prefix, "fonds/");
        return response(JSON.stringify([
          {
            id: "object-1",
            name: "rapport.pdf",
            metadata: { mimetype: "application/pdf" },
            etag: "etag-1",
          },
        ]), { headers: { "content-type": "application/json" } });
      }
      if (target.pathname === "/storage/v1/object/download/documenten/fonds/rapport.pdf") {
        return response("test-bytes", {
          headers: { "content-length": "10", "content-type": "application/pdf" },
        });
      }
      throw new Error(`Onverwachte mock-request: ${target.pathname}`);
    };

    const result = await backupStorage({
      baseUrl: "https://example.supabase.co",
      serviceRoleKey: "test-key",
      sourceProject: "example",
      buckets: ["documenten"],
      outputDir,
      generatedUtc: "2026-08-17T00:00:00Z",
    });

    assert.equal(result.manifest.object_count, 1);
    assert.equal(result.manifest.total_bytes, 10);
    assert.equal(result.manifest.buckets[0].objects[0].sha256,
      "837fa4675d0ea98b79c41533ed9f35feefd73b7b88ca9134fd8a750cb7863ffc");
    const stored = await readFile(path.join(outputDir, "documenten", "fonds", "rapport.pdf"), "utf8");
    assert.equal(stored, "test-bytes");
    assert.ok(calls.includes("POST /storage/v1/object/list/documenten"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("Storage-back-up faalt bij een onverwachte bucket", async () => {
  const originalFetch = globalThis.fetch;
  const outputDir = await mkdtemp(path.join(tmpdir(), "bestuurdersportaal-storage-test-"));
  try {
    globalThis.fetch = async () => response(JSON.stringify([
      { id: "documenten", name: "documenten", public: false },
      { id: "onbekend", name: "onbekend", public: false },
    ]));

    await assert.rejects(
      backupStorage({
        baseUrl: "https://example.supabase.co",
        serviceRoleKey: "test-key",
        sourceProject: "example",
        buckets: ["documenten"],
        outputDir,
        generatedUtc: "2026-08-17T00:00:00Z",
      }),
      /Storage-buckets wijken af/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});
