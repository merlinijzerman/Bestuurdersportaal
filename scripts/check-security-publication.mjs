import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "security/publicatie-manifest.json");

function fail(message) {
  console.error(`Securitypublicatiecheck rood: ${message}`);
  process.exitCode = 1;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1) fail("onbekende manifestversie");
if (manifest.defaultClassification !== "private") {
  fail("defaultClassification moet private zijn (fail-closed)");
}

const publicPaths = Array.isArray(manifest.public) ? manifest.public : [];
const frozenEntries = Array.isArray(manifest.legacyFrozen)
  ? manifest.legacyFrozen
  : [];
const frozenPaths = frozenEntries.map((entry) => entry.path);
const classified = [...publicPaths, ...frozenPaths];

for (const path of classified) {
  if (
    typeof path !== "string" ||
    !path.startsWith("security/") ||
    path.includes("..")
  ) {
    fail(`ongeldig manifestpad: ${String(path)}`);
  }
}
if (new Set(classified).size !== classified.length) {
  fail("een securitybestand staat dubbel of in beide klassen");
}

const tracked = execFileSync("git", ["ls-files", "security"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();

for (const path of tracked) {
  if (!classified.includes(path)) {
    fail(`${path} mist expliciete classificatie (default = private)`);
  }
}
for (const path of classified) {
  try {
    readFileSync(resolve(repoRoot, path));
  } catch {
    fail(`${path} staat in het manifest maar ontbreekt`);
  }
}

for (const entry of frozenEntries) {
  if (
    typeof entry.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)
  ) {
    fail(`${entry.path} heeft geen geldige gepinde sha256`);
    continue;
  }
  const actual = createHash("sha256")
    .update(readFileSync(resolve(repoRoot, entry.path)))
    .digest("hex");
  if (actual !== entry.sha256) {
    fail(
      `${entry.path} is legacy_frozen en gewijzigd; schrijf nieuwe operationele ` +
        "informatie in de private laag"
    );
  }
}

if (!process.exitCode) {
  console.log(
    `Securitypublicatiecheck groen: ${publicPaths.length} publiek, ` +
      `${frozenEntries.length} legacy bevroren, default privé.`
  );
}
