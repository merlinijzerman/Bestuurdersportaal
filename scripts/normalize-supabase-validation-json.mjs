#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ALLOWED_PSQL_STATUS_LINES = new Set([
  "Output format is unaligned.",
  "Tuples only is on.",
  "Pager usage is off.",
]);
const PSQL_STATUS_PREFIX = /^(Output format is|Tuples only is|Pager usage is)/;

export function normalizeValidationJson(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Database-validatiebestand is leeg");
  }

  const seenStatusLines = new Set();
  const kept = [];
  let jsonStarted = false;

  for (const rawLine of input.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (ALLOWED_PSQL_STATUS_LINES.has(line)) {
      if (jsonStarted) throw new Error("psql-statusregel na begin van database-validatie-JSON geweigerd");
      if (seenStatusLines.has(line)) throw new Error("Dubbele psql-statusregel in database-validatie geweigerd");
      seenStatusLines.add(line);
      continue;
    }
    if (PSQL_STATUS_PREFIX.test(line)) {
      throw new Error("Onbekende psql-statusregel in database-validatie geweigerd");
    }
    if (line.trim() !== "") jsonStarted = true;
    kept.push(line);
  }

  const jsonText = kept.join("\n").trim();
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch {
    throw new Error("Database-validatie bevat geen geldig enkel JSON-document");
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Database-validatie moet een JSON-object zijn");
  }

  return {
    json: `${JSON.stringify(value, null, 2)}\n`,
    removedStatusLines: seenStatusLines.size,
  };
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
  if (!values.input || !values.output) throw new Error("--input en --output zijn verplicht");
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const normalized = normalizeValidationJson(await readFile(args.input, "utf8"));
  await writeFile(args.output, normalized.json, { encoding: "utf8", mode: 0o600 });
  process.stderr.write(
    `Database-validatie genormaliseerd; ${normalized.removedStatusLines} bekende psql-statusregel(s) verwijderd.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
