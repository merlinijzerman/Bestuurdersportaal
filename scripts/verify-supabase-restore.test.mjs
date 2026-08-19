import assert from "node:assert/strict";
import test from "node:test";

import { restoreValidationDiagnostic, verifyRestore } from "./verify-supabase-restore.mjs";

function fixture() {
  const source = {
    manifest_version: 2,
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
    content_sha256: {
      auth_users: "a".repeat(64),
      auth_identities: "b".repeat(64),
      storage_buckets: "c".repeat(64),
      storage_objects: "d".repeat(64),
      critical_public: {
        fondsen: "e".repeat(64),
        profielen: "f".repeat(64),
        documenten: "0".repeat(64),
        document_chunks: "1".repeat(64),
        governance_log: "2".repeat(64),
        platform_event_log: "3".repeat(64),
      },
    },
    policies: [
      { schema: "public", table: "documenten", name: "documenten_select", sha256: "4".repeat(64) },
    ],
    triggers: [
      { schema: "auth", table: "users", name: "on_auth_user_created", sha256: "5".repeat(64) },
    ],
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
    content_hashes_verified: true,
    policy_count: 1,
    trigger_count: 1,
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

test("accepteert een expliciete lege Storage-bucket naast de databasegroepering", () => {
  const data = fixture();
  data.source.storage_buckets = 3;
  data.target.storage_buckets = 3;
  data.storage.bucket_count = 3;
  data.storage.buckets.push({
    id: "lege-bucket",
    object_count: 0,
    total_bytes: 0,
    objects: [],
  });

  const result = verifyRestore(data);
  assert.equal(result.storage_buckets, 3);
  assert.equal(result.storage_objects, 3);
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

test("weigert een inhoudsverschil ondanks gelijke tellingen", () => {
  const data = fixture();
  data.target.content_sha256.auth_users = "9".repeat(64);
  assert.throws(() => verifyRestore(data), (error) => {
    assert.match(error.message, /inhoudshashes/);
    assert.deepEqual(restoreValidationDiagnostic(error), { category: "content_auth_users" });
    return true;
  });
});

test("diagnostiek is beperkt tot een veilige validatiecategorie", () => {
  const data = fixture();
  data.target.content_sha256.storage_objects = "9".repeat(64);
  assert.throws(() => verifyRestore(data), (error) => {
    assert.deepEqual(restoreValidationDiagnostic(error), { category: "content_storage_objects" });
    return true;
  });
  assert.deepEqual(restoreValidationDiagnostic(new Error("gevoelige details")), { category: "unknown" });
});

test("weigert afwijkende policy- of triggerdefinities", () => {
  const policyData = fixture();
  policyData.target.policies[0].sha256 = "8".repeat(64);
  assert.throws(() => verifyRestore(policyData), /policydefinities/);

  const triggerData = fixture();
  triggerData.target.triggers[0].name = "ander_trigger";
  assert.throws(() => verifyRestore(triggerData), /triggerdefinities/);
});
