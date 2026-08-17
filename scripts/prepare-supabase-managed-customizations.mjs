#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ALLOWED_PSQL_STATUS_LINES = new Set([
  "Output format is unaligned.",
  "Tuples only is on.",
  "Pager usage is off.",
]);

const PSQL_STATUS_PREFIX = /^(Output format is|Tuples only is|Pager usage is)/;

export function prepareManagedCustomizations(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Managed-customizations SQL is leeg");
  }

  let removedStatusLines = 0;
  const kept = [];
  for (const rawLine of input.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (ALLOWED_PSQL_STATUS_LINES.has(line)) {
      removedStatusLines += 1;
      continue;
    }
    if (PSQL_STATUS_PREFIX.test(line)) {
      throw new Error(`Onverwachte psql-statusregel: ${line}`);
    }
    kept.push(rawLine);
  }

  const sql = kept.join("\n");
  if (sql.trim() === "") {
    throw new Error("Managed-customizations SQL bevat na voorbereiding geen SQL");
  }
  return { sql, removedStatusLines };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Gebruik: --input <bestand> --output <bestand>");
    }
    values[key.slice(2)] = value;
  }
  if (!values.input || !values.output) {
    throw new Error("--input en --output zijn verplicht");
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await readFile(args.input, "utf8");
  const prepared = prepareManagedCustomizations(input);
  await writeFile(args.output, prepared.sql, { encoding: "utf8", mode: 0o600 });
  process.stderr.write(
    `Managed customizations voorbereid; ${prepared.removedStatusLines} bekende psql-statusregel(s) verwijderd.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
