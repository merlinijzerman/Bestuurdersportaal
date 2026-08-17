#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ALLOWED_SCHEMAS = new Set(["auth", "storage"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function prepareManagedDataDump({ sql, schema }) {
  if (!ALLOWED_SCHEMAS.has(schema)) throw new Error(`Onverwacht managed schema: ${schema}`);
  if (typeof sql !== "string" || !sql.trim()) throw new Error("Managed data-dump is leeg");

  const identifier = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)`;
  const generatedToggle = new RegExp(
    String.raw`^ALTER TABLE (?:ONLY )?${escapeRegExp(schema)}\.${identifier} (?:DISABLE|ENABLE) TRIGGER ALL;\r?$`,
    "gm",
  );
  let removedTriggerStatements = 0;
  const preparedSql = sql.replace(generatedToggle, () => {
    removedTriggerStatements += 1;
    return "";
  });

  const remainingToggle = preparedSql.match(
    /^\s*ALTER TABLE .* (?:DISABLE|ENABLE) TRIGGER (?:ALL|USER);\s*$/gim,
  );
  if (remainingToggle?.length) {
    throw new Error("Managed data-dump bevat een onverwachte triggerwijziging");
  }
  return { sql: preparedSql, removed_trigger_statements: removedTriggerStatements };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Onbekend argument: ${argument}`);
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Waarde ontbreekt voor --${key}`);
    args.set(key, value);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const schema = args.get("schema");
  const input = args.get("input");
  const output = args.get("output");
  if (!schema || !input || !output) throw new Error("--schema, --input en --output zijn verplicht");
  if (input === output) throw new Error("Output moet afwijken van input zodat het bronbewijs intact blijft");

  const result = prepareManagedDataDump({ sql: await readFile(input, "utf8"), schema });
  await writeFile(output, result.sql, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({ ok: true, schema, removed_trigger_statements: result.removed_trigger_statements })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Managed data voorbereiden mislukt: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
