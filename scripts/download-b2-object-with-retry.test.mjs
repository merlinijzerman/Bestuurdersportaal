import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/download-b2-object-with-retry.sh", ...args], {
      cwd: repositoryRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixture(fakeAwsLines) {
  const root = await mkdtemp(path.join(os.tmpdir(), "b2-download-retry-"));
  const encryptedRoot = path.join(root, "luks");
  const fakeBin = path.join(root, "bin");
  await mkdir(encryptedRoot);
  await mkdir(fakeBin);
  const awsPath = path.join(fakeBin, "aws");
  await writeFile(awsPath, ["#!/usr/bin/env bash", "set -Eeuo pipefail", ...fakeAwsLines, ""].join("\n"));
  await chmod(awsPath, 0o700);
  return {
    root,
    encryptedRoot,
    destination: path.join(encryptedRoot, "archive.tar.gz"),
    attemptsPath: path.join(root, "attempts"),
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      MANAGED_RESTORE_ROOT: encryptedRoot,
      B2_DOWNLOAD_MAX_ATTEMPTS: "3",
      B2_DOWNLOAD_RETRY_DELAY_SECONDS: "0",
      ATTEMPTS_PATH: path.join(root, "attempts"),
    },
  };
}

test("verwijdert een incomplete download en slaagt met een begrensde retry", async () => {
  const data = await fixture([
    "attempts=0; [ -f \"$ATTEMPTS_PATH\" ] && attempts=$(cat \"$ATTEMPTS_PATH\")",
    "attempts=$((attempts + 1)); printf '%s' \"$attempts\" > \"$ATTEMPTS_PATH\"",
    "if [ \"$attempts\" -eq 1 ]; then printf 'partial' > \"$4\"; exit 1; fi",
    "printf 'complete-payload' > \"$4\"",
  ]);
  try {
    const payload = "complete-payload";
    const sha = createHash("sha256").update(payload).digest("hex");
    const result = await run(["s3://bucket/object", data.destination, "https://example.invalid", `${payload.length}`, sha], data.env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(data.destination, "utf8"), payload);
    assert.equal(await readFile(data.attemptsPath, "utf8"), "2");
    assert.doesNotMatch(result.stderr, /bucket\/object|partial/);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test("weigert corrupte succesvolle downloads en stopt na de ingestelde limiet", async () => {
  const data = await fixture([
    "attempts=0; [ -f \"$ATTEMPTS_PATH\" ] && attempts=$(cat \"$ATTEMPTS_PATH\")",
    "attempts=$((attempts + 1)); printf '%s' \"$attempts\" > \"$ATTEMPTS_PATH\"",
    "printf 'corrupt' > \"$4\"",
  ]);
  try {
    const sha = createHash("sha256").update("expected").digest("hex");
    const result = await run(["s3://bucket/private-name", data.destination, "https://example.invalid", "8", sha], data.env);
    assert.equal(result.code, 1);
    assert.equal(await readFile(data.attemptsPath, "utf8"), "3");
    assert.doesNotMatch(result.stderr, /private-name|corrupt/);
    await assert.rejects(readFile(data.destination));
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test("weigert ieder doel buiten de versleutelde root vóór aws wordt aangeroepen", async () => {
  const data = await fixture(["exit 99"]);
  try {
    const result = await run(["s3://bucket/object", path.join(data.root, "outside"), "https://example.invalid"], data.env);
    assert.equal(result.code, 64);
    assert.match(result.stderr, /versleutelde runneropslag/);
    await assert.rejects(readFile(data.attemptsPath));
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});
