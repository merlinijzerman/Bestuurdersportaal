#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CHECKSUM_LINE_PATTERN = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/;

export async function verifyPortableChecksum({ dataPath, checksumPath, expectedSha256 }) {
  if (!SHA256_PATTERN.test(expectedSha256)) {
    throw new Error("Verwachte SHA-256 heeft geen geldig formaat");
  }

  const checksumText = await readFile(checksumPath, "utf8");
  const lines = checksumText.endsWith("\n")
    ? checksumText.slice(0, -1).split("\n")
    : checksumText.split("\n");
  if (lines.length !== 1 || lines[0].includes("\r")) {
    throw new Error("Checksumbestand moet exact één Unix-regel bevatten");
  }

  const match = CHECKSUM_LINE_PATTERN.exec(lines[0]);
  if (!match) throw new Error("Checksumbestand heeft geen ondersteund formaat");

  const [, recordedSha256, recordedPath] = match;
  if (path.posix.basename(recordedPath) !== path.basename(dataPath)) {
    throw new Error("Checksumbestand hoort niet bij het databestand");
  }

  const actualSha256 = createHash("sha256").update(await readFile(dataPath)).digest("hex");
  if (recordedSha256 !== actualSha256 || expectedSha256 !== actualSha256) {
    throw new Error("SHA-256 komt niet driemaal exact overeen");
  }

  return { schema_version: 1, status: "verified" };
}

async function main() {
  const [dataPath, checksumPath, expectedSha256] = process.argv.slice(2);
  if (!dataPath || !checksumPath || !expectedSha256) {
    throw new Error("Portable checksumcontrole mist verplichte inputs");
  }
  const result = await verifyPortableChecksum({ dataPath, checksumPath, expectedSha256 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("PORTABLE_CHECKSUM_FAILED\n");
    process.exitCode = 1;
  });
}
