import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sanitizeE2eArtefacten } from "./sanitize-e2e-artifacts.mjs";

test("E2E-artifacts houden een bruikbare trace zonder netwerkdata of testgeheimen", async () => {
  const basis = await mkdtemp(join(tmpdir(), "bp-artifact-test-"));
  const bron = join(basis, "bron");
  const doel = join(basis, "resultaten");
  await mkdir(bron);
  await mkdir(doel);
  await writeFile(
    join(bron, "0-trace.trace"),
    '{"type":"before","params":{"value":"WP3-E2E-Aa1!"},"email":"wp3-a-bestuurder@e2e.invalid"}\n',
  );
  await writeFile(
    join(bron, "0-trace.network"),
    '{"headers":[{"name":"cookie","value":"sb-local-auth-token=geheim"}]}\n',
  );
  execFileSync("zip", ["-q", "-r", join(doel, "trace-hash.zip"), "."], { cwd: bron });
  await writeFile(join(doel, "error-context.md"), "Bearer eyJaaa.bbb.ccc");

  try {
    await sanitizeE2eArtefacten([doel]);
    const uitpak = join(basis, "uitpak");
    await mkdir(uitpak);
    execFileSync("unzip", ["-q", join(doel, "trace-hash.zip"), "-d", uitpak]);
    const trace = await readFile(join(uitpak, "0-trace.trace"), "utf8");
    const context = await readFile(join(doel, "error-context.md"), "utf8");

    assert.match(trace, /\[REDACTED\]/);
    assert.doesNotMatch(trace, /WP3-E2E|@e2e\.invalid/);
    const inhoud = execFileSync("unzip", ["-Z1", join(doel, "trace-hash.zip")], { encoding: "utf8" });
    assert.doesNotMatch(inhoud, /\.network$/m);
    assert.doesNotMatch(context, /eyJaaa|bbb|ccc/);
  } finally {
    await rm(basis, { recursive: true, force: true });
  }
});
