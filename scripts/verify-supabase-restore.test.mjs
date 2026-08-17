import assert from "node:assert/strict";
import test from "node:test";

import { verifyRestore } from "./verify-supabase-restore.mjs";

function fixture() {
  const source = {
    manifest_version: 1,
    captured_utc: "2026-08-17T16:59:19Z",
    postgres_version: "17.6",
    extensions: ["pgcrypto", "uuid-ossp"],
    auth_users: 7,
    auth_identities: 7,
    storage_buckets: 2,
    storage_objects: 3,
    storage_objects_by_bucket: { documenten: 2, afschriften: 1 },
    critical_public_counts: {
      fondsen: 2,
      profielen: 7,
      documenten: 3,
      document_chunks: 20,
      governance_log: 4,
      platform_event_log: 9,
    },
  };
  const target = structuredClone(source);
  target.captured_utc = "2026-08-17T18:00:00Z";
  target.postgres_version = "17.7";
  target.extensions.push("plpgsql");
  const storage = {
    schema_version: 1,
    source_project: "aebwiufuegsiwhwpdrfb",
    bucket_count: 2,
    object_count: 3,
    total_bytes: 60,
    buckets: [
      {
        id: "documenten",
        object_count: 2,
        total_bytes: 30,
        objects: [{ name: "a.pdf" }, { name: "b.pdf" }],
      },
      {
        id: "afschriften",
        object_count: 1,
        total_bytes: 30,
        objects: [{ name: "c.pdf" }],
      },
    ],
  };
  return { source, target, storage };
}

test("accepteert een exacte restore met een extensiesuperset op het doel", () => {
  const result = verifyRestore(fixture());
  assert.deepEqual(result, {
    ok: true,
    postgres_major: 17,
    auth_users: 7,
    auth_identities: 7,
    storage_buckets: 2,
    storage_objects: 3,
    storage_total_bytes: 60,
    critical_public_counts: {
      document_chunks: 20,
      documenten: 3,
      fondsen: 2,
      governance_log: 4,
      platform_event_log: 9,
      profielen: 7,
    },
    source_extensions: ["pgcrypto", "uuid-ossp"],
  });
});

test("weigert een verschil in kritieke databasetellingen", () => {
  const data = fixture();
  data.target.auth_users += 1;
  assert.throws(() => verifyRestore(data), /auth_users: verwacht 7, aangetroffen 8/);
});

test("weigert een onvolledig fysiek Storage-manifest", () => {
  const data = fixture();
  data.storage.buckets[0].objects.pop();
  assert.throws(() => verifyRestore(data), /object_count klopt niet met objects/);
});

test("weigert wanneer het doel een bronextensie mist", () => {
  const data = fixture();
  data.target.extensions = ["pgcrypto"];
  assert.throws(() => verifyRestore(data), /doel mist extensies: uuid-ossp/);
});
