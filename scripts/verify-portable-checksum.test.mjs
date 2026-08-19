import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyPortableChecksum } from "./verify-portable-checksum.mjs";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "portable-checksum-"));
  const name = "platform-inventory-2026-08-17T17-37-00Z.json";
  const dataPath = path.join(directory, name);
  const checksumPath = `${dataPath}.sha256`;
  const bytes = Buffer.from('{"schema_version":1}\n');
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(dataPath, bytes);
  return { dataPath, checksumPath, name, sha256 };
}

test("accepteert een absoluut producentpad met exact dezelfde basename", async () => {
  const item = await fixture();
  await writeFile(item.checksumPath, `${item.sha256}  /home/runner/work/_temp/${item.name}\n`);

  assert.deepEqual(await verifyPortableChecksum({
    dataPath: item.dataPath,
    checksumPath: item.checksumPath,
    expectedSha256: item.sha256,
  }), { schema_version: 1, status: "verified" });
});

test("accepteert ook een portable checksumbestand met alleen de basename", async () => {
  const item = await fixture();
  await writeFile(item.checksumPath, `${item.sha256}  ${item.name}\n`);

  await verifyPortableChecksum({
    dataPath: item.dataPath,
    checksumPath: item.checksumPath,
    expectedSha256: item.sha256,
  });
});

test("weigert een ander bestand, extra regels en iedere hashafwijking", async () => {
  const item = await fixture();
  const otherSha256 = "0".repeat(64);

  await writeFile(item.checksumPath, `${item.sha256}  /home/runner/work/_temp/ander.json\n`);
  await assert.rejects(
    verifyPortableChecksum({ ...item, expectedSha256: item.sha256 }),
    /hoort niet bij het databestand/,
  );

  await writeFile(item.checksumPath, `${item.sha256}  ${item.name}\n${item.sha256}  ${item.name}\n`);
  await assert.rejects(
    verifyPortableChecksum({ ...item, expectedSha256: item.sha256 }),
    /exact één Unix-regel/,
  );

  await writeFile(item.checksumPath, `${otherSha256}  ${item.name}\n`);
  await assert.rejects(
    verifyPortableChecksum({ ...item, expectedSha256: item.sha256 }),
    /driemaal exact overeen/,
  );

  await writeFile(item.checksumPath, `${item.sha256}  ${item.name}\n`);
  await assert.rejects(
    verifyPortableChecksum({ ...item, expectedSha256: otherSha256 }),
    /driemaal exact overeen/,
  );
});
