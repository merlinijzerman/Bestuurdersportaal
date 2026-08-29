import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directories = ["core/lib", "platform/lib", "tests/karakterisering"];

const files = directories.flatMap((directory) =>
  readdirSync(resolve(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sanity.ts"))
    .map((entry) => `${directory}/${entry.name}`)
).sort();

if (files.length === 0) {
  console.error("Geen resterende sanity-suites gevonden.");
  process.exit(1);
}

const failures = [];

for (const file of files) {
  console.log(`> ${file}`);
  const result = spawnSync(process.execPath, ["--import", "tsx", file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) failures.push(file);
}

if (failures.length > 0) {
  console.error(`\nSANITY ROOD in:\n${failures.map((file) => `  - ${file}`).join("\n")}`);
  process.exit(1);
}

console.log("\nAlle resterende sanity-suites groen.");
